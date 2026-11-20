/* ══════════════════════════════════════════════════════════════════════════
   pages/settings.js — จัดการรายการตัวเลือกที่ขึ้นในฟอร์มและตัวกรอง
   เรียก settings.add / settings.remove ที่หลังบ้านมีอยู่แล้ว
   ══════════════════════════════════════════════════════════════════════════ */
import { api, can, isAdmin } from '../api.js';
import { loadSnapshot, saveSnapshot } from '../store.js';
import { buildIndex, getSettings } from '../search.js';
import { $, $$, esc, toast, run, confirmBox, withBusy, icon } from '../ui.js';

/** ชนิดตัวเลือกที่มีในระบบ — ต้องตรงกับ SETTING_TYPES ใน gas/Config.gs */
const LISTS = [
  ['Room',        'ห้อง',            'เช่น Room 101 · ห้องเย็น'],
  ['Shelf',       'ชั้นวาง',          'เช่น Shelf A · ตู้ 1'],
  ['Supplier',    'ผู้จำหน่าย',        'ชื่อร้าน/บริษัทที่สั่งซื้อประจำ'],
  ['Function',    'หน้าที่ของสาร',     'เช่น Humectant · Thickener · Preservative'],
  ['State',       'สถานะสาร',         'เช่น Liquid · Powder · Solid'],
  ['Unit',        'หน่วยนับ',          'เช่น g · mL · kg · L · pcs'],
  ['FiscalYear',  'ปีงบประมาณ',       'เช่น 2569']
];

let root = null;

export function render(el) {
  root = el;
  el.innerHTML = `
    <div class="view-head">
      <h1>รายการตัวเลือก</h1>
      <p>ค่าที่ขึ้นในตัวกรองและฟอร์มต่าง ๆ — ลบออกแล้วข้อมูลเดิมที่ใช้ค่านี้ยังอยู่ครบ ไม่ถูกแก้</p>
    </div>
    ${isAdmin() ? '' : '<div class="note note-info">เพิ่มค่าใหม่ได้เลย ส่วนการลบค่าออกจากรายการต้องให้ผู้ดูแลระบบทำ</div>'}
    <div id="set-body"></div>`;

  wire();
  load();
}

function wire() {
  root.addEventListener('submit', async e => {
    const form = e.target.closest('[data-add]');
    if (!form) return;
    e.preventDefault();
    const type = form.dataset.add;
    const inp  = form.querySelector('input');
    const val  = inp.value.trim();
    if (!val) return;

    const r = await run(form.querySelector('button'), () => api.settingsAdd(type, val), 'เพิ่มแล้ว');
    if (r.ok) { inp.value = ''; await load(true); }
  });

  root.addEventListener('click', async e => {
    const rm = e.target.closest('[data-rm]');
    if (!rm) return;
    const type = rm.closest('[data-type]').dataset.type;
    const val  = rm.dataset.rm;
    if (!(await confirmBox({
      title: 'ลบ "' + val + '" ออกจากรายการ?', okText: 'ลบออก', danger: true,
      message: 'ค่านี้จะไม่ขึ้นในตัวกรองและฟอร์มอีก\nข้อมูลเดิมที่ใช้ค่านี้ยังอยู่ครบ ไม่ถูกแก้'
    }))) return;
    const r = await run(rm, () => api.settingsRemove(type, val), 'ลบออกแล้ว');
    if (r.ok) await load(true);
  });
}

async function load(force) {
  try {
    await withBusy(async () => {
      let snap = force ? null : await loadSnapshot();
      if (!snap) {
        snap = await api.snapshot();
        await saveSnapshot(snap);
      }
      buildIndex(snap);
      paint();
    });
  } catch (e) {
    $('#set-body', root).innerHTML = `<div class="note note-risk">${esc(e.message)}</div>`;
  }
}

function paint() {
  const settings = getSettings() || {};
  const editable  = can('staff');     // เพิ่มค่าใหม่ได้
  const removable = isAdmin();        // ลบออกได้ (หลังบ้านจำกัดไว้เฉพาะ admin)

  $('#set-body', root).innerHTML = LISTS.map(([type, label, hint]) => {
    const values = settings[type] || [];
    return `
      <section class="panel set-block" data-type="${esc(type)}">
        <div class="set-head">
          <h2>${esc(label)}</h2>
          <span class="muted">${values.length} รายการ</span>
        </div>
        <p class="hint">${esc(hint)}</p>
        <div class="chips">
          ${values.length
            ? values.map(v => `<span class="chip${removable ? ' chip-del' : ''}">${esc(v)}${removable
                ? `<button data-rm="${esc(v)}" aria-label="ลบ ${esc(v)}">×</button>` : ''}</span>`).join('')
            : '<span class="muted">ยังไม่มีรายการ</span>'}
        </div>
        ${editable ? `<form class="add-row" data-add="${esc(type)}" autocomplete="off">
          <input maxlength="80" placeholder="เพิ่ม${esc(label)}…" aria-label="เพิ่ม${esc(label)}" required>
          <button class="btn btn-ghost btn-sm">${icon.plus} เพิ่ม</button>
        </form>` : ''}
      </section>`;
  }).join('');
}
