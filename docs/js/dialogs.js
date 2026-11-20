/* ══════════════════════════════════════════════════════════════════════════
   dialogs.js — หน้าต่างย่อยที่ใช้ร่วมกัน
     · ทำรายการ: เบิก · คืน · ปรับยอด · จำหน่ายออก
     · ย้ายที่เก็บ · รูปภาพ · เพิ่ม/แก้ไขที่เก็บ
   ══════════════════════════════════════════════════════════════════════════ */
import { api, getUser, can, setSession } from './api.js';
import { getItems, getRoots, placeOf, descendantIds, photosOf } from './search.js';
import { $, $$, esc, toast, run, openModal, confirmBox, readForm, icon,
         fmtNum, todayYmd, TXN_TH, PLACE_KIND_TH } from './ui.js';
import { photoImg, photoSrc, resizeImage, pickImages,
         hasCamera, looksHeic, HEIC_HELP } from './photo.js';
import { canTxn, qtyAttrs, EQUIPMENT_NO_ISSUE } from './kinds.js';

const TITLES = {
  ISSUE:   'เบิกใช้',
  RETURN:  'คืนของ',
  ADJUST:  'ปรับยอดคงเหลือ',
  DISPOSE: 'จำหน่ายออก'
};

export function lotOf(lotId) {
  return getItems().filter(it => it.lotId === lotId)[0] || null;
}

/**
 * เปิดหน้าต่างทำรายการกับล็อตหนึ่ง
 * @param {string} lotId
 * @param {'ISSUE'|'RETURN'|'ADJUST'|'DISPOSE'} type
 * @param {Function} [onDone] เรียกหลังบันทึกสำเร็จ (ให้หน้าที่เรียกไปซิงก์ข้อมูลเอง)
 */
export function txnDialog(lotId, type, onDone) {
  const it = lotOf(lotId);
  if (!it) return null;
  // กันทางลัดที่ยังไม่ได้ซ่อนปุ่ม — หลังบ้านก็ปฏิเสธอยู่แล้ว แต่ไม่ควรให้กรอกเสร็จแล้วค่อยรู้
  if (!canTxn(it, type)) { toast(EQUIPMENT_NO_ISSUE, 'risk'); return null; }

  const u = getUser() || {};
  const num = qtyAttrs(it);
  const unit = esc(it.unit);
  const who = `
    <div class="field"><label>ผู้ทำรายการ</label>
      <input name="person" value="${esc(u.name || '')}" maxlength="80"></div>`;

  let fields = '';
  if (type === 'ISSUE') fields = `
    <div class="field"><label>จำนวนที่เบิก (${unit}) *</label>
      <input name="qty" type="number" ${num} min="0" max="${it.balance}" required autofocus>
      <div class="hint">คงเหลือ ${fmtNum(it.balance)} ${unit}</div></div>
    ${who}
    <div class="field"><label>ใช้เพื่อ</label>
      <input name="purpose" maxlength="200" placeholder="เช่น ปฏิบัติการ HBT2206 / เตรียมสารละลาย"></div>
    <div class="field"><label>เลขที่เอกสารอ้างอิง</label>
      <input name="refDoc" maxlength="60" placeholder="ไม่บังคับ"></div>`;

  else if (type === 'RETURN') fields = `
    <div class="field"><label>จำนวนที่คืน (${unit}) *</label>
      <input name="qty" type="number" ${num} min="0" required autofocus></div>
    ${who}
    <div class="field"><label>หมายเหตุ</label><input name="notes" maxlength="300"></div>`;

  else if (type === 'ADJUST') fields = `
    <div class="field"><label>นับได้จริง (${unit}) *</label>
      <input name="counted" type="number" ${num} min="0" required autofocus
             value="${it.balance}">
      <div class="hint">ยอดในระบบตอนนี้ ${fmtNum(it.balance)} ${unit} — ระบบจะบันทึกเฉพาะส่วนต่างให้เอง</div></div>
    <div class="field"><label>เหตุผล</label>
      <input name="notes" maxlength="300" placeholder="เช่น นับสต็อกประจำปี / ระเหย / หก"></div>`;

  else if (type === 'DISPOSE') fields = `
    <div class="note note-warn">จะตัดยอด ${fmtNum(it.balance)} ${unit} ออกจากคลังทั้งหมด
      รายการจะยังอยู่ในประวัติและยกเลิกย้อนหลังได้</div>
    <div class="field"><label>เหตุผล *</label>
      <input name="notes" maxlength="300" required autofocus
             placeholder="เช่น หมดอายุ / ปนเปื้อน / ทำลายตามระเบียบ"></div>`;

  const m = openModal({
    title: esc(TITLES[type]) + ' · ' + esc(it.name),
    body: `<form id="tx-form" autocomplete="off">
      <div class="note note-info lotline">
        <b>${esc(it.name)}</b>${it.inci && it.trade ? ' <span class="muted">' + esc(it.trade) + '</span>' : ''}
        <div class="hint"><span class="mono">${esc(it.legacyCode || it.lotId)}</span>
          · ${esc(it.room || 'ไม่ระบุห้อง')}${it.shelf ? ' / ' + esc(it.shelf) : ''}</div>
      </div>
      ${fields}
      <div class="field"><label>วันที่ทำรายการ</label>
        <input name="txnAt" type="date" value="${todayYmd()}"></div>
    </form>`,
    foot: `<button class="btn btn-ghost" data-close>ยกเลิก</button>
           <button class="btn ${type === 'DISPOSE' ? 'btn-risk' : ''}" id="tx-ok">${esc(TITLES[type])}</button>`
  });

  const submit = async () => {
    const form = $('#tx-form', m.el);
    if (!form.reportValidity()) return;
    const f = readForm(m.el);

    const payload = {
      lotId, type,
      person: f.person, purpose: f.purpose, refDoc: f.refDoc, notes: f.notes,
      txnAt: f.txnAt || undefined
    };

    if (type === 'ADJUST') {
      // หลังบ้านรับ "ส่วนต่าง" แบบมีเครื่องหมาย — คำนวณจากยอดที่นับได้จริง
      const diff = Math.round((Number(f.counted) - it.balance) * 10000) / 10000;
      if (diff === 0) { m.close(); return; }
      payload.qty = diff;
    } else if (type === 'DISPOSE') {
      payload.qty = it.balance;
    } else {
      payload.qty = Number(f.qty);
    }

    const r = await run($('#tx-ok', m.el), () => api.txnPost(payload), TITLES[type] + 'แล้ว');
    if (r.ok) { m.close(true); if (onDone) await onDone(); }
  };

  $('#tx-ok', m.el).addEventListener('click', submit);
  $('#tx-form', m.el).addEventListener('submit', e => { e.preventDefault(); submit(); });
  return m;
}

/** ถามเหตุผลก่อนยกเลิกรายการ — คืนข้อความ หรือ null ถ้าไม่ยืนยัน */
export function reasonBox(title, label) {
  return new Promise(resolve => {
    const m = openModal({
      title: esc(title),
      body: `<div class="field"><label for="rb-in">${esc(label)}</label>
        <input id="rb-in" maxlength="120" autofocus placeholder="เช่น ลงผิดล็อต / กรอกจำนวนผิด"></div>`,
      foot: `<button class="btn btn-ghost" data-close>ไม่ยกเลิก</button>
             <button class="btn btn-risk" id="rb-ok">ยืนยันยกเลิกรายการ</button>`
    });
    const done = () => m.close($('#rb-in', m.el).value.trim() || 'ไม่ระบุเหตุผล');
    $('#rb-ok', m.el).addEventListener('click', done);
    $('#rb-in', m.el).addEventListener('keydown', e => { if (e.key === 'Enter') done(); });
    m.closed.then(r => resolve(r || null));
  });
}

export { TXN_TH };


/* ══════════════════════════════════════════════════════════════════════════
   ย้ายที่เก็บ · รูปภาพ · เพิ่ม/แก้ไขที่เก็บ    (กลุ่ม D)
   ══════════════════════════════════════════════════════════════════════════ */
const CFG2 = window.APP_CONFIG;
const RANK = ['ROOM', 'CABINET', 'SHELF', 'BOX'];
export const ZONE_COLORS = ['#0b5d73', '#1e6b45', '#8a5a09', '#99202f', '#5b3f9e', '#a0436b', '#3b6fb0', '#5f6b72'];

/** <option> ของที่เก็บทั้งหมด เรียงตามเส้นทาง */
export function placeOptions(selected, o) {
  const opt = o || {};
  const skip = new Set(opt.exclude || []);
  let h = opt.blank !== undefined ? `<option value="">${esc(opt.blank)}</option>` : '';
  (function walk(ids) {
    for (const id of ids) {
      const p = placeOf(id);
      if (!p) continue;
      if (!skip.has(id)) {
        h += `<option value="${esc(p.id)}"${p.id === selected ? ' selected' : ''}>${esc(p.pathText)}</option>`;
      }
      walk(p.children);
    }
  })(getRoots());
  return h;
}

/** ย้ายล็อตไปที่เก็บอื่น (ทีละตัวหรือหลายตัว) */
export function moveDialog(lotIds, onDone) {
  const ids = Array.isArray(lotIds) ? lotIds : [lotIds];
  const first = ids.length === 1 ? lotOf(ids[0]) : null;
  const here = first && first.placeId ? placeOf(first.placeId) : null;

  const m = openModal({
    title: ids.length === 1 ? 'ย้ายที่เก็บ' : `ย้ายที่เก็บ ${ids.length} ล็อต`,
    body: `<form id="mv-form" autocomplete="off">
      ${first ? `<div class="note note-info lotline"><b>${esc(first.name)}</b>
        <div class="hint"><span class="mono">${esc(first.legacyCode || first.lotId)}</span>
          · ตอนนี้อยู่ที่ ${here ? esc(here.pathText) : 'ยังไม่ระบุที่เก็บ'}</div></div>` : ''}
      <div class="field"><label for="mv-to">ย้ายไปที่ *</label>
        <select id="mv-to" name="toPlaceId" required autofocus>
          ${placeOptions('', { blank: '— เลือกที่เก็บปลายทาง —', exclude: here ? [here.id] : [] })}
        </select>
        <div class="hint">ไม่มีที่เก็บให้เลือก? สร้างได้ที่หน้า "แผนผัง"</div></div>
      <div class="field"><label>หมายเหตุ</label><input name="notes" maxlength="200"></div>
    </form>`,
    foot: `<button class="btn btn-ghost" data-close>ยกเลิก</button>
           <button class="btn" id="mv-ok">ย้ายที่เก็บ</button>`
  });

  const submit = async () => {
    const form = $('#mv-form', m.el);
    if (!form.reportValidity()) return;
    const f = readForm(m.el);
    const r = await run($('#mv-ok', m.el), () => api.lotMove(ids, f.toPlaceId, f.notes), 'ย้ายที่เก็บแล้ว');
    if (r.ok) { m.close(true); if (onDone) await onDone(); }
  };
  $('#mv-ok', m.el).addEventListener('click', submit);
  $('#mv-form', m.el).addEventListener('submit', e => { e.preventDefault(); submit(); });
  return m;
}

/** ดูรูปขนาดใหญ่ */
export function lightbox(photo) {
  if (!photo) return;
  openModal({
    title: esc(photo.caption || 'รูปภาพ'), wide: true, className: 'lightbox',
    body: `<div class="lb-wrap"><img src="${esc(photoSrc(photo.fileId, 1600))}"
             data-fid="${esc(photo.fileId)}" data-w="1600" alt="${esc(photo.caption)}"></div>`
  });
}

/**
 * จัดการรูปของที่เก็บ / สาร / ล็อต
 *
 *  ขั้นตอนตั้งใจให้เป็น เลือก → ดู → ค่อยอัปโหลด ไม่ใช่เลือกแล้วส่งทันที
 *  เพราะรูปจากกล้องมือถือมักตะแคงหรือเบลอ และรูปหลักของชั้นวางถูกใช้วางปุ่ม
 *  ถ้าอัปรูปผิดไปแล้วต้องลากปุ่มใหม่ทั้งชั้น
 */
export function photosDialog({ ownerType, ownerId, title, hint, onDone }) {
  const editable = can('staff');
  const maxSide  = ownerType === 'PLACE' ? CFG2.PHOTO_MAX_SIDE_PLACE : CFG2.PHOTO_MAX_SIDE_ITEM;
  const maxPer   = CFG2.PHOTO_MAX_PER_OWNER || 8;

  const m = openModal({ title: esc(title || 'รูปภาพ'), wide: true, body: '<div id="pd"></div>' });

  let staged = [];        // { key, file, url, rot, failed, error }
  let busy   = false;
  let seq    = 0;

  const uploaded = () => photosOf(ownerType, ownerId);
  const quota    = () => Math.max(0, maxPer - uploaded().length);

  /* ── วาดหน้าต่าง ─────────────────────────────────────────────────────── */

  function render() {
    const list = uploaded();
    const box  = $('#pd', m.el);
    if (!box) return;

    box.innerHTML = `
      ${editable ? `<div class="pd-bar">
        ${hasCamera() ? `<button class="btn" data-pick="cam">${icon.camera} ถ่ายรูป</button>` : ''}
        <button class="btn ${hasCamera() ? 'btn-ghost' : ''}" data-pick="file">${icon.image} เลือกรูปจากเครื่อง</button>
        <span class="muted" id="pd-note">${quotaText()}</span>
      </div>` : ''}
      ${hint ? `<p class="muted">${esc(hint)}</p>` : ''}
      ${ownerType === 'PLACE' ? `<div class="note note-info">รูปแรก (รูปหลัก) คือรูปที่ใช้วางปุ่มของที่เก็บข้างใน
        ถ้าเปลี่ยนรูปหลัก ตำแหน่งปุ่มเดิมอาจไม่ตรงกับรูปใหม่</div>` : ''}
      ${stageHtml()}
      ${list.length ? `<div class="pd-grid">${list.map((p, i) => `
        <figure class="pd-item">
          <button class="pd-thumb" data-open="${esc(p.id)}" title="ดูรูปใหญ่">${photoImg(p, 400, { noRatio: true })}</button>
          ${i === 0 ? '<span class="pd-cover">รูปหลัก</span>' : ''}
          ${editable ? `<figcaption>
            <input class="pd-cap" data-cap="${esc(p.id)}" value="${esc(p.caption)}" maxlength="120" placeholder="คำบรรยาย (ไม่บังคับ)">
            <div class="pd-act">
              ${i !== 0 ? `<button class="btn btn-ghost btn-sm" data-cover="${esc(p.id)}">ตั้งเป็นรูปหลัก</button>` : ''}
              <button class="btn btn-ghost btn-sm" data-del="${esc(p.id)}">${icon.trash} ลบ</button>
            </div></figcaption>` : (p.caption ? `<figcaption><span class="muted">${esc(p.caption)}</span></figcaption>` : '')}
        </figure>`).join('')}</div>`
        : (staged.length ? '' : `<div class="empty small"><b>ยังไม่มีรูป</b>${
            editable ? (hasCamera() ? ' กด "ถ่ายรูป" เพื่อเริ่ม' : ' ลากรูปมาวางที่นี่ หรือกด "เลือกรูปจากเครื่อง"') : ''}</div>`)}`;
  }

  function quotaText() {
    const left = quota() - staged.length;
    if (left <= 0) return `ครบ ${maxPer} รูปแล้ว — ลบรูปเดิมออกก่อนจึงจะเพิ่มได้อีก`;
    return `รูปจะถูกย่อในเครื่องก่อนอัปโหลด · เพิ่มได้อีก ${left} รูป`;
  }

  /** แถบรูปที่เลือกไว้แต่ยังไม่ได้ส่ง */
  function stageHtml() {
    if (!staged.length) return '';
    const anyFailed = staged.some(s => s.failed);
    return `<div class="pd-stage" id="pd-stage">
      <div class="pd-stage-head">
        <b>รูปที่เลือกไว้ ${staged.length} รูป</b>
        <span class="muted">ยังไม่ได้อัปโหลด — หมุนหรือลบออกได้ก่อน</span>
      </div>
      <div class="pd-stage-grid">
        ${staged.map(s => `
          <figure class="pd-sitem${s.failed ? ' is-fail' : ''}">
            <div class="pd-sthumb"><img src="${esc(s.url)}" alt="" style="transform:rotate(${s.rot}deg)"></div>
            ${s.failed ? `<span class="pd-serr" title="${esc(s.error || '')}">ส่งไม่สำเร็จ</span>` : ''}
            <div class="pd-sact">
              <button class="btn btn-ghost btn-sm" data-rot="${s.key}" title="หมุนตามเข็ม 90°">↻</button>
              <button class="btn btn-ghost btn-sm" data-unstage="${s.key}" title="เอาออก">✕</button>
            </div>
          </figure>`).join('')}
      </div>
      <div class="pd-stage-foot">
        <button class="btn" data-up="go">อัปโหลด ${staged.length} รูป</button>
        ${hasCamera() ? `<button class="btn btn-ghost" data-pick="cam">+ ถ่ายอีกรูป</button>` : ''}
        <button class="btn btn-ghost" data-pick="file">+ เลือกเพิ่ม</button>
        <button class="btn btn-ghost" data-up="clear">ล้างทั้งหมด</button>
        <span class="muted" id="pd-prog">${anyFailed ? 'กด "อัปโหลด" อีกครั้งเพื่อลองส่งรูปที่ค้างใหม่' : ''}</span>
      </div>
    </div>`;
  }

  /* ── เลือกรูปเข้าแถบรอ ───────────────────────────────────────────────── */

  function addFiles(files) {
    if (!editable || !files || !files.length) return;
    const left = quota() - staged.length;
    if (left <= 0) {
      toast(`แนบได้สูงสุด ${maxPer} รูปต่อรายการ — ลบรูปเดิมออกก่อน`, 'risk');
      return;
    }

    const pics = [...files].filter(f => /^image\//.test(f.type || '') || looksHeic(f));
    if (!pics.length) { toast('ไฟล์ที่เลือกไม่ใช่รูปภาพ', 'risk'); return; }

    const heic = pics.filter(looksHeic);
    const good = pics.filter(f => !looksHeic(f));
    if (heic.length) toast(HEIC_HELP, 'risk');          // บอกตั้งแต่ตอนเลือก ไม่ต้องรอให้อัปพัง

    const take = good.slice(0, left);
    if (good.length > take.length) {
      toast(`เพิ่มได้อีกแค่ ${left} รูป — รับไว้ ${take.length} รูป ที่เหลือไม่ได้ใส่`, 'risk');
    }
    take.forEach(file => staged.push({
      key: 's' + (++seq), file, url: URL.createObjectURL(file), rot: 0, failed: false, error: ''
    }));
    render();
  }

  function dropStaged(keys) {
    staged = staged.filter(s => {
      if (keys.indexOf(s.key) === -1) return true;
      URL.revokeObjectURL(s.url);
      return false;
    });
  }

  /* ── ส่งขึ้นเซิร์ฟเวอร์ ───────────────────────────────────────────────── */

  async function uploadStaged() {
    if (busy || !staged.length) return;
    const room = quota();
    if (room <= 0) { toast(`ครบ ${maxPer} รูปแล้ว`, 'risk'); return; }

    busy = true;
    const prog = $('#pd-prog', m.el);
    const todo = staged.slice(0, room);
    const okKeys = [];
    let fails = 0;

    for (let i = 0; i < todo.length; i++) {
      const s = todo[i];
      if (prog) prog.textContent = `กำลังอัปโหลด ${i + 1}/${todo.length} …`;
      try {
        const img = await resizeImage(s.file, maxSide, 0.82, s.rot);
        await api.photoUpload({
          ownerType, ownerId, data: img.data, width: img.width, height: img.height
        });
        okKeys.push(s.key);
      } catch (e) {
        // รูปใบเดียวพังต้องไม่ทำให้ที่เหลือไม่ได้ส่ง — ทำเครื่องหมายไว้แล้วไปต่อ
        s.failed = true;
        s.error  = e.message || 'ส่งไม่สำเร็จ';
        fails++;
      }
    }

    dropStaged(okKeys);
    busy = false;

    if (okKeys.length && !fails)      toast(`อัปโหลด ${okKeys.length} รูปแล้ว`, 'ok');
    else if (okKeys.length && fails)  toast(`อัปโหลดสำเร็จ ${okKeys.length} รูป · ค้างอยู่ ${fails} รูป`, 'risk');
    else if (fails)                   toast(staged.find(s => s.failed)?.error || 'อัปโหลดไม่สำเร็จ', 'risk');

    await refresh();
  }

  async function refresh() { if (onDone) await onDone(); render(); }

  /* ── เหตุการณ์ ───────────────────────────────────────────────────────── */

  // กันปิดหน้าต่างระหว่างอัปโหลด ไม่งั้นรูปที่ค้างจะหายไปโดยไม่รู้ตัว
  m.el.addEventListener('click', e => {
    if (!busy) return;
    if (e.target === m.el || e.target.closest('[data-close]')) {
      e.preventDefault(); e.stopPropagation();
      toast('กำลังอัปโหลดอยู่ รอให้เสร็จก่อนนะ', 'risk');
    }
  }, true);
  m.el.addEventListener('cancel', e => { if (busy) e.preventDefault(); });

  m.el.addEventListener('click', async e => {
    const t = e.target.closest('button');
    if (!t) return;

    if (t.dataset.pick) {
      const cam = t.dataset.pick === 'cam';
      return addFiles(await pickImages({ capture: cam, multiple: !cam }));
    }
    if (t.dataset.rot) {
      const s = staged.find(x => x.key === t.dataset.rot);
      if (s) { s.rot = (s.rot + 90) % 360; s.failed = false; render(); }
      return;
    }
    if (t.dataset.unstage) { dropStaged([t.dataset.unstage]); render(); return; }
    if (t.dataset.up === 'go')    return uploadStaged();
    if (t.dataset.up === 'clear') { dropStaged(staged.map(s => s.key)); render(); return; }

    if (t.dataset.open) return lightbox(uploaded().find(p => p.id === t.dataset.open));
    if (t.dataset.del) {
      if (!(await confirmBox({ title: 'ลบรูปนี้?', okText: 'ลบรูป', danger: true,
        message: 'รูปจะถูกลบออกจากระบบและย้ายไปถังขยะใน Google Drive' }))) return;
      const r = await run(t, () => api.photoDelete(t.dataset.del), 'ลบรูปแล้ว');
      if (r.ok) await refresh();
      return;
    }
    if (t.dataset.cover) {
      const r = await run(t, () => api.photoUpdate({ photoId: t.dataset.cover, makeCover: true }), 'ตั้งเป็นรูปหลักแล้ว');
      if (r.ok) await refresh();
    }
  });

  m.el.addEventListener('change', async e => {
    const inp = e.target.closest('[data-cap]');
    if (!inp) return;
    const r = await run(null, () => api.photoUpdate({ photoId: inp.dataset.cap, caption: inp.value }), 'บันทึกคำบรรยายแล้ว');
    if (r.ok && onDone) await onDone();
  });

  // ลากไฟล์มาวาง (เดสก์ท็อป)
  m.el.addEventListener('dragover', e => {
    if (!editable) return;
    e.preventDefault();
    m.el.classList.add('is-drop');
  });
  m.el.addEventListener('dragleave', e => {
    if (e.target === m.el) m.el.classList.remove('is-drop');
  });
  m.el.addEventListener('drop', e => {
    if (!editable) return;
    e.preventDefault();
    m.el.classList.remove('is-drop');
    addFiles(e.dataTransfer && e.dataTransfer.files);
  });

  // วางรูปจากคลิปบอร์ด (Ctrl+V) — คนถ่ายด้วยมือถือแล้วส่งเข้าคอมใช้ทางนี้บ่อย
  const onPaste = e => {
    if (!editable || !e.clipboardData) return;
    const files = [...e.clipboardData.files || []];
    if (files.length) { e.preventDefault(); addFiles(files); }
  };
  document.addEventListener('paste', onPaste);

  m.closed.then(() => {
    document.removeEventListener('paste', onPaste);
    staged.forEach(s => URL.revokeObjectURL(s.url));
    staged = [];
  });

  render();
  return m;
}

/** เพิ่ม / แก้ไข / ลบที่เก็บ */
export function placeDialog(o) {
  const editing = !!o.placeId;
  const cur = editing ? placeOf(o.placeId) : null;
  if (editing && !cur) { toast('ไม่พบที่เก็บนี้', 'risk'); return null; }

  const parentId = editing ? cur.parentId : (o.parentId || '');
  const parent = parentId ? placeOf(parentId) : null;
  const minRank = parent ? RANK.indexOf(parent.kind) + 1 : 0;
  const maxRank = editing && cur.children.length
    ? Math.min(...cur.children.map(c => RANK.indexOf(placeOf(c).kind))) - 1 : 3;
  const kinds = RANK.filter((k, i) => i >= minRank && i <= maxRank);
  const defKind = editing ? cur.kind : (o.kind && kinds.includes(o.kind) ? o.kind : (kinds[0] || 'BOX'));
  const color = editing ? cur.color : (o.color || '');

  const m = openModal({
    title: editing ? 'แก้ไขที่เก็บ' : 'เพิ่มที่เก็บ' + (parent ? ' ใน ' + esc(parent.name) : ''),
    body: `<form id="pl-form" autocomplete="off">
      <div class="field"><label for="pl-name">ชื่อ *</label>
        <input id="pl-name" name="name" value="${esc(editing ? cur.name : (o.name || ''))}" maxlength="80" required autofocus
               placeholder="เช่น ชั้น 2 · ตู้เหล็ก A · Room 204"></div>
      <div class="row-2">
        <div class="field"><label>ระดับ</label>
          <select name="kind">${kinds.map(k => `<option value="${k}"${k === defKind ? ' selected' : ''}>${esc(PLACE_KIND_TH[k])}</option>`).join('')}</select></div>
        <div class="field"><label>สีของปุ่ม</label>
          <div class="swatches" id="pl-colors">
            <button type="button" class="sw sw-none${color ? '' : ' on'}" data-c="" title="อัตโนมัติ">∅</button>
            ${ZONE_COLORS.map(c => `<button type="button" class="sw${c === color ? ' on' : ''}" data-c="${c}" style="--c:${c}" title="${c}"></button>`).join('')}
          </div><input type="hidden" name="color" value="${esc(color)}"></div>
      </div>
      <div class="field"><label>หมายเหตุ</label><input name="notes" value="${esc(editing ? cur.notes : '')}" maxlength="300"></div>
      ${editing ? `<div class="field"><label>ย้ายไปไว้ใน</label>
        <select name="parentId">${placeOptions(parentId, { blank: '— ระดับบนสุด —', exclude: [cur.id, ...descendantIds(cur.id)] })}</select>
        <div class="hint">ย้ายไปที่อื่นแล้วปุ่มบนรูปเดิมจะถูกเอาออก ต้องวางใหม่</div></div>` : ''}
    </form>`,
    foot: `${editing ? `<button class="btn btn-ghost btn-danger-text" id="pl-del">${icon.trash} ลบที่เก็บนี้</button><span class="spacer"></span>` : ''}
           <button class="btn btn-ghost" data-close>ยกเลิก</button>
           <button class="btn" id="pl-ok">บันทึก</button>`
  });

  $('#pl-colors', m.el).addEventListener('click', e => {
    const b = e.target.closest('.sw'); if (!b) return;
    $$('.sw', m.el).forEach(x => x.classList.toggle('on', x === b));
    $('[name=color]', m.el).value = b.dataset.c;
  });

  const submit = async () => {
    const form = $('#pl-form', m.el);
    if (!form.reportValidity()) return;
    const f = readForm(m.el);
    const payload = { name: f.name, kind: f.kind, color: f.color, notes: f.notes };
    if (editing) { payload.placeId = cur.id; if (f.parentId !== parentId) payload.parentId = f.parentId; }
    else { payload.parentId = parentId; if (o.zone) payload.zone = o.zone; }
    const r = await run($('#pl-ok', m.el), () => api.placeSave(payload), 'บันทึกแล้ว');
    if (r.ok) { m.close(true); if (o.onDone) await o.onDone(r.value); }
  };
  $('#pl-ok', m.el).addEventListener('click', submit);
  $('#pl-form', m.el).addEventListener('submit', e => { e.preventDefault(); submit(); });

  if (editing) $('#pl-del', m.el).addEventListener('click', async () => {
    const n = cur.deep;
    if (!(await confirmBox({
      title: 'ลบ "' + cur.name + '" ?', danger: true, okText: 'ลบที่เก็บ',
      message: n ? `ที่เก็บนี้ยังมีของ ${n} ล็อต — ระบบจะไม่ยอมให้ลบจนกว่าจะย้ายของออก`
                 : 'รูปของที่เก็บนี้จะถูกลบด้วย (ลบแล้วเอากลับไม่ได้)'
    }))) return;
    const r = await run($('#pl-del', m.el), () => api.placeDelete(cur.id), 'ลบที่เก็บแล้ว');
    if (r.ok) { m.close(true); if (o.onDeleted) await o.onDeleted(); }
  });
  return m;
}


/* ── เปลี่ยนรหัสผ่านของตัวเอง (บัญชีรหัสผ่านเท่านั้น) ────────────────────── */

export function changePasswordDialog() {
  const m = openModal({
    title: 'เปลี่ยนรหัสผ่าน',
    body: `<form id="cp-form" autocomplete="off">
      <div class="field">
        <label for="cp-old">รหัสผ่านเดิม</label>
        <input id="cp-old" type="password" autocomplete="current-password" required>
      </div>
      <div class="field">
        <label for="cp-new">รหัสผ่านใหม่</label>
        <input id="cp-new" type="password" autocomplete="new-password" required minlength="8">
        <small class="hint">ยาวอย่างน้อย 8 ตัว มีทั้งตัวอักษรและตัวเลข</small>
      </div>
      <div class="field">
        <label for="cp-new2">พิมพ์รหัสผ่านใหม่อีกครั้ง</label>
        <input id="cp-new2" type="password" autocomplete="new-password" required>
      </div>
      <p class="muted">เปลี่ยนแล้วเครื่องอื่นที่ค้างล็อกอินอยู่จะหลุดทั้งหมด</p>
    </form>`,
    foot: `<button class="btn btn-ghost" data-close>ยกเลิก</button>
           <button class="btn" id="cp-ok">เปลี่ยนรหัสผ่าน</button>`
  });

  const go = async ev => {
    ev.preventDefault();
    const oldPassword = $('#cp-old', m.el).value;
    const a = $('#cp-new', m.el).value;
    const b = $('#cp-new2', m.el).value;

    if (a !== b) { toast('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน', 'risk'); return; }

    const r = await run($('#cp-ok', m.el),
      () => api.passwordChange(oldPassword, a), 'เปลี่ยนรหัสผ่านเรียบร้อย');
    if (!r.ok) return;

    // หลังบ้านตัด session เดิมทุกตัว — ต้องเก็บ session ใหม่ที่ได้มาแทนทันที
    setSession(r.value.session, r.value.user);
    m.close();
  };

  $('#cp-form', m.el).addEventListener('submit', go);
  $('#cp-ok', m.el).addEventListener('click', go);
  $('#cp-old', m.el).focus();
  return m;
}
