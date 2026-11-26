/* ══════════════════════════════════════════════════════════════════════════
   pages/map.js — แผนผังที่เก็บ: ห้อง → ตู้/โต๊ะ → ชั้น → กล่อง

   • หน้าห้อง/ตู้แสดงรูปหลักของที่เก็บนั้น แล้ววางปุ่มของที่เก็บข้างในทับบนรูป
   • กดปุ่ม = ดูรายการล็อตที่อยู่ในนั้น · "เข้าไปดู" = ลงไปอีกชั้น
   • โหมดจัดวางปุ่ม: ลากบนรูปเพื่อสร้างปุ่มใหม่ · ลากปุ่มเพื่อย้าย · ลากมุมเพื่อปรับขนาด
     ทุกการแก้เก็บเป็น "ร่าง" ในเครื่องก่อน (zone-draft.js) ย้อนกลับได้ แล้วกดบันทึกครั้งเดียว
   ตำแหน่งปุ่มเก็บเป็นสัดส่วน (0–1) ของรูป จึงตรงเสมอไม่ว่าจอจะกว้างเท่าไร
   ══════════════════════════════════════════════════════════════════════════ */
import { api, can } from '../api.js';
import { loadSnapshot, saveSnapshot } from '../store.js';
import {
  buildIndex, getRoots, placeOf, pathOf, descendantIds, lotsIn, coverOf, getItems
} from '../search.js';
import {
  $, esc, toast, run, withBusy, fmtNum, fmtDays, icon, PLACE_KIND_TH, confirmBox
} from '../ui.js';
import { photoImg } from '../photo.js';
import { placeDialog, photosDialog, moveDialog, txnDialog, ZONE_COLORS } from '../dialogs.js';
import { openLotDetail } from '../detail.js';
import { openItemForm } from '../form.js';
import { canTxn } from '../kinds.js';
import * as Z from '../zone-draft.js';
import { barHtml, hintHtml, splitDialog, saveDraft } from './map-edit.js';

const MIN_DRAW = 0.025;      // ลากสั้นกว่านี้ถือว่าเป็นแค่การแตะ
const MIN_SIZE = 0.02;
const MAX_ROWS = 150;
const NUDGE = 0.005;         // ปุ่มลูกศรขยับทีละครึ่งเปอร์เซ็นต์ของรูป (Shift = 5 เท่า)
const RESIZE = 0.01;
const clamp = Z.clamp;

let root = null;
// draft = ร่างของปุ่มบนรูปของ placeId ระหว่างจัดวาง · split = ตั้งค่าแบ่งชั้นที่รอให้ลากกรอบ
let st = { placeId: '', sel: '', edit: false, assign: '', flash: '', draft: null, split: null, saving: '' };
let drag = null;
let nameSnap = null;

const dirty = () => st.edit && Z.isDirty(st.draft);

// ปิดแท็บ/รีเฟรชระหว่างมีงานค้าง → ให้เบราว์เซอร์ถามก่อน
window.addEventListener('beforeunload', e => {
  if (dirty()) { e.preventDefault(); e.returnValue = ''; }
});

/** ทิ้งร่างได้ไหม — ถามก่อนถ้ามีงานที่ยังไม่บันทึก */
async function okToDiscard() {
  if (!dirty()) return true;
  return confirmBox({
    title: 'ยังไม่ได้บันทึกปุ่ม',
    message: `มีการแก้ไขปุ่มบนรูป ${Z.dirtyCount(st.draft)} รายการที่ยังไม่ได้บันทึก\nถ้าออกตอนนี้ งานที่ทำไว้จะหายไป`,
    okText: 'ออกโดยไม่บันทึก', cancelText: 'กลับไปบันทึก', danger: true
  });
}

function leaveEdit() {
  st.edit = false; st.draft = null; st.split = null; st.assign = ''; st.saving = '';
}

/** app.js เรียกก่อนเปลี่ยนไปหน้าอื่น — false = ผู้ใช้ขออยู่ต่อ */
export async function confirmLeave() {
  if (!(await okToDiscard())) return false;
  leaveEdit();
  return true;
}

/** ให้หน้าอื่นสั่งเปิดแผนผังที่ที่เก็บหนึ่งได้ (เช่น ปุ่ม "ดูบนแผนผัง") */
export function focusPlace(placeId) {
  if (dirty()) return;                 // มีปุ่มที่ยังไม่บันทึก — app.js จะถามก่อนออกอยู่แล้ว
  const p = placeOf(placeId);
  if (!p) { st.placeId = ''; return; }
  if (p.parentId && p.zone && coverOf('PLACE', p.parentId)) {
    st.placeId = p.parentId; st.sel = p.id; st.flash = p.id;
  } else {
    st.placeId = p.id; st.sel = ''; st.flash = '';
  }
}

export function render(el) {
  // ผูกเหตุการณ์กับกล่องที่สร้างใหม่ทุกครั้ง ไม่ใช่กับ #main ที่อยู่ถาวร —
  // เดิมผูกกับ #main ทำให้เข้าหน้านี้กี่รอบก็ซ้อนตัวรับคลิกกี่ชุด แล้วไปทำงานบนหน้าคลังด้วย
  // กดเปิดรายการครั้งเดียวจึงได้หน้าต่างซ้อนหลายใบ ต้องกดกากบาทหลายครั้ง
  el.innerHTML = '<div class="map-page"><div id="map-body"></div></div>';
  root = el.firstElementChild;
  wire();
  load(false);
}

/* ── โหลดข้อมูล ───────────────────────────────────────────────────────── */
async function load(force) {
  try {
    await withBusy(async () => {
      let snap = force ? null : await loadSnapshot();
      if (!snap) {
        snap = await api.snapshot();
        await saveSnapshot(snap);
      }
      buildIndex(snap);
      draw();
    });
  } catch (e) {
    $('#map-body', root).innerHTML = `<div class="note note-risk">${esc(e.message)}</div>`;
  }
}
async function reload() { await load(true); }

/* ── ส่วนประกอบย่อย ───────────────────────────────────────────────────── */
const zoneColor = (p, i) => p.color || ZONE_COLORS[i % ZONE_COLORS.length];
const staff = () => can('staff');

function lotRow(it) {
  const qty = `${esc(fmtNum(it.balance))} ${esc(it.unit)}`;
  const exp = it.expiry === 'expired' ? '<span class="tag tag-risk">หมดอายุ</span>'
    : it.expiry === 'soon' ? `<span class="tag tag-warn" title="${esc(fmtDays(it.daysLeft))}">ใกล้หมดอายุ</span>` : '';
  const id = esc(it.lotId);
  const acts = !staff() ? '' : `
    ${canTxn(it, 'ISSUE') ? `<button class="qa qa-minus" data-tx="ISSUE"  data-lot="${id}">− เบิก</button>` : ''}
    <button class="qa"          data-tx="ADJUST" data-lot="${id}">ปรับยอด</button>
    <button class="qa"          data-mv="${id}">${icon.pin} ย้ายที่</button>`;

  return `<div class="u-item">
    <button class="u-row" data-open="${id}">
      <span class="u-thumb">${icon.image}</span>
      <span class="u-main"><b>${esc(it.name)}</b>
        <small><span class="mono">${esc(it.legacyCode || it.lotId)}</span>${it.trade ? ' · ' + esc(it.trade) : ''}</small></span>
      <span class="u-qty${it.balance <= 0 ? ' neg' : ''}">${qty}${exp}</span>
    </button>
    ${acts ? `<div class="u-acts">${acts}</div>` : ''}
  </div>`;
}

function lotList(lots, basePath) {
  if (!lots.length) return '<div class="empty small"><b>ยังไม่มีของในที่เก็บนี้</b></div>';
  const groups = new Map();
  for (const it of lots) {
    if (!groups.has(it.placeId)) groups.set(it.placeId, []);
    groups.get(it.placeId).push(it);
  }
  const keys = [...groups.keys()].sort((a, b) =>
    (placeOf(a) ? placeOf(a).pathText : '').localeCompare(placeOf(b) ? placeOf(b).pathText : '', 'th', { numeric: true }));

  let shown = 0, html = '';
  for (const k of keys) {
    const pl = placeOf(k);
    const list = groups.get(k).sort((a, b) => a.name.localeCompare(b.name, 'th'));
    let head = '';
    if (keys.length > 1 || (pl && pl.pathText !== basePath)) {
      const label = pl ? (pl.pathText.replace(basePath ? basePath + ' › ' : '', '') || pl.name) : '';
      head = `<div class="grp">${esc(label)}</div>`;
    }
    let rows = '';
    for (const it of list) {
      if (shown >= MAX_ROWS) break;
      rows += lotRow(it); shown++;
    }
    if (rows) html += head + rows;
  }
  if (lots.length > shown) {
    html += `<div class="muted note-small">แสดง ${shown} จาก ${lots.length} ล็อต — เข้าไปดูข้างในเพื่อดูที่เหลือ</div>`;
  }
  return `<div class="u-list">${html}</div>`;
}

/* ── หน้าแรก: รายการห้อง ──────────────────────────────────────────────── */
function drawRoot() {
  const roots = getRoots().map(id => placeOf(id));
  const noPlace = getItems().filter(it => !it.placeId).length;

  $('#map-body', root).innerHTML = `
    <div class="view-head">
      <h1>แผนผังที่เก็บ</h1>
      <p>เลือกห้อง ตู้ หรือโต๊ะ เพื่อดูว่าอะไรอยู่ตรงไหน</p>
    </div>
    <div class="head-acts">
      ${staff() ? `<button class="btn" data-act="add-root">${icon.plus} เพิ่มห้อง/ที่เก็บ</button>` : ''}
    </div>
    ${noPlace ? `<div class="note note-warn">มีของ ${noPlace} ล็อตที่ยังไม่ได้ผูกกับที่เก็บ —
      ย้ายเข้าที่เก็บได้จากหน้าคลังสารเคมีและวัสดุ หรือให้ผู้ดูแลระบบรัน <code>migratePlaces</code> ใน Apps Script
      เพื่อย้ายข้อมูล Room/Shelf เดิมเข้ามาทีเดียว</div>` : ''}
    ${roots.length ? `<div class="room-grid">${roots.map(p => {
      const cov = coverOf('PLACE', p.id);
      return `<button class="room-card" data-go="${esc(p.id)}">
        <span class="room-photo">${cov ? photoImg(cov, 640, { noRatio: true }) : icon.map}</span>
        <span class="room-body"><span class="muted">${esc(PLACE_KIND_TH[p.kind] || p.kind)}</span>
          <b>${esc(p.name)}</b>
          <span class="muted">${p.deep} ล็อต${p.children.length ? ' · ' + p.children.length + ' ที่เก็บข้างใน' : ''}</span></span>
      </button>`;
    }).join('')}</div>`
    : `<div class="empty"><b>ยังไม่มีที่เก็บในระบบ</b>
        เริ่มจากเพิ่มห้อง (เช่น "Room 101") แล้วถ่ายรูปตู้เข้าไปวางปุ่มทีละชั้น<br><br>
        ${staff() ? `<button class="btn" data-act="add-root">${icon.plus} เพิ่มห้อง/ที่เก็บ</button>` : ''}
       </div>`}`;
}

/* ── หน้าที่เก็บหนึ่งแห่ง ─────────────────────────────────────────────── */

/** ปุ่มที่จะวาดบนรูป: โหมดดูใช้ข้อมูลจริง · โหมดจัดวางใช้ร่าง (รวมปุ่มใหม่ที่ยังไม่บันทึก) */
function entriesOf(p) {
  if (st.edit && st.draft) {
    return st.draft.items.map(it => {
      const real = it.isNew ? null : placeOf(it.id);
      return { ...it, deep: real ? real.deep : 0 };
    });
  }
  return p.children.map(placeOf).map(c => ({ ...c, isNew: false }));
}

function ensureDraft(p) {
  if (st.draft && st.draft.parentId === p.id) return;
  st.draft = Z.createDraft(p.id, p.children.map(placeOf));
  st.split = null; st.assign = '';
}

function drawPlace(p) {
  const cover = coverOf('PLACE', p.id);
  const canZone = !!cover && p.kind !== 'BOX';
  if (!canZone && st.edit) leaveEdit();
  if (st.edit) ensureDraft(p);

  const all = entriesOf(p);
  const ids = all.map(c => c.id);
  if (st.sel && !ids.includes(st.sel)) st.sel = '';
  if (st.assign && !ids.includes(st.assign)) st.assign = '';

  const crumbs = pathOf(p.id).map((x, i, a) => i === a.length - 1
    ? `<span>${esc(x.name)}</span>`
    : `<button class="link-btn" data-go="${esc(x.id)}">${esc(x.name)}</button>`).join('<i>›</i>');

  const placed = all.filter(c => c.zone);

  let stage;
  if (cover) {
    const ar = cover.width && cover.height ? ` style="--ar:${(cover.width / cover.height).toFixed(4)}"` : '';
    const assignName = st.assign ? (all.find(c => c.id === st.assign) || {}).name : '';
    stage = `
      ${st.edit ? hintHtml({ split: st.split, assign: st.assign, assignName }) : ''}
      <div class="stage-wrap"><div class="stage${st.edit ? ' editing' : ''}${st.split ? ' splitting' : ''}" id="stage"${ar}>
        ${photoImg(cover, 1600, { cls: 'stage-img', eager: true })}
        ${placed.map(c => {
          const i = ids.indexOf(c.id), g = c.zone, on = st.sel === c.id;
          return `<div class="zone${on ? ' sel' : ''}${c.isNew ? ' new' : ''}${c.failed ? ' err' : ''}${st.flash === c.id ? ' flash' : ''}" role="button" tabindex="0"
              data-zone="${esc(c.id)}" title="${esc(c.name)}"
              style="left:${g.x * 100}%;top:${g.y * 100}%;width:${g.w * 100}%;height:${g.h * 100}%;--c:${esc(zoneColor(c, i))}">
            <span class="zone-name">${esc(c.name || '(ไม่มีชื่อ)')}</span>${c.isNew ? '<span class="zone-n">ใหม่</span>' : `<span class="zone-n">${c.deep}</span>`}
            ${st.edit && on ? '<i class="hd hd-nw" data-h="nw"></i><i class="hd hd-ne" data-h="ne"></i><i class="hd hd-sw" data-h="sw"></i><i class="hd hd-se" data-h="se"></i>' : ''}
          </div>`;
        }).join('')}
        <div class="draw-box" id="drawbox" hidden></div>
      </div></div>
      ${st.edit ? barHtml({ d: st.draft, sel: st.sel ? Z.itemOf(st.draft, st.sel) : null, saving: st.saving,
                            assign: st.assign, parentKind: p.kind }) : ''}`;
  } else {
    stage = `<div class="stage-empty">${icon.camera}
      <b>ยังไม่มีรูปของ "${esc(p.name)}"</b>
      <span class="muted">${p.kind === 'BOX' ? 'กล่องเป็นระดับลึกสุด ไม่ต้องวางปุ่มข้างใน'
        : 'ถ่ายรูปด้านหน้า' + esc(PLACE_KIND_TH[p.kind] || '') + 'นี้ แล้วจะวางปุ่มของที่เก็บข้างในลงบนรูปได้'}</span>
      ${staff() ? `<button class="btn" data-act="photos">${icon.camera} เพิ่มรูป</button>` : ''}</div>`;
  }

  const nDirty = st.edit ? Z.dirtyCount(st.draft) : 0;
  $('#map-body', root).innerHTML = `
    <nav class="crumbs"><button class="link-btn" data-go="">${icon.map} แผนผัง</button><i>›</i>${crumbs}</nav>
    <div class="view-head">
      <div class="eyebrow">${esc(PLACE_KIND_TH[p.kind] || p.kind)}</div>
      <h1>${esc(p.name)}</h1>
      <p>${p.deep} ล็อต${p.notes ? ' · ' + esc(p.notes) : ''}</p>
    </div>
    <div class="head-acts">
      ${staff() ? `
        ${st.edit ? '' : `<button class="btn btn-ghost btn-sm" data-act="photos">${icon.camera} รูป</button>
        <button class="btn btn-ghost btn-sm" data-act="edit-place">${icon.edit} แก้ไข</button>
        ${p.kind !== 'BOX' ? `<button class="btn btn-ghost btn-sm" data-act="add-child">${icon.plus} เพิ่มที่เก็บข้างใน</button>` : ''}`}
        ${canZone ? `<button class="btn btn-sm ${st.edit ? '' : 'btn-ghost'}" data-act="toggle-edit"${st.saving ? ' disabled' : ''}>${
          st.edit ? (nDirty ? `✓ บันทึกและเสร็จสิ้น (${nDirty})` : '✓ เสร็จสิ้น') : 'จัดวางปุ่ม'}</button>` : ''}` : ''}
    </div>
    <div class="map-layout">
      <section class="map-main">${stage}</section>
      <aside class="map-side" id="side">${sideHtml(p, all)}</aside>
    </div>`;

  if (st.flash) {
    const z = $('.zone.flash', root);
    if (z) z.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const fid = st.flash; st.flash = '';
    setTimeout(() => { const el = $(`[data-zone="${fid}"]`, root); if (el) el.classList.remove('flash'); }, 3000);
  }
}

function sideHtml(p, kids) {
  const kindTag = c => `<span class="tag tag-mute">${esc(PLACE_KIND_TH[c.kind] || c.kind)}</span>`;

  if (st.edit) {
    // คำสั่งทั้งหมดอยู่ที่แถบใต้รูปแล้ว ด้านข้างเหลือแค่คำแนะนำ
    return `<div class="side-card"><div class="side-head"><b>วิธีจัดวางปุ่ม</b></div>
        <ol class="howto">
          <li>ตู้หรือชั้นวางที่มีหลายชั้น กด <b>แบ่งชั้นอัตโนมัติ</b> แล้วลากกรอบครอบทุกชั้นครั้งเดียว</li>
          <li>ลากบนที่ว่างของรูปเพื่อเพิ่มทีละปุ่ม ระบบตั้งชื่อถัดไปให้เอง</li>
          <li>แตะปุ่มเพื่อเปลี่ยนชื่อ สี ขยับด้วยลูกศร หรือปรับขนาด</li>
          <li>เสร็จแล้วกด <b>บันทึก</b> — ก่อนบันทึกกด <b>ย้อนกลับ</b> ได้ทุกขั้น</li>
        </ol>
        <p class="hint">คอมพิวเตอร์: ปุ่มลูกศรบนคีย์บอร์ดขยับปุ่มที่เลือก (Shift = ทีละมาก) · Delete เอาออก · Ctrl+Z ย้อนกลับ</p>
      </div>
      <button class="btn btn-ghost btn-block" data-act="add-child">${icon.plus} เพิ่มที่เก็บข้างใน (ไม่วางบนรูป)</button>`;
  }

  if (st.sel && placeOf(st.sel)) {
    const c = placeOf(st.sel);
    return `
      <div class="side-card">
        <button class="link-btn" data-act="clear-sel">${icon.back} ทั้งหมดใน ${esc(p.name)}</button>
        <div class="side-head"><b>${esc(c.name)}</b>${kindTag(c)}</div>
        <p class="muted">${c.deep} ล็อต${c.children.length ? ' · ' + c.children.length + ' ที่เก็บข้างใน' : ''}</p>
        <div class="side-acts">
          <button class="btn btn-sm" data-go="${esc(c.id)}">เข้าไปดู ${icon.chev}</button>
          ${staff() ? `<button class="btn btn-ghost btn-sm" data-act="add-item-child">${icon.plus} รับเข้าที่ชั้นนี้</button>` : ''}
        </div>
      </div>
      ${lotList(lotsIn(c.id, true), c.pathText)}`;
  }

  const direct = lotsIn(p.id, false);
  return `
    ${kids.length ? `<div class="side-card"><div class="side-head"><b>ภายใน ${esc(p.name)}</b><span class="muted">${kids.length} แห่ง</span></div>
      <div class="kid-list">${kids.map((c, i) => `
        <button class="kid" data-pick="${esc(c.id)}">
          <span class="dot" style="--c:${esc(zoneColor(c, i))}"></span>
          <span class="kid-name">${esc(c.name)}${c.zone ? '' : ' <small class="muted">(ไม่มีปุ่มบนรูป)</small>'}</span>
          <span class="kid-n">${c.deep}</span>
        </button>`).join('')}</div></div>` : ''}
    <div class="side-card"><div class="side-head"><b>วางอยู่ที่นี่โดยตรง</b><span class="muted">${direct.length}</span></div></div>
    ${lotList(direct, p.pathText)}`;
}

/* ── วาด ──────────────────────────────────────────────────────────────── */
function draw() {
  if (!root) return;
  if (!st.placeId) return drawRoot();
  const p = placeOf(st.placeId);
  if (!p) {
    leaveEdit();
    $('#map-body', root).innerHTML =
      '<div class="empty"><b>ไม่พบที่เก็บนี้</b> อาจถูกลบหรือย้ายไปแล้ว<br><br>' +
      '<button class="btn" data-go="">กลับไปแผนผัง</button></div>';
    return;
  }
  drawPlace(p);
}

const goUp = () => {
  const p = placeOf(st.placeId);
  st.placeId = p && p.parentId ? p.parentId : '';
  st.sel = ''; leaveEdit();
};

/* ── งานบนร่าง ─────────────────────────────────────────────────────────── */

/** แก้ร่างหนึ่งครั้ง = จุดย้อนกลับหนึ่งจุด */
function edit(fn) {
  Z.checkpoint(st.draft);
  fn(st.draft);
  draw();
}

function nudge(dir, big) {
  const it = st.sel && Z.itemOf(st.draft, st.sel);
  if (!it || !it.zone) return;
  const k = NUDGE * (big ? 5 : 1);
  const dx = dir === 'left' ? -k : dir === 'right' ? k : 0;
  const dy = dir === 'up' ? -k : dir === 'down' ? k : 0;
  edit(() => { it.zone = Z.fitZone({ ...it.zone, x: it.zone.x + dx, y: it.zone.y + dy }); });
}

function resize(how) {
  const it = st.sel && Z.itemOf(st.draft, st.sel);
  if (!it || !it.zone) return;
  const g = it.zone, d = how.endsWith('+') ? RESIZE : -RESIZE;
  // ขยายหรือหดรอบจุดกึ่งกลาง ปุ่มจึงไม่วิ่งหนีนิ้ว
  const w = how[0] === 'w' ? clamp(g.w + d, MIN_SIZE, 1) : g.w;
  const h = how[0] === 'h' ? clamp(g.h + d, MIN_SIZE, 1) : g.h;
  edit(() => { it.zone = Z.fitZone({ x: g.x - (w - g.w) / 2, y: g.y - (h - g.h) / 2, w, h }); });
}

function duplicateSel() {
  const c = st.sel && Z.itemOf(st.draft, st.sel);
  if (!c || !c.zone) return;
  const g = c.zone;
  let ng = { x: g.x, y: g.y + g.h + 0.01, w: g.w, h: g.h };
  if (ng.y + ng.h > 1) ng = { x: clamp(g.x + g.w + 0.01, 0, 1 - g.w), y: g.y, w: g.w, h: g.h };
  if (ng.x + ng.w > 1) ng = { x: clamp(g.x + 0.03, 0, 1 - g.w), y: clamp(g.y + 0.03, 0, 1 - g.h), w: g.w, h: g.h };
  edit(d => {
    const it = Z.addItem(d, { name: Z.nextName(c.name, Z.namesOf(d)), kind: c.kind, color: c.color, zone: ng });
    st.sel = it.id;
  });
}

/** ลากบนที่ว่างโดยไม่ได้อยู่ในขั้นวางชื่อใดชื่อหนึ่ง = สร้างปุ่มใหม่ทันที ชื่อถัดไปตั้งให้เอง */
function quickCreate(zone) {
  const p = placeOf(st.placeId);
  edit(d => {
    const kind = Z.childKind(p.kind);
    const it = Z.addItem(d, { name: Z.suggestName(kind, Z.namesOf(d), d.lastName), kind, zone });
    st.sel = it.id;
  });
}

function applySplit(area) {
  const s = st.split; st.split = null;
  if (!Z.gridFits(area, s.rows, s.cols)) {
    toast('กรอบเล็กเกินไปสำหรับ ' + s.rows * s.cols + ' ปุ่ม — ลากกรอบให้ใหญ่ขึ้น หรือลดจำนวนชั้น', 'risk');
    st.split = s; draw(); return;
  }
  const r = Z.applyGrid(st.draft, Z.splitGrid(area, s.rows, s.cols), Z.gridNames(s), s.kind);
  st.sel = '';
  draw();
  const parts = [];
  if (r.created.length) parts.push(`สร้าง ${r.created.length} ปุ่ม`);
  if (r.reused.length) parts.push(`ใช้ที่เก็บเดิม ${r.reused.length} แห่ง`);
  if (r.skipped.length) parts.push(`ข้าม ${r.skipped.length} ชื่อที่มีปุ่มอยู่แล้ว`);
  toast((parts.join(' · ') || 'ไม่มีปุ่มใหม่') + ' — ตรวจดูแล้วกด "บันทึก"', r.skipped.length ? 'warn' : 'ok');
}

async function startSplit() {
  const p = placeOf(st.placeId);
  const s = await splitDialog({ d: st.draft, parentKind: p.kind });
  if (!s) return;
  st.sel = ''; st.assign = '';
  if (s.whole) {
    st.split = s;
    // เว้นขอบรูปเล็กน้อย — ขอบรูปมักเป็นโครงตู้ ไม่ใช่ชั้น และมุมปุ่มที่ชิดขอบจับลากยาก
    return applySplit({ x: 0.02, y: 0.02, w: 0.96, h: 0.96 });
  }
  st.split = s;
  draw();
  const stage = $('#stage', root);
  if (stage) stage.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function save(exitAfter) {
  const d = st.draft;
  const errs = Z.validate(d);
  if (errs.length) { toast(errs[0], 'risk'); return false; }
  const ops = Z.pendingOps(d);
  if (!ops.length) { if (exitAfter) { leaveEdit(); draw(); } return true; }

  st.saving = 'กำลังบันทึก…'; st.split = null; st.assign = '';
  draw();
  let res;
  try {
    res = await withBusy(() => saveDraft(d, (i, n) => {
      st.saving = `กำลังบันทึก ${i}/${n}`;
      const b = $('[data-ed="save"]', root); if (b) b.textContent = st.saving;
    }));
  } finally { st.saving = ''; }

  // สร้างร่างใหม่จากข้อมูลล่าสุดเสมอ แล้วใส่คำสั่งที่ยังไม่ผ่านกลับเข้าไป — งานไม่หาย
  const keepSel = st.sel;
  st.draft = null;
  await reload();
  if (res.failed.length) {
    if (!st.edit) st.edit = true;
    ensureDraft(placeOf(st.placeId));
    Z.reapplyFailed(st.draft, res.failed);
    st.sel = '';
    draw();
    toast(`บันทึกได้ ${res.done} จาก ${res.total} รายการ — ${res.failed[0].message}` +
          '\nปุ่มที่ยังไม่ผ่านมีกรอบสีแดง แก้แล้วกด "บันทึก" อีกครั้ง', 'risk');
    return false;
  }
  if (exitAfter) leaveEdit();
  else st.sel = keepSel && !keepSel.startsWith('new:') ? keepSel : '';
  draw();
  toast(`บันทึกปุ่มแล้ว ${res.done} รายการ`, 'ok');
  return true;
}

/* ── เหตุการณ์ ────────────────────────────────────────────────────────── */
function wire() {
  root.addEventListener('click', async e => {
    // เปลี่ยนที่เก็บที่กำลังดู
    const go = e.target.closest('[data-go]');
    if (go) {
      if (!(await okToDiscard())) return;
      const keep = st.edit && go.dataset.go === st.placeId;
      st.placeId = go.dataset.go; st.sel = '';
      if (!keep) leaveEdit();
      draw();
      return;
    }

    const ed = e.target.closest('[data-ed]');
    if (ed && st.edit && st.draft) return onEditCmd(ed.dataset.ed, ed);

    const a = e.target.closest('[data-act]');
    if (a) {
      const act = a.dataset.act;
      const p = st.placeId && placeOf(st.placeId);

      if (act === 'add-root') {
        return placeDialog({ parentId: '', onDone: async r => { await reload(); if (r && r.placeId) { st.placeId = r.placeId; draw(); } } });
      }
      if (!p) return;
      if (act === 'toggle-edit') {
        if (!st.edit) { st.edit = true; st.sel = ''; st.draft = null; return draw(); }
        return save(true);
      }
      if (act === 'add-child') {
        // หน้าต่างนี้บันทึกทันทีแล้วโหลดใหม่ — ถ้ามีร่างค้างจะชนกัน ให้บันทึกร่างก่อน
        if (dirty()) { toast('กด "บันทึก" ปุ่มที่แก้ไว้ก่อน แล้วค่อยเพิ่มที่เก็บ', 'warn'); return; }
        return placeDialog({ parentId: p.id, onDone: async () => { st.draft = null; await reload(); } });
      }
      if (act === 'photos') return photosDialog({ ownerType: 'PLACE', ownerId: p.id, title: 'รูปของ ' + p.name, onDone: reload });
      if (act === 'edit-place') return placeDialog({ placeId: p.id, onDone: reload, onDeleted: async () => { goUp(); await reload(); } });
      if (act === 'clear-sel') { st.sel = ''; return draw(); }
      if (act === 'add-item-child') {
        const target = st.sel && placeOf(st.sel);
        // กด "รับเข้าที่ชั้นนี้" แล้วต้องเลือกชั้นนั้นไว้ให้เลย ไม่ต้องหาในรายการอีกรอบ
        return openItemForm({ mode: 'new', placeId: target ? target.id : p.id, onSaved: reload });
      }
      return;
    }

    if (st.edit && st.draft) {
      const nd = e.target.closest('[data-nudge]');
      if (nd) return nudge(nd.dataset.nudge, e.shiftKey);
      const sz = e.target.closest('[data-size]');
      if (sz) return resize(sz.dataset.size);
      const col = e.target.closest('[data-color]');
      if (col) {
        const it = st.sel && Z.itemOf(st.draft, st.sel);
        if (it && (it.color || '') !== col.dataset.color) edit(() => { it.color = col.dataset.color; });
        return;
      }
    }

    // ปุ่มลัดในรายการล็อต
    const tx = e.target.closest('[data-tx]');
    if (tx) return txnDialog(tx.dataset.lot, tx.dataset.tx, reload);
    const mv = e.target.closest('[data-mv]');
    if (mv) return moveDialog(mv.dataset.mv, reload);
    const open = e.target.closest('[data-open]');
    if (open) return openLotDetail(open.dataset.open, reload);

    const pick = e.target.closest('[data-pick]');
    if (pick) { st.sel = pick.dataset.pick; return draw(); }

    const as = e.target.closest('[data-assign]');
    if (as) { st.split = null; st.sel = ''; st.assign = st.assign === as.dataset.assign ? '' : as.dataset.assign; return draw(); }

    const z = e.target.closest('[data-zone]');
    if (z && !st.edit) {
      st.sel = z.dataset.zone;
      draw();
      const side = $('#side', root);
      if (side && window.matchMedia('(max-width: 880px)').matches) side.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  async function onEditCmd(cmd) {
    const d = st.draft;
    const sel = st.sel && Z.itemOf(d, st.sel);
    switch (cmd) {
      case 'undo':
        if (Z.undo(d)) { if (st.sel && !Z.itemOf(d, st.sel)) st.sel = ''; draw(); }
        return;
      case 'save': return save(false);
      case 'revert':
        if (!(await confirmBox({ title: 'ยกเลิกที่แก้ทั้งหมด?', okText: 'ยกเลิกที่แก้', cancelText: 'ไม่ใช่', danger: true,
          message: `ปุ่มจะกลับไปเหมือนก่อนเริ่มแก้ (${Z.dirtyCount(d)} รายการ)\nยังกด "ย้อนกลับ" เพื่อเอาคืนได้` }))) return;
        Z.revertAll(d); st.sel = ''; st.split = null; st.assign = ''; draw();
        return;
      case 'split': return startSplit();
      case 'split-whole': return st.split && applySplit({ x: 0.02, y: 0.02, w: 0.96, h: 0.96 });
      case 'split-cancel': st.split = null; return draw();
      case 'cancel-assign': st.assign = ''; return draw();
      case 'deselect': st.sel = ''; return draw();
      case 'dup': return duplicateSel();
      case 'remove':
        if (!sel) return;
        // เลิกเลือกเสมอ แถบจึงกลับไปแสดงรายการ "ยังไม่มีปุ่มบนรูป" ให้วางใหม่ได้ทันที
        edit(() => { Z.removeItem(d, sel.id); st.sel = ''; });
        return;
      case 'details':
        if (!sel || sel.isNew) return;
        if (dirty()) { toast('กด "บันทึก" ปุ่มที่แก้ไว้ก่อน แล้วค่อยเปิดรายละเอียด', 'warn'); return; }
        return placeDialog({ placeId: sel.id, onDone: async () => { st.draft = null; await reload(); },
                             onDeleted: async () => { st.sel = ''; st.draft = null; await reload(); } });
    }
  }

  // ชื่อปุ่ม: พิมพ์แล้วเห็นบนรูปทันที แต่จดจุดย้อนกลับครั้งเดียวต่อการแก้ชื่อหนึ่งรอบ
  root.addEventListener('focusin', e => {
    if (e.target.id === 'zb-name' && st.draft) nameSnap = Z.takeSnapshot(st.draft);
  });
  root.addEventListener('input', e => {
    if (e.target.id !== 'zb-name' || !st.draft) return;
    const it = st.sel && Z.itemOf(st.draft, st.sel);
    if (!it) return;
    it.name = Z.cleanName(e.target.value);
    const z = $(`[data-zone="${CSS.escape(it.id)}"]`, root);
    if (z) { $('.zone-name', z).textContent = it.name || '(ไม่มีชื่อ)'; z.title = it.name; }
  });
  root.addEventListener('change', e => {
    if (!st.draft) return;
    const it = st.sel && Z.itemOf(st.draft, st.sel);
    if (!it) return;
    if (e.target.id === 'zb-name') {
      Z.pushSnapshot(st.draft, nameSnap); nameSnap = null;
      if (it.isNew) st.draft.lastName = it.name;
      delete it.failed;
      draw();
    } else if (e.target.id === 'zb-kind') {
      edit(() => { it.kind = e.target.value; });
    }
  });
  root.addEventListener('keydown', e => {
    if (e.target.id === 'zb-name' && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  });

  root.addEventListener('dblclick', e => {
    const z = e.target.closest('[data-zone]');
    if (z && !st.edit) { st.placeId = z.dataset.zone; st.sel = ''; draw(); }
  });

  root.addEventListener('keydown', e => {
    const z = e.target.closest && e.target.closest('[data-zone]');
    if (z && (e.key === 'Enter' || e.key === ' ') && e.target === z) {
      e.preventDefault(); st.sel = z.dataset.zone; draw();
      const again = $(`[data-zone="${CSS.escape(st.sel)}"]`, root); if (again) again.focus();
    }
  });

  /* ── ลาก: สร้าง / ย้าย / ปรับขนาดปุ่ม ──────────────────────────────── */
  const fracOf = (e, stage) => {
    const r = stage.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) };
  };
  const setBox = (el, g) => {
    el.style.left = g.x * 100 + '%'; el.style.top = g.y * 100 + '%';
    el.style.width = g.w * 100 + '%'; el.style.height = g.h * 100 + '%';
  };

  root.addEventListener('pointerdown', e => {
    if (!st.edit || !st.draft || st.saving || e.button > 0) return;
    const stage = e.target.closest('#stage');
    if (!stage) return;
    const pt = fracOf(e, stage);
    const handle = e.target.closest('[data-h]');
    const zone = st.split ? null : e.target.closest('[data-zone]');   // ขั้นแบ่งชั้น: ลากทับปุ่มเดิมได้

    if (handle && zone) {
      const c = Z.itemOf(st.draft, zone.dataset.zone);
      drag = { mode: 'resize', h: handle.dataset.h, id: c.id, el: zone, g0: { ...c.zone }, stage };
    } else if (zone) {
      const c = Z.itemOf(st.draft, zone.dataset.zone);
      if (st.sel !== c.id) { st.sel = c.id; st.assign = ''; draw(); }
      drag = { mode: 'move', id: c.id, el: $(`[data-zone="${CSS.escape(c.id)}"]`, root), g0: { ...c.zone },
               p0: pt, stage: $('#stage', root), moved: false };
    } else {
      drag = { mode: 'draw', p0: pt, g: null, el: $('#drawbox', stage), stage };
    }
    e.preventDefault();
    try { drag.stage.setPointerCapture(e.pointerId); } catch { /* ไม่เป็นไร */ }
  });

  root.addEventListener('pointermove', e => {
    if (!drag) return;
    const pt = fracOf(e, drag.stage);
    if (drag.mode === 'draw') {
      const x = Math.min(drag.p0.x, pt.x), y = Math.min(drag.p0.y, pt.y);
      drag.g = { x, y, w: Math.abs(pt.x - drag.p0.x), h: Math.abs(pt.y - drag.p0.y) };
      drag.el.hidden = false; setBox(drag.el, drag.g);
    } else if (drag.mode === 'move') {
      const g0 = drag.g0;
      const dx = pt.x - drag.p0.x, dy = pt.y - drag.p0.y;
      if (Math.abs(dx) + Math.abs(dy) > 0.004) drag.moved = true;
      drag.g = { x: clamp(g0.x + dx, 0, 1 - g0.w), y: clamp(g0.y + dy, 0, 1 - g0.h), w: g0.w, h: g0.h };
      setBox(drag.el, drag.g);
    } else {
      const g0 = drag.g0, h = drag.h;
      let x1 = g0.x, y1 = g0.y, x2 = g0.x + g0.w, y2 = g0.y + g0.h;
      if (h.includes('w')) x1 = clamp(pt.x, 0, x2 - MIN_SIZE); else x2 = clamp(pt.x, x1 + MIN_SIZE, 1);
      if (h.includes('n')) y1 = clamp(pt.y, 0, y2 - MIN_SIZE); else y2 = clamp(pt.y, y1 + MIN_SIZE, 1);
      drag.g = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
      setBox(drag.el, drag.g);
    }
  });

  const endDrag = e => {
    if (!drag) return;
    const d = drag; drag = null;
    try { d.stage.releasePointerCapture(e.pointerId); } catch { /* ไม่เป็นไร */ }
    if (e.type === 'pointercancel' || !st.draft) { draw(); return; }

    if (d.mode === 'draw') {
      if (d.el) d.el.hidden = true;
      if (!d.g || d.g.w < MIN_DRAW || d.g.h < MIN_DRAW) {
        if (st.sel) { st.sel = ''; draw(); }         // แตะพื้นที่ว่าง = เลิกเลือก
        return;
      }
      if (st.split) return applySplit(d.g);
      if (st.assign) {
        const it = Z.itemOf(st.draft, st.assign);
        st.assign = '';
        if (it) edit(() => { it.zone = Z.fitZone(d.g); st.sel = it.id; });
        return;
      }
      return quickCreate(Z.fitZone(d.g));
    }
    if (!d.g || (d.mode === 'move' && !d.moved)) { draw(); return; }
    const it = Z.itemOf(st.draft, d.id);
    if (it) edit(() => { it.zone = Z.fitZone(d.g); });
  };
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);
}

/* ── คีย์บอร์ดบนคอมพิวเตอร์ (ผูกกับ document ครั้งเดียว แล้วเช็กว่ายังอยู่หน้านี้) ── */
document.addEventListener('keydown', e => {
  if (!root || !root.isConnected || !st.edit || !st.draft || st.saving) return;
  if (document.querySelector('dialog[open]')) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
    e.preventDefault();
    if (Z.undo(st.draft)) { if (st.sel && !Z.itemOf(st.draft, st.sel)) st.sel = ''; draw(); }
    return;
  }
  if (!st.sel) { if (e.key === 'Escape' && (st.split || st.assign)) { st.split = null; st.assign = ''; draw(); } return; }
  const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key];
  if (dir) { e.preventDefault(); nudge(dir, e.shiftKey); keepFocus(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    const it = Z.itemOf(st.draft, st.sel);
    if (it) edit(() => { Z.removeItem(st.draft, it.id); st.sel = ''; });
    return;
  }
  if (e.key === 'Escape') { st.sel = ''; draw(); }
});

function keepFocus() {
  const z = st.sel && $(`[data-zone="${CSS.escape(st.sel)}"]`, root);
  if (z) z.focus({ preventScroll: true });
}
