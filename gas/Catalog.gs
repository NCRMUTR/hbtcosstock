/**
 * ============================================================================
 *  Catalog.gs  —  เพิ่ม/แก้ไข "สาร" และ "ล็อต" ผ่านหน้าเว็บ
 * ============================================================================
 *  เดิมข้อมูลเข้าได้ทางเดียวคือนำเข้า CSV — ไฟล์นี้เปิดให้เพิ่มทีละรายการได้
 *
 *  หลักการที่ยึดไว้:
 *    · ยอดคงเหลือมาจาก ledger (Transactions) เสมอ — ไม่มีการเขียนทับตัวเลขยอด
 *      ดังนั้น "จำนวนที่รับเข้า" ของล็อตที่สร้างแล้ว แก้ไม่ได้ ให้ใช้ปรับยอดแทน
 *    · ชื่อสารซ้ำกัน = ไม่สร้างใหม่ แต่บอกรหัสสารเดิมกลับไปให้หน้าเว็บเสนอ
 *      "รับเข้าเป็นล็อตใหม่ของสารเดิม" แทน
 */

// ─────────────────────────────────────────────────────────────────────────────
//  ตัวช่วยกรองค่าที่รับจากหน้าเว็บ
// ─────────────────────────────────────────────────────────────────────────────

/** ข้อความบรรทัดเดียว ตัดช่องว่างซ้ำ จำกัดความยาว */
function s_(v, max) {
  var t = String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
  return max ? t.slice(0, max) : t;
}

/** ข้อความหลายบรรทัด (คงการขึ้นบรรทัดใหม่ไว้) */
function t_(v, max) {
  var t = String(v === undefined || v === null ? '' : v).replace(/[ \t]+/g, ' ').trim();
  return max ? t.slice(0, max) : t;
}

/** ลิงก์ที่ยอมรับได้ต้องเป็น http(s) เท่านั้น (กัน javascript: หลุดไปอยู่ในหน้าเว็บ) */
function link_(v) {
  var t = s_(v, 500);
  if (!t) return '';
  if (!/^https?:\/\/[^\s]+$/i.test(t)) throw new AppError('ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://', 'BAD_URL');
  return t;
}

/** ตัวเลขที่ต้องไม่ติดลบ — ค่าว่างคืน null */
function numOrNull_(v, label) {
  if (v === '' || v === null || v === undefined) return null;
  var n = parseNumberFlexible_(v);
  if (n === null || isNaN(n)) throw new AppError((label || 'ตัวเลข') + 'ไม่ถูกต้อง', 'BAD_NUMBER');
  if (n < 0) throw new AppError((label || 'ตัวเลข') + 'ต้องไม่ติดลบ', 'BAD_NUMBER');
  return n;
}

/** วันที่แบบยืดหยุ่น — ค่าว่างคืน '' */
function dateOrBlank_(v, label) {
  if (!v) return '';
  var d = parseDateFlexible_(v);
  if (!d) throw new AppError((label || 'วันที่') + 'ไม่ถูกต้อง', 'BAD_DATE');
  return d;
}


// ─────────────────────────────────────────────────────────────────────────────
//  สาร (Materials)
// ─────────────────────────────────────────────────────────────────────────────

/** หาสารที่ชื่อซ้ำกับที่กรอกมา (ยกเว้นตัวเอง) */
function findMaterialByName_(materials, inci, trade, exceptId) {
  var key = materialKey_(inci, trade);
  for (var i = 0; i < materials.length; i++) {
    var m = materials[i];
    if (exceptId && String(m.MaterialID) === exceptId) continue;
    if (materialKey_(m.INCIName, m.TradeName) === key) return m;
  }
  return null;
}

/** คอลัมน์ของสารที่รับมาจากฟอร์ม (เฉพาะช่องที่ส่งมาเท่านั้นที่ถูกแก้) */
function materialFields_(p, cur) {
  var f = {};
  if (p.inci  !== undefined) f.INCIName  = s_(p.inci, 150);
  if (p.trade !== undefined) f.TradeName = s_(p.trade, 150);
  if (p.cas   !== undefined) f.CASNo     = s_(p.cas, 40);
  if (p.func  !== undefined) f.Function   = s_(p.func, 80);
  if (p.state !== undefined) f.State      = s_(p.state, 40);
  if (p.unit  !== undefined) f.Unit       = s_(p.unit, 20);
  if (p.defaultSupplier  !== undefined) f.DefaultSupplier  = s_(p.defaultSupplier, 100);
  if (p.sds              !== undefined) f.SDSLink          = link_(p.sds);
  if (p.hazard           !== undefined) f.Hazard           = s_(p.hazard, 150);
  if (p.storageCondition !== undefined) f.StorageCondition = s_(p.storageCondition, 60);
  if (p.notes            !== undefined) f.Notes            = t_(p.notes, 1000);

  var asked = parseItemKind_(p.kind);
  if (asked) f.ItemKind = asked;
  else if (!cur) f.ItemKind = DEFAULT_ITEM_KIND;   // เขียนลงชีตชัด ๆ ไม่ปล่อยว่างให้ต้องเดา
  var kind = f.ItemKind || itemKindOf_(cur ? cur.ItemKind : '');

  var inci  = f.INCIName  !== undefined ? f.INCIName  : (cur ? s_(cur.INCIName)  : '');
  var trade = f.TradeName !== undefined ? f.TradeName : (cur ? s_(cur.TradeName) : '');
  if (kind === 'CHEMICAL') {
    if (!inci) throw new AppError('กรุณากรอกชื่อสาร — ถ้าเป็นเครื่องแก้วหรือวัสดุ ให้เปลี่ยนชนิดของก่อน', 'NO_NAME');
  } else if (!inci && !trade) {
    // บีกเกอร์/กระดาษกรองไม่มีชื่อ INCI หรือ CAS แต่ต้องมีชื่ออะไรสักอย่างให้ค้นเจอ
    throw new AppError('กรุณากรอกชื่อรายการ หรือ ชื่อการค้า/รุ่น อย่างน้อย 1 ช่อง', 'NO_NAME');
  }

  if (kind === 'EQUIPMENT') {
    var unit = f.Unit !== undefined ? f.Unit : '';
    if (unit && unit.toLowerCase() !== EQUIPMENT_UNIT) {
      throw new AppError('ครุภัณฑ์นับเป็นชิ้นเท่านั้น (หน่วย ' + EQUIPMENT_UNIT + ') — ' +
                         'ถ้าเป็นของที่ตวงวัดได้ ให้เลือกชนิด "วัสดุสิ้นเปลือง" แทน', 'BAD_UNIT');
    }
    // เขียนทับเสมอ รวมถึงตอนเปลี่ยนสารเดิมที่เคยเป็น g มาเป็นครุภัณฑ์โดยไม่ได้ส่งหน่วยมา
    f.Unit = EQUIPMENT_UNIT;
  } else if (!cur && !f.Unit) {
    f.Unit = 'g';
  }
  return f;
}

/**
 * ก่อนเปลี่ยนสารเดิมให้เป็นครุภัณฑ์ ทุกล็อตต้องเป็นจำนวนเต็มอยู่แล้ว
 * มิฉะนั้นจะมียอด 2.5 ชิ้นค้างอยู่ที่ปรับให้ลงตัวไม่ได้ เพราะห้ามกรอกทศนิยมอีกต่อไป
 * ⚠️ ต้องเรียกอยู่ภายใน withLock_
 */
function assertWholeLotsFor_(materialId) {
  var balances = computeBalances_();
  var lots = readTable_('LOTS').filter(function (l) { return String(l.MaterialID) === materialId; });
  for (var i = 0; i < lots.length; i++) {
    var id  = String(lots[i].LotID);
    var bal = balances[id] || 0;
    var rec = parseFloat(lots[i].QtyReceived) || 0;
    if (!isWholeNumber_(bal) || !isWholeNumber_(rec)) {
      throw new AppError('เปลี่ยนเป็นครุภัณฑ์ไม่ได้ — ล็อต ' + id + ' มียอดเป็นทศนิยม (' + bal + ')\n' +
                         'ให้ "ปรับยอด" ล็อตนั้นให้เป็นจำนวนเต็มก่อน แล้วค่อยเปลี่ยนชนิด', 'HAS_FRACTION');
    }
  }
}

/**
 * สร้างหรือแก้ไขสาร
 * @param {Object} p { materialId? , inci, trade?, cas?, func?, state?, unit?, ... }
 */
function materialSave_(p, ctx) {
  var id = s_(p.materialId, 20);

  return withLock_(function () {
    var materials = readTable_('MATERIALS');
    var cur = id ? materials.filter(function (m) { return String(m.MaterialID) === id; })[0] : null;
    if (id && !cur) throw new AppError('ไม่พบสาร ' + id, 'NOT_FOUND');

    var f = materialFields_(p, cur);
    var inci  = f.INCIName  !== undefined ? f.INCIName  : s_(cur ? cur.INCIName : '');
    var trade = f.TradeName !== undefined ? f.TradeName : s_(cur ? cur.TradeName : '');

    if (cur && f.ItemKind === 'EQUIPMENT' && itemKindOf_(cur.ItemKind) !== 'EQUIPMENT') {
      assertWholeLotsFor_(String(cur.MaterialID));
    }

    var dup = findMaterialByName_(materials, inci, trade, cur ? String(cur.MaterialID) : null);
    if (dup) {
      var dupName = s_(dup.INCIName) || s_(dup.TradeName);
      var e = new AppError(
        (itemKindOf_(dup.ItemKind) === 'CHEMICAL' ? 'มีสารชื่อนี้อยู่แล้ว: ' : 'มีรายการชื่อนี้อยู่แล้ว: ') + dupName +
        (dup.INCIName && dup.TradeName ? ' (' + s_(dup.TradeName) + ')' : '') +
        ' — ถ้าเป็นของเดิม ให้รับเข้าเป็นล็อตใหม่ของรายการนั้นแทน',
        'DUPLICATE_MATERIAL');
      e.data = { materialId: String(dup.MaterialID) };
      throw e;
    }

    var now = new Date();
    if (!cur) {
      f.MaterialID = newMaterialId_();
      f.Status     = 'ACTIVE';
      f.CreatedBy  = ctx.email; f.CreatedAt = now;
      f.UpdatedBy  = ctx.email; f.UpdatedAt = now;
      appendRows_('MATERIALS', [f]);
      feedSettingsFromMaterial_(f, ctx.email);
      audit_(ctx.email, 'MATERIAL_ADD', 'Materials', f.MaterialID, { inci: inci || trade, kind: f.ItemKind });
      return { materialId: f.MaterialID, created: true };
    }

    f.UpdatedBy = ctx.email; f.UpdatedAt = now;
    updateRowById_('MATERIALS', 'MaterialID', cur.MaterialID, f);
    feedSettingsFromMaterial_(f, ctx.email);
    audit_(ctx.email, 'MATERIAL_UPDATE', 'Materials', cur.MaterialID,
           f.ItemKind ? { inci: inci || trade, kind: f.ItemKind } : { inci: inci || trade });
    return { materialId: String(cur.MaterialID), created: false };
  });
}

/** ค่าที่กรอกใหม่ให้โผล่ในรายการตัวเลือกครั้งหน้าด้วย */
function feedSettingsFromMaterial_(f, actor) {
  if (f.Function)        addSettingsIfMissing_('Function', [f.Function], actor);
  if (f.State)           addSettingsIfMissing_('State',    [f.State],    actor);
  if (f.Unit)            addSettingsIfMissing_('Unit',     [f.Unit],     actor);
  if (f.DefaultSupplier) addSettingsIfMissing_('Supplier', [f.DefaultSupplier], actor);
}


// ─────────────────────────────────────────────────────────────────────────────
//  ล็อต (Lots)
// ─────────────────────────────────────────────────────────────────────────────

/** คอลัมน์ของล็อตที่รับมาจากฟอร์ม (ไม่รวม QtyReceived ซึ่งแก้ไม่ได้หลังสร้าง) */
function lotFields_(p) {
  var f = {};
  if (p.supplierLotNo !== undefined) f.SupplierLotNo = s_(p.supplierLotNo, 80);
  if (p.supplier      !== undefined) f.Supplier      = s_(p.supplier, 100);
  if (p.fiscalYear    !== undefined) f.FiscalYear    = s_(p.fiscalYear, 10);
  if (p.room          !== undefined) f.Room          = s_(p.room, 80);
  if (p.shelf         !== undefined) f.Shelf         = s_(p.shelf, 80);
  if (p.notes         !== undefined) f.Notes         = t_(p.notes, 1000);
  if (p.legacyCode    !== undefined) f.LegacyCode    = s_(p.legacyCode, 60);
  if (p.unitPrice     !== undefined) {
    var up = numOrNull_(p.unitPrice, 'ราคาต่อหน่วย');
    f.UnitPrice = up === null ? '' : up;
  }
  if (p.receiveDate !== undefined) f.ReceiveDate = dateOrBlank_(p.receiveDate, 'วันที่รับเข้า');
  if (p.expireDate  !== undefined) f.ExpireDate  = dateOrBlank_(p.expireDate, 'วันหมดอายุ');
  return f;
}

/** รหัสเดิมบนขวดต้องไม่ซ้ำ เพราะใช้เป็นกุญแจตอนนำเข้า CSV และตอนค้นหา */
function assertLegacyCodeFree_(lots, code, exceptId) {
  if (!code) return;
  var key = String(code).trim().toLowerCase();
  for (var i = 0; i < lots.length; i++) {
    if (exceptId && String(lots[i].LotID) === exceptId) continue;
    if (String(lots[i].LegacyCode || '').trim().toLowerCase() === key) {
      throw new AppError('รหัสเดิมบนขวด "' + code + '" ถูกใช้กับล็อต ' + lots[i].LotID + ' แล้ว', 'DUPLICATE_CODE');
    }
  }
}

/**
 * รับเข้าล็อตใหม่ หรือแก้ไขข้อมูลล็อตเดิม
 *
 * สร้างใหม่:  { materialId หรือ material:{...}, qty, room?, shelf?, supplier?, ... }
 *             → สร้างแถวใน Lots + ลงบัญชี RECEIVE ให้อัตโนมัติ
 * แก้ไข:      { lotId, room?, shelf?, ... }  — แก้ QtyReceived ไม่ได้ (ใช้ปรับยอดแทน)
 */
function lotSave_(p, ctx) {
  var lotId = s_(p.lotId, 30);

  // สร้างสารใหม่พร้อมกันในคำสั่งเดียว (ทำนอก lock ของล็อต เพราะ materialSave_ ถือ lock เอง)
  var materialId = s_(p.materialId, 20);
  // ตรวจที่เก็บก่อนสร้างสาร — ถ้าไปเจอทีหลังใน lock สารใหม่จะถูกสร้างค้างไว้โดยไม่มีล็อต
  if (!lotId && p.placeId && !activePlaces_().some(function (x) { return String(x.PlaceID) === s_(p.placeId, 20); })) {
    throw new AppError('ไม่พบที่เก็บที่เลือก (อาจถูกลบไปแล้ว) — กดซิงก์ข้อมูลแล้วเลือกใหม่ ' +
                       'หรือเพิ่มที่เก็บที่หน้าแผนผังก่อน', 'NO_PLACE');
  }
  if (!lotId && !materialId && p.material) {
    materialId = materialSave_(p.material, ctx).materialId;
  }

  return withLock_(function () {
    var lots = readTable_('LOTS');

    // ── แก้ไขล็อตเดิม ─────────────────────────────────────────────────────
    if (lotId) {
      var cur = lots.filter(function (l) { return String(l.LotID) === lotId; })[0];
      if (!cur) throw new AppError('ไม่พบล็อต ' + lotId, 'NOT_FOUND');

      if (p.qty !== undefined) {
        throw new AppError(
          'แก้จำนวนที่รับเข้าของล็อตที่บันทึกแล้วไม่ได้ — ยอดคงเหลือมาจากบัญชีเดินสะพัด\n' +
          'ถ้ายอดจริงไม่ตรง ให้ใช้ "ปรับยอด" แทน', 'QTY_LOCKED');
      }

      // ย้ายที่ผ่านการแก้ไขจะไม่มีรายการ MOVE ในประวัติ — บังคับให้ไปทางย้ายที่เก็บแทน
      if (p.placeId !== undefined) {
        throw new AppError(
          'เปลี่ยนที่เก็บของล็อตเดิมผ่านการแก้ไขข้อมูลไม่ได้ — ให้ใช้ปุ่ม "ย้ายที่เก็บ" ' +
          'เพื่อให้การย้ายถูกบันทึกในประวัติ', 'USE_MOVE');
      }

      var patch = lotFields_(p);
      if (patch.LegacyCode !== undefined) assertLegacyCodeFree_(lots, patch.LegacyCode, lotId);
      patch.UpdatedBy = ctx.email;
      patch.UpdatedAt = new Date();
      updateRowById_('LOTS', 'LotID', lotId, patch);
      feedSettingsFromLot_(patch, ctx.email);
      audit_(ctx.email, 'LOT_UPDATE', 'Lots', lotId, { fields: Object.keys(patch).join(',') });
      return { lotId: lotId, created: false };
    }

    // ── รับเข้าล็อตใหม่ ───────────────────────────────────────────────────
    if (!materialId) throw new AppError('กรุณาเลือกสารที่จะรับเข้า', 'NO_MATERIAL');
    var mat = readTable_('MATERIALS').filter(function (m) { return String(m.MaterialID) === materialId; })[0];
    if (!mat) throw new AppError('ไม่พบสาร ' + materialId, 'NOT_FOUND');

    var qty = numOrNull_(p.qty, 'จำนวนที่รับเข้า');
    if (qty === null || qty <= 0) throw new AppError('จำนวนที่รับเข้าต้องมากกว่า 0', 'BAD_QTY');
    // ตรวจก่อนเขียนแถว Lots — ถ้าปล่อยให้ postTxn_ ปฏิเสธทีหลัง จะเหลือล็อตกำพร้าที่ไม่มีรายการรับเข้า
    var kind = itemKindOf_(mat.ItemKind);
    assertQtyForKind_(kind, qty);

    var f = lotFields_(p);
    assertLegacyCodeFree_(lots, f.LegacyCode, null);

    // เลือกที่เก็บจากแผนผัง → ข้อความห้อง/ชั้นมาจากที่เก็บนั้นเสมอ ไม่ใช่ที่พิมพ์มา
    // ของที่รับเข้าจึงขึ้นบนแผนผังทันที และชื่อห้อง/ชั้นตรงกับแผนผังทุกตัวอักษร
    var placeId = s_(p.placeId, 20);
    var fromPlace = false;
    if (placeId) {
      var places = activePlaces_();
      var dest = places.filter(function (x) { return String(x.PlaceID) === placeId; })[0];
      if (!dest) {
        throw new AppError('ไม่พบที่เก็บที่เลือก (อาจถูกลบไปแล้ว) — กดซิงก์ข้อมูลแล้วเลือกใหม่ ' +
                           'หรือเพิ่มที่เก็บที่หน้าแผนผังก่อน', 'NO_PLACE');
      }
      var text = placeTextFor_(places, placeId);
      f.PlaceID = placeId;
      f.Room    = text.Room;
      f.Shelf   = text.Shelf;
      fromPlace = true;
    }

    var now = new Date();
    var receive = f.ReceiveDate || now;
    if (!f.FiscalYear) f.FiscalYear = thaiFiscalYear_(receive instanceof Date ? receive : now);
    if (!f.Supplier)   f.Supplier   = s_(mat.DefaultSupplier, 100);

    f.LotID       = newLotId_(f.FiscalYear);
    f.MaterialID  = materialId;
    f.QtyReceived = qty;
    f.ReceiveDate = receive;
    f.ShelfState  = 'On Shelf';
    f.Status      = 'ACTIVE';
    f.CreatedBy   = ctx.email; f.CreatedAt = now;
    f.UpdatedBy   = ctx.email; f.UpdatedAt = now;
    appendRows_('LOTS', [f]);

    // ลงบัญชีรับเข้าให้เอง — ยอดคงเหลือจึงมาจาก ledger ตั้งแต่แถวแรก
    var txn = postTxn_({
      lotId:      f.LotID,
      materialId: materialId,
      itemKind:   kind,
      type:       'RECEIVE',
      qty:        qty,
      person:     s_(p.person, 80) || ctx.name || ctx.email,
      purpose:    'รับเข้าคลัง',
      refDoc:     s_(p.refDoc, 60),
      txnAt:      receive,
      notes:      ''
    }, ctx.email);
    appendRows_('TRANSACTIONS', [txn]);

    // ห้อง/ชั้นที่มาจากแผนผังเป็นเส้นทางเต็ม ไม่ต้องไปเพิ่มเป็นรายการตัวเลือกแบบพิมพ์เอง
    feedSettingsFromLot_(fromPlace
      ? { Supplier: f.Supplier, FiscalYear: f.FiscalYear } : f, ctx.email);
    audit_(ctx.email, 'LOT_ADD', 'Lots', f.LotID,
           fromPlace ? { material: materialId, qty: qty, place: placeId } : { material: materialId, qty: qty });

    return { lotId: f.LotID, materialId: materialId, txnId: txn.TxnID, created: true };
  });
}

function feedSettingsFromLot_(f, actor) {
  if (f.Room)       addSettingsIfMissing_('Room',       [f.Room],       actor);
  if (f.Shelf)      addSettingsIfMissing_('Shelf',      [f.Shelf],      actor);
  if (f.Supplier)   addSettingsIfMissing_('Supplier',   [f.Supplier],   actor);
  if (f.FiscalYear) addSettingsIfMissing_('FiscalYear', [f.FiscalYear], actor);
}
