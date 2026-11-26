/* ══════════════════════════════════════════════════════════════════════════
   pages/map-edit.js — ส่วนประกอบของโหมดจัดวางปุ่มบนหน้าแผนผัง

   • แถบคำสั่ง (ติดขอบล่างจอ) — บนมือถือแผงด้านข้างไปอยู่ใต้รูป ต้องเลื่อนหาทุกครั้ง
     จึงย้ายทุกคำสั่งที่ใช้ระหว่างจัดวางมาไว้ที่แถบนี้ที่เดียว ทั้งมือถือและคอมพิวเตอร์
   • หน้าต่าง "แบ่งชั้นอัตโนมัติ"
   • บันทึกร่างทั้งหมดขึ้นหลังบ้าน (ใช้ placeSave ตัวเดิม ไม่ต้องแก้ Apps Script)
   ══════════════════════════════════════════════════════════════════════════ */
import { api } from '../api.js';
import { $, esc, openModal, PLACE_KIND_TH, icon } from '../ui.js';
import { ZONE_COLORS } from '../dialogs.js';
import {
  KIND_PREFIX, MAX_GRID_CELLS, childKind, childKinds, nextNumber, gridNames,
  gridConflicts, namesOf, dirtyCount, pendingOps
} from '../zone-draft.js';

const ARROW = {
  up:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg>',
  down:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14m-6-6 6 6 6-6"/></svg>',
  left:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5m6-6-6 6 6 6"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>',
  undo:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
  grid:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3.5" width="16" height="17" rx="1.5"/><path d="M4 9h16M4 14.5h16"/></svg>'
};

/**
 * แถบคำสั่งระหว่างจัดวางปุ่ม
 * @param {Object} o { d, sel (รายการที่เลือก หรือ null), saving, canUndo }
 */
export function barHtml(o) {
  const { d, sel, saving } = o;
  const n = dirtyCount(d);
  const unplaced = d.items.filter(it => !it.zone);

  const top = `<div class="zb-row zb-main">
      <button class="btn btn-ghost btn-sm" data-ed="undo"${d.hist.length && !saving ? '' : ' disabled'} title="ย้อนกลับ (Ctrl+Z)">${ARROW.undo} ย้อนกลับ</button>
      <button class="btn btn-ghost btn-sm" data-ed="split"${saving ? ' disabled' : ''}>${ARROW.grid} แบ่งชั้นอัตโนมัติ</button>
      <span class="spacer"></span>
      ${n ? `<button class="btn btn-ghost btn-sm" data-ed="revert"${saving ? ' disabled' : ''}>ยกเลิกที่แก้</button>` : ''}
      <button class="btn btn-sm" data-ed="save"${n && !saving ? '' : ' disabled'}>
        ${saving ? esc(saving) : n ? `บันทึก <span class="zb-n">${n}</span>` : 'บันทึกแล้ว'}</button>
    </div>`;

  let mid = '';
  if (sel) {
    const kinds = childKinds(o.parentKind);
    mid = `<div class="zb-sel" data-sel="${esc(sel.id)}">
      <div class="zb-row">
        <label class="zb-name"><span class="sr-only">ชื่อปุ่ม</span>
          <input id="zb-name" value="${esc(sel.name)}" maxlength="80" autocomplete="off" enterkeyhint="done"
                 placeholder="ตั้งชื่อ เช่น ชั้น 2"></label>
        ${sel.isNew && kinds.length > 1 ? `<select id="zb-kind" title="ระดับ">${kinds.map(k =>
          `<option value="${k}"${k === sel.kind ? ' selected' : ''}>${esc(PLACE_KIND_TH[k])}</option>`).join('')}</select>` : ''}
      </div>
      ${sel.failed ? `<div class="zb-err">บันทึกไม่สำเร็จ: ${esc(typeof sel.failed === 'string' ? sel.failed : 'ลองใหม่อีกครั้ง')}</div>` : ''}
      ${sel.zone ? `<div class="zb-row zb-pad">
        <span class="zb-grp" aria-label="ขยับปุ่ม">
          <button class="zb-ic" data-nudge="left"  aria-label="ขยับซ้าย">${ARROW.left}</button>
          <button class="zb-ic" data-nudge="up"    aria-label="ขยับขึ้น">${ARROW.up}</button>
          <button class="zb-ic" data-nudge="down"  aria-label="ขยับลง">${ARROW.down}</button>
          <button class="zb-ic" data-nudge="right" aria-label="ขยับขวา">${ARROW.right}</button>
        </span>
        <span class="zb-grp" aria-label="ปรับขนาด">
          <button class="zb-ic zb-tx" data-size="w-" aria-label="แคบลง">กว้าง −</button>
          <button class="zb-ic zb-tx" data-size="w+" aria-label="กว้างขึ้น">กว้าง +</button>
          <button class="zb-ic zb-tx" data-size="h-" aria-label="เตี้ยลง">สูง −</button>
          <button class="zb-ic zb-tx" data-size="h+" aria-label="สูงขึ้น">สูง +</button>
        </span>
      </div>` : ''}
      <div class="zb-row">
        ${sel.zone ? `<button class="btn btn-ghost btn-sm" data-ed="dup">${icon.copy} ทำสำเนา</button>` : ''}
        ${sel.zone || sel.isNew ? `<button class="btn btn-ghost btn-sm btn-danger-text" data-ed="remove">${sel.isNew ? `${icon.trash} ลบปุ่มนี้` : 'เอาปุ่มออกจากรูป'}</button>` : ''}
        <details class="zb-more"><summary class="btn btn-ghost btn-sm"><span class="zb-dot" style="--c:${esc(sel.color || 'transparent')}"></span> สี</summary>
          <span class="swatches zb-colors">
            <button type="button" class="sw sw-none${sel.color ? '' : ' on'}" data-color="" title="สีอัตโนมัติ">∅</button>
            ${ZONE_COLORS.map(c => `<button type="button" class="sw${c === sel.color ? ' on' : ''}" data-color="${c}" style="--c:${c}" title="${c}"></button>`).join('')}
          </span></details>
        ${!sel.isNew ? `<button class="btn btn-ghost btn-sm" data-ed="details">${icon.edit} รายละเอียด</button>` : ''}
        <span class="spacer"></span>
        <button class="btn btn-ghost btn-sm" data-ed="deselect">ปิด</button>
      </div>
    </div>`;
  }

  const chips = unplaced.length ? `<div class="zb-row zb-chips">
      <span class="muted">ยังไม่มีปุ่มบนรูป:</span>
      ${unplaced.map(u => `<button class="chip${o.assign === u.id ? ' on' : ''}" data-assign="${esc(u.id)}">${esc(u.name)}</button>`).join('')}
    </div>` : '';

  return `<div class="zbar" id="zbar">${mid}${sel ? '' : chips}${top}</div>`;
}

/** ข้อความแนะนำเหนือรูป บอกว่าตอนนี้ลากแล้วจะเกิดอะไร */
export function hintHtml(o) {
  if (o.split) {
    const s = o.split;
    return `<div class="edit-bar">ลากกรอบครอบ <b>${s.rows} ชั้น${s.cols > 1 ? ' × ' + s.cols + ' ช่อง' : ''}</b> บนรูป
      <span class="spacer"></span>
      <button class="btn btn-ghost btn-sm" data-ed="split-whole">ใช้ทั้งรูป</button>
      <button class="btn btn-ghost btn-sm" data-ed="split-cancel">ยกเลิก</button></div>`;
  }
  if (o.assign) {
    return `<div class="edit-bar">ลากบนรูปเพื่อวางปุ่ม <b>${esc(o.assignName)}</b>
      <span class="spacer"></span><button class="btn btn-ghost btn-sm" data-ed="cancel-assign">ยกเลิก</button></div>`;
  }
  return `<div class="edit-bar">ลากบนที่ว่างของรูป = สร้างปุ่มใหม่ · ลากปุ่ม = ย้าย · ลากมุม = ปรับขนาด
    <span class="muted-inv">ยังไม่บันทึกจนกว่าจะกด "บันทึก"</span></div>`;
}

/**
 * หน้าต่างแบ่งชั้นอัตโนมัติ
 * @returns {Promise<null|{rows, cols, kind, prefix, start, bottomUp, whole}>}
 */
export function splitDialog({ d, parentKind }) {
  const kinds = childKinds(parentKind);
  const k0 = childKind(parentKind);
  const taken = namesOf(d);
  const startFor = prefix => nextNumber(prefix, taken);

  const m = openModal({
    title: 'แบ่งชั้นอัตโนมัติ',
    body: `<form id="sp-form" autocomplete="off">
      <p class="hint" style="margin-top:0">บอกว่ามีกี่ชั้น ระบบจะสร้างปุ่มเรียงให้ทั้งหมด แล้วค่อยลากปรับทีละปุ่มได้</p>
      <div class="row-2">
        <div class="field"><label for="sp-rows">จำนวนชั้น (บนลงล่าง)</label>
          <div class="stepper"><button type="button" data-step="rows:-1" aria-label="ลดจำนวนชั้น">−</button>
            <input id="sp-rows" name="rows" type="number" inputmode="numeric" min="1" max="30" value="4" required>
            <button type="button" data-step="rows:1" aria-label="เพิ่มจำนวนชั้น">+</button></div></div>
        <div class="field"><label for="sp-cols">ช่องต่อชั้น (ซ้ายไปขวา)</label>
          <div class="stepper"><button type="button" data-step="cols:-1" aria-label="ลดจำนวนช่อง">−</button>
            <input id="sp-cols" name="cols" type="number" inputmode="numeric" min="1" max="10" value="1" required>
            <button type="button" data-step="cols:1" aria-label="เพิ่มจำนวนช่อง">+</button></div></div>
      </div>
      <div class="row-2">
        <div class="field"><label for="sp-prefix">ชื่อขึ้นต้น</label>
          <input id="sp-prefix" name="prefix" value="${esc(KIND_PREFIX[k0] || '')}" maxlength="40" required></div>
        <div class="field"><label for="sp-start">เริ่มนับที่เลข</label>
          <input id="sp-start" name="start" type="number" inputmode="numeric" min="0" max="999" value="${startFor(KIND_PREFIX[k0] || '')}" required></div>
      </div>
      <div class="row-2">
        <div class="field"><label>เลขน้อยอยู่</label>
          <div class="sp-seg">
            <label><input type="radio" name="order" value="top" checked> ชั้นบนสุด</label>
            <label><input type="radio" name="order" value="bottom"> ชั้นล่างสุด</label></div></div>
        ${kinds.length > 1 ? `<div class="field"><label for="sp-kind">ระดับ</label>
          <select id="sp-kind" name="kind">${kinds.map(k => `<option value="${k}"${k === k0 ? ' selected' : ''}>${esc(PLACE_KIND_TH[k])}</option>`).join('')}</select></div>`
          : `<input type="hidden" name="kind" value="${esc(k0)}">`}
      </div>
      <div class="sp-prev" id="sp-prev" aria-live="polite"></div>
      <div class="field-err" id="sp-err" role="alert"></div>
    </form>`,
    foot: `<button class="btn btn-ghost" data-close>ยกเลิก</button>
           <span class="spacer"></span>
           <button class="btn btn-ghost" id="sp-whole">ใช้ทั้งรูป</button>
           <button class="btn" id="sp-ok">ลากกรอบบนรูป ${icon.chev}</button>`
  });

  const f = $('#sp-form', m.el);
  let prefixTouched = false, startTouched = false;
  const val = () => {
    const rows = parseInt(f.rows.value, 10), cols = parseInt(f.cols.value, 10);
    return { rows, cols, kind: f.kind.value, prefix: f.prefix.value.trim(),
             start: parseInt(f.start.value, 10), bottomUp: f.querySelector('[name=order]:checked').value === 'bottom' };
  };
  const check = v => {
    if (!(v.rows >= 1 && v.rows <= 30)) return 'จำนวนชั้นต้องอยู่ระหว่าง 1–30';
    if (!(v.cols >= 1 && v.cols <= 10)) return 'ช่องต่อชั้นต้องอยู่ระหว่าง 1–10';
    if (v.rows * v.cols > MAX_GRID_CELLS) return `สร้างได้ครั้งละไม่เกิน ${MAX_GRID_CELLS} ปุ่ม — ลดจำนวนชั้นหรือช่องลง`;
    if (!v.prefix) return 'กรุณาใส่ชื่อขึ้นต้น เช่น "ชั้น"';
    if (!(v.start >= 0)) return 'เลขเริ่มต้นต้องเป็นตัวเลข';
    const clash = gridConflicts(d, gridNames(v));
    if (clash.length) return `มีปุ่มชื่อ ${clash.slice(0, 3).map(n => '"' + n + '"').join(', ')}${clash.length > 3 ? ' …' : ''} อยู่บนรูปแล้ว — เปลี่ยนเลขเริ่มหรือชื่อขึ้นต้น`;
    return '';
  };
  const refresh = () => {
    const v = val();
    const err = check(v);
    $('#sp-err', m.el).textContent = err;
    $('#sp-ok', m.el).disabled = !!err;
    $('#sp-whole', m.el).disabled = !!err;
    if (!(v.rows >= 1 && v.cols >= 1 && v.rows <= 30 && v.cols <= 10)) { $('#sp-prev', m.el).innerHTML = ''; return; }
    const names = gridNames(v);
    const reuse = new Set(d.items.filter(it => !it.zone).map(it => it.name.toLowerCase()));
    $('#sp-prev', m.el).innerHTML = `<div class="sp-grid" style="--cols:${v.cols}">${names.flat().map(n =>
      `<span${reuse.has(n.toLowerCase()) ? ' class="re" title="ใช้ที่เก็บเดิมที่ยังไม่มีปุ่ม"' : ''}>${esc(n)}</span>`).join('')}</div>`;
  };

  f.addEventListener('input', e => {
    if (e.target.name === 'prefix') prefixTouched = true;
    if (e.target.name === 'start') startTouched = true;
    if (e.target.name === 'prefix' && !startTouched) f.start.value = startFor(f.prefix.value);
    if (e.target.name === 'kind' && !prefixTouched) {
      f.prefix.value = KIND_PREFIX[f.kind.value] || '';
      if (!startTouched) f.start.value = startFor(f.prefix.value);
    }
    refresh();
  });
  f.addEventListener('change', refresh);
  f.addEventListener('click', e => {
    const b = e.target.closest('[data-step]'); if (!b) return;
    const [name, by] = b.dataset.step.split(':');
    const inp = f[name];
    inp.value = Math.min(+inp.max, Math.max(+inp.min, (parseInt(inp.value, 10) || 0) + Number(by)));
    refresh();
  });
  f.addEventListener('submit', e => e.preventDefault());

  return new Promise(resolve => {
    const done = whole => { const v = val(); if (check(v)) return; m.close({ ...v, whole }); };
    $('#sp-ok', m.el).addEventListener('click', () => done(false));
    $('#sp-whole', m.el).addEventListener('click', () => done(true));
    m.closed.then(r => resolve(r || null));
    refresh();
  });
}

/**
 * ส่งร่างขึ้นหลังบ้านทีละคำสั่ง (หลังบ้านล็อกทีละคำขออยู่แล้ว ส่งพร้อมกันก็ไม่เร็วขึ้น
 * และลำดับปุ่มใหม่จะสลับกันได้) — คำสั่งที่พังไม่หยุดคำสั่งอื่น แต่ถูกเก็บไว้ให้ลองใหม่
 */
export async function saveDraft(d, onProgress) {
  const ops = pendingOps(d);
  const failed = [];
  let done = 0;
  for (let i = 0; i < ops.length; i++) {
    if (onProgress) onProgress(i + 1, ops.length);
    try { await api.placeSave(ops[i].payload); done++; }
    catch (e) { failed.push({ ...ops[i], message: e.message || 'บันทึกไม่สำเร็จ' }); }
  }
  return { done, failed, total: ops.length };
}
