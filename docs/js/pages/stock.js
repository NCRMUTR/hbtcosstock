/* ══════════════════════════════════════════════════════════════════════════
   pages/stock.js — หน้าค้นหาคลังวัตถุดิบ (หน้าหลัก)
   ══════════════════════════════════════════════════════════════════════════ */

import { api, can } from '../api.js';
import { loadSnapshot, saveSnapshot } from '../store.js';
import { buildIndex, search, facet, getItems, coverOf } from '../search.js';
import { $, $$, esc, toast, withBusy, fmtDate, fmtDays, fmtNum, downloadCsv,
         confirmAction, icon } from '../ui.js';
import { openLotDetail } from '../detail.js';
import { txnDialog } from '../dialogs.js';
import { openItemForm } from '../form.js';
import { photoImg } from '../photo.js';
import { KIND_ORDER, KINDS, kindTag, kindLabel, canTxn } from '../kinds.js';

const CFG = window.APP_CONFIG;

let state = {
  q:       '',
  preset:  'all',
  filters: { kind: '', room: '', shelf: '', supplier: '', fiscalYear: '', func: '' },
  sort:    { key: 'name', dir: 'asc' },
  shown:   CFG.PAGE_SIZE,
  rows:    [],
  counts:  {},
  picked:  new Set(),
  version: null,
  builtAt: null
};

/* ── โครงหน้า ────────────────────────────────────────────────────────────── */

export function render(root) {
  root.innerHTML = `
    <div class="view-head">
      <h1>คลังวัตถุดิบ</h1>
      <p>พิมพ์เพื่อค้นหาได้ทันที — ชื่อสาร ชื่อการค้า เลข CAS รหัสล็อต หรือรหัสเดิมที่ติดบนขวด</p>
    </div>

    <div class="search-wrap">
      ${icon.search}
      <input id="q" type="search" autocomplete="off" spellcheck="false"
             placeholder="ค้นหาวัตถุดิบ…" aria-label="ค้นหาวัตถุดิบ">
      <button id="q-clear" class="search-clear hidden" aria-label="ล้างคำค้น">×</button>
    </div>

    <div class="chips" id="chips" role="group" aria-label="ตัวกรองด่วน"></div>

    <div class="filters">
      <select id="f-kind"     aria-label="ชนิดของ"></select>
      <select id="f-room"     aria-label="ห้อง"></select>
      <select id="f-shelf"    aria-label="ชั้นวาง"></select>
      <select id="f-supplier" aria-label="ผู้จำหน่าย"></select>
      <select id="f-fy"       aria-label="ปีงบประมาณ"></select>
      <select id="f-func"     aria-label="หน้าที่ของสาร"></select>
      <button id="f-reset" class="link-btn hidden">ล้างตัวกรอง</button>
    </div>

    <div id="bulk" class="note note-info hidden" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <span id="bulk-count"></span>
      <button class="btn btn-sm" data-shelf-state="On Shelf">คงไว้บนชั้น</button>
      <button class="btn btn-sm btn-risk" data-shelf-state="Eliminate">ทำลาย/นำออก</button>
      <button id="bulk-clear" class="link-btn">ยกเลิกการเลือก</button>
    </div>

    <div class="result-bar">
      <div class="result-count">
        <b id="r-count">—</b> รายการ
        <span class="result-time" id="r-time"></span>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="result-time" id="sync-info"></span>
        <button id="btn-sync" class="btn btn-ghost btn-sm">ซิงก์ข้อมูล</button>
        <button id="btn-csv"  class="btn btn-ghost btn-sm">ดาวน์โหลด CSV</button>
        ${can('staff') ? '<button id="btn-add" class="btn btn-sm">+ เพิ่มของ</button>' : ''}
      </div>
    </div>

    <div class="table-scroll">
      <table class="data" id="tbl">
        <thead><tr id="thead-row"></tr></thead>
        <tbody id="tbody"></tbody>
      </table>
    </div>
    <div class="more-row" id="more"></div>
  `;

  wire();
  load(false);
}

/* ── ผูกเหตุการณ์ ────────────────────────────────────────────────────────── */

function wire() {
  const q = $('#q');

  // กลับเข้าหน้านี้ใหม่ (เช่น ไปหน้าตัวเลือกแล้วกลับมา) — คำค้นเดิมยังอยู่ใน state
  // ต้องใส่กลับในช่องค้นหาด้วย ไม่งั้นผู้ใช้เห็นผลลัพธ์ถูกกรองโดยไม่รู้ว่ากรองด้วยอะไร
  if (state.q) {
    q.value = state.q;
    $('#q-clear').classList.remove('hidden');
  }

  // ค้นหาสด — ใช้ rAF ให้การพิมพ์ลื่น ไม่หน่วงเวลาเทียม
  let frame = null;
  q.addEventListener('input', () => {
    state.q = q.value;
    $('#q-clear').classList.toggle('hidden', !q.value);
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { state.shown = CFG.PAGE_SIZE; run(); });
  });

  q.addEventListener('keydown', e => {
    if (e.key === 'Escape') { q.value = ''; q.dispatchEvent(new Event('input')); }
  });

  $('#q-clear').addEventListener('click', () => {
    q.value = ''; q.focus(); q.dispatchEvent(new Event('input'));
  });

  $('#chips').addEventListener('click', e => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    state.preset = b.dataset.preset;
    state.shown  = CFG.PAGE_SIZE;
    run();
  });

  [['#f-kind', 'kind'], ['#f-room', 'room'], ['#f-shelf', 'shelf'], ['#f-supplier', 'supplier'],
   ['#f-fy', 'fiscalYear'], ['#f-func', 'func']].forEach(([sel, key]) => {
    $(sel).addEventListener('change', e => {
      state.filters[key] = e.target.value;
      state.shown = CFG.PAGE_SIZE;
      run();
    });
  });

  $('#f-reset').addEventListener('click', () => {
    state.filters = { kind: '', room: '', shelf: '', supplier: '', fiscalYear: '', func: '' };
    state.preset  = 'all';
    $('#q').value = ''; state.q = '';
    $('#q-clear').classList.add('hidden');
    fillFilters();
    state.shown = CFG.PAGE_SIZE;
    run();
  });

  $('#thead-row').addEventListener('click', e => {
    const b = e.target.closest('[data-sort]');
    if (!b) return;
    const key = b.dataset.sort;
    state.sort = (state.sort.key === key)
      ? { key, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'name' || key === 'location' ? 'asc' : 'asc' };
    run();
  });

  $('#tbody').addEventListener('change', e => {
    const cb = e.target.closest('input[type="checkbox"][data-lot]');
    if (!cb) return;
    if (cb.checked) state.picked.add(cb.dataset.lot);
    else            state.picked.delete(cb.dataset.lot);
    renderBulk();
  });

  $('#bulk').addEventListener('click', e => {
    const b = e.target.closest('[data-shelf-state]');
    if (b) return setShelfState(b.dataset.shelfState);
    if (e.target.id === 'bulk-clear') {
      state.picked.clear();
      $$('#tbody input[type="checkbox"]').forEach(c => { c.checked = false; });
      renderBulk();
    }
  });

  $('#more').addEventListener('click', e => {
    if (e.target.closest('#btn-more')) { state.shown += CFG.PAGE_SIZE; paint(); }
  });

  // เปิดรายละเอียดล็อต และปุ่มลัดทำรายการ (ผูกที่ตารางครั้งเดียว ใช้ได้กับแถวที่วาดใหม่)
  $('#tbody').addEventListener('click', e => {
    const open = e.target.closest('[data-open]');
    if (open) return openLotDetail(open.dataset.open, reload);

    const tx = e.target.closest('[data-tx]');
    if (tx) return txnDialog(tx.dataset.lot, tx.dataset.tx, reload);
  });

  const add = $('#btn-add');
  if (add) add.addEventListener('click', () => openItemForm({ mode: 'new', onSaved: reload }));

  $('#btn-sync').addEventListener('click', () => load(true));
  $('#btn-csv').addEventListener('click', exportCsv);
}

/** โหลดข้อมูลใหม่จากเซิร์ฟเวอร์แล้ววาดหน้าใหม่ — ใช้หลังบันทึกจากหน้าต่างย่อย */
async function reload() {
  await load(true);
}

/* ── โหลดข้อมูล ──────────────────────────────────────────────────────────── */

async function load(force) {
  try {
    await withBusy(async () => {
      let snap = force ? null : await loadSnapshot();

      if (snap) {
        // มีข้อมูลในเครื่องแล้ว — ถามเซิร์ฟเวอร์แค่เลขเวอร์ชัน (เบามาก)
        buildIndex(snap);
        state.version = snap.version;
        state.builtAt = snap.builtAt;
        fillFilters();
        run();

        try {
          const { version } = await api.version();
          if (version !== snap.version) snap = null;      // มีคนแก้ข้อมูล → โหลดใหม่
          else showSync('ข้อมูลตรงกับเซิร์ฟเวอร์');
        } catch {
          showSync('ใช้ข้อมูลที่เก็บไว้ในเครื่อง (ออฟไลน์)');
          return;
        }
      }

      if (!snap) {
        snap = await api.snapshot();
        buildIndex(snap);
        state.version = snap.version;
        state.builtAt = snap.builtAt;
        await saveSnapshot(snap);
        fillFilters();
        run();
        showSync('โหลดข้อมูลใหม่แล้ว');
      }
    });
  } catch (e) {
    $('#tbody').innerHTML = '';
    $('#more').innerHTML =
      `<div class="note note-risk" style="text-align:left">${esc(e.message)}</div>`;
    toast(e.message, 'risk');
  }
}

function showSync(msg) {
  const n = getItems().length;
  $('#sync-info').textContent = `${msg} · ${fmtNum(n)} ล็อตในคลัง`;
}

/* ── ตัวกรอง ─────────────────────────────────────────────────────────────── */

function fillFilters() {
  const set = (sel, label, field, chosen) => {
    const el = $(sel);
    const opts = facet(field);
    el.innerHTML = `<option value="">${esc(label)}</option>` +
      opts.map(v => `<option value="${esc(v)}"${v === chosen ? ' selected' : ''}>${esc(v)}</option>`).join('');
  };
  // ชนิดของมีครบ 3 ตัวเลือกเสมอ (ไม่ดึงจากข้อมูล) — คลังที่ยังไม่มีครุภัณฑ์ก็ยังเห็นว่ากรองได้
  $('#f-kind').innerHTML = '<option value="">ทุกชนิด</option>' + KIND_ORDER.map(k =>
    `<option value="${k}"${k === state.filters.kind ? ' selected' : ''}>${esc(KINDS[k].th)}</option>`).join('');
  set('#f-room',     'ทุกห้อง',         'room',       state.filters.room);
  set('#f-shelf',    'ทุกชั้นวาง',      'shelf',      state.filters.shelf);
  set('#f-supplier', 'ทุกผู้จำหน่าย',   'supplier',   state.filters.supplier);
  set('#f-fy',       'ทุกปีงบประมาณ',   'fiscalYear', state.filters.fiscalYear);
  set('#f-func',     'ทุกหน้าที่',      'func',       state.filters.func);
}

/* ── ค้นหาแล้ววาดผล ──────────────────────────────────────────────────────── */

function run() {
  const f = Object.assign({ preset: state.preset }, state.filters);
  const r = search(state.q, f, state.sort);
  state.rows   = r.rows;
  state.counts = r.counts;

  $('#r-count').textContent = fmtNum(r.rows.length);
  $('#r-time').textContent  = `ค้นใน ${r.ms} ms`;

  const dirty = state.q || state.preset !== 'all' ||
                Object.values(state.filters).some(Boolean);
  $('#f-reset').classList.toggle('hidden', !dirty);

  renderChips();
  renderHead();
  paint();
}

function renderChips() {
  const c = state.counts;
  const presets = [
    ['all',       'ทั้งหมด',       c.all],
    ['low',       'ใกล้หมด',       c.low],
    ['out',       'หมดสต็อก',      c.out],
    ['soon',      'ใกล้หมดอายุ',   c.soon],
    ['expired',   'หมดอายุแล้ว',   c.expired],
    ['eliminate', 'รอทำลาย',       c.eliminate]
  ];
  $('#chips').innerHTML = presets.map(([k, label, n]) => `
    <button class="chip" data-preset="${k}" aria-pressed="${state.preset === k}">
      ${esc(label)}<span class="count">${fmtNum(n || 0)}</span>
    </button>`).join('');
}

function renderHead() {
  const arrow = key => state.sort.key !== key ? '' : (state.sort.dir === 'asc' ? ' ↑' : ' ↓');
  const th = (key, label, cls) => `<th class="${cls || ''}">
      <button data-sort="${key}">${esc(label)}${arrow(key)}</button></th>`;

  $('#thead-row').innerHTML =
    (can('staff') ? '<th style="width:30px"><span class="sr">เลือก</span></th>' : '') +
    '<th class="pic-col"><span class="sr">รูป</span></th>' +
    th('name', 'รายการ / ชื่อการค้า') +
    th('balance', 'คงเหลือ', 'right') +
    th('location', 'ที่เก็บ') +
    '<th>ผู้จำหน่าย</th>' +
    '<th>ปีงบ</th>' +
    th('expire', 'วันหมดอายุ') +
    '<th>สถานะชั้นวาง</th>' +
    (can('staff') ? '<th class="c-act"><span class="sr">คำสั่ง</span></th>' : '');
}

function paint() {
  const rows = state.rows.slice(0, state.shown);
  const pick = can('staff');

  if (!rows.length) {
    $('#tbody').innerHTML = '';
    $('#more').innerHTML = `
      <div class="empty">
        <b>ไม่พบวัตถุดิบที่ตรงกับเงื่อนไข</b>
        ลองลดคำค้นให้สั้นลง หรือกดล้างตัวกรอง
      </div>`;
    return;
  }

  const html = rows.map(it => {
    const cls = it.shelfState === 'Eliminate' ? 's-elim' : 's-' + it.stock;
    const checked = state.picked.has(it.lotId) ? ' checked' : '';

    const ids = [
      it.legacyCode ? `<span class="mono">${esc(it.legacyCode)}</span>` : '',
      `<span class="mono">${esc(it.lotId)}</span>`,
      it.cas ? `CAS ${esc(it.cas)}` : ''
    ].filter(Boolean).join(' &nbsp; ');

    const expTag = it.expiry === 'expired' ? 'tag tag-risk'
                 : it.expiry === 'soon'    ? 'tag tag-warn'
                 : it.expiry === 'none'    ? 'tag tag-mute' : '';

    // รูปของล็อตก่อน ถ้ายังไม่มีก็ยืมรูปของสารมาแสดง (ขวดสารเดียวกันหน้าตาเหมือนกัน)
    const pic = coverOf('LOT', it.lotId) || coverOf('MATERIAL', it.materialId);

    return `<tr class="${cls}">
      ${pick ? `<td><input type="checkbox" data-lot="${esc(it.lotId)}"${checked}
                     aria-label="เลือก ${esc(it.name)}"></td>` : ''}
      <td class="pic-col">${pic
        ? photoImg(pic, 120, { cls: 'cell-pic', noRatio: true, alt: it.name })
        : '<span class="cell-pic is-none" aria-hidden="true"></span>'}</td>
      <td class="cell-name">
        <button class="name-btn" data-open="${esc(it.lotId)}" title="ดูรายละเอียดและประวัติ">
          <b>${esc(it.name)}</b>${it.inci && it.trade ? ' · <span class="muted">' + esc(it.trade) + '</span>' : ''}
        </button>
        <span class="cell-sub">${kindTag(it.kind)} ${ids}</span>
      </td>
      <td class="right">
        <span class="qty">${fmtNum(it.balance)}</span><span class="qty-unit">${esc(it.unit)}</span>
        ${it.stock === 'out' ? '<br><span class="tag tag-risk">หมด</span>'
          : it.stock === 'low' ? '<br><span class="tag tag-warn">ใกล้หมด</span>' : ''}
      </td>
      <td class="loc">${esc(it.room || '—')}${it.shelf ? '<span class="sep">/</span>' + esc(it.shelf) : ''}</td>
      <td>${esc(it.supplier || '—')}</td>
      <td class="num">${esc(it.fiscalYear || '—')}</td>
      <td>
        ${fmtDate(it.expireDate)}
        ${it.expireDate ? `<span class="cell-sub"><span class="${expTag}">${esc(fmtDays(it.daysLeft))}</span></span>` : ''}
      </td>
      <td>${it.shelfState === 'Eliminate'
            ? '<span class="tag tag-risk">รอทำลาย</span>'
            : '<span class="muted">—</span>'}</td>
      ${pick ? `<td class="c-act"><div class="qa-row">
        ${canTxn(it, 'ISSUE') ? `<button class="qa qa-minus" data-tx="ISSUE"  data-lot="${esc(it.lotId)}" title="เบิกใช้">− เบิก</button>` : ''}
        ${canTxn(it, 'RETURN') ? `<button class="qa qa-plus"  data-tx="RETURN" data-lot="${esc(it.lotId)}" title="คืนของ">+ คืน</button>` : ''}
        <button class="qa"          data-tx="ADJUST" data-lot="${esc(it.lotId)}" title="ปรับยอดคงเหลือ">ปรับยอด</button>
      </div></td>` : ''}
    </tr>`;
  }).join('');

  $('#tbody').innerHTML = html;

  const left = state.rows.length - rows.length;
  $('#more').innerHTML = left > 0
    ? `<button id="btn-more" class="btn btn-ghost">แสดงเพิ่ม (เหลืออีก ${fmtNum(left)} รายการ)</button>`
    : '';
}

/* ── เลือกหลายรายการเพื่อเปลี่ยนสถานะชั้นวาง ─────────────────────────────── */

function renderBulk() {
  const n = state.picked.size;
  $('#bulk').classList.toggle('hidden', n === 0);
  $('#bulk-count').textContent = `เลือกไว้ ${fmtNum(n)} ล็อต`;
}

async function setShelfState(newState) {
  const ids = [...state.picked];
  if (!ids.length) return;

  const label = newState === 'Eliminate' ? 'รอทำลาย/นำออก' : 'อยู่บนชั้น';
  if (!confirmAction(`เปลี่ยนสถานะ ${ids.length} ล็อต เป็น "${label}" ?`)) return;

  try {
    await withBusy(() => api.setShelfState(ids, newState));
    toast(`เปลี่ยนสถานะแล้ว ${ids.length} ล็อต`, 'ok');
    state.picked.clear();
    renderBulk();
    await load(true);          // ดึงข้อมูลใหม่ให้ตรงกับเซิร์ฟเวอร์
  } catch (e) {
    toast(e.message, 'risk');
  }
}

/* ── ส่งออกผลที่เห็นอยู่ ─────────────────────────────────────────────────── */

function exportCsv() {
  if (!state.rows.length) { toast('ไม่มีข้อมูลให้ดาวน์โหลด'); return; }

  const header = ['LotID', 'Legacy Code', 'INCI Name', 'Trade Name', 'CAS No.',
                  'Function', 'State', 'Supplier', 'Supplier Lot',
                  'Room', 'Shelf', 'Fiscal Year',
                  'Qty Received', 'Balance', 'Unit',
                  'Receive Date', 'Expire Date', 'Days Left', 'Shelf State', 'Item Kind'];

  const iso = d => (d ? new Date(d).toISOString().slice(0, 10) : '');

  const rows = state.rows.map(it => [
    it.lotId, it.legacyCode, it.inci, it.trade, it.cas,
    it.func, it.state, it.supplier, it.supplierLotNo,
    it.room, it.shelf, it.fiscalYear,
    it.qtyReceived, it.balance, it.unit,
    iso(it.receiveDate), iso(it.expireDate),
    it.daysLeft === null ? '' : it.daysLeft,
    it.shelfState, kindLabel(it.kind)
  ]);

  const stamp = new Date().toISOString().slice(0, 10);
  downloadCsv(`hbt-stock-${stamp}.csv`, header, rows);
  toast(`ดาวน์โหลด ${fmtNum(rows.length)} รายการแล้ว`, 'ok');
}
