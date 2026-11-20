/**
 * ============================================================================
 *  Data.gs  —  ชั้นเข้าถึงข้อมูล (อ่าน/เขียนชีต, ล็อก, เลขรันนิ่ง, เวอร์ชัน)
 * ============================================================================
 *
 *  ทุกการอ่าน/เขียนชีตต้องผ่านไฟล์นี้ เพื่อให้:
 *   • ลำดับคอลัมน์มาจาก SCHEMA ที่เดียว (ไม่มี hard-code เลข index กระจัดกระจาย)
 *   • ทุกการเขียนถูกห่อด้วย LockService (กันข้อมูลหายเวลาหลายคนทำพร้อมกัน)
 *   • ทุกการเขียนเพิ่มเลขเวอร์ชันข้อมูล (หน้าเว็บจึงรู้ว่าต้องโหลด snapshot ใหม่)
 */


// ─────────────────────────────────────────────────────────────────────────────
//  Error ที่สื่อสารกับผู้ใช้ได้
// ─────────────────────────────────────────────────────────────────────────────

function AppError(message, code) {
  var e = new Error(message);
  e.name = 'AppError';
  e.code = code || 'ERROR';
  e.userFacing = true;
  return e;
}


// ─────────────────────────────────────────────────────────────────────────────
//  อ่านข้อมูล
// ─────────────────────────────────────────────────────────────────────────────

function sheetOf_(schemaKey) {
  var name  = SHEETS[schemaKey];
  var sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new AppError('ไม่พบชีต "' + name + '" — กรุณารัน setupSpreadsheet() ก่อน', 'NO_SHEET');
  return sheet;
}

/** อ่านทั้งตารางเป็น array ของ object  [{Col:val, ...}, ...] */
function readTable_(schemaKey) {
  var sheet   = sheetOf_(schemaKey);
  var headers = SCHEMA[schemaKey];
  var last    = sheet.getLastRow();
  if (last < 2) return [];

  var values = sheet.getRange(2, 1, last - 1, headers.length).getValues();
  var out    = [];

  for (var r = 0; r < values.length; r++) {
    // ข้ามแถวว่างเปล่า
    var blank = true;
    for (var c = 0; c < values[r].length; c++) {
      if (values[r][c] !== '' && values[r][c] !== null) { blank = false; break; }
    }
    if (blank) continue;

    var obj = { __row: r + 2 };
    for (var k = 0; k < headers.length; k++) obj[headers[k]] = values[r][k];
    out.push(obj);
  }
  return out;
}

/** อ่านเป็น array-of-array ดิบ ๆ (เร็วกว่า ใช้ตอนสร้าง snapshot) */
function readRaw_(schemaKey) {
  var sheet   = sheetOf_(schemaKey);
  var headers = SCHEMA[schemaKey];
  var last    = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, headers.length).getValues();
}


// ─────────────────────────────────────────────────────────────────────────────
//  เขียนข้อมูล
// ─────────────────────────────────────────────────────────────────────────────

/** แปลง object เป็นแถวตามลำดับ SCHEMA */
function objToRow_(schemaKey, obj) {
  return SCHEMA[schemaKey].map(function (h) {
    var v = obj[h];
    if (v === undefined || v === null) return '';
    // ชีตรับได้เฉพาะข้อความ/ตัวเลข/ค่าจริงเท็จ/วันที่ — อย่างอื่นแปลงเป็นข้อความกัน "[object Object]"
    if (v instanceof Date) return isNaN(v.getTime()) ? '' : v;
    var t = typeof v;
    if (t === 'string' || t === 'number' || t === 'boolean') {
      return (t === 'number' && !isFinite(v)) ? '' : v;
    }
    try { return JSON.stringify(v).slice(0, 4000); } catch (e) { return String(v); }
  });
}

/** เพิ่มหลายแถวในครั้งเดียว (เร็วกว่า appendRow ทีละแถวมาก) */
function appendRows_(schemaKey, objects) {
  if (!objects || !objects.length) return 0;
  var sheet = sheetOf_(schemaKey);
  var rows  = objects.map(function (o) { return objToRow_(schemaKey, o); });
  var start = sheet.getLastRow() + 1;
  ensureCapacity_(sheet, start + rows.length - 1, SCHEMA[schemaKey].length);
  sheet.getRange(start, 1, rows.length, SCHEMA[schemaKey].length).setValues(rows);
  return rows.length;
}

/**
 * ชีตของ Google มีจำนวนแถว/คอลัมน์จำกัด (ชีตใหม่ = 1000 แถว 26 คอลัมน์)
 * เขียนเกินขอบเขตจะได้ error "Those rows are out of bounds" — จึงต้องขยายก่อน
 * ตาราง Transactions โตทุกครั้งที่เบิก/รับเข้า เคสนี้จึงเกิดแน่นอนเมื่อใช้ไปสักพัก
 * ขยายทีละ 500 แถวเป็นอย่างน้อย เพื่อไม่ต้องขยายใหม่ทุกครั้งที่บันทึก
 */
function ensureCapacity_(sheet, needRows, needCols) {
  var maxR = sheet.getMaxRows();
  if (needRows > maxR) sheet.insertRowsAfter(maxR, Math.max(needRows - maxR, 500));
  var maxC = sheet.getMaxColumns();
  if (needCols > maxC) sheet.insertColumnsAfter(maxC, needCols - maxC);
}

/**
 * แก้ไขบางคอลัมน์ของแถวที่ id ตรงกัน
 * @return {boolean} true ถ้าพบและแก้แล้ว
 */
/**
 * แก้หลายแถวพร้อมกัน — { idValue: patch, ... }
 * แก้เกิน 12 แถว = อ่าน/เขียนทั้งช่วงรวดเดียว เร็วกว่าไล่ทีละแถวมาก
 * @return {number} จำนวนแถวที่แก้จริง
 */
function patchRowsById_(schemaKey, idField, patches) {
  var sheet   = sheetOf_(schemaKey);
  var headers = SCHEMA[schemaKey];
  var idCol   = headers.indexOf(idField);
  if (idCol === -1) throw new AppError('ไม่รู้จักคอลัมน์ ' + idField, 'BAD_FIELD');

  var last = sheet.getLastRow();
  if (last < 2) return 0;

  var wanted = {};
  Object.keys(patches).forEach(function (k) { wanted[String(k).trim().toLowerCase()] = patches[k]; });
  if (!Object.keys(wanted).length) return 0;

  var ids = sheet.getRange(2, idCol + 1, last - 1, 1).getValues();
  var hits = [];
  for (var i = 0; i < ids.length; i++) {
    var key = String(ids[i][0]).trim().toLowerCase();
    if (key && wanted.hasOwnProperty(key)) hits.push({ idx: i, patch: wanted[key] });
  }
  if (!hits.length) return 0;

  function apply(rowArr, patch) {
    Object.keys(patch).forEach(function (f) {
      var c = headers.indexOf(f);
      if (c !== -1) rowArr[c] = (patch[f] === undefined || patch[f] === null) ? '' : patch[f];
    });
  }

  if (hits.length > 12) {
    var all = sheet.getRange(2, 1, last - 1, headers.length).getValues();
    hits.forEach(function (h) { apply(all[h.idx], h.patch); });
    sheet.getRange(2, 1, last - 1, headers.length).setValues(all);
  } else {
    hits.forEach(function (h) {
      var row = h.idx + 2;
      var cur = sheet.getRange(row, 1, 1, headers.length).getValues()[0];
      apply(cur, h.patch);
      sheet.getRange(row, 1, 1, headers.length).setValues([cur]);
    });
  }
  return hits.length;
}

function updateRowById_(schemaKey, idField, idValue, patch) {
  var sheet   = sheetOf_(schemaKey);
  var headers = SCHEMA[schemaKey];
  var idCol   = headers.indexOf(idField);
  if (idCol === -1) throw new AppError('ไม่รู้จักคอลัมน์ ' + idField, 'BAD_FIELD');

  var last = sheet.getLastRow();
  if (last < 2) return false;

  var ids = sheet.getRange(2, idCol + 1, last - 1, 1).getValues();
  var key = String(idValue).trim().toLowerCase();

  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim().toLowerCase() === key) {
      var row     = i + 2;
      var current = sheet.getRange(row, 1, 1, headers.length).getValues()[0];
      Object.keys(patch).forEach(function (f) {
        var c = headers.indexOf(f);
        if (c !== -1) current[c] = (patch[f] === undefined || patch[f] === null) ? '' : patch[f];
      });
      sheet.getRange(row, 1, 1, headers.length).setValues([current]);
      return true;
    }
  }
  return false;
}


// ─────────────────────────────────────────────────────────────────────────────
//  ล็อก — ป้องกัน "lost update" เวลาหลายคนเขียนพร้อมกัน
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ห่อการเขียนทุกครั้งด้วยล็อก แล้วเพิ่มเลขเวอร์ชันข้อมูลให้อัตโนมัติ
 * @param {Function} fn  งานที่จะทำภายใต้ล็อก
 */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) {
    throw new AppError('ระบบกำลังมีผู้ใช้อื่นบันทึกข้อมูลอยู่ กรุณาลองใหม่อีกครั้ง', 'BUSY');
  }
  try {
    var result = fn();
    bumpVersion_();
    return result;
  } finally {
    lock.releaseLock();
  }
}


// ─────────────────────────────────────────────────────────────────────────────
//  เวอร์ชันข้อมูล — หน้าเว็บใช้เทียบว่าต้องโหลด snapshot ใหม่หรือไม่
// ─────────────────────────────────────────────────────────────────────────────

function getVersion_() {
  var v = PropertiesService.getScriptProperties().getProperty(PROP_VERSION_KEY);
  return parseInt(v, 10) || 1;
}

function bumpVersion_() {
  var props = PropertiesService.getScriptProperties();
  var next  = (parseInt(props.getProperty(PROP_VERSION_KEY), 10) || 0) + 1;
  props.setProperty(PROP_VERSION_KEY, String(next));
  dropSnapshotCache_();
  return next;
}


// ─────────────────────────────────────────────────────────────────────────────
//  เลขรันนิ่ง  (MAT-00001 / LOT-2569-00001 / TXN-00000001)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ขอเลขลำดับถัดไป เก็บตัวนับใน Script Properties เพื่อไม่ต้องสแกนชีตทุกครั้ง
 * ครั้งแรกจะสแกนชีตหา "เลขสูงสุดที่มีอยู่" มาตั้งต้นให้ (กันเลขซ้ำกับข้อมูลเดิม)
 */
function nextSeq_(seqName, schemaKey, idField, prefix) {
  var props = PropertiesService.getScriptProperties();
  var key   = 'SEQ_' + seqName;
  var cur   = parseInt(props.getProperty(key), 10);

  if (!cur) {
    cur = scanMaxSeq_(schemaKey, idField, prefix);
  }
  cur += 1;
  props.setProperty(key, String(cur));
  return cur;
}

/** สแกนหาเลขสูงสุดของ ID ที่ขึ้นต้นด้วย prefix */
function scanMaxSeq_(schemaKey, idField, prefix) {
  var sheet = sheetOf_(schemaKey);
  var col   = SCHEMA[schemaKey].indexOf(idField) + 1;
  var last  = sheet.getLastRow();
  if (last < 2 || col < 1) return 0;

  var ids = sheet.getRange(2, col, last - 1, 1).getValues();
  var max = 0;
  for (var i = 0; i < ids.length; i++) {
    var s = String(ids[i][0] || '');
    if (s.indexOf(prefix) !== 0) continue;
    var n = parseInt(s.slice(prefix.length), 10);
    if (n > max) max = n;
  }
  return max;
}

/**
 * จองเลขลำดับเป็นชุด — ใช้ตอนนำเข้าข้อมูลจำนวนมาก
 * (ถ้าเรียก nextSeq_ ทีละแถว 1,000 ครั้ง จะเขียน Properties 1,000 ครั้ง = ช้ามาก)
 * @return {number} เลขเริ่มต้นของชุดที่จองได้ (ตัวแรกที่ใช้ได้)
 */
function reserveSeq_(seqName, schemaKey, idField, prefix, count) {
  var props = PropertiesService.getScriptProperties();
  var key   = 'SEQ_' + seqName;
  var cur   = parseInt(props.getProperty(key), 10);
  if (!cur) cur = scanMaxSeq_(schemaKey, idField, prefix);
  props.setProperty(key, String(cur + count));
  return cur + 1;
}

function pad_(n, width) {
  var s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

function newMaterialId_()      { return 'MAT-' + pad_(nextSeq_('MAT', 'MATERIALS', 'MaterialID', 'MAT-'), 5); }
function newPlaceId_()         { return 'PL-'  + pad_(nextSeq_('PL',  'PLACES', 'PlaceID', 'PL-'),  5); }
function newPhotoId_()         { return 'PH-'  + pad_(nextSeq_('PH',  'PHOTOS', 'PhotoID', 'PH-'),  5); }
/** จองรหัสที่เก็บหลายตัวรวดเดียว (ใช้ตอนย้ายข้อมูลเก่า) */
function newPlaceIds_(count)   {
  var start = reserveSeq_('PL', 'PLACES', 'PlaceID', 'PL-', count);
  var out = [];
  for (var i = 0; i < count; i++) out.push('PL-' + pad_(start + i, 5));
  return out;
}
function newTxnId_()           { return 'TXN-' + pad_(nextSeq_('TXN', 'TRANSACTIONS', 'TxnID', 'TXN-'), 8); }
function newLotId_(fiscalYear) {
  var fy     = String(fiscalYear || thaiFiscalYear_(new Date())).trim();
  var prefix = 'LOT-' + fy + '-';
  return prefix + pad_(nextSeq_('LOT_' + fy, 'LOTS', 'LotID', prefix), 5);
}


// ─────────────────────────────────────────────────────────────────────────────
//  บัญชีเดินสะพัด — ยอดคงเหลือคำนวณจาก ledger ไม่ใช่เขียนทับตัวเลข
// ─────────────────────────────────────────────────────────────────────────────

/** คำนวณยอดคงเหลือของทุกล็อต → { LotID: balance } */
function computeBalances_(txnRows) {
  var H   = SCHEMA.TRANSACTIONS;
  var iL  = H.indexOf('LotID');
  var iQ  = H.indexOf('Qty');
  var iS  = H.indexOf('Status');
  var out = {};

  var rows = txnRows || readRaw_('TRANSACTIONS');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][iS]).toUpperCase() === 'CANCELLED') continue;
    var lot = String(rows[i][iL]).trim();
    if (!lot) continue;
    out[lot] = (out[lot] || 0) + (parseFloat(rows[i][iQ]) || 0);
  }
  // ปัดทศนิยม 4 ตำแหน่ง กัน floating point เพี้ยน (0.1+0.2)
  Object.keys(out).forEach(function (k) { out[k] = Math.round(out[k] * 10000) / 10000; });
  return out;
}

/**
 * บันทึกรายการเข้า ledger  (ต้องเรียกอยู่ภายใน withLock_ เสมอ)
 * @param {Object} t { lotId, materialId, type, qty, person, purpose, refDoc, txnAt, notes }
 * @param {string} actor อีเมลผู้บันทึก
 */
function postTxn_(t, actor, balancesCache) {
  var type = String(t.type || '').toUpperCase();
  if (!(type in TXN_SIGN)) throw new AppError('ชนิดรายการไม่ถูกต้อง: ' + type, 'BAD_TYPE');

  var qty = parseFloat(t.qty);
  if (isNaN(qty)) throw new AppError('จำนวนไม่ถูกต้อง', 'BAD_QTY');

  // ตรวจที่นี่จุดเดียว ทุกทางที่ลงบัญชี (รับเข้า เบิก ปรับยอด ทำลาย) จึงโดนกฎเดียวกันหมด
  var kind = t.itemKind ? itemKindOf_(t.itemKind) : materialKindById_(t.materialId);
  if (kind === 'EQUIPMENT' && EQUIPMENT_BLOCKED_TXN.indexOf(type) !== -1) {
    throw new AppError(
      'ครุภัณฑ์ยังเบิก/คืนไม่ได้ — ถ้านำไปใช้ที่ห้องอื่น ให้ใช้ "ย้ายที่เก็บ" แทน\n' +
      '(ระบบยืม-คืนครุภัณฑ์จะเปิดให้ใช้ภายหลัง)', 'EQUIPMENT_NO_ISSUE');
  }
  assertQtyForKind_(kind, qty);

  // ใส่เครื่องหมายตามชนิดรายการ (ADJUST ใช้เครื่องหมายที่ผู้ใช้กรอกมา)
  var signed = (TXN_SIGN[type] === 0) ? qty : Math.abs(qty) * TXN_SIGN[type];

  var balances = balancesCache || computeBalances_();
  var before   = balances[t.lotId] || 0;
  var after    = Math.round((before + signed) * 10000) / 10000;

  if (after < 0 && type !== 'ADJUST') {
    throw new AppError(
      'จำนวนคงเหลือไม่พอ — ล็อต ' + t.lotId + ' มีอยู่ ' + before + ' แต่ขอ ' + Math.abs(signed),
      'INSUFFICIENT'
    );
  }

  var row = {
    TxnID:        newTxnId_(),
    LotID:        t.lotId,
    MaterialID:   t.materialId || '',
    Type:         type,
    Qty:          signed,
    BalanceAfter: after,
    Person:       t.person  || actor,
    Purpose:      t.purpose || '',
    RefDoc:       t.refDoc  || '',
    TxnAt:        t.txnAt ? new Date(t.txnAt) : new Date(),
    Status:       'ACTIVE',
    CancelOf:     '',
    Notes:        t.notes || '',
    RecordedBy:   actor,
    RecordedAt:   new Date()
  };

  balances[t.lotId] = after;
  return row;
}


/** ชนิดของของสาร — หาไม่เจอหรือไม่ระบุ ถือเป็น CHEMICAL (กติกาเดียวกับแถวเก่า) */
function materialKindById_(materialId) {
  var id = String(materialId || '').trim();
  if (!id) return DEFAULT_ITEM_KIND;
  var rows = readTable_('MATERIALS');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].MaterialID).trim() === id) return itemKindOf_(rows[i].ItemKind);
  }
  return DEFAULT_ITEM_KIND;
}

/** เผื่อ floating point เพี้ยนเล็กน้อย (เช่น 3.0000000001 จากการบวกลบ) */
function isWholeNumber_(n) {
  return Math.abs(n - Math.round(n)) < 1e-9;
}

/** ครุภัณฑ์นับเป็นชิ้น — 1.5 ชิ้นไม่มีอยู่จริง ไม่ว่าจะรับเข้า ปรับยอด หรือทำลาย */
function assertQtyForKind_(kind, qty) {
  if (kind === 'EQUIPMENT' && !isWholeNumber_(qty)) {
    throw new AppError('ครุภัณฑ์นับเป็นชิ้น ต้องกรอกจำนวนเต็ม (ได้รับ ' + qty + ') — ' +
                       'เช่น 1, 2, 10', 'WHOLE_NUMBER_ONLY');
  }
}


// ─────────────────────────────────────────────────────────────────────────────
//  ประวัติการเปลี่ยนแปลง
// ─────────────────────────────────────────────────────────────────────────────

function audit_(actor, action, entity, entityId, detail) {
  try {
    appendRows_('AUDIT', [{
      LogID:    'LOG-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      At:       new Date(),
      Actor:    actor || '',
      Action:   action,
      Entity:   entity || '',
      EntityID: entityId || '',
      Detail:   detail ? JSON.stringify(detail).slice(0, 4000) : ''
    }]);
  } catch (e) {
    console.warn('audit_ failed: ' + e.message);
  }
}


// ─────────────────────────────────────────────────────────────────────────────
//  แปลงค่า
// ─────────────────────────────────────────────────────────────────────────────

/** แปลง Date → ISO string เพื่อส่งเป็น JSON (ค่าอื่นคงเดิม) */
function isoSafe_(v) {
  return (v instanceof Date) ? v.toISOString() : v;
}

/** วันที่ → "YYYY-MM-DD" ตามปฏิทินท้องถิ่น (ไม่เพี้ยนข้ามวันเพราะ timezone) */
function ymd_(v) {
  var d = parseDateFlexible_(v);
  if (!d) return '';
  return d.getFullYear() + '-' + pad_(d.getMonth() + 1, 2) + '-' + pad_(d.getDate(), 2);
}

/**
 * แปลงข้อความเป็นวันที่ รองรับหลายรูปแบบที่พบใน CSV จริง
 *   2026-10-14, 2026-10-14T00:00:00.000Z
 *   14/10/2026, 14/10/2569 (พ.ศ.), 10/14/2026
 * @return {Date|null}
 */
function parseDateFlexible_(input) {
  if (input === '' || input === null || input === undefined) return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;

  var s = String(input).trim();
  if (!s) return null;

  // ISO
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    var y = +iso[1];
    if (y > 2400) y -= 543;                       // เผื่อเขียน พ.ศ. มาในรูป ISO
    return new Date(y, +iso[2] - 1, +iso[3]);
  }

  // d/m/y หรือ m/d/y (คั่นด้วย / - .)
  var p = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (p) {
    var a = +p[1], b = +p[2], yy = +p[3];
    if (yy < 100) yy += 2000;
    if (yy > 2400) yy -= 543;                     // พ.ศ. → ค.ศ.
    // ถ้าตัวแรกมากกว่า 12 แปลว่าเป็นวันแน่ ๆ → d/m/y
    // ถ้าตัวที่สองมากกว่า 12 แปลว่าเป็นวัน → m/d/y
    var day   = (b > 12) ? b : a;
    var month = (b > 12) ? a : b;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return new Date(yy, month - 1, day);
  }

  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** แปลงเป็นตัวเลข รองรับ comma และช่องว่าง */
function parseNumberFlexible_(input) {
  if (input === '' || input === null || input === undefined) return null;
  if (typeof input === 'number') return isNaN(input) ? null : input;
  var s = String(input).replace(/,/g, '').replace(/\s/g, '').trim();
  if (!s) return null;
  var n = parseFloat(s);
  return isNaN(n) ? null : n;
}
