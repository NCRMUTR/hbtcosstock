/**
 * ============================================================================
 *  Import.gs  —  นำเข้าข้อมูลจาก CSV ของระบบเดิม
 * ============================================================================
 *
 *  ระบบเดิมเก็บทุกอย่างในตารางเดียว 16 คอลัมน์ ระบบใหม่แยกเป็น
 *  Materials / Lots / Transactions ตัวนำเข้าจึงต้อง "แตก" 1 แถวเดิม ออกเป็น:
 *
 *    1 แถวเดิม  →  Materials  1 แถว (ถ้าเป็นสารใหม่ที่ยังไม่มี)
 *               →  Lots       1 แถว
 *               →  Transactions 1–2 แถว:
 *                    • RECEIVE  = Total W.  (ยอดที่รับเข้ามาเดิม)
 *                    • ADJUST   = Label W. − Total W.  (ติดลบ)
 *                      เพื่อให้ยอดคงเหลือเท่ากับ Label W. ของระบบเดิมพอดี
 *                      โดยยังมีร่องรอยตรวจสอบได้ว่ายอดนี้ "ยกมาจากระบบเดิม"
 *
 *  ลำดับการทำงาน: import.preview (ตรวจก่อน ไม่เขียนอะไร) → import.commit
 */


/** ลำดับคอลัมน์ของ CSV ระบบเดิม (กรณีไฟล์ไม่มีแถวหัวตาราง) */
var LEGACY_ORDER = [
  'legacyCode', 'state', 'func', 'supplier', 'shelf',
  'inci', 'trade', 'totalW', 'labelW',
  'receiveDate', 'expireDate', 'recordedBy',
  'shelfState', 'shelfStateBy', 'shelfStateAt', 'room'
];

/** ชื่อหัวตารางที่ระบบรู้จัก → ฟิลด์มาตรฐาน (เทียบแบบไม่สนตัวพิมพ์/ช่องว่าง) */
var HEADER_ALIASES = {
  // ระบบเดิม
  'code': 'legacyCode', 'รหัส': 'legacyCode', 'legacycode': 'legacyCode',
  'state': 'state', 'สถานะสาร': 'state',
  'function': 'func', 'func': 'func', 'หน้าที่': 'func',
  'supplier': 'supplier', 'supp': 'supplier', 'ผู้จำหน่าย': 'supplier',
  'shelf': 'shelf', 'ชั้นวาง': 'shelf',
  'room': 'room', 'ห้อง': 'room',
  'inciname': 'inci', 'inci': 'inci', 'inci name': 'inci',
  'tradename': 'trade', 'trade': 'trade', 'trade name': 'trade',
  'totalw': 'totalW', 'totalw(g)': 'totalW', 'totalweight': 'totalW',
  'totalweight(g)': 'totalW', 'total w.': 'totalW', 'total w.(g)': 'totalW',
  'labelw': 'labelW', 'labelw(g)': 'labelW', 'labelweight': 'labelW',
  'labelweight(g)': 'labelW', 'label w.': 'labelW', 'label w.(g)': 'labelW',
  'labelw.&สต็อก': 'labelW', 'label w. & สต็อก': 'labelW',
  'receivedate': 'receiveDate', 'receive date': 'receiveDate',
  'วันรับเข้า': 'receiveDate', 'วันที่รับ': 'receiveDate',
  'expiredate': 'expireDate', 'expire date': 'expireDate',
  'วันหมดอายุ': 'expireDate',
  'recordedby': 'recordedBy', 'recorded by': 'recordedBy', 'บันทึกโดย': 'recordedBy',
  'shelfstate': 'shelfState', 'shelf state': 'shelfState',
  'changedby': 'shelfStateBy', 'changed by': 'shelfStateBy', 'แก้ไขโดย': 'shelfStateBy',
  'changedat': 'shelfStateAt', 'changed at': 'shelfStateAt', 'แก้ไขเมื่อ': 'shelfStateAt',
  // ฟิลด์ใหม่ (เผื่อไฟล์ที่เตรียมมาเองมีให้)
  'cas': 'cas', 'casno': 'cas', 'cas no': 'cas', 'cas no.': 'cas',
  'unit': 'unit', 'หน่วย': 'unit',
  'fiscalyear': 'fiscalYear', 'fiscal year': 'fiscalYear',
  'ปีงบประมาณ': 'fiscalYear', 'ปีงบ': 'fiscalYear',
  'unitprice': 'unitPrice', 'unit price': 'unitPrice', 'ราคา': 'unitPrice',
  'ราคาต่อหน่วย': 'unitPrice',
  'supplierlotno': 'supplierLotNo', 'lot': 'supplierLotNo', 'lotno': 'supplierLotNo',
  'เลขล็อต': 'supplierLotNo',
  // ไฟล์จากปุ่ม "ดาวน์โหลด CSV" ของ HBT Raw Material Stock v2 (ระบบที่ใช้อยู่ตอนนี้)
  //   Qty Received = ยอดที่รับเข้าครั้งแรก · Balance = ยอดคงเหลือ ณ วันที่ export
  //   ความหมายเดียวกับ Total W. / Label W. ของตารางเก่า จึงใช้กลไก RECEIVE + ADJUST เดิมได้เลย
  'legacy code': 'legacyCode', 'supplier lot': 'supplierLotNo',
  'qty received': 'totalW', 'qtyreceived': 'totalW',
  'balance': 'labelW', 'คงเหลือ': 'labelW',
  'lotid': 'oldLotId', 'lot id': 'oldLotId'
};

/**
 * คอลัมน์ที่รู้จักแต่ตั้งใจไม่นำเข้า — ไม่ต้องขึ้นเตือนว่า "ไม่รู้จักคอลัมน์" ให้ผู้ใช้กังวล
 * Days Left คำนวณใหม่จากวันหมดอายุได้เสมอ เก็บไว้จะกลายเป็นตัวเลขที่ผิดในวันถัดไป
 */
var IGNORED_HEADERS = { 'days left': true, 'daysleft': true };


// ─────────────────────────────────────────────────────────────────────────────
//  ขั้นที่ 1  —  ตรวจก่อนนำเข้า (ไม่เขียนข้อมูลใด ๆ)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Object} p { csv:string, defaults:{fiscalYear,unit,room}, mapping?:{field:colIndex} }
 */
function importPreview_(p, ctx) {
  var parsed = parseAndNormalize_(p);

  return {
    fingerprint:   parsed.fingerprint,
    mode:          parsed.mode,
    headerRow:     parsed.headerRow,
    mapping:       parsed.mapping,
    unmapped:      parsed.unmapped,
    totalRows:     parsed.items.length,
    summary:       parsed.summary,
    newCategories: parsed.newCategories,
    newMaterials:  parsed.newMaterialKeys.length,
    issues:        parsed.issues.slice(0, 200),
    sample:        parsed.items.filter(function (it) { return it.__action !== 'error'; })
                               .slice(0, 20)
                               .map(previewRow_)
  };
}

function previewRow_(it) {
  return {
    action:      it.__action,
    legacyCode:  it.legacyCode,
    inci:        it.inci,
    trade:       it.trade,
    supplier:    it.supplier,
    room:        it.room,
    shelf:       it.shelf,
    fiscalYear:  it.fiscalYear,
    unit:        it.unit,
    qtyReceived: it.totalW,
    balance:     it.labelW,
    receiveDate: it.receiveDate ? it.receiveDate.toISOString().slice(0, 10) : '',
    expireDate:  it.expireDate  ? it.expireDate.toISOString().slice(0, 10)  : '',
    shelfState:  it.shelfState
  };
}


// ─────────────────────────────────────────────────────────────────────────────
//  ขั้นที่ 2  —  เขียนข้อมูลจริง
// ─────────────────────────────────────────────────────────────────────────────

function importCommit_(p, ctx) {
  if (!p.fingerprint) {
    throw new AppError('กรุณากดตรวจสอบข้อมูล (Preview) ก่อนนำเข้า', 'NO_FINGERPRINT');
  }

  return withLock_(function () {
    var parsed = parseAndNormalize_(p);

    if (parsed.fingerprint !== p.fingerprint) {
      throw new AppError(
        'ไฟล์ที่ส่งมาไม่ตรงกับที่ตรวจสอบไว้ กรุณากดตรวจสอบใหม่อีกครั้ง',
        'FINGERPRINT_MISMATCH'
      );
    }

    var items = parsed.items.filter(function (it) {
      return it.__action === 'new';   // ข้าม error และ duplicate
    });

    if (!items.length) {
      return {
        imported: 0, materials: 0, lots: 0, transactions: 0,
        skipped: parsed.summary.duplicate,
        errors:  parsed.summary.error,
        message: 'ไม่มีรายการใหม่ที่ต้องนำเข้า'
      };
    }

    // ── 1. สร้าง Category ที่ยังไม่มี ──────────────────────────────────────
    var catAdded = {};
    Object.keys(parsed.newCategories).forEach(function (type) {
      if (parsed.newCategories[type].length) {
        catAdded[type] = addSettingsIfMissing_(type, parsed.newCategories[type], ctx.email);
      }
    });

    // ── 2. สร้าง Materials ที่ยังไม่มี ─────────────────────────────────────
    var matIndex = buildMaterialIndex_();            // key → MaterialID
    var newKeys  = parsed.newMaterialKeys.filter(function (k) { return !matIndex[k]; });
    var matRows  = [];

    if (newKeys.length) {
      var startMat = reserveSeq_('MAT', 'MATERIALS', 'MaterialID', 'MAT-', newKeys.length);
      newKeys.forEach(function (key, i) {
        var src = parsed.materialSample[key];
        var id  = 'MAT-' + pad_(startMat + i, 5);
        matIndex[key] = id;
        matRows.push({
          MaterialID: id,
          INCIName:   src.inci,
          CASNo:      src.cas || '',
          TradeName:  src.trade || '',
          Function:   src.func || '',
          State:      src.state || '',
          Unit:       src.unit || 'g',
          DefaultSupplier: src.supplier || '',
          SDSLink: '', Hazard: '', StorageCondition: '',
          Notes:    'นำเข้าจากระบบเดิม',
          Status:   'ACTIVE',
          // ระบบเดิมมีแต่สารเคมี — ถ้ามีวัสดุ/ครุภัณฑ์ปนมา ให้แก้ทีละรายการหลังนำเข้า
          ItemKind: 'CHEMICAL',
          CreatedBy: ctx.email, CreatedAt: new Date(),
          UpdatedBy: '',        UpdatedAt: ''
        });
      });
    }

    // ── 3. สร้าง Lots ──────────────────────────────────────────────────────
    //      จองเลขล็อตแยกตามปีงบประมาณ
    var byFy = {};
    items.forEach(function (it) {
      byFy[it.fiscalYear] = (byFy[it.fiscalYear] || 0) + 1;
    });
    var fyStart = {};
    Object.keys(byFy).forEach(function (fy) {
      fyStart[fy] = {
        next: reserveSeq_('LOT_' + fy, 'LOTS', 'LotID', 'LOT-' + fy + '-', byFy[fy]),
        prefix: 'LOT-' + fy + '-'
      };
    });

    var lotRows = [];
    var txnPlan = [];
    var now     = new Date();

    items.forEach(function (it) {
      var slot  = fyStart[it.fiscalYear];
      var lotId = slot.prefix + pad_(slot.next++, 5);
      var matId = matIndex[it.__materialKey];

      lotRows.push({
        LotID:         lotId,
        MaterialID:    matId,
        SupplierLotNo: it.supplierLotNo || '',
        Supplier:      it.supplier || '',
        FiscalYear:    it.fiscalYear,
        Room:          it.room  || '',
        Shelf:         it.shelf || '',
        QtyReceived:   it.totalW,
        UnitPrice:     it.unitPrice === null ? '' : it.unitPrice,
        ReceiveDate:   it.receiveDate || '',
        ExpireDate:    it.expireDate  || '',
        ShelfState:    it.shelfState,
        Status:        'ACTIVE',
        // รหัสล็อตเดิมเก็บไว้ในหมายเหตุ ไม่ใส่ใน LegacyCode เพราะรูปแบบ LOT-ปีงบ-เลข ชนกับรหัสล็อตของระบบนี้ได้
        // (findLot_ หา LotID ก่อน — พิมพ์รหัสเดิมจะเจอล็อตใหม่ที่บังเอิญเลขตรงกันแทน)
        // เก็บไว้ให้ตรวจย้อนในชีตได้เท่านั้น ช่องค้นหาบนหน้าเว็บไม่ค้นหมายเหตุ
        Notes:         'นำเข้าจากระบบเดิม' +
                       (it.oldLotId   ? ' (รหัสล็อตเดิม ' + it.oldLotId + ')' : '') +
                       (it.recordedBy ? ' (เดิมบันทึกโดย ' + it.recordedBy + ')' : ''),
        LegacyCode:    it.legacyCode || '',
        CreatedBy:     ctx.email, CreatedAt: now,
        UpdatedBy:     '',        UpdatedAt: '',
        ShelfStateBy:  it.shelfStateBy || '',
        ShelfStateAt:  it.shelfStateAt || ''
      });

      txnPlan.push({ lotId: lotId, matId: matId, item: it });
    });

    // ── 4. สร้าง Transactions (RECEIVE + ADJUST ยอดยกมา) ───────────────────
    var txnRows   = [];
    var txnNeeded = 0;
    txnPlan.forEach(function (t) {
      txnNeeded += 1;
      if (Math.abs(t.item.labelW - t.item.totalW) > 0.00001) txnNeeded += 1;
    });

    var txnSeq = reserveSeq_('TXN', 'TRANSACTIONS', 'TxnID', 'TXN-', txnNeeded);

    txnPlan.forEach(function (t) {
      var it   = t.item;
      var when = it.receiveDate || now;

      txnRows.push({
        TxnID: 'TXN-' + pad_(txnSeq++, 8),
        LotID: t.lotId, MaterialID: t.matId,
        Type: 'RECEIVE', Qty: it.totalW, BalanceAfter: it.totalW,
        Person: it.recordedBy || ctx.email,
        Purpose: 'รับเข้า (นำเข้าจากระบบเดิม)',
        RefDoc: it.legacyCode || '',
        TxnAt: when, Status: 'ACTIVE', CancelOf: '',
        Notes: 'สร้างอัตโนมัติจากการนำเข้า CSV',
        RecordedBy: ctx.email, RecordedAt: now
      });

      var diff = Math.round((it.labelW - it.totalW) * 10000) / 10000;
      if (Math.abs(diff) > 0.00001) {
        txnRows.push({
          TxnID: 'TXN-' + pad_(txnSeq++, 8),
          LotID: t.lotId, MaterialID: t.matId,
          Type: 'ADJUST', Qty: diff, BalanceAfter: it.labelW,
          Person: ctx.email,
          Purpose: 'ยอดยกมาจากระบบเดิม',
          RefDoc: it.legacyCode || '',
          TxnAt: when, Status: 'ACTIVE', CancelOf: '',
          Notes: 'ปรับยอดให้ตรงกับ Label W. ของระบบเดิม (รับเข้า ' +
                 it.totalW + ' คงเหลือ ' + it.labelW + ')',
          RecordedBy: ctx.email, RecordedAt: now
        });
      }
    });

    // ── 5. เขียนลงชีตแบบ batch ─────────────────────────────────────────────
    if (matRows.length) appendRows_('MATERIALS', matRows);
    appendRows_('LOTS', lotRows);
    appendRows_('TRANSACTIONS', txnRows);

    audit_(ctx.email, 'IMPORT_COMMIT', 'Lots', '', {
      rows: items.length, materials: matRows.length,
      lots: lotRows.length, txns: txnRows.length,
      fingerprint: parsed.fingerprint
    });

    return {
      imported:     items.length,
      materials:    matRows.length,
      lots:         lotRows.length,
      transactions: txnRows.length,
      categories:   catAdded,
      skipped:      parsed.summary.duplicate,
      errors:       parsed.summary.error
    };
  });
}


// ─────────────────────────────────────────────────────────────────────────────
//  อ่าน CSV + ตรวจความถูกต้อง  (ใช้ร่วมกันทั้ง preview และ commit)
// ─────────────────────────────────────────────────────────────────────────────

function parseAndNormalize_(p) {
  var csv = String(p.csv || '');
  if (!csv.trim()) throw new AppError('ไม่พบเนื้อหาไฟล์ CSV', 'EMPTY_CSV');

  // ตัด BOM ที่ Excel มักใส่มา
  if (csv.charCodeAt(0) === 0xFEFF) csv = csv.slice(1);

  var table;
  try {
    table = Utilities.parseCsv(csv);
  } catch (e) {
    throw new AppError('อ่านไฟล์ CSV ไม่ได้: ' + e.message, 'BAD_CSV');
  }

  // ตัดแถวว่างท้ายไฟล์
  while (table.length && table[table.length - 1].every(function (c) { return String(c).trim() === ''; })) {
    table.pop();
  }
  if (!table.length) throw new AppError('ไฟล์ CSV ไม่มีข้อมูล', 'EMPTY_CSV');

  var fingerprint = Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, csv, Utilities.Charset.UTF_8)
  );

  // ── หาแถวหัวตาราง ────────────────────────────────────────────────────────
  var mode      = 'positional';
  var headerRow = null;
  var mapping   = {};
  var unmapped  = [];
  var dataStart = 0;

  if (looksLikeHeader_(table[0])) {
    mode      = 'header';
    headerRow = table[0];
    dataStart = 1;
    table[0].forEach(function (h, i) {
      var field = HEADER_ALIASES[normHeader_(h)];
      if (field && mapping[field] === undefined) mapping[field] = i;
      else if (!field && String(h).trim() && !IGNORED_HEADERS[normHeader_(h)]) unmapped.push(String(h).trim());
    });
  } else {
    LEGACY_ORDER.forEach(function (field, i) {
      if (i < table[0].length) mapping[field] = i;
    });
  }

  // ให้ mapping ที่ผู้ใช้ปรับเองมีผลทับค่าที่ระบบเดา
  if (p.mapping && typeof p.mapping === 'object') {
    Object.keys(p.mapping).forEach(function (f) {
      var c = parseInt(p.mapping[f], 10);
      if (!isNaN(c) && c >= 0) mapping[f] = c;
      if (p.mapping[f] === null || p.mapping[f] === '') delete mapping[f];
    });
  }

  if (mapping.inci === undefined) {
    throw new AppError(
      'ไม่พบคอลัมน์ INCI Name ในไฟล์ — ' +
      'กรุณาตรวจสอบว่าเป็นไฟล์ที่ export จากระบบเดิม หรือกำหนดการจับคู่คอลัมน์เอง',
      'NO_INCI_COLUMN'
    );
  }

  // ── เตรียมข้อมูลที่มีอยู่แล้วในระบบ เพื่อตรวจรายการซ้ำ ──────────────────
  //    ตรวจ 2 ชั้น: (1) Code เดิม  (2) ลายนิ้วมือของแถว (เผื่อไฟล์ไม่มี Code)
  var existingMat     = buildMaterialIndex_();
  var matKeyById      = {};
  Object.keys(existingMat).forEach(function (k) { matKeyById[existingMat[k]] = k; });

  var existingLegacy  = {};
  var existingNatural = {};
  var LH = SCHEMA.LOTS;
  readRaw_('LOTS').forEach(function (r) {
    var lc = String(r[LH.indexOf('LegacyCode')] || '').trim().toLowerCase();
    if (lc) existingLegacy[lc] = true;
    existingNatural[naturalKey_(
      matKeyById[String(r[LH.indexOf('MaterialID')]).trim()] || '',
      r[LH.indexOf('ReceiveDate')],
      r[LH.indexOf('QtyReceived')],
      r[LH.indexOf('Supplier')]
    )] = true;
  });
  var settings    = getSettingsMap_();
  var knownCat    = {};
  SETTING_TYPES.forEach(function (t) {
    knownCat[t] = {};
    (settings[t] || []).forEach(function (v) { knownCat[t][String(v).toLowerCase()] = true; });
  });

  var defaults = p.defaults || {};
  var defFy    = String(defaults.fiscalYear || '').trim();
  var defUnit  = String(defaults.unit || 'g').trim() || 'g';
  var defRoom  = String(defaults.room || '').trim();

  // ── วนตรวจทีละแถว ────────────────────────────────────────────────────────
  var items           = [];
  var issues          = [];
  var seenLegacy      = {};
  var seenNatural     = {};
  var newCategories   = {};
  var newMaterialKeys = [];
  var materialSample  = {};
  var summary         = { new: 0, duplicate: 0, error: 0, warning: 0 };

  SETTING_TYPES.forEach(function (t) { newCategories[t] = []; });
  var catSeen = {};
  SETTING_TYPES.forEach(function (t) { catSeen[t] = {}; });

  function get(row, field) {
    var c = mapping[field];
    return (c === undefined || c >= row.length) ? '' : String(row[c] === null ? '' : row[c]).trim();
  }

  function noteCategory(type, value) {
    var v = String(value || '').trim();
    if (!v) return;
    var k = v.toLowerCase();
    if (knownCat[type] && knownCat[type][k]) return;
    if (catSeen[type][k]) return;
    catSeen[type][k] = true;
    newCategories[type].push(v);
  }

  for (var r = dataStart; r < table.length; r++) {
    var row     = table[r];
    var lineNo  = r + 1;

    // ข้ามแถวว่าง
    if (row.every(function (c) { return String(c).trim() === ''; })) continue;

    var it = {
      __line:   lineNo,
      __action: 'new',
      legacyCode: get(row, 'legacyCode'),
      inci:       get(row, 'inci'),
      trade:      get(row, 'trade'),
      cas:        get(row, 'cas'),
      state:      get(row, 'state'),
      func:       get(row, 'func'),
      supplier:   get(row, 'supplier'),
      shelf:      get(row, 'shelf'),
      room:       get(row, 'room') || defRoom,
      unit:       get(row, 'unit') || defUnit,
      supplierLotNo: get(row, 'supplierLotNo'),
      recordedBy:    get(row, 'recordedBy'),
      oldLotId:      get(row, 'oldLotId'),
      shelfStateBy:  get(row, 'shelfStateBy')
    };

    // ── INCI Name บังคับ ──────────────────────────────────────────────────
    if (!it.inci) {
      it.__action = 'error';
      issues.push({ line: lineNo, level: 'error', message: 'ไม่มี INCI Name' });
      summary.error++;
      items.push(it);
      continue;
    }

    // ── วันที่ ────────────────────────────────────────────────────────────
    it.receiveDate = parseDateFlexible_(get(row, 'receiveDate'));
    it.expireDate  = parseDateFlexible_(get(row, 'expireDate'));
    it.shelfStateAt = parseDateFlexible_(get(row, 'shelfStateAt')) || '';

    if (get(row, 'receiveDate') && !it.receiveDate) {
      issues.push({ line: lineNo, level: 'warning',
                    message: 'อ่านวันรับเข้าไม่ได้: "' + get(row, 'receiveDate') + '" → เว้นว่างไว้' });
      summary.warning++;
    }
    if (get(row, 'expireDate') && !it.expireDate) {
      issues.push({ line: lineNo, level: 'warning',
                    message: 'อ่านวันหมดอายุไม่ได้: "' + get(row, 'expireDate') + '" → เว้นว่างไว้' });
      summary.warning++;
    }

    // ── น้ำหนัก ───────────────────────────────────────────────────────────
    var totalW = parseNumberFlexible_(get(row, 'totalW'));
    var labelW = parseNumberFlexible_(get(row, 'labelW'));

    if (totalW === null && labelW === null) {
      issues.push({ line: lineNo, level: 'warning',
                    message: 'ไม่มีน้ำหนักทั้ง Total W. และ Label W. → ตั้งเป็น 0' });
      summary.warning++;
      totalW = 0; labelW = 0;
    } else if (totalW === null) {
      totalW = labelW;
    } else if (labelW === null) {
      labelW = totalW;
    }

    if (labelW > totalW) {
      issues.push({ line: lineNo, level: 'warning',
                    message: 'Label W. (' + labelW + ') มากกว่า Total W. (' + totalW +
                             ') → ใช้ ' + labelW + ' เป็นยอดรับเข้า' });
      summary.warning++;
      totalW = labelW;
    }

    it.totalW = totalW;
    it.labelW = labelW;
    it.unitPrice = parseNumberFlexible_(get(row, 'unitPrice'));

    // ── ปีงบประมาณ ────────────────────────────────────────────────────────
    it.fiscalYear = get(row, 'fiscalYear') || defFy ||
                    thaiFiscalYear_(it.receiveDate || new Date());

    // ── Shelf State ───────────────────────────────────────────────────────
    var ss = get(row, 'shelfState');
    it.shelfState = (/elimin/i.test(ss)) ? 'Eliminate' : 'On Shelf';

    // ── จัดกลุ่มเป็นสาร (Material) ─────────────────────────────────────────
    var key = materialKey_(it.inci, it.trade);
    it.__materialKey = key;

    // ── ตรวจรายการซ้ำ ─────────────────────────────────────────────────────
    //    ชั้นที่ 1: Code เดิม (แม่นที่สุด)
    //    ชั้นที่ 2: ลายนิ้วมือของแถว — สาร + วันรับเข้า + จำนวน + ผู้จำหน่าย
    //               ใช้เมื่อไฟล์ไม่มี Code เดิม เพื่อให้นำเข้าซ้ำได้โดยไม่เกิดข้อมูลซ้ำ
    var lc = it.legacyCode.toLowerCase();
    if (lc) {
      if (existingLegacy[lc]) {
        it.__action = 'duplicate';
        issues.push({ line: lineNo, level: 'info',
                      message: 'Code ' + it.legacyCode + ' นำเข้าไปแล้ว → ข้าม' });
        summary.duplicate++;
        items.push(it);
        continue;
      }
      if (seenLegacy[lc]) {
        issues.push({ line: lineNo, level: 'warning',
                      message: 'Code ' + it.legacyCode + ' ซ้ำกับบรรทัด ' + seenLegacy[lc] +
                               ' ในไฟล์เดียวกัน → นำเข้าเป็น 2 ล็อตแยกกัน' });
        summary.warning++;
      } else {
        seenLegacy[lc] = lineNo;
      }
    } else {
      var nk = naturalKey_(key, it.receiveDate, it.totalW, it.supplier);
      if (existingNatural[nk]) {
        it.__action = 'duplicate';
        issues.push({ line: lineNo, level: 'info',
                      message: 'ไม่มี Code เดิม แต่พบล็อตที่ตรงกันทุกอย่างในระบบแล้ว ' +
                               '(' + it.inci + ' รับ ' + ymd_(it.receiveDate) + ' จำนวน ' +
                               it.totalW + ') → ข้าม' });
        summary.duplicate++;
        items.push(it);
        continue;
      }
      if (seenNatural[nk]) {
        issues.push({ line: lineNo, level: 'warning',
                      message: 'ไม่มี Code เดิม และเหมือนบรรทัด ' + seenNatural[nk] +
                               ' ทุกอย่าง → นำเข้าเป็น 2 ล็อตแยกกัน' });
        summary.warning++;
      } else {
        seenNatural[nk] = lineNo;
      }
      issues.push({ line: lineNo, level: 'warning',
                    message: 'ไม่มี Code เดิม → ใช้ สาร+วันรับเข้า+จำนวน+ผู้จำหน่าย แทนในการตรวจซ้ำ' });
      summary.warning++;
    }

    if (!existingMat[key] && !materialSample[key]) {
      materialSample[key] = it;
      newMaterialKeys.push(key);
    }

    // ── Category ที่ยังไม่มีในระบบ ─────────────────────────────────────────
    noteCategory('State',      it.state);
    noteCategory('Function',   it.func);
    noteCategory('Supplier',   it.supplier);
    noteCategory('Shelf',      it.shelf);
    noteCategory('Room',       it.room);
    noteCategory('Unit',       it.unit);
    noteCategory('FiscalYear', it.fiscalYear);

    summary.new++;
    items.push(it);
  }

  return {
    fingerprint:     fingerprint,
    mode:            mode,
    headerRow:       headerRow,
    mapping:         mapping,
    unmapped:        unmapped,
    items:           items,
    issues:          issues,
    summary:         summary,
    newCategories:   newCategories,
    newMaterialKeys: newMaterialKeys,
    materialSample:  materialSample
  };
}


// ─────────────────────────────────────────────────────────────────────────────
//  ตัวช่วย
// ─────────────────────────────────────────────────────────────────────────────

/** ชื่อหัวตารางให้เทียบง่าย: ตัวเล็ก ตัดช่องว่างซ้ำและอักขระพิเศษท้าย */
function normHeader_(h) {
  return String(h || '')
    .replace(/﻿/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** เดาว่าแถวแรกเป็นหัวตารางหรือข้อมูล */
function looksLikeHeader_(row) {
  if (!row || !row.length) return false;
  var hits = 0;
  for (var i = 0; i < row.length; i++) {
    var n = normHeader_(row[i]);
    if (!n) continue;
    if (HEADER_ALIASES[n]) hits++;
  }
  return hits >= 3;   // เจอชื่อคอลัมน์ที่รู้จักตั้งแต่ 3 ช่องขึ้นไป = เป็นหัวตาราง
}

/** กุญแจระบุตัวสาร — INCI + Trade Name (ไม่สนตัวพิมพ์/ช่องว่างเกิน) */
function materialKey_(inci, trade) {
  return String(inci || '').replace(/\s+/g, ' ').trim().toLowerCase() + '||' +
         String(trade || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * ลายนิ้วมือของล็อต สำหรับตรวจรายการซ้ำเมื่อไฟล์ไม่มี Code เดิม
 * = สาร + วันรับเข้า + จำนวนที่รับ + ผู้จำหน่าย
 */
function naturalKey_(matKey, receiveDate, qty, supplier) {
  return [
    matKey || '',
    ymd_(receiveDate),
    Math.round((parseFloat(qty) || 0) * 10000) / 10000,
    String(supplier || '').replace(/\s+/g, ' ').trim().toLowerCase()
  ].join('|');
}

/** index ของสารที่มีอยู่แล้ว  key → MaterialID */
function buildMaterialIndex_() {
  var H   = SCHEMA.MATERIALS;
  var iId = H.indexOf('MaterialID');
  var iIn = H.indexOf('INCIName');
  var iTr = H.indexOf('TradeName');
  var out = {};

  readRaw_('MATERIALS').forEach(function (r) {
    var id = String(r[iId] || '').trim();
    if (!id) return;
    out[materialKey_(r[iIn], r[iTr])] = id;
  });
  return out;
}
