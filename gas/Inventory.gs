/**
 * ============================================================================
 *  Inventory.gs  —  Category และการเคลื่อนไหวของคลัง
 * ============================================================================
 *  หน้าจอสำหรับส่วนเบิก/รับเข้าจะทำใน Phase 2
 *  แต่ฝั่งหลังบ้านพร้อมแล้ว และระบบนำเข้า CSV ใช้ฟังก์ชันในไฟล์นี้
 */


// ─────────────────────────────────────────────────────────────────────────────
//  Category
// ─────────────────────────────────────────────────────────────────────────────

function settingsAdd_(p, ctx) {
  var type  = String(p.type  || '').trim();
  var value = String(p.value || '').trim();

  if (SETTING_TYPES.indexOf(type) === -1) {
    throw new AppError('ชนิด Category ไม่ถูกต้อง: ' + type +
                       ' (ที่รองรับ: ' + SETTING_TYPES.join(', ') + ')', 'BAD_TYPE');
  }
  if (!value) throw new AppError('กรุณากรอกค่าที่ต้องการเพิ่ม', 'NO_VALUE');

  return withLock_(function () {
    var added = addSettingsIfMissing_(type, [value], ctx.email);
    if (!added.length) throw new AppError('"' + value + '" มีอยู่ในรายการแล้ว', 'DUPLICATE');
    audit_(ctx.email, 'SETTING_ADD', 'Settings', type, { value: value });
    return { type: type, value: value };
  });
}


/**
 * เพิ่มค่า Category ที่ยังไม่มี (เทียบแบบไม่สนตัวพิมพ์ใหญ่เล็ก)
 * ใช้ร่วมกับระบบนำเข้า CSV ที่ต้องสร้าง Category ใหม่หลายค่าพร้อมกัน
 * ⚠️ ต้องเรียกอยู่ภายใน withLock_
 * @return {string[]} ค่าที่ถูกเพิ่มจริง
 */
function addSettingsIfMissing_(type, values, actor) {
  var rows     = readTable_('SETTINGS');
  var existing = {};
  var maxSort  = 0;

  rows.forEach(function (r) {
    if (String(r.Type).trim() === type) {
      existing[String(r.Value).trim().toLowerCase()] = true;
      var s = parseInt(r.Sort, 10) || 0;
      if (s > maxSort) maxSort = s;
    }
  });

  var toAdd = [];
  var seen  = {};
  values.forEach(function (v) {
    var value = String(v || '').trim();
    if (!value) return;
    var key = value.toLowerCase();
    if (existing[key] || seen[key]) return;
    seen[key] = true;
    toAdd.push(value);
  });

  if (toAdd.length) {
    appendRows_('SETTINGS', toAdd.map(function (v, i) {
      return {
        Type: type, Value: v, Sort: maxSort + i + 1, Active: true,
        CreatedBy: actor || 'SYSTEM', CreatedAt: new Date()
      };
    }));
  }
  return toAdd;
}


/** ลบแบบ soft delete — ตั้ง Active = FALSE เพื่อไม่ให้ข้อมูลเก่าที่อ้างอิงอยู่เสียหาย */
function settingsRemove_(p, ctx) {
  var type  = String(p.type  || '').trim();
  var value = String(p.value || '').trim();

  return withLock_(function () {
    var sheet   = sheetOf_('SETTINGS');
    var last    = sheet.getLastRow();
    if (last < 2) throw new AppError('ไม่พบรายการ', 'NOT_FOUND');

    var headers = SCHEMA.SETTINGS;
    var cType   = headers.indexOf('Type');
    var cValue  = headers.indexOf('Value');
    var cActive = headers.indexOf('Active') + 1;

    var data  = sheet.getRange(2, 1, last - 1, headers.length).getValues();
    var hits  = 0;

    for (var i = 0; i < data.length; i++) {
      if (String(data[i][cType]).trim() === type &&
          String(data[i][cValue]).trim().toLowerCase() === value.toLowerCase()) {
        sheet.getRange(i + 2, cActive).setValue(false);
        hits++;
      }
    }

    if (!hits) throw new AppError('ไม่พบ "' + value + '" ในรายการ ' + type, 'NOT_FOUND');
    audit_(ctx.email, 'SETTING_REMOVE', 'Settings', type, { value: value });
    return { type: type, value: value, removed: hits };
  });
}


// ─────────────────────────────────────────────────────────────────────────────
//  Shelf State  (On Shelf / Eliminate)
// ─────────────────────────────────────────────────────────────────────────────

function lotSetShelfState_(p, ctx) {
  var ids   = Array.isArray(p.lotIds) ? p.lotIds : [p.lotId];
  var state = String(p.state || '').trim();

  if (['On Shelf', 'Eliminate'].indexOf(state) === -1) {
    throw new AppError('สถานะต้องเป็น "On Shelf" หรือ "Eliminate"', 'BAD_STATE');
  }
  ids = ids.map(function (s) { return String(s || '').trim(); }).filter(Boolean);
  if (!ids.length) throw new AppError('กรุณาเลือกรายการอย่างน้อย 1 รายการ', 'NO_SELECTION');

  return withLock_(function () {
    var sheet   = sheetOf_('LOTS');
    var headers = SCHEMA.LOTS;
    var last    = sheet.getLastRow();
    if (last < 2) throw new AppError('ยังไม่มีข้อมูลล็อตในระบบ', 'EMPTY');

    var cId    = headers.indexOf('LotID');
    var cState = headers.indexOf('ShelfState') + 1;
    var cBy    = headers.indexOf('ShelfStateBy') + 1;
    var cAt    = headers.indexOf('ShelfStateAt') + 1;

    var allIds = sheet.getRange(2, cId + 1, last - 1, 1).getValues();
    var wanted = {};
    ids.forEach(function (id) { wanted[id.toLowerCase()] = true; });

    var now = new Date();
    var n   = 0;

    for (var i = 0; i < allIds.length; i++) {
      if (wanted[String(allIds[i][0]).trim().toLowerCase()]) {
        var row = i + 2;
        sheet.getRange(row, cState).setValue(state);
        sheet.getRange(row, cBy).setValue(ctx.email);
        sheet.getRange(row, cAt).setValue(now);
        n++;
      }
    }

    if (!n) throw new AppError('ไม่พบล็อตที่เลือกในระบบ', 'NOT_FOUND');
    audit_(ctx.email, 'SHELF_STATE', 'Lots', ids.join(','), { state: state, count: n });
    return { updated: n, state: state };
  });
}


// ─────────────────────────────────────────────────────────────────────────────
//  บันทึกรายการเคลื่อนไหว (รับเข้า / เบิก / คืน / ปรับยอด / ทำลาย)
// ─────────────────────────────────────────────────────────────────────────────

function txnPost_(p, ctx) {
  var lotId = String(p.lotId || '').trim();
  if (!lotId) throw new AppError('กรุณาระบุรหัสล็อต', 'NO_LOT');

  return withLock_(function () {
    var lot = findLot_(lotId);
    if (!lot) throw new AppError('ไม่พบล็อต ' + lotId, 'NOT_FOUND');

    var row = postTxn_({
      lotId:      lot.LotID,
      materialId: lot.MaterialID,
      type:       p.type,
      qty:        p.qty,
      person:     p.person,
      purpose:    p.purpose,
      refDoc:     p.refDoc,
      txnAt:      p.txnAt,
      notes:      p.notes
    }, ctx.email);

    appendRows_('TRANSACTIONS', [row]);
    audit_(ctx.email, 'TXN_POST', 'Transactions', row.TxnID,
           { lot: lot.LotID, type: row.Type, qty: row.Qty });

    return { txnId: row.TxnID, balanceAfter: row.BalanceAfter };
  });
}


function txnCancel_(p, ctx) {
  var txnId = String(p.txnId || '').trim();
  if (!txnId) throw new AppError('กรุณาระบุรหัสรายการ', 'NO_TXN');

  return withLock_(function () {
    var all    = readTable_('TRANSACTIONS');
    var target = null;
    for (var i = 0; i < all.length; i++) {
      if (String(all[i].TxnID).trim().toLowerCase() === txnId.toLowerCase()) {
        target = all[i]; break;
      }
    }
    if (!target) throw new AppError('ไม่พบรายการ ' + txnId, 'NOT_FOUND');
    if (String(target.Status).toUpperCase() === 'CANCELLED') {
      throw new AppError('รายการนี้ถูกยกเลิกไปแล้ว', 'ALREADY_CANCELLED');
    }
    // ยกเลิกรายการย้ายที่ไม่ได้ เพราะการทำเครื่องหมายยกเลิกไม่ได้ย้ายของกลับจริง
    // ถ้าย้ายผิดที่ ให้ย้ายกลับ — ประวัติจะเห็นทั้งขาไปและขากลับ ตรวจสอบง่ายกว่า
    if (String(target.Type).toUpperCase() === 'MOVE') {
      throw new AppError('ยกเลิกรายการย้ายที่เก็บไม่ได้ — ถ้าย้ายผิดที่ ให้ย้ายกลับไปที่เดิมแทน', 'CANNOT_CANCEL_MOVE');
    }

    // ทำเครื่องหมายยกเลิกที่รายการเดิม — ไม่ลบแถว เพื่อรักษาประวัติไว้ครบ
    updateRowById_('TRANSACTIONS', 'TxnID', target.TxnID, {
      Status: 'CANCELLED',
      Notes:  String(target.Notes || '') +
              ' | ยกเลิกโดย ' + ctx.email + ' ' + new Date().toISOString() +
              (p.reason ? ' เหตุผล: ' + p.reason : '')
    });

    audit_(ctx.email, 'TXN_CANCEL', 'Transactions', target.TxnID, { reason: p.reason || '' });

    var balances = computeBalances_();
    return {
      txnId:   target.TxnID,
      lotId:   target.LotID,
      balance: balances[String(target.LotID).trim()] || 0
    };
  });
}


function findLot_(lotIdOrLegacyCode) {
  var key  = String(lotIdOrLegacyCode).trim().toLowerCase();
  var rows = readTable_('LOTS');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].LotID).trim().toLowerCase() === key) return rows[i];
  }
  // เผื่อผู้ใช้กรอก Code เดิมจากระบบเก่าที่ติดอยู่บนขวดสาร
  for (var j = 0; j < rows.length; j++) {
    if (String(rows[j].LegacyCode).trim().toLowerCase() === key) return rows[j];
  }
  return null;
}


/**
 * ประวัติการเคลื่อนไหว — ของล็อตเดียว หรือของสารทุกล็อต
 * @param {Object} p { lotId? , materialId? , limit? }  ส่งอย่างใดอย่างหนึ่ง
 * @return {Object} { txns:[...], total:Number }  เรียงใหม่สุดขึ้นก่อน
 */
function historyList_(p) {
  var lotId      = String(p.lotId || '').trim();
  var materialId = String(p.materialId || '').trim();
  var limit      = Math.min(Math.max(parseInt(p.limit, 10) || 200, 1), 500);

  if (!lotId && !materialId) throw new AppError('กรุณาระบุล็อตหรือสารที่ต้องการดูประวัติ', 'NO_TARGET');

  // อ้างด้วย Code เดิมของระบบเก่าก็ได้ (ผู้ใช้อ่านจากขวด)
  if (lotId) {
    var lot = findLot_(lotId);
    if (!lot) throw new AppError('ไม่พบล็อต ' + lotId, 'NOT_FOUND');
    lotId = lot.LotID;
  }

  var rows = readTable_('TRANSACTIONS').filter(function (t) {
    return lotId ? String(t.LotID) === lotId : String(t.MaterialID) === materialId;
  });

  rows.sort(function (a, b) {
    return new Date(b.RecordedAt || b.TxnAt).getTime() - new Date(a.RecordedAt || a.TxnAt).getTime();
  });

  var total = rows.length;
  return {
    total: total,
    txns: rows.slice(0, limit).map(function (t) {
      return {
        txnId:        t.TxnID,
        lotId:        t.LotID,
        type:         String(t.Type || '').toUpperCase(),
        qty:          parseFloat(t.Qty) || 0,
        balanceAfter: parseFloat(t.BalanceAfter) || 0,
        person:       t.Person  || '',
        purpose:      t.Purpose || '',
        refDoc:       t.RefDoc  || '',
        notes:        t.Notes   || '',
        status:       String(t.Status || 'ACTIVE').toUpperCase(),
        cancelOf:     t.CancelOf || '',
        txnAt:        isoSafe_(t.TxnAt) || '',
        recordedBy:   t.RecordedBy || '',
        recordedAt:   isoSafe_(t.RecordedAt) || ''
      };
    })
  };
}
