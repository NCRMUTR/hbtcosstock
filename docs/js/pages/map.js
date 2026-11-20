/* ══════════════════════════════════════════════════════════════════════════
   pages/map.js — แผนผังที่เก็บ: ห้อง → ตู้/โต๊ะ → ชั้น → กล่อง

   • หน้าห้อง/ตู้แสดงรูปหลักของที่เก็บนั้น แล้ววางปุ่มของที่เก็บข้างในทับบนรูป
   • กดปุ่ม = ดูรายการล็อตที่อยู่ในนั้น · "เข้าไปดู" = ลงไปอีกชั้น
   • โหมดจัดวางปุ่ม: ลากบนรูปเพื่อสร้างปุ่มใหม่ · ลากปุ่มเพื่อย้าย · ลากมุมเพื่อปรับขนาด
   ตำแหน่งปุ่มเก็บเป็นสัดส่วน (0–1) ของรูป จึงตรงเสมอไม่ว่าจอจะกว้างเท่าไร
   ══════════════════════════════════════════════════════════════════════════ */
import { api, can } from '../api.js';
import { loadSnapshot, saveSnapshot } from '../store.js';
import {
  buildIndex, getRoots, placeOf, pathOf, descendantIds, lotsIn, coverOf, getItems
} from '../search.js';
import {
  $, $$, esc, toast, run, withBusy, fmtNum, fmtDays, icon, PLACE_KIND_TH
} from '../ui.js';
import { photoImg } from '../photo.js';
import { placeDialog, photosDialog, moveDialog, txnDialog, ZONE_COLORS } from '../dialogs.js';
import { openLotDetail } from '../detail.js';
import { openItemForm } from '../form.js';
import { canTxn } from '../kinds.js';

const MIN_DRAW = 0.025;      // ลากสั้นกว่านี้ถือว่าเป็นแค่การแตะ
const MIN_SIZE = 0.02;
const MAX_ROWS = 150;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

let root = null;
let st = { placeId: '', sel: '', edit: false, assign: '', flash: '' };
let drag = null;

/** ให้หน้าอื่นสั่งเปิดแผนผังที่ที่เก็บหนึ่งได้ (เช่น ปุ่ม "ดูบนแผนผัง") */
export function focusPlace(placeId) {
  const p = placeOf(placeId);
  if (!p) { st.placeId = ''; return; }
  if (p.parentId && p.zone && coverOf('PLACE', p.parentId)) {
    st.placeId = p.parentId; st.sel = p.id; st.flash = p.id;
  } else {
    st.placeId = p.id; st.sel = ''; st.flash = '';
  }
}

export function render(el) {
  root = el;
  el.innerHTML = '<div id="map-body"></div>';
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
      ย้ายเข้าที่เก็บได้จากหน้าคลังวัตถุดิบ หรือให้ผู้ดูแลระบบรัน <code>migratePlaces</code> ใน Apps Script
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
function drawPlace(p) {
  const cover = coverOf('PLACE', p.id);
  const canZone = !!cover && p.kind !== 'BOX';
  if (!canZone) { st.edit = false; st.assign = ''; }
  if (st.sel && !p.children.includes(st.sel)) st.sel = '';

  const crumbs = pathOf(p.id).map((x, i, a) => i === a.length - 1
    ? `<span>${esc(x.name)}</span>`
    : `<button class="link-btn" data-go="${esc(x.id)}">${esc(x.name)}</button>`).join('<i>›</i>');

  const kids = p.children.map(placeOf);
  const placed = kids.filter(c => c.zone);
  const unplaced = kids.filter(c => !c.zone);

  let stage;
  if (cover) {
    const ar = cover.width && cover.height ? ` style="--ar:${(cover.width / cover.height).toFixed(4)}"` : '';
    stage = `
      ${st.edit ? `<div class="edit-bar">${st.assign
        ? `ลากบนรูปเพื่อกำหนดตำแหน่งของ <b>${esc(placeOf(st.assign).name)}</b>
           <button class="btn btn-ghost btn-sm" data-act="cancel-assign">ยกเลิก</button>`
        : 'ลากบนรูปเพื่อสร้างปุ่มใหม่ · ลากปุ่มเพื่อย้าย · ลากมุมเพื่อปรับขนาด'}</div>` : ''}
      <div class="stage-wrap"><div class="stage${st.edit ? ' editing' : ''}" id="stage"${ar}>
        ${photoImg(cover, 1600, { cls: 'stage-img', eager: true })}
        ${placed.map(c => {
          const i = p.children.indexOf(c.id), g = c.zone, on = st.sel === c.id;
          return `<div class="zone${on ? ' sel' : ''}${st.flash === c.id ? ' flash' : ''}" role="button" tabindex="0"
              data-zone="${esc(c.id)}" title="${esc(c.name)}"
              style="left:${g.x * 100}%;top:${g.y * 100}%;width:${g.w * 100}%;height:${g.h * 100}%;--c:${esc(zoneColor(c, i))}">
            <span class="zone-name">${esc(c.name)}</span><span class="zone-n">${c.deep}</span>
            ${st.edit && on ? '<i class="hd hd-nw" data-h="nw"></i><i class="hd hd-ne" data-h="ne"></i><i class="hd hd-sw" data-h="sw"></i><i class="hd hd-se" data-h="se"></i>' : ''}
          </div>`;
        }).join('')}
        <div class="draw-box" id="drawbox" hidden></div>
      </div></div>`;
  } else {
    stage = `<div class="stage-empty">${icon.camera}
      <b>ยังไม่มีรูปของ "${esc(p.name)}"</b>
      <span class="muted">${p.kind === 'BOX' ? 'กล่องเป็นระดับลึกสุด ไม่ต้องวางปุ่มข้างใน'
        : 'ถ่ายรูปด้านหน้า' + esc(PLACE_KIND_TH[p.kind] || '') + 'นี้ แล้วจะวางปุ่มของที่เก็บข้างในลงบนรูปได้'}</span>
      ${staff() ? `<button class="btn" data-act="photos">${icon.camera} เพิ่มรูป</button>` : ''}</div>`;
  }

  $('#map-body', root).innerHTML = `
    <nav class="crumbs"><button class="link-btn" data-go="">${icon.map} แผนผัง</button><i>›</i>${crumbs}</nav>
    <div class="view-head">
      <div class="eyebrow">${esc(PLACE_KIND_TH[p.kind] || p.kind)}</div>
      <h1>${esc(p.name)}</h1>
      <p>${p.deep} ล็อต${p.notes ? ' · ' + esc(p.notes) : ''}</p>
    </div>
    <div class="head-acts">
      ${staff() ? `
        <button class="btn btn-ghost btn-sm" data-act="photos">${icon.camera} รูป</button>
        <button class="btn btn-ghost btn-sm" data-act="edit-place">${icon.edit} แก้ไข</button>
        ${p.kind !== 'BOX' ? `<button class="btn btn-ghost btn-sm" data-act="add-child">${icon.plus} เพิ่มที่เก็บข้างใน</button>` : ''}
        ${canZone ? `<button class="btn btn-sm ${st.edit ? '' : 'btn-ghost'}" data-act="toggle-edit">${st.edit ? '✓ เสร็จสิ้น' : 'จัดวางปุ่ม'}</button>` : ''}` : ''}
    </div>
    <div class="map-layout">
      <section class="map-main">${stage}</section>
      <aside class="map-side" id="side">${sideHtml(p, kids, unplaced)}</aside>
    </div>`;

  if (st.flash) {
    const z = $('.zone.flash', root);
    if (z) z.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const fid = st.flash; st.flash = '';
    setTimeout(() => { const el = $(`[data-zone="${fid}"]`, root); if (el) el.classList.remove('flash'); }, 3000);
  }
}

function sideHtml(p, kids, unplaced) {
  const kindTag = c => `<span class="tag tag-mute">${esc(PLACE_KIND_TH[c.kind] || c.kind)}</span>`;

  if (st.edit) {
    const c = st.sel && placeOf(st.sel);
    return `
      ${c ? `<div class="side-card">
        <div class="side-head"><b>${esc(c.name)}</b>${kindTag(c)}</div>
        <div class="side-acts">
          <button class="btn btn-ghost btn-sm" data-act="edit-child">${icon.edit} ชื่อ/สี</button>
          <button class="btn btn-ghost btn-sm" data-act="dup-child">${icon.copy} ทำสำเนา</button>
          <button class="btn btn-ghost btn-sm" data-act="unplace-child">เอาปุ่มออกจากรูป</button>
          <button class="btn btn-ghost btn-sm" data-go="${esc(c.id)}">เข้าไปดู ${icon.chev}</button>
        </div></div>`
        : '<div class="note note-info">แตะปุ่มบนรูปเพื่อแก้ไข หรือลากบนพื้นที่ว่างของรูปเพื่อสร้างปุ่มใหม่</div>'}
      ${unplaced.length ? `<div class="side-card"><div class="side-head"><b>ยังไม่มีปุ่มบนรูป</b></div>
        <div class="chips">${unplaced.map(u => `<button class="chip${st.assign === u.id ? ' on' : ''}" data-assign="${esc(u.id)}">${esc(u.name)}</button>`).join('')}</div>
        <p class="hint">แตะชื่อ แล้วลากบนรูปเพื่อวางปุ่ม</p></div>` : ''}
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
  st.sel = ''; st.edit = false;
};

async function saveZone(id, zone) {
  const r = await run(null, () => api.placeSave({ placeId: id, zone }));
  if (!r.ok) { draw(); return; }
  await reload();
}

/* ── เหตุการณ์ ────────────────────────────────────────────────────────── */
function wire() {
  root.addEventListener('click', async e => {
    // เปลี่ยนที่เก็บที่กำลังดู
    const go = e.target.closest('[data-go]');
    if (go) {
      st.placeId = go.dataset.go; st.sel = ''; st.edit = false; st.assign = '';
      draw();
      return;
    }

    const a = e.target.closest('[data-act]');
    if (a) {
      const act = a.dataset.act;
      const p = st.placeId && placeOf(st.placeId);

      if (act === 'add-root') {
        return placeDialog({ parentId: '', onDone: async r => { await reload(); if (r && r.placeId) { st.placeId = r.placeId; draw(); } } });
      }
      if (!p) return;
      if (act === 'photos') return photosDialog({ ownerType: 'PLACE', ownerId: p.id, title: 'รูปของ ' + p.name, onDone: reload });
      if (act === 'edit-place') return placeDialog({ placeId: p.id, onDone: reload, onDeleted: async () => { goUp(); await reload(); } });
      if (act === 'add-child') return placeDialog({ parentId: p.id, onDone: reload });
      if (act === 'toggle-edit') { st.edit = !st.edit; st.assign = ''; return draw(); }
      if (act === 'cancel-assign') { st.assign = ''; return draw(); }
      if (act === 'clear-sel') { st.sel = ''; return draw(); }
      if (act === 'add-item-child') return openItemForm({ mode: 'new', onSaved: reload });

      const c = st.sel && placeOf(st.sel);
      if (act === 'edit-child' && c) {
        return placeDialog({ placeId: c.id, onDone: reload, onDeleted: async () => { st.sel = ''; await reload(); } });
      }
      if (act === 'unplace-child' && c) {
        return run(a, async () => { await api.placeSave({ placeId: c.id, zone: null }); await reload(); }, 'เอาปุ่มออกจากรูปแล้ว');
      }
      if (act === 'dup-child' && c && c.zone) {
        const g = c.zone;
        let ng = { x: g.x, y: g.y + g.h + 0.01, w: g.w, h: g.h };
        if (ng.y + ng.h > 1) ng = { x: clamp(g.x + g.w + 0.01, 0, 1 - g.w), y: g.y, w: g.w, h: g.h };
        if (ng.x + ng.w > 1) ng = { x: clamp(g.x + 0.03, 0, 1 - g.w), y: clamp(g.y + 0.03, 0, 1 - g.h), w: g.w, h: g.h };
        return placeDialog({
          parentId: p.id, kind: c.kind, color: c.color, zone: ng,
          name: nextName(c.name), onDone: reload
        });
      }
      return;
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
    if (as) { st.assign = st.assign === as.dataset.assign ? '' : as.dataset.assign; return draw(); }

    const z = e.target.closest('[data-zone]');
    if (z && !st.edit) {
      st.sel = z.dataset.zone;
      draw();
      const side = $('#side', root);
      if (side && window.matchMedia('(max-width: 880px)').matches) side.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  root.addEventListener('dblclick', e => {
    const z = e.target.closest('[data-zone]');
    if (z && !st.edit) { st.placeId = z.dataset.zone; st.sel = ''; draw(); }
  });

  root.addEventListener('keydown', e => {
    const z = e.target.closest && e.target.closest('[data-zone]');
    if (z && (e.key === 'Enter' || e.key === ' ') && e.target === z) {
      e.preventDefault(); st.sel = z.dataset.zone; draw();
      const again = $(`[data-zone="${st.sel}"]`, root); if (again) again.focus();
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
    if (!st.edit || e.button > 0) return;
    const stage = e.target.closest('#stage');
    if (!stage) return;
    const pt = fracOf(e, stage);
    const handle = e.target.closest('[data-h]');
    const zone = e.target.closest('[data-zone]');

    if (handle && zone) {
      const c = placeOf(zone.dataset.zone);
      drag = { mode: 'resize', h: handle.dataset.h, id: c.id, el: zone, g0: { ...c.zone }, stage };
    } else if (zone) {
      const c = placeOf(zone.dataset.zone);
      if (st.sel !== c.id) { st.sel = c.id; st.assign = ''; draw(); }
      drag = { mode: 'move', id: c.id, el: $(`[data-zone="${c.id}"]`, root), g0: { ...c.zone },
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

  const endDrag = async e => {
    if (!drag) return;
    const d = drag; drag = null;
    try { d.stage.releasePointerCapture(e.pointerId); } catch { /* ไม่เป็นไร */ }
    if (e.type === 'pointercancel') { draw(); return; }

    if (d.mode === 'draw') {
      if (d.el) d.el.hidden = true;
      if (!d.g || d.g.w < MIN_DRAW || d.g.h < MIN_DRAW) {
        if (st.sel) { st.sel = ''; draw(); }         // แตะพื้นที่ว่าง = เลิกเลือก
        return;
      }
      if (st.assign) {
        const id = st.assign;
        st.assign = ''; st.sel = id;
        return saveZone(id, d.g);
      }
      const dlg = placeDialog({
        parentId: st.placeId, zone: d.g,
        onDone: async r => { await reload(); if (r && r.placeId) { st.sel = r.placeId; draw(); } }
      });
      if (!dlg) draw();
      return;
    }
    if (!d.g || (d.mode === 'move' && !d.moved)) { draw(); return; }
    saveZone(d.id, d.g);
  };
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);
}

function nextName(name) {
  const m = String(name).match(/^(.*?)(\d+)\s*$/);
  return m ? m[1] + (parseInt(m[2], 10) + 1) : name + ' 2';
}
