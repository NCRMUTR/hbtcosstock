/* ══════════════════════════════════════════════════════════════════════════
   detail.js — หน้าต่างรายละเอียดล็อต: ข้อมูล · คำสั่ง · ประวัติการเคลื่อนไหว
   ══════════════════════════════════════════════════════════════════════════ */
import { api, can } from './api.js';
import { placeOf, photosOf } from './search.js';
import { photoImg } from './photo.js';
import {
  $, $$, esc, toast, run, openModal, confirmBox, icon,
  fmtNum, fmtDate, fmtDateTime, fmtDays, TXN_TH
} from './ui.js';
import { txnDialog, reasonBox, lotOf, moveDialog, photosDialog, lightbox } from './dialogs.js';
import { openItemForm } from './form.js';
import { kindTag, kindLabel, isEquipment, canTxn, EQUIPMENT_NO_ISSUE } from './kinds.js';

function safeUrl(u) {
  const s = String(u || '').trim();
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : '';
}

function stockTag(it) {
  if (it.shelfState === 'Eliminate') return '<span class="tag tag-risk">รอทำลาย/นำออก</span>';
  if (it.balance <= 0) return '<span class="tag tag-risk">หมด</span>';
  if (it.stock === 'low') return '<span class="tag tag-warn">ใกล้หมด</span>';
  return '<span class="tag tag-ok">มีของ</span>';
}
function expiryTag(it) {
  if (!it.expireDate) return '';
  if (it.expiry === 'expired') return `<span class="tag tag-risk">หมดอายุแล้ว (${esc(fmtDays(it.daysLeft))})</span>`;
  if (it.expiry === 'soon') return `<span class="tag tag-warn">ใกล้หมดอายุ (${esc(fmtDays(it.daysLeft))})</span>`;
  return '';
}

/**
 * @param {string} lotId
 * @param {Function} onChanged เรียกเมื่อมีการบันทึก เพื่อให้หน้าหลักซิงก์ข้อมูลใหม่
 */
export function openLotDetail(lotId, onChanged) {
  let it = lotOf(lotId);
  if (!it) { toast('ไม่พบล็อตนี้', 'risk'); return null; }

  const m = openModal({ title: esc(it.name), wide: true, body: '<div id="dt"></div>' });
  let tab = 'info', hist = null, histErr = '';

  /** ดึงข้อมูลใหม่จาก snapshot ที่ซิงก์มาแล้ว แล้ววาดใหม่ */
  async function refresh() {
    if (onChanged) await onChanged();
    const fresh = lotOf(lotId);
    if (!fresh) { m.close(); return; }
    it = fresh;
    hist = null;
    render();
    loadHistory();
  }

  async function loadHistory() {
    try { hist = await api.history({ lotId, limit: 200 }); histErr = ''; }
    catch (e) { histErr = e.message; }
    if (tab === 'hist') render();
  }

  function render() {
    const staff = can('staff');
    const row = (k, v) => (v === '' || v === null || v === undefined)
      ? '' : `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
    const sds = safeUrl(it.sds);

    $('#dt', m.el).innerHTML = `
      <div class="detail-tags">${kindTag(it.kind)} ${stockTag(it)} ${expiryTag(it)}
        ${it.hazard ? `<span class="tag tag-warn">${esc(it.hazard)}</span>` : ''}</div>
      ${it.inci && it.trade ? `<div class="muted">${esc(it.trade)}</div>` : ''}
      ${photoStripHtml()}

      <dl class="kv">
        ${row('คงเหลือ', `<b class="qty big">${esc(fmtNum(it.balance))}</b> ${esc(it.unit)}
              <span class="muted">(รับเข้า ${esc(fmtNum(it.qtyReceived))})</span>`)}
        ${row('ที่เก็บ', it.placeId && placeOf(it.placeId)
            ? `${esc(placeOf(it.placeId).pathText)}
               <button class="link-btn" data-act="showmap">${icon.pin} ดูบนแผนผัง</button>`
            : (esc([it.room, it.shelf].filter(Boolean).join(' / ')) || '<span class="muted">ยังไม่ระบุ</span>'))}
        ${row('รหัสล็อต', `<span class="mono">${esc(it.lotId)}</span>`)}
        ${row('รหัสเดิมบนขวด', it.legacyCode ? `<span class="mono">${esc(it.legacyCode)}</span>` : '')}
        ${row('เลขล็อตผู้ขาย', esc(it.supplierLotNo))}
        ${row('เลข CAS', it.cas ? `<span class="mono">${esc(it.cas)}</span>` : '')}
        ${row('หน้าที่ของสาร', esc(it.func))}
        ${row('สถานะสาร', esc(it.state))}
        ${row('ผู้จำหน่าย', esc(it.supplier))}
        ${row('ปีงบประมาณ', esc(it.fiscalYear))}
        ${row('ราคาต่อหน่วย', it.unitPrice !== null ? esc(fmtNum(it.unitPrice)) + ' บาท' : '')}
        ${row('วันที่รับเข้า', it.receiveDate ? esc(fmtDate(it.receiveDate)) : '')}
        ${row('วันหมดอายุ', it.expireDate
            ? `${esc(fmtDate(it.expireDate))} <span class="muted">(${esc(fmtDays(it.daysLeft))})</span>` : '')}
        ${row('SDS', sds ? `<a href="${esc(sds)}" target="_blank" rel="noopener noreferrer">เปิดเอกสาร SDS ↗</a>` : '')}
      </dl>

      ${staff && isEquipment(it) ? `<div class="note note-info" id="equip-note">${esc(EQUIPMENT_NO_ISSUE)}</div>` : ''}
      ${staff ? `<div class="actions">
        ${canTxn(it, 'ISSUE')  ? '<button class="btn" data-act="ISSUE">เบิกใช้</button>' : ''}
        ${canTxn(it, 'RETURN') ? '<button class="btn btn-ghost" data-act="RETURN">คืน</button>' : ''}
        <button class="btn btn-ghost" data-act="ADJUST">ปรับยอด</button>
        <button class="btn btn-ghost" data-act="DISPOSE">จำหน่ายออก</button>
        <button class="btn btn-ghost" data-act="edit">แก้ไขข้อมูลล็อต</button>
        <button class="btn${isEquipment(it) ? '' : ' btn-ghost'}" data-act="move">${icon.pin} ย้ายที่เก็บ</button>
        <button class="btn btn-ghost" data-act="newlot">+ รับเข้าล็อตใหม่</button>
        <span class="spacer"></span>
        ${it.shelfState === 'Eliminate'
          ? '<button class="btn btn-ghost" data-act="keep">คงไว้บนชั้น</button>'
          : '<button class="btn btn-ghost btn-danger-text" data-act="elim">ทำเครื่องหมายรอทำลาย</button>'}
      </div>` : ''}

      <div class="tabs" role="tablist">
        <button role="tab" data-tab="info" aria-selected="${tab === 'info'}">ข้อมูลรายการ</button>
        <button role="tab" data-tab="hist" aria-selected="${tab === 'hist'}">${icon.clock} ประวัติการเคลื่อนไหว</button>
      </div>
      <div class="tabpane">${tab === 'info' ? infoHtml() : histHtml()}</div>`;
  }

  /**
   * แถบรูปใต้หัวเรื่อง — ถ้าล็อตนี้ยังไม่มีรูปของตัวเอง ให้ยืมรูปของสารมาแสดงก่อน
   * (สารเดียวกันหน้าตาขวดมักเหมือนกัน เห็นภาพรวมได้เร็วกว่าไม่เห็นอะไรเลย)
   */
  function photoStripHtml() {
    const lotPics = photosOf('LOT', it.lotId);
    const matPics = photosOf('MATERIAL', it.materialId);
    const borrowed = !lotPics.length && matPics.length > 0;
    const show = lotPics.length ? lotPics : matPics;
    const owner = lotPics.length ? 'LOT' : 'MATERIAL';

    return `<div class="ph-strip">
      ${show.slice(0, 4).map(p => `<button class="ph-thumb" data-pic="${esc(p.id)}"
          data-powner="${owner}" title="ดูรูปใหญ่">${photoImg(p, 200, { noRatio: true })}</button>`).join('')}
      ${show.length > 4 ? `<span class="ph-more">+${show.length - 4}</span>` : ''}
      <button class="btn btn-ghost btn-sm" data-act="photos">${icon.camera}
        ${lotPics.length ? `รูปของล็อตนี้ (${lotPics.length})` : (can('staff') ? 'เพิ่มรูปล็อตนี้' : 'รูปของล็อตนี้')}</button>
      ${borrowed ? '<span class="muted ph-hint">กำลังแสดงรูปของสาร — ล็อตนี้ยังไม่มีรูปของตัวเอง</span>' : ''}
    </div>`;
  }

  function infoHtml() {
    return `<p class="muted">ข้อมูลสารใช้ร่วมกันทุกล็อตของ
      <b>${esc(it.name)}</b> — แก้ที่นี่ยังไม่รองรับในรุ่นนี้ ให้แก้ผ่านการนำเข้า CSV</p>
      <dl class="kv">
        <div><dt>รหัสสาร</dt><dd><span class="mono">${esc(it.materialId)}</span></dd></div>
        <div><dt>ชนิด</dt><dd>${esc(kindLabel(it.kind))}</dd></div>
        <div><dt>ชื่อสาร / ชื่อรายการ</dt><dd>${esc(it.inci) || '—'}</dd></div>
        <div><dt>ชื่อการค้า</dt><dd>${esc(it.trade) || '—'}</dd></div>
        <div><dt>หน่วยนับ</dt><dd>${esc(it.unit)}</dd></div>
      </dl>
      <div class="ph-strip">
        ${photosOf('MATERIAL', it.materialId).slice(0, 4).map(p =>
          `<button class="ph-thumb" data-pic="${esc(p.id)}" data-powner="MATERIAL"
                   title="ดูรูปใหญ่">${photoImg(p, 200, { noRatio: true })}</button>`).join('')}
        <button class="btn btn-ghost btn-sm" data-act="matphotos">${icon.camera}
          รูปของสารนี้ (${photosOf('MATERIAL', it.materialId).length})</button>
        <span class="muted ph-hint">รูปของสารใช้ร่วมกันทุกล็อต เช่น ฉลากข้างขวด หรือหน้า SDS</span>
      </div>`;
  }

  function histHtml() {
    if (histErr) return `<div class="note note-risk">${esc(histErr)}</div>`;
    if (!hist) return '<div class="empty small">กำลังโหลดประวัติ …</div>';
    if (!hist.txns.length) return '<div class="empty small">ยังไม่มีประวัติ</div>';
    const staff = can('staff');

    return `<ul class="hist">${hist.txns.map(h => {
      const cancelled = h.status === 'CANCELLED';
      const sign = h.qty > 0 ? '+' : '';
      const detail = [h.purpose, h.refDoc ? 'เอกสาร ' + h.refDoc : '', h.notes]
        .filter(Boolean).map(esc).join(' · ');
      return `<li class="h-${esc(h.type)}${cancelled ? ' cancelled' : ''}">
        <div class="h-top">
          <b>${esc(TXN_TH[h.type] || h.type)}</b>
          <span class="qty ${h.qty > 0 ? 'pos' : 'neg'}">${sign}${esc(fmtNum(h.qty))}</span>
          <span class="muted">→ คงเหลือ ${esc(fmtNum(h.balanceAfter))}</span>
          ${cancelled ? '<span class="tag tag-mute">ยกเลิกแล้ว</span>' : ''}
          <span class="h-when">${esc(fmtDateTime(h.recordedAt || h.txnAt))}</span>
        </div>
        <div class="h-sub">${esc(h.person || h.recordedBy)}${detail ? ' · ' + detail : ''}</div>
        ${staff && !cancelled && h.type !== 'RECEIVE' && h.type !== 'MOVE'
          ? `<button class="link-btn h-cancel" data-cancel="${esc(h.txnId)}">ยกเลิกรายการนี้</button>` : ''}
      </li>`;
    }).join('')}</ul>
    ${hist.total > hist.txns.length
      ? `<div class="muted">แสดง ${hist.txns.length} จาก ${hist.total} รายการล่าสุด</div>` : ''}`;
  }

  m.el.addEventListener('click', async e => {
    const t = e.target.closest('button');
    if (!t) return;

    if (t.dataset.tab) {
      tab = t.dataset.tab; render();
      if (tab === 'hist' && !hist) loadHistory();
      return;
    }

    if (t.dataset.pic) {
      const p = photosOf(t.dataset.powner, t.dataset.powner === 'LOT' ? it.lotId : it.materialId)
                .find(x => x.id === t.dataset.pic);
      return lightbox(p);
    }

    if (t.dataset.cancel) {
      const reason = await reasonBox('ยกเลิกรายการนี้?', 'เหตุผลที่ยกเลิก');
      if (!reason) return;
      const r = await run(t, () => api.txnCancel(t.dataset.cancel, reason), 'ยกเลิกรายการแล้ว');
      if (r.ok) await refresh();
      return;
    }

    const act = t.dataset.act;
    if (!act) return;

    if (act === 'elim' || act === 'keep') {
      const to = act === 'elim' ? 'Eliminate' : 'On Shelf';
      if (to === 'Eliminate' && !(await confirmBox({
        title: 'ทำเครื่องหมายรอทำลาย?', okText: 'ทำเครื่องหมาย', danger: true,
        message: 'ล็อตนี้จะถูกจัดอยู่ในกลุ่มรอทำลาย/นำออก ยอดคงเหลือยังไม่ถูกตัด\nถ้าต้องการตัดยอดด้วยให้ใช้ "จำหน่ายออก" แทน'
      }))) return;
      const r = await run(t, () => api.setShelfState([lotId], to),
                          to === 'Eliminate' ? 'ทำเครื่องหมายแล้ว' : 'คงไว้บนชั้นแล้ว');
      if (r.ok) await refresh();
      return;
    }

    if (act === 'photos') {
      return photosDialog({
        ownerType: 'LOT', ownerId: lotId,
        title: 'รูปของล็อต ' + it.name,
        hint: 'ถ่ายขวดจริง ฉลาก หรือจุดที่วางไว้ เพื่อให้คนอื่นหยิบถูกใบ',
        onDone: refresh
      });
    }
    if (act === 'matphotos') {
      return photosDialog({
        ownerType: 'MATERIAL', ownerId: it.materialId,
        title: 'รูปของสาร ' + it.name,
        hint: 'รูปชุดนี้ใช้ร่วมกันทุกล็อตของสารนี้',
        onDone: refresh
      });
    }
    if (act === 'move') {
      return moveDialog(lotId, refresh);
    }
    if (act === 'showmap') {
      m.close();
      window.dispatchEvent(new CustomEvent('hbt:showOnMap', { detail: { placeId: it.placeId } }));
      return;
    }
    if (act === 'edit') {
      return openItemForm({ mode: 'edit', lotId, onSaved: refresh });
    }
    if (act === 'newlot') {
      return openItemForm({ mode: 'lot', materialId: it.materialId, onSaved: onChanged });
    }

    if (['ISSUE', 'RETURN', 'ADJUST', 'DISPOSE'].indexOf(act) !== -1) {
      if (!canTxn(it, act)) { toast(EQUIPMENT_NO_ISSUE, 'risk'); return; }
      txnDialog(lotId, act, refresh);
    }
  });

  render();
  loadHistory();
  return m;
}
