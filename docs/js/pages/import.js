/* ══════════════════════════════════════════════════════════════════════════
   pages/import.js — นำเข้าข้อมูลจาก CSV ของระบบเดิม

   ทำงาน 2 ขั้นเสมอ: ตรวจสอบก่อน (ไม่เขียนอะไร) → แล้วจึงบันทึก
   ══════════════════════════════════════════════════════════════════════════ */

import { api } from '../api.js';
import { clearSnapshot } from '../store.js';
import { $, esc, toast, withBusy, fmtNum, confirmAction, icon } from '../ui.js';

let file = null;
let csv  = null;
let prev = null;

export function render(root) {
  root.innerHTML = `
    <div class="view-head">
      <h1>นำเข้าข้อมูลจากระบบเดิม</h1>
      <p>รับไฟล์จากปุ่ม "ดาวน์โหลด CSV" ของระบบเดิม หรือตารางเก่า 16 คอลัมน์ได้โดยตรง —
         ระบบจะแยกข้อมูลเป็นสาร ล็อต และรายการรับเข้าให้เอง โดยยอดคงเหลือจะเท่ากับยอดในไฟล์
         (Balance หรือ Label W.) ทุกรายการ</p>
    </div>

    <div class="note note-info" id="imp-kind-note">ของที่นำเข้าจากระบบเดิมจะถูกตั้งเป็นชนิด <b>สารเคมี</b> ทั้งหมด
      (ระบบเดิมมีแต่สารเคมี) — ถ้ามีวัสดุหรือครุภัณฑ์ปนมา ให้แก้คอลัมน์ ItemKind ในชีต Materials หลังนำเข้า
      ดูขั้นตอนใน SETUP.md หัวข้อ "ย้ายข้อมูลจากระบบเดิม"</div>

    <div class="panel">
      <input id="file" type="file" accept=".csv,text/csv" class="sr">
      <label class="drop" id="drop" for="file">
        ${icon.upload}
        <b id="drop-name">เลือกไฟล์ CSV หรือลากไฟล์มาวางที่นี่</b>
        <span id="drop-hint">รองรับไฟล์ที่มีหรือไม่มีแถวหัวตาราง</span>
      </label>

      <div class="row-3" style="margin-top:16px">
        <div class="field">
          <label for="d-fy">ปีงบประมาณ (ถ้าไฟล์ไม่มี)</label>
          <input id="d-fy" type="text" inputmode="numeric" placeholder="เช่น 2569">
          <span class="hint">เว้นว่างไว้ ระบบจะคิดจากวันรับเข้าให้</span>
        </div>
        <div class="field">
          <label for="d-unit">หน่วยนับตั้งต้น</label>
          <select id="d-unit">
            <option value="g">g — กรัม</option>
            <option value="mL">mL — มิลลิลิตร</option>
            <option value="kg">kg — กิโลกรัม</option>
            <option value="L">L — ลิตร</option>
            <option value="pcs">pcs — ชิ้น</option>
          </select>
        </div>
        <div class="field">
          <label for="d-room">ห้องตั้งต้น (ถ้าไฟล์ไม่มี)</label>
          <input id="d-room" type="text" placeholder="เช่น Room 101">
        </div>
      </div>

      <div class="form-actions">
        <button id="btn-check" class="btn" disabled>ตรวจสอบข้อมูล</button>
        <button id="btn-commit" class="btn btn-ghost hidden">บันทึกเข้าระบบ</button>
      </div>
    </div>

    <div id="report"></div>
  `;

  wire();
}

function wire() {
  const input = $('#file');
  const drop  = $('#drop');

  input.addEventListener('change', () => pick(input.files[0]));

  ['dragenter', 'dragover'].forEach(ev =>
    drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev =>
    drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));

  drop.addEventListener('drop', e => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) pick(f);
  });

  $('#btn-check').addEventListener('click', check);
  $('#btn-commit').addEventListener('click', commit);
}

async function pick(f) {
  if (!f) return;
  if (f.size > 8 * 1024 * 1024) {
    toast('ไฟล์ใหญ่เกิน 8 MB — กรุณาแบ่งไฟล์ก่อนนำเข้า', 'risk');
    return;
  }

  file = f;
  prev = null;
  $('#btn-commit').classList.add('hidden');
  $('#report').innerHTML = '';

  csv = await readText(f);

  $('#drop-name').textContent = f.name;
  $('#drop-hint').textContent =
    `${fmtNum(Math.round(f.size / 1024))} KB · ${fmtNum(countLines(csv))} บรรทัด`;
  $('#btn-check').disabled = false;
}

/** อ่านไฟล์เป็นข้อความ — เดา encoding ให้ไฟล์เก่าที่บันทึกเป็น TIS-620 ด้วย */
function readText(f) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
    fr.onload = () => {
      const buf = fr.result;
      let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
      // ถ้าเจออักขระแทนที่เยอะ แปลว่าไฟล์ไม่ใช่ UTF-8 → ลองรหัสภาษาไทยเดิม
      const bad = (text.match(/�/g) || []).length;
      if (bad > 2) {
        try { text = new TextDecoder('windows-874').decode(buf); } catch { /* คงค่าเดิม */ }
      }
      resolve(text);
    };
    fr.readAsArrayBuffer(f);
  });
}

function countLines(text) {
  return text.split(/\r\n|\r|\n/).filter(l => l.trim()).length;
}

function defaults() {
  return {
    fiscalYear: $('#d-fy').value.trim(),
    unit:       $('#d-unit').value,
    room:       $('#d-room').value.trim()
  };
}

/* ── ขั้นที่ 1: ตรวจสอบ ──────────────────────────────────────────────────── */

async function check() {
  try {
    prev = await withBusy(() => api.importPreview({ csv, defaults: defaults() }));
    showReport(prev);
    $('#btn-commit').classList.toggle('hidden', prev.summary.new === 0);
    if (prev.summary.new === 0) toast('ไม่มีรายการใหม่ที่ต้องนำเข้า');
  } catch (e) {
    prev = null;
    $('#btn-commit').classList.add('hidden');
    $('#report').innerHTML = `<div class="note note-risk">${esc(e.message)}</div>`;
    toast(e.message, 'risk');
  }
}

/* ── ขั้นที่ 2: บันทึก ───────────────────────────────────────────────────── */

async function commit() {
  if (!prev) return;

  const msg = `บันทึกเข้าระบบ ${prev.summary.new} รายการ?\n\n` +
              `• สร้างสารใหม่ ${prev.newMaterials} รายการ\n` +
              `• ข้ามรายการที่มีอยู่แล้ว ${prev.summary.duplicate} รายการ\n` +
              `• ข้ามรายการที่ผิดพลาด ${prev.summary.error} รายการ`;
  if (!confirmAction(msg)) return;

  try {
    const res = await withBusy(() => api.importCommit({
      csv, fingerprint: prev.fingerprint, defaults: defaults()
    }));

    await clearSnapshot();   // บังคับให้หน้าคลังโหลดข้อมูลชุดใหม่

    $('#report').innerHTML = `
      <div class="note note-ok">
        <b>นำเข้าเรียบร้อย</b><br>
        เพิ่มล็อต ${fmtNum(res.lots)} ล็อต · สารใหม่ ${fmtNum(res.materials)} รายการ ·
        รายการเคลื่อนไหว ${fmtNum(res.transactions)} รายการ<br>
        ข้ามรายการซ้ำ ${fmtNum(res.skipped)} · ข้ามรายการผิดพลาด ${fmtNum(res.errors)}
      </div>
      <div class="note note-info">เปิดหน้า <b>คลังสารเคมีและวัสดุ</b> เพื่อตรวจสอบข้อมูลที่นำเข้าได้เลย</div>`;

    $('#btn-commit').classList.add('hidden');
    $('#btn-check').disabled = true;
    prev = null;
    toast(`นำเข้า ${res.imported} รายการเรียบร้อย`, 'ok');
  } catch (e) {
    toast(e.message, 'risk');
    if (e.code === 'FINGERPRINT_MISMATCH') {
      $('#report').innerHTML = `<div class="note note-warn">${esc(e.message)}</div>`;
      $('#btn-commit').classList.add('hidden');
    }
  }
}

/* ── ผลการตรวจสอบ ───────────────────────────────────────────────────────── */

function showReport(p) {
  const s = p.summary;

  const cats = Object.keys(p.newCategories)
    .filter(k => p.newCategories[k].length)
    .map(k => `<li><b>${esc(k)}</b> — ${p.newCategories[k].map(esc).join(', ')}</li>`)
    .join('');

  const issues = p.issues.length
    ? `<div class="issues">${p.issues.map(i => `
        <div class="issue lv-${esc(i.level)}">
          <span class="ln">บรรทัด ${i.line}</span>
          <span>${esc(i.message)}</span>
        </div>`).join('')}</div>`
    : '<p class="muted">ไม่พบข้อสังเกต</p>';

  const sample = p.sample.length ? `
    <div class="table-scroll">
      <table class="data">
        <thead><tr>
          <th>Code เดิม</th><th>สาร</th><th>ผู้จำหน่าย</th><th>ที่เก็บ</th>
          <th>ปีงบ</th><th class="right">รับเข้า</th><th class="right">คงเหลือ</th>
          <th>หมดอายุ</th>
        </tr></thead>
        <tbody>${p.sample.map(r => `
          <tr>
            <td class="mono">${esc(r.legacyCode || '—')}</td>
            <td><b>${esc(r.inci)}</b>${r.trade ? ' · <span class="muted">' + esc(r.trade) + '</span>' : ''}</td>
            <td>${esc(r.supplier || '—')}</td>
            <td>${esc(r.room || '—')}${r.shelf ? ' / ' + esc(r.shelf) : ''}</td>
            <td class="num">${esc(r.fiscalYear)}</td>
            <td class="right num">${fmtNum(r.qtyReceived)}</td>
            <td class="right num">${fmtNum(r.balance)}</td>
            <td class="num">${esc(r.expireDate || '—')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : '';

  $('#report').innerHTML = `
    <div class="panel">
      <h2>ผลการตรวจสอบ</h2>
      <p>${p.mode === 'header'
            ? 'ไฟล์นี้มีแถวหัวตาราง — จับคู่คอลัมน์ตามชื่อหัวตารางให้แล้ว'
            : 'ไฟล์นี้ไม่มีแถวหัวตาราง — อ่านตามลำดับคอลัมน์ของระบบเดิม 16 คอลัมน์'}</p>

      <div class="stats">
        <div class="stat"><div class="v">${fmtNum(s.new)}</div><div class="k">พร้อมนำเข้า</div></div>
        <div class="stat"><div class="v">${fmtNum(p.newMaterials)}</div><div class="k">สารใหม่</div></div>
        <div class="stat"><div class="v">${fmtNum(s.duplicate)}</div><div class="k">มีอยู่แล้ว · ข้าม</div></div>
        <div class="stat ${s.warning ? 'is-warn' : ''}"><div class="v">${fmtNum(s.warning)}</div><div class="k">ข้อสังเกต</div></div>
        <div class="stat ${s.error ? 'is-risk' : ''}"><div class="v">${fmtNum(s.error)}</div><div class="k">ผิดพลาด · ข้าม</div></div>
      </div>

      ${s.error ? `<div class="note note-risk">
        มี ${s.error} บรรทัดที่นำเข้าไม่ได้เพราะไม่มีชื่อสาร (คอลัมน์ INCI Name) — บรรทัดเหล่านี้จะถูกข้าม
        ส่วนบรรทัดที่เหลือนำเข้าได้ตามปกติ</div>` : ''}

      ${p.unmapped && p.unmapped.length ? `<div class="note note-warn">
        <b>คอลัมน์ที่ระบบไม่รู้จัก</b> (จะไม่ถูกนำเข้า): ${p.unmapped.map(esc).join(', ')}</div>` : ''}

      ${cats ? `<h3 style="margin-top:14px">Category ที่จะถูกสร้างใหม่</h3>
        <ul style="margin:6px 0 0;padding-left:20px;font-size:.9rem">${cats}</ul>` : ''}
    </div>

    ${sample ? `<div class="panel"><h2>ตัวอย่าง ${p.sample.length} รายการแรก</h2>${sample}</div>` : ''}

    <div class="panel">
      <h2>ข้อสังเกตทั้งหมด</h2>
      <p>รายการที่ขึ้นสีแดงจะถูกข้าม สีเหลืองนำเข้าได้แต่ควรตรวจทานภายหลัง</p>
      ${issues}
    </div>
  `;
}
