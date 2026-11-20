/* ══════════════════════════════════════════════════════════════════════════
   ui.js — ส่วนประกอบหน้าจอที่ใช้ร่วมกันทุกหน้า
   ══════════════════════════════════════════════════════════════════════════ */

/* ── ดึง element ─────────────────────────────────────────────────────────── */
export const $  = (sel, root) => (root || document).querySelector(sel);
export const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];

/* ── กันข้อความจากผู้ใช้ไปเป็น HTML ──────────────────────────────────────── */
export function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ── แจ้งผลลัพธ์มุมจอ ────────────────────────────────────────────────────── */
export function toast(message, kind) {
  const wrap = $('#toasts');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' is-' + kind : '');
  el.setAttribute('role', kind === 'risk' ? 'alert' : 'status');
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), kind === 'risk' ? 7000 : 3800);
}

/* ── แถบสถานะการโหลดด้านบนจอ ─────────────────────────────────────────────── */
let busy = 0;
export function startBusy() {
  busy++;
  const b = $('#bar');
  if (b) { b.classList.remove('off'); b.classList.add('on'); }
}
export function endBusy() {
  busy = Math.max(0, busy - 1);
  if (busy === 0) {
    const b = $('#bar');
    if (b) { b.classList.remove('on'); b.classList.add('off'); }
  }
}
export async function withBusy(fn) {
  startBusy();
  try { return await fn(); } finally { endBusy(); }
}

/* ── วันที่ / ตัวเลข ─────────────────────────────────────────────────────── */

const dFmt = new Intl.DateTimeFormat('th-TH', { day: '2-digit', month: 'short', year: 'numeric' });
const dtFmt = new Intl.DateTimeFormat('th-TH', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
});

export function fmtDate(d) {
  if (!d) return '—';
  const dt = d instanceof Date ? d : new Date(d);
  return isNaN(dt.getTime()) ? '—' : dFmt.format(dt);
}

export function fmtDateTime(d) {
  if (!d) return '—';
  const dt = d instanceof Date ? d : new Date(d);
  return isNaN(dt.getTime()) ? '—' : dtFmt.format(dt);
}

const nFmt = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 4 });
export function fmtNum(n) {
  const v = Number(n);
  return isNaN(v) ? '—' : nFmt.format(v);
}

/** "อีก 42 วัน" / "เลยมา 5 วัน" */
export function fmtDays(days) {
  if (days === null || days === undefined) return '—';
  if (days < 0)  return 'เลยมา ' + fmtNum(-days) + ' วัน';
  if (days === 0) return 'วันนี้';
  return 'อีก ' + fmtNum(days) + ' วัน';
}

/* ── ยืนยันการทำรายการ ───────────────────────────────────────────────────── */
export function confirmAction(message) {
  return window.confirm(message);
}

/* ── ดาวน์โหลดเป็นไฟล์ CSV (ใส่ BOM ให้ Excel อ่านภาษาไทยถูก) ───────────── */
export function downloadCsv(filename, header, rows) {
  const cell = v => {
    const s = (v === null || v === undefined) ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const body = [header, ...rows].map(r => r.map(cell).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ── ไอคอน (เส้นเรียบ ขนาดเท่ากันทุกตัว) ─────────────────────────────────── */
export const icon = {
  search: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4.3-4.3"/></svg>`,
  stock:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h18M3 12h18M3 17h18"/></svg>`,
  upload: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2"/></svg>`,
  users:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 5.5a3 3 0 0 1 0 5.6M18 20c0-2-.6-3.5-1.6-4.6"/></svg>`,
  out:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/><circle cx="12" cy="12" r="9"/></svg>`,
  gear:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/></svg>`,
  plus:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`,
  clock:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/></svg>`,
  map:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 9.5h17M3.5 15h17M12 3.5v17"/></svg>`,
  camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.4"/></svg>`,
  image:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 18 5-5 4 4 3-3 4 4"/></svg>`,
  pin:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/></svg>`,
  back:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>`,
  chev:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>`,
  trash:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13"/></svg>`,
  copy:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>`,
  edit:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/></svg>`
};

/** รูปที่โหลดไม่ได้ → ลองลิงก์สำรอง แล้วค่อยซ่อนกรอบ (ลิงก์ Drive บางรูปแบบโหลดไม่ขึ้น) */
export function installImgFallback(fallbackUrl) {
  document.addEventListener('error', e => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.fid) return;
    if (!img.dataset.tried && fallbackUrl) {
      img.dataset.tried = '1';
      img.src = fallbackUrl.replace('{id}', img.dataset.fid).replace('{w}', img.dataset.w || '400');
    } else {
      img.classList.add('broken');
    }
  }, true);
}

/** ชื่อไทยของระดับที่เก็บ */
export const PLACE_KIND_TH = { ROOM: 'ห้อง', CABINET: 'ตู้/โต๊ะ', SHELF: 'ชั้น', BOX: 'กล่อง' };


/* ══════════════════════════════════════════════════════════════════════════
   หน้าต่างย่อย (ใช้ <dialog> ของเบราว์เซอร์ — จัดการโฟกัสและปุ่ม Esc ให้เอง)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * @param {Object} o { title, body, foot?, wide?, className?, onClose? }
 * @return {Object} { el, body, foot, close(result), setTitle(html), closed:Promise }
 */
export function openModal({ title, body, foot, wide, className, onClose }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal' + (wide ? ' wide' : '') + (className ? ' ' + className : '');
  dlg.innerHTML = `
    <div class="modal-card">
      <header class="modal-head">
        <h2>${title || ''}</h2>
        <button type="button" class="modal-x" data-close aria-label="ปิด">×</button>
      </header>
      <div class="modal-body">${body || ''}</div>
      ${foot !== undefined ? `<footer class="modal-foot">${foot}</footer>` : ''}
    </div>`;
  document.body.appendChild(dlg);

  let result;
  const handle = {
    el: dlg,
    body: $('.modal-body', dlg),
    foot: $('.modal-foot', dlg),
    close(r) { result = r; if (dlg.open) dlg.close(); },
    setTitle(t) { $('.modal-head h2', dlg).innerHTML = t; }
  };
  handle.closed = new Promise(resolve => {
    dlg.addEventListener('close', () => { dlg.remove(); if (onClose) onClose(result); resolve(result); });
  });
  dlg.addEventListener('click', e => {
    if (e.target === dlg) handle.close();                  // คลิกพื้นหลังเพื่อปิด
    if (e.target.closest('[data-close]')) handle.close();
  });
  dlg.showModal();
  return handle;
}

/** กล่องยืนยันแบบมีปุ่ม (แทน window.confirm ที่หน้าตาไม่เข้ากับระบบ) */
export function confirmBox({ title, message, okText, danger, cancelText }) {
  return new Promise(resolve => {
    const m = openModal({
      title: esc(title || 'ยืนยัน'),
      body: `<p class="pre">${esc(message || '')}</p>`,
      foot: `<button class="btn btn-ghost" data-close>${esc(cancelText || 'ยกเลิก')}</button>
             <button class="btn ${danger ? 'btn-risk' : ''}" id="cf-ok">${esc(okText || 'ตกลง')}</button>`
    });
    $('#cf-ok', m.el).addEventListener('click', () => m.close(true));
    m.closed.then(r => resolve(!!r));
  });
}

/** รันงานพร้อมปิดปุ่มกันกดซ้ำ และแสดงข้อผิดพลาดเป็น toast */
export async function run(btn, fn, okMsg) {
  if (btn) btn.disabled = true;
  try {
    const r = await withBusy(fn);
    if (okMsg) toast(okMsg, 'ok');
    return { ok: true, value: r };
  } catch (e) {
    toast(e.message || 'เกิดข้อผิดพลาด', 'risk');
    return { ok: false, error: e };
  } finally {
    if (btn && btn.isConnected) btn.disabled = false;
  }
}

/** อ่านค่าทุกช่องที่มี name="" ในกรอบที่ให้มา เป็น object */
export function readForm(root) {
  const out = {};
  $$('[name]', root).forEach(el => {
    if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; return; }
    if (el.type === 'checkbox') { out[el.name] = el.checked; return; }
    if (el.type === 'file') return;
    out[el.name] = el.value;
  });
  return out;
}

export function optionsHtml(list, selected, blankLabel) {
  let h = blankLabel !== undefined ? `<option value="">${esc(blankLabel)}</option>` : '';
  for (const v of list) {
    const val = typeof v === 'object' ? v.value : v;
    const lab = typeof v === 'object' ? v.label : v;
    h += `<option value="${esc(val)}"${String(val) === String(selected) ? ' selected' : ''}>${esc(lab)}</option>`;
  }
  return h;
}

export function datalistHtml(id, list) {
  return `<datalist id="${esc(id)}">${list.map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
}

export function todayYmd() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** ชื่อไทยของชนิดรายการใน ledger */
export const TXN_TH = {
  RECEIVE: 'รับเข้า', ISSUE: 'เบิกใช้', RETURN: 'คืน', ADJUST: 'ปรับยอด', DISPOSE: 'จำหน่ายออก', MOVE: 'ย้ายที่เก็บ'
};
