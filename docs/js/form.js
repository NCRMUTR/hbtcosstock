/* ══════════════════════════════════════════════════════════════════════════
   form.js — ฟอร์มเพิ่มสาร / รับเข้าล็อตใหม่ / แก้ไขข้อมูลล็อต

   3 โหมด
     new  เพิ่มสารใหม่ + รับเข้าล็อตแรกในครั้งเดียว
     lot  รับเข้าล็อตใหม่ของสารที่มีอยู่แล้ว
     edit แก้ไขข้อมูลล็อต (จำนวนที่รับเข้าแก้ไม่ได้ — ยอดมาจากบัญชีเดินสะพัด)
   ══════════════════════════════════════════════════════════════════════════ */
import { api } from './api.js';
import { getItems, getSettings } from './search.js';
import {
  $, $$, esc, toast, run, openModal, readForm, optionsHtml, datalistHtml, todayYmd, fmtNum, icon
} from './ui.js';
import { resizeImage, pickImages, hasCamera, looksHeic, HEIC_HELP } from './photo.js';
import { KIND_ORDER, KINDS, kindTag, qtyAttrs, EQUIPMENT_UNIT } from './kinds.js';

const CFG = window.APP_CONFIG;

const TITLES = {
  new:  'เพิ่มรายการใหม่เข้าคลัง',
  lot:  'รับเข้าล็อตใหม่',
  edit: 'แก้ไขข้อมูลล็อต'
};

/** รายชื่อสารที่มีอยู่แล้ว (ไม่ซ้ำ) จาก snapshot ในเครื่อง */
function materialList() {
  const seen = new Map();
  for (const it of getItems()) {
    if (!seen.has(it.materialId)) {
      seen.set(it.materialId, {
        materialId: it.materialId, inci: it.inci, trade: it.trade, cas: it.cas, name: it.name,
        unit: it.unit, func: it.func, state: it.state, supplier: it.supplier, kind: it.kind
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'th'));
}

const opts = type => (getSettings() || {})[type] || [];

/**
 * @param {Object} o { mode:'new'|'lot'|'edit', materialId?, lotId?, onSaved? }
 */
export function openItemForm(o) {
  const st = {
    mode: o.mode || 'new',
    materialId: o.materialId || '',
    lotId: o.lotId || '',
    v: { receiveDate: todayYmd(), kind: o.kind || 'CHEMICAL' },
    pics: []      // รูปที่เลือกไว้ตอนกรอกฟอร์ม — อัปหลังสร้างล็อตสำเร็จเท่านั้น
  };
  let picSeq = 0;

  const mats = materialList();

  if (st.mode === 'edit') {
    const it = getItems().filter(x => x.lotId === st.lotId)[0];
    if (!it) { toast('ไม่พบล็อตนี้', 'risk'); return null; }
    st.materialId = it.materialId;
    st.v = {
      supplier: it.supplier, supplierLotNo: it.supplierLotNo, fiscalYear: it.fiscalYear,
      room: it.room, shelf: it.shelf, legacyCode: it.legacyCode,
      unitPrice: it.unitPrice === null ? '' : it.unitPrice,
      receiveDate: ymd(it.receiveDate), expireDate: ymd(it.expireDate),
      notes: ''
    };
    st.it = it;
  } else if (st.mode === 'lot') {
    const m = mats.filter(x => x.materialId === st.materialId)[0];
    if (!m) { toast('ไม่พบสารนี้', 'risk'); return null; }
    st.v.supplier = m.supplier || '';
    st.mat = m;
  }

  const m = openModal({
    title: esc(TITLES[st.mode]), wide: true,
    body: '<form id="it-form" autocomplete="off"></form>',
    foot: `<span class="err" id="it-err" role="alert"></span><span class="spacer"></span>
           <button class="btn btn-ghost" data-close>ยกเลิก</button>
           <button class="btn" id="it-ok">${st.mode === 'edit' ? 'บันทึกการแก้ไข' : 'บันทึก'}</button>`
  });

  function ymd(d) {
    if (!d) return '';
    const dt = d instanceof Date ? d : new Date(d);
    return isNaN(dt.getTime()) ? ''
      : dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  }

  /* ── วาดฟอร์ม ───────────────────────────────────────────────────────── */
  function render() {
    const v = st.v;
    const val = k => esc(v[k] === undefined || v[k] === null ? '' : v[k]);
    // ชนิดของรายการที่กำลังกรอก — โหมด lot/edit ใช้ชนิดของสารเดิม แก้ที่นี่ไม่ได้
    const kind = st.mat ? st.mat.kind : (st.it ? st.it.kind : v.kind);
    const chem = kind === 'CHEMICAL', equip = kind === 'EQUIPMENT';
    const unitNow = st.mat ? st.mat.unit : (st.it ? st.it.unit : (equip ? EQUIPMENT_UNIT : (v.unit || 'g')));

    $('#it-form', m.el).innerHTML = `
      ${st.mode === 'lot' ? `
      <div class="note note-info lotline">
        ${kindTag(st.mat.kind)} <b>${esc(st.mat.name)}</b>${st.mat.inci && st.mat.trade ? ' <span class="muted">' + esc(st.mat.trade) + '</span>' : ''}
        <div class="hint">รับเข้าเป็นล็อตใหม่ของสารเดิม — ข้อมูลสาร (ชื่อ CAS หน่วยนับ) ใช้ตามเดิม</div>
      </div>` : ''}

      ${st.mode === 'edit' ? `
      <div class="note note-info lotline">
        ${kindTag(st.it.kind)} <b>${esc(st.it.name)}</b> <span class="mono">${esc(st.it.lotId)}</span>
        <div class="hint">คงเหลือ ${fmtNum(st.it.balance)} ${esc(st.it.unit)}
          (รับเข้า ${fmtNum(st.it.qtyReceived)}) — แก้จำนวนที่รับเข้าไม่ได้ ถ้ายอดไม่ตรงให้ใช้ "ปรับยอด"</div>
      </div>` : ''}

      ${st.mode === 'new' ? `
      <fieldset class="fs">
        <legend>ข้อมูลรายการ</legend>
        <div class="field"><label for="f-kind">ชนิดของ *</label>
          <select id="f-kind" name="kind">${KIND_ORDER.map(k =>
            `<option value="${k}"${k === kind ? ' selected' : ''}>${esc(KINDS[k].th)}</option>`).join('')}</select>
          <div class="hint">${chem ? 'สารเคมีต้องมีชื่อสาร ตวงวัดเป็นทศนิยมได้'
            : equip ? 'ครุภัณฑ์นับเป็นชิ้น (pcs) รับเฉพาะจำนวนเต็ม และยังเบิก/คืนไม่ได้ — ใช้ "ย้ายที่เก็บ" แทน'
            : 'วัสดุสิ้นเปลือง เช่น กระดาษกรอง ถุงมือ — ไม่ต้องมีเลข CAS'}</div></div>
        <div class="field"><label for="f-inci">${chem ? 'ชื่อสาร *' : 'ชื่อรายการ'}</label>
          <input id="f-inci" name="inci" value="${val('inci')}" maxlength="150" ${chem ? 'required' : ''} autofocus
                 placeholder="${chem ? 'เช่น Sodium chloride' : equip ? 'เช่น บีกเกอร์ 250 mL' : 'เช่น กระดาษกรอง No.1'}">
          <div id="sugg" class="sugg"></div></div>
        <div class="row-2">
          <div class="field"><label>${chem ? 'ชื่อการค้า' : 'ชื่อการค้า / รุ่น'}</label>
            <input name="trade" value="${val('trade')}" maxlength="150" placeholder="${chem ? 'เช่น AR grade / Merck' : 'เช่น Whatman No.1 / Pyrex'}"></div>
          ${chem ? `<div class="field"><label>เลข CAS</label>
            <input name="cas" class="mono" value="${val('cas')}" maxlength="40" placeholder="7647-14-5"></div>` : ''}
        </div>
        <div class="row-3">
          ${chem ? `<div class="field"><label>หน้าที่ของสาร</label>
            <input name="func" value="${val('func')}" maxlength="80" list="dl-func" placeholder="เลือกหรือพิมพ์ใหม่"></div>
          <div class="field"><label>สถานะสาร</label>
            <input name="state" value="${val('state')}" maxlength="40" list="dl-state"></div>` : ''}
          <div class="field"><label>หน่วยนับ *</label>
            ${equip
              ? `<input name="unit" value="${EQUIPMENT_UNIT}" readonly aria-readonly="true" title="ครุภัณฑ์นับเป็นชิ้นเสมอ">`
              : `<input name="unit" value="${val('unit') || 'g'}" maxlength="20" list="dl-unit" required>`}</div>
        </div>
        ${equip ? '' : `<div class="row-2">
          <div class="field"><label>การเก็บรักษา</label>
            <input name="storageCondition" value="${val('storageCondition')}" maxlength="60"
                   placeholder="เช่น RT · 2-8C · -20C"></div>
          <div class="field"><label>ความอันตราย (GHS)</label>
            <input name="hazard" value="${val('hazard')}" maxlength="150" placeholder="เช่น Corrosive, Flammable"></div>
        </div>
        <div class="field"><label>ลิงก์เอกสาร SDS</label>
          <input name="sds" type="url" value="${val('sds')}" maxlength="500" placeholder="https://…"></div>`}
      </fieldset>` : ''}

      <fieldset class="fs">
        <legend>${st.mode === 'edit' ? 'ข้อมูลล็อตนี้' : 'ล็อตที่รับเข้า'}</legend>
        <div class="row-3">
          ${st.mode === 'edit' ? '' : `
          <div class="field"><label>จำนวนที่รับเข้า (${esc(unitNow)}) *</label>
            <input name="qty" type="number" ${qtyAttrs({ kind })} min="0" value="${val('qty')}" required
                   ${st.mode === 'lot' ? 'autofocus' : ''}></div>`}
          <div class="field"><label>ห้อง</label>
            <input name="room" value="${val('room')}" maxlength="80" list="dl-room"></div>
          <div class="field"><label>ชั้นวาง</label>
            <input name="shelf" value="${val('shelf')}" maxlength="80" list="dl-shelf"></div>
        </div>
        <div class="row-3">
          <div class="field"><label>ผู้จำหน่าย</label>
            <input name="supplier" value="${val('supplier')}" maxlength="100" list="dl-sup"></div>
          <div class="field"><label>เลขล็อตจากผู้ขาย</label>
            <input name="supplierLotNo" value="${val('supplierLotNo')}" maxlength="80"></div>
          <div class="field"><label>รหัสเดิมที่ติดบนขวด</label>
            <input name="legacyCode" class="mono" value="${val('legacyCode')}" maxlength="60" placeholder="เช่น #2610/1234"></div>
        </div>
        <div class="row-3">
          <div class="field"><label>วันที่รับเข้า</label>
            <input name="receiveDate" type="date" value="${val('receiveDate')}"></div>
          <div class="field"><label>วันหมดอายุ</label>
            <input name="expireDate" type="date" value="${val('expireDate')}"></div>
          <div class="field"><label>ปีงบประมาณ</label>
            <input name="fiscalYear" value="${val('fiscalYear')}" maxlength="10" list="dl-fy"
                   placeholder="เว้นว่าง = คำนวณให้เอง"></div>
        </div>
        <div class="row-2">
          <div class="field"><label>ราคาต่อหน่วย (บาท)</label>
            <input name="unitPrice" type="number" inputmode="decimal" step="any" min="0" value="${val('unitPrice')}"></div>
          <div class="field"><label>หมายเหตุ</label>
            <input name="notes" value="${val('notes')}" maxlength="300"></div>
        </div>
      </fieldset>

      ${st.mode === 'edit' ? '' : picsFieldset()}

      ${datalistHtml('dl-func',  opts('Function'))}
      ${datalistHtml('dl-state', opts('State'))}
      ${datalistHtml('dl-unit',  opts('Unit'))}
      ${datalistHtml('dl-room',  opts('Room'))}
      ${datalistHtml('dl-shelf', opts('Shelf'))}
      ${datalistHtml('dl-sup',   opts('Supplier'))}
      ${datalistHtml('dl-fy',    opts('FiscalYear'))}`;
  }

  /* ── รูปของล็อตที่กำลังรับเข้า ───────────────────────────────────────── */

  function picsFieldset() {
    return `<fieldset class="fs">
      <legend>รูปภาพ (ไม่บังคับ)</legend>
      <div class="pd-bar">
        ${hasCamera() ? `<button type="button" class="btn btn-ghost" data-pic-add="cam">${icon.camera} ถ่ายรูป</button>` : ''}
        <button type="button" class="btn btn-ghost" data-pic-add="file">${icon.image} เลือกรูปจากเครื่อง</button>
        <span class="muted">${st.pics.length
          ? 'จะอัปโหลดให้หลังบันทึกล็อตสำเร็จ'
          : 'ถ่ายขวดหรือฉลากตอนนี้เลยก็ได้ ไม่ต้องกลับมาทำทีหลัง'}</span>
      </div>
      ${st.pics.length ? `<div class="pd-stage-grid" id="f-pics">${st.pics.map(s2 => `
        <figure class="pd-sitem">
          <div class="pd-sthumb"><img src="${esc(s2.url)}" alt="" style="transform:rotate(${s2.rot}deg)"></div>
          <div class="pd-sact">
            <button type="button" class="btn btn-ghost btn-sm" data-pic-rot="${s2.key}" title="หมุนตามเข็ม 90°">↻</button>
            <button type="button" class="btn btn-ghost btn-sm" data-pic-del="${s2.key}" title="เอาออก">✕</button>
          </div>
        </figure>`).join('')}</div>` : ''}
    </fieldset>`;
  }

  function addPics(files) {
    if (!files || !files.length) return;
    const left = (CFG.PHOTO_MAX_PER_OWNER || 8) - st.pics.length;
    if (left <= 0) { toast('แนบได้สูงสุด ' + (CFG.PHOTO_MAX_PER_OWNER || 8) + ' รูป', 'risk'); return; }

    const pics = [...files].filter(f => /^image\//.test(f.type || '') || looksHeic(f));
    if (pics.some(looksHeic)) toast(HEIC_HELP, 'risk');

    keep();                                              // อย่าให้ค่าที่กรอกไว้หายตอนวาดใหม่
    pics.filter(f => !looksHeic(f)).slice(0, left).forEach(file => st.pics.push({
      key: 'p' + (++picSeq), file, url: URL.createObjectURL(file), rot: 0
    }));
    render();
  }

  function dropPics(keys) {
    st.pics = st.pics.filter(s2 => {
      if (keys.indexOf(s2.key) === -1) return true;
      URL.revokeObjectURL(s2.url);
      return false;
    });
  }

  /** อัปโหลดรูปหลังล็อตถูกสร้างแล้ว — ล้มเหลวก็ไม่ทำให้ล็อตที่บันทึกไปแล้วเสียหาย */
  async function uploadPics(lotId) {
    if (!st.pics.length) return;
    const err = $('#it-err', m.el);
    let done = 0, fail = 0;

    for (let i = 0; i < st.pics.length; i++) {
      if (err) err.textContent = `กำลังอัปโหลดรูป ${i + 1}/${st.pics.length} …`;
      try {
        const img = await resizeImage(st.pics[i].file, CFG.PHOTO_MAX_SIDE_ITEM, 0.82, st.pics[i].rot);
        await api.photoUpload({ ownerType: 'LOT', ownerId: lotId, data: img.data, width: img.width, height: img.height });
        done++;
      } catch (e) { fail++; }
    }
    if (err) err.textContent = '';

    if (done && !fail) toast(`แนบรูป ${done} รูปแล้ว`, 'ok');
    else if (fail)     toast(`บันทึกล็อตแล้ว แต่อัปโหลดรูปไม่สำเร็จ ${fail} รูป — เปิดรายละเอียดล็อตแล้วลองใหม่ได้`, 'risk');
  }

  /** เก็บค่าที่กรอกไว้ก่อนวาดใหม่ (ตอนสลับโหมด) */
  function keep() {
    Object.assign(st.v, readForm($('#it-form', m.el)));
  }

  render();

  /* ── แนะนำสารที่มีอยู่แล้ว ขณะพิมพ์ชื่อ ─────────────────────────────── */
  // เปลี่ยนชนิดแล้วช่องที่ต้องกรอกเปลี่ยนตาม (ครุภัณฑ์ไม่มี CAS หน่วยล็อกเป็นชิ้น) — วาดใหม่ทั้งฟอร์ม
  m.el.addEventListener('change', e => {
    if (e.target.name !== 'kind' || st.mode !== 'new') return;
    keep();
    $('#it-err', m.el).textContent = '';
    render();
    const k = $('[name=kind]', m.el);
    if (k) k.focus();
  });

  let suggTimer = null;
  m.el.addEventListener('input', e => {
    // วัสดุ/ครุภัณฑ์มักกรอกแค่ชื่อรุ่น จึงแนะนำจากช่องชื่อการค้าด้วย
    if ((e.target.name !== 'inci' && e.target.name !== 'trade') || st.mode !== 'new') return;
    clearTimeout(suggTimer);
    suggTimer = setTimeout(() => {
      const box = $('#sugg', m.el);
      if (!box) return;
      const q = (($('[name=inci]', m.el).value || '') || ($('[name=trade]', m.el).value || '')).toLowerCase().trim();
      if (q.length < 2) { box.innerHTML = ''; return; }
      const toks = q.split(/\s+/);
      const hits = mats.filter(x =>
        toks.every(t => (x.inci + ' ' + x.trade + ' ' + x.cas).toLowerCase().includes(t))).slice(0, 5);
      box.innerHTML = hits.length ? `
        <div class="sugg-head">รายการนี้มีอยู่แล้วหรือเปล่า? กดเพื่อรับเข้าเป็นล็อตใหม่ของรายการเดิม (ไม่ต้องสร้างซ้ำ)</div>
        ${hits.map(x => `<button type="button" class="sugg-item" data-use="${esc(x.materialId)}">
          ${kindTag(x.kind)} <b>${esc(x.name)}</b> <span class="muted">${esc([x.inci ? x.trade : '', x.cas].filter(Boolean).join(' · '))}</span>
          <span class="sugg-go">รับเข้าเป็นล็อตใหม่ →</span></button>`).join('')}` : '';
    }, 140);
  });

  /** สลับไปโหมดรับเข้าล็อตใหม่ของสารที่เลือก โดยเก็บค่าล็อตที่กรอกไว้แล้ว */
  function switchToLot(materialId) {
    keep();
    const mat = mats.filter(x => x.materialId === materialId)[0];
    if (!mat) return;
    const k = st.v;
    st.mode = 'lot'; st.materialId = materialId; st.mat = mat;
    st.v = {
      qty: k.qty, room: k.room, shelf: k.shelf, legacyCode: k.legacyCode,
      supplier: k.supplier || mat.supplier || '', supplierLotNo: k.supplierLotNo,
      receiveDate: k.receiveDate, expireDate: k.expireDate, fiscalYear: k.fiscalYear,
      unitPrice: k.unitPrice, notes: k.notes
    };
    m.setTitle(esc(TITLES.lot));
    $('#it-err', m.el).textContent = '';
    render();
  }

  m.el.addEventListener('click', async e => {
    const use = e.target.closest('[data-use]');
    if (use) return switchToLot(use.dataset.use);

    const add = e.target.closest('[data-pic-add]');
    if (add) {
      const cam = add.dataset.picAdd === 'cam';
      return addPics(await pickImages({ capture: cam, multiple: !cam }));
    }
    const rot = e.target.closest('[data-pic-rot]');
    if (rot) {
      const s2 = st.pics.find(x => x.key === rot.dataset.picRot);
      if (s2) { s2.rot = (s2.rot + 90) % 360; keep(); render(); }
      return;
    }
    const del = e.target.closest('[data-pic-del]');
    if (del) { dropPics([del.dataset.picDel]); keep(); render(); }
  });

  // ออกจากฟอร์มแล้วคืนหน่วยความจำของรูปที่เลือกไว้
  m.closed.then(() => dropPics(st.pics.map(s2 => s2.key)));

  /* ── บันทึก ─────────────────────────────────────────────────────────── */
  const strip = obj => { Object.keys(obj).forEach(k => { if (obj[k] === '' || obj[k] === undefined) delete obj[k]; }); return obj; };

  async function save() {
    const form = $('#it-form', m.el);
    const err = $('#it-err', m.el);
    err.textContent = '';
    if (!form.reportValidity()) return;
    keep();
    const f = st.v;
    if (st.mode === 'new' && f.kind !== 'CHEMICAL' && !String(f.inci || '').trim() && !String(f.trade || '').trim()) {
      err.textContent = 'กรุณากรอกชื่อรายการ หรือ ชื่อการค้า/รุ่น อย่างน้อย 1 ช่อง';
      return;
    }

    const lotPart = {
      room: f.room, shelf: f.shelf, supplier: f.supplier, supplierLotNo: f.supplierLotNo,
      legacyCode: f.legacyCode, receiveDate: f.receiveDate, expireDate: f.expireDate,
      fiscalYear: f.fiscalYear, unitPrice: f.unitPrice, notes: f.notes
    };

    const r = await run($('#it-ok', m.el), async () => {
      if (st.mode === 'edit') {
        return api.lotSave(Object.assign({ lotId: st.lotId }, lotPart));
      }
      if (st.mode === 'lot') {
        return api.lotSave(strip(Object.assign({ materialId: st.materialId, qty: Number(f.qty) }, lotPart)));
      }
      // ช่องที่ซ่อนไปตอนเปลี่ยนชนิดยังค้างค่าที่เคยกรอกไว้ใน st.v — ไม่ส่งของที่ผู้ใช้มองไม่เห็นแล้ว
      if (f.kind !== 'CHEMICAL') { f.cas = ''; f.func = ''; f.state = ''; }
      if (f.kind === 'EQUIPMENT') { f.hazard = ''; f.storageCondition = ''; f.sds = ''; f.unit = EQUIPMENT_UNIT; }
      return api.lotSave(strip(Object.assign({
        material: strip({
          kind: f.kind,
          inci: f.inci, trade: f.trade, cas: f.cas, func: f.func, state: f.state, unit: f.unit,
          hazard: f.hazard, storageCondition: f.storageCondition, sds: f.sds, defaultSupplier: f.supplier
        }),
        qty: Number(f.qty)
      }, lotPart)));
    }, st.mode === 'edit' ? 'บันทึกการแก้ไขแล้ว' : 'บันทึกแล้ว');

    if (!r.ok) {
      const e = r.error;
      if (e && e.code === 'DUPLICATE_MATERIAL' && e.data && e.data.materialId) {
        err.innerHTML = `${esc(e.message)} <button type="button" class="link-btn" id="it-dup">ใช้สารเดิม</button>`;
        $('#it-dup', m.el).addEventListener('click', () => switchToLot(e.data.materialId));
      } else {
        err.textContent = e ? e.message : 'บันทึกไม่สำเร็จ';
      }
      return;
    }

    const lotId = (r.value && r.value.lotId) || st.lotId;
    if (st.mode !== 'edit' && lotId) await uploadPics(lotId);

    m.close(r.value);
    if (o.onSaved) await o.onSaved(r.value);
  }

  $('#it-ok', m.el).addEventListener('click', save);
  $('#it-form', m.el).addEventListener('submit', e => { e.preventDefault(); save(); });
  return m;
}
