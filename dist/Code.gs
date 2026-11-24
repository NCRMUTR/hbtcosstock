// Lab Chem Stock — รวมจากไฟล์ใน gas/ (สร้างโดย tools/bundle.js)
// อย่าแก้ไฟล์นี้โดยตรง — แก้ไฟล์ต้นทางใน gas/ แล้วรันรวมใหม่

// ═════════════════════ Config.gs ═════════════════════
/**
 * ============================================================================
 *  HBT Raw Material Stock v2  —  Config.gs
 *  ค่าตั้งต้นของระบบ และ "แหล่งความจริงเดียว" ของโครงสร้างตาราง (SCHEMA)
 * ============================================================================
 *
 *  ⚠️  ก่อนใช้งานครั้งแรก ต้องตั้งค่า Script Properties 3 ตัว:
 *      (Apps Script → Project Settings → Script Properties)
 *
 *      SPREADSHEET_ID   = ID ของ Google Sheet ที่เก็บข้อมูล
 *      OAUTH_CLIENT_ID  = Client ID จาก Google Cloud Console
 *      BOOTSTRAP_ADMIN  = อีเมลผู้ดูแลระบบคนแรก (เช่น you@rmutr.ac.th)
 *
 *      SESSION_SECRET   จะถูกสร้างอัตโนมัติครั้งแรก ไม่ต้องตั้งเอง
 */

// ─────────────────────────────────────────────────────────────────────────────
//  1. องค์กร / ความปลอดภัย
// ─────────────────────────────────────────────────────────────────────────────

/** โดเมน Workspace ที่อนุญาตให้ล็อกอิน (ตรวจจาก claim "hd" ใน ID Token) */
var ALLOWED_DOMAIN = 'rmutr.ac.th';

/** อายุ session token (ชั่วโมง) — หมดอายุแล้วหน้าเว็บจะขอ token ใหม่เองเงียบ ๆ */
var SESSION_TTL_HOURS = 8;

/** สิทธิ์ที่มีในระบบ (เรียงจากสูงไปต่ำ) */
var ROLES = ['admin', 'staff', 'viewer'];

// ─────────────────────────────────────────────────────────────────────────────
//  2. ชื่อชีต
// ─────────────────────────────────────────────────────────────────────────────

var SHEETS = {
  MATERIALS:    'Materials',
  LOTS:         'Lots',
  TRANSACTIONS: 'Transactions',
  PLACES:       'Places',
  PHOTOS:       'Photos',
  SETTINGS:     'Settings',
  USERS:        'Users',
  AUDIT:        'AuditLog'
};

// ─────────────────────────────────────────────────────────────────────────────
//  3. โครงสร้างคอลัมน์ (SCHEMA)
//
//     ลำดับใน array = ลำดับคอลัมน์จริงในชีต (A, B, C, ...)
//     ทุกไฟล์ในระบบอ่านลำดับจากที่นี่ — ห้าม hard-code เลข index ที่อื่น
//     เพิ่มคอลัมน์ใหม่: ต่อท้าย array เท่านั้น (ห้ามแทรกกลาง) แล้วรัน
//     setupSpreadsheet() อีกครั้งเพื่อเติม header
// ─────────────────────────────────────────────────────────────────────────────

var SCHEMA = {

  /** ข้อมูลหลักของสาร — 1 แถวต่อ 1 สาร (ไม่เกี่ยวกับน้ำหนัก/วันหมดอายุ) */
  MATERIALS: [
    'MaterialID',      // MAT-00001
    'INCIName',
    'CASNo',
    'TradeName',
    'Function',
    'State',
    'Unit',            // g | mL | kg | L | pcs
    'DefaultSupplier',
    'SDSLink',
    'Hazard',          // GHS เช่น "Irritant, Flammable"
    'StorageCondition',// RT | 2-8C | -20C
    'Notes',
    'Status',          // ACTIVE | INACTIVE
    'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt',
    'ItemKind'         // CHEMICAL | CONSUMABLE | EQUIPMENT — ว่าง = CHEMICAL (แถวก่อนมีคอลัมน์นี้)
  ],

  /** ล็อตที่รับเข้ามา — 1 แถวต่อ 1 ครั้งที่รับของ (หลายล็อตต่อ 1 สารได้) */
  LOTS: [
    'LotID',           // LOT-2569-00001
    'MaterialID',
    'SupplierLotNo',   // เลขล็อตจากผู้ขาย
    'Supplier',
    'FiscalYear',      // ปีงบประมาณ (Text) เช่น 2569
    'Room',
    'Shelf',
    'QtyReceived',
    'UnitPrice',
    'ReceiveDate',
    'ExpireDate',
    'ShelfState',      // On Shelf | Eliminate
    'Status',          // ACTIVE | DISPOSED
    'Notes',
    'LegacyCode',      // Code เดิมจากระบบเก่า เช่น #2504/1234 (ค้นหาได้)
    'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt',
    'ShelfStateBy', 'ShelfStateAt',
    'PlaceID'          // อ้างตาราง Places — Room/Shelf ด้านบนยังเก็บไว้เป็นข้อความคู่กัน
  ],

  /**
   * บัญชีเดินสะพัด (append-only ledger)
   * ยอดคงเหลือของล็อต = ผลรวม Qty ของแถวที่ Status = ACTIVE
   * เครื่องหมาย: RECEIVE/RETURN = บวก, ISSUE/DISPOSE = ลบ, ADJUST = ตามที่กรอก
   */
  TRANSACTIONS: [
    'TxnID',           // TXN-00000001
    'LotID',
    'MaterialID',
    'Type',            // RECEIVE | ISSUE | RETURN | ADJUST | DISPOSE
    'Qty',             // มีเครื่องหมาย +/-
    'BalanceAfter',    // ยอดคงเหลือหลังรายการนี้ (เก็บไว้เพื่อตรวจสอบย้อนหลัง)
    'Person',          // ผู้เบิก / ผู้รับผิดชอบ
    'Purpose',
    'RefDoc',          // เลขที่เอกสารอ้างอิง
    'TxnAt',           // เวลาที่เกิดรายการจริง
    'Status',          // ACTIVE | CANCELLED
    'CancelOf',        // TxnID ที่รายการนี้ไปยกเลิก
    'Notes',
    'RecordedBy', 'RecordedAt'
  ],

  /** Category ทั้งหมดของระบบ */
  SETTINGS: [
    'Type',            // State | Function | Supplier | Shelf | Room | FiscalYear | Unit
    'Value',
    'Sort',
    'Active',          // TRUE | FALSE
    'CreatedBy', 'CreatedAt'
  ],

  /** ผู้ใช้ที่ได้รับอนุญาต — ไม่เก็บรหัสผ่าน (ใช้ Google Sign-In) */
  USERS: [
    'Email',           // บัญชี Google — บัญชีรหัสผ่านเว้นว่าง
    'Name',
    'Role',            // admin | staff | viewer
    'Status',          // ACTIVE | DISABLED
    'Notes',
    'AddedBy', 'AddedAt',
    'LastLogin', 'LoginCount',
    'LoginKind',       // GOOGLE | PASSWORD
    'Username',        // บัญชีรหัสผ่าน — บัญชี Google เว้นว่าง
    'PassHash',        // v1$รอบ$salt$hex (ไม่มีทางถอดกลับเป็นรหัสเดิม)
    'SessionVer',      // เพิ่มทีละ 1 เพื่อตัด session ที่ค้างอยู่ทุกเครื่อง
    'PassChangedAt'
  ],

  /** ประวัติการเปลี่ยนแปลงทั้งหมด */
  /** ที่เก็บแบบลำดับชั้น: ห้อง → ตู้/โต๊ะ → ชั้น → กล่อง
   *  X, Y, W, H = ตำแหน่งปุ่มบนรูปของที่เก็บ "แม่" เป็นสัดส่วน 0–1 ของรูป
   *  (เก็บเป็นสัดส่วน ไม่ใช่พิกเซล ปุ่มจึงตรงเสมอไม่ว่าจอจะกว้างเท่าไร) */
  PLACES: [
    'PlaceID',         // PL-00001
    'ParentID',
    'Kind',            // ROOM | CABINET | SHELF | BOX
    'Name',
    'X', 'Y', 'W', 'H',
    'Color',           // #rrggbb — เว้นว่าง = ใช้สีอัตโนมัติ
    'Sort',
    'Notes',
    'Status',          // ACTIVE | DELETED
    'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt'
  ],

  /** รูปภาพที่เก็บใน Google Drive — แถวนี้เก็บแค่รหัสไฟล์ */
  PHOTOS: [
    'PhotoID',         // PH-00001
    'OwnerType',       // PLACE | MATERIAL | LOT
    'OwnerID',
    'DriveFileID',
    'Width', 'Height',
    'Caption',
    'Sort',            // รูปแรก (Sort น้อยสุด) = รูปหลักที่ใช้วางปุ่ม
    'Status',          // ACTIVE | DELETED
    'CreatedBy', 'CreatedAt'
  ],

  AUDIT: [
    'LogID',
    'At',
    'Actor',
    'Action',          // LOGIN | USER_ADD | LOT_UPDATE | IMPORT_COMMIT | ...
    'Entity',          // Materials | Lots | Users | ...
    'EntityID',
    'Detail'           // JSON
  ]
};

/**
 * ชนิดของในคลัง
 *   CHEMICAL   สารเคมี — ต้องมีชื่อสาร ตวงวัดเป็นทศนิยมได้
 *   CONSUMABLE วัสดุสิ้นเปลือง (กระดาษกรอง ถุงมือ) — ไม่มี CAS ใช้แล้วหมดไป
 *   EQUIPMENT  ครุภัณฑ์/เครื่องแก้ว — นับเป็นชิ้นเสมอ เพราะครึ่งบีกเกอร์ไม่มีความหมาย
 *              และไม่ให้ "เบิก/คืน" จนกว่าจะมีระบบยืม-คืนแยก (กันประวัติปนกัน)
 */
var ITEM_KINDS      = ['CHEMICAL', 'CONSUMABLE', 'EQUIPMENT'];
var DEFAULT_ITEM_KIND = 'CHEMICAL';
var EQUIPMENT_UNIT  = 'pcs';
/** ชนิดรายการที่ครุภัณฑ์ทำไม่ได้ — ต้องรอระบบยืม-คืน */
var EQUIPMENT_BLOCKED_TXN = ['ISSUE', 'RETURN'];

/**
 * อ่านชนิดของจากค่าในชีต — ค่าว่างหรือค่าที่ไม่รู้จักถือเป็น CHEMICAL
 * เพราะทุกแถวที่มีก่อนเพิ่มคอลัมน์นี้คือสารเคมีจากระบบเดิม
 * (ใช้ตอน "อ่าน" เท่านั้น ตอนรับค่าจากผู้ใช้ให้ใช้ parseItemKind_ ที่ปฏิเสธค่าแปลก)
 */
function itemKindOf_(v) {
  var k = String(v === undefined || v === null ? '' : v).trim().toUpperCase();
  return ITEM_KINDS.indexOf(k) === -1 ? DEFAULT_ITEM_KIND : k;
}

/** ค่าที่ผู้ใช้ส่งมา — ว่างคืน null, ไม่รู้จักโยน error */
function parseItemKind_(v) {
  var k = String(v === undefined || v === null ? '' : v).trim().toUpperCase();
  if (!k) return null;
  if (ITEM_KINDS.indexOf(k) === -1) {
    throw new AppError('ชนิดของไม่ถูกต้อง: "' + v + '" — เลือกได้เฉพาะ สารเคมี (CHEMICAL), ' +
                       'วัสดุสิ้นเปลือง (CONSUMABLE) หรือ ครุภัณฑ์ (EQUIPMENT)', 'BAD_KIND');
  }
  return k;
}

/** ชนิด Category ที่ระบบรู้จัก */
var SETTING_TYPES = ['State', 'Function', 'Supplier', 'Shelf', 'Room', 'FiscalYear', 'Unit'];

// ─────────────────────────────────────────────────────────────────────────────
//  3.1 ที่เก็บแบบลำดับชั้น และรูปภาพ
// ─────────────────────────────────────────────────────────────────────────────

/** ระดับของที่เก็บ เรียงจากนอกเข้าใน — ลูกต้องลึกกว่าพ่อเสมอ */
var PLACE_KINDS = ['ROOM', 'CABINET', 'SHELF', 'BOX'];
function placeRank_(kind) { return PLACE_KINDS.indexOf(String(kind || '').toUpperCase()); }

/** ชนิดเจ้าของรูป */
var PHOTO_OWNERS = ['PLACE', 'MATERIAL', 'LOT'];

var MAX_PHOTOS_PER_OWNER = 8;
var MAX_PHOTO_BYTES      = 3.5 * 1024 * 1024;   // หลังย่อที่เบราว์เซอร์แล้ว
var PHOTO_FOLDER_NAME    = 'Lab Chem Stock Photos';

/** ขนาดปุ่มบนรูปที่เล็กที่สุดที่ยอมรับ (สัดส่วนของรูป) */
var MIN_ZONE_SIZE = 0.01;

/** ชนิดรายการใน ledger และทิศทางของยอด */
var TXN_SIGN = {
  RECEIVE:  1,
  RETURN:   1,
  ISSUE:   -1,
  DISPOSE: -1,
  ADJUST:   0,  // ใช้เครื่องหมายตามที่ผู้ใช้กรอกเอง
  MOVE:     0   // ย้ายที่เก็บ — ไม่กระทบยอด แต่เก็บไว้ในประวัติ
};

/** ชนิดรายการที่ไม่ได้ทำให้ยอดเปลี่ยน (ยกเลิกย้อนหลังไม่ต้องคืนยอด) */
var TXN_NO_QTY = ['MOVE'];

// ─────────────────────────────────────────────────────────────────────────────
//  4. Cache / Snapshot
// ─────────────────────────────────────────────────────────────────────────────

/** บัญชีรหัสผ่าน (สำหรับคนที่ไม่มีอีเมล @rmutr.ac.th เช่น นักศึกษา) */
var LOGIN_KINDS       = ['GOOGLE', 'PASSWORD'];
/** เพดานสิทธิ์ของบัญชีรหัสผ่าน — เป็น admin ไม่ได้ เพราะรหัสผ่านหลุดง่ายกว่าบัญชีที่มี 2FA */
var PASSWORD_MAX_ROLE = 'staff';
var PASSWORD_MIN_LEN  = 8;
var PASSWORD_MAX_LEN  = 72;
var HASH_ITERATIONS   = 3000;
var LOGIN_MAX_FAILS   = 5;
var LOGIN_LOCK_SECONDS = 900;    // ล็อก 15 นาทีเมื่อใส่ผิดครบ 5 ครั้ง
var USERS_CACHE_KEY   = 'users_live';
var USERS_CACHE_TTL   = 300;     // 5 นาที — เปลี่ยนสิทธิ์แล้วมีผลช้าสุดเท่านี้ (ล้าง cache ทันทีเมื่อแก้)

var CACHE_CHUNK_SIZE  = 90000;   // ไบต์ต่อ 1 key (ขีดจำกัด CacheService ~100KB)
var CACHE_TTL_SECONDS = 21600;   // 6 ชั่วโมง (ค่าสูงสุดของ CacheService)
var PROP_VERSION_KEY  = 'DATA_VERSION';

// ─────────────────────────────────────────────────────────────────────────────
//  Helper อ่านค่าตั้งต้น
// ─────────────────────────────────────────────────────────────────────────────

function cfg_(key, required) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (required && !v) {
    throw new Error('ยังไม่ได้ตั้งค่า Script Property: ' + key + ' (ดูวิธีใน SETUP.md)');
  }
  return v;
}

function getSpreadsheet_() {
  var id = cfg_('SPREADSHEET_ID', false);
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

// ═════════════════════ Data.gs ═════════════════════
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

// ═════════════════════ Auth.gs ═════════════════════
/**
 * ============================================================================
 *  Auth.gs  —  ยืนยันตัวตนด้วย Google Sign-In
 * ============================================================================
 *
 *  ทำไมต้องออกแบบแบบนี้?
 *  ----------------------
 *  เมื่อหน้าเว็บอยู่บน GitHub Pages ตัว GAS ต้อง deploy เป็น "Anyone" (anonymous)
 *  มิฉะนั้น fetch ข้ามโดเมนจะถูก redirect ไปหน้า login ของ Google แล้วใช้งานไม่ได้
 *  ผลคือ Session.getActiveUser().getEmail() จะคืนค่าว่าง ใช้ยืนยันตัวตนไม่ได้
 *
 *  จึงยืนยันตัวตนเองเป็น 2 จังหวะ:
 *
 *    จังหวะที่ 1 (ตอนล็อกอิน)  — ส่ง Google ID Token มาตรวจกับ Google 1 ครั้ง
 *                                 ตรวจ aud, email_verified และ hd (โดเมนองค์กร)
 *                                 แล้วออก "session token" ของเราเองให้
 *
 *    จังหวะที่ 2 (ทุก request)  — ตรวจ session token ด้วย HMAC-SHA256 ในเครื่อง
 *                                 ไม่ยิงเน็ตออกไปเลย → เร็วและไม่กิน UrlFetch quota
 *
 *  ความปลอดภัย: session token เซ็นด้วย SESSION_SECRET ที่อยู่ใน Script Properties
 *  ซึ่งหน้าเว็บมองไม่เห็น ปลอมแปลงไม่ได้ และมีวันหมดอายุในตัว
 */

var TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo?id_token=';


// ─────────────────────────────────────────────────────────────────────────────
//  ล็อกอิน
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ตรวจ Google ID Token แล้วออก session token
 * @param {string} idToken  JWT จาก Google Identity Services ฝั่งหน้าเว็บ
 * @return {Object} { session, user:{email,name,role}, expiresAt }
 */
function authLogin_(idToken) {
  if (!idToken) throw new AppError('ไม่พบ ID Token', 'NO_TOKEN');

  var clientId = cfg_('OAUTH_CLIENT_ID', true);

  // ── ตรวจ token กับ Google ────────────────────────────────────────────────
  var res = UrlFetchApp.fetch(TOKENINFO_URL + encodeURIComponent(idToken), {
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    throw new AppError('ID Token ไม่ถูกต้องหรือหมดอายุ กรุณาล็อกอินใหม่', 'BAD_TOKEN');
  }

  var info;
  try {
    info = JSON.parse(res.getContentText());
  } catch (e) {
    throw new AppError('อ่านผลตรวจ Token ไม่ได้', 'BAD_TOKEN');
  }

  // ── ตรวจว่า token ออกให้แอปของเราจริง (กัน token จากแอปอื่น) ─────────────
  if (info.aud !== clientId) {
    throw new AppError('Token นี้ไม่ได้ออกให้ระบบนี้', 'WRONG_AUDIENCE');
  }

  // ── ตรวจอีเมลยืนยันแล้ว ──────────────────────────────────────────────────
  if (String(info.email_verified) !== 'true') {
    throw new AppError('อีเมลนี้ยังไม่ได้รับการยืนยันจาก Google', 'EMAIL_UNVERIFIED');
  }

  var email = String(info.email || '').toLowerCase().trim();
  if (!email) throw new AppError('Token ไม่มีอีเมล', 'NO_EMAIL');

  // ── ตรวจโดเมนองค์กร ──────────────────────────────────────────────────────
  var hd     = String(info.hd || '').toLowerCase().trim();
  var suffix = '@' + ALLOWED_DOMAIN.toLowerCase();
  if (hd !== ALLOWED_DOMAIN.toLowerCase() && email.slice(-suffix.length) !== suffix) {
    throw new AppError(
      'ระบบนี้อนุญาตเฉพาะบัญชี @' + ALLOWED_DOMAIN + ' เท่านั้น\n' +
      'คุณกำลังใช้: ' + email,
      'WRONG_DOMAIN'
    );
  }

  // ── ตรวจว่าอยู่ในรายชื่อผู้ใช้ที่ได้รับอนุญาต ────────────────────────────
  var user = findUser_(email);
  if (!user) {
    throw new AppError(
      'บัญชี ' + email + ' ยังไม่ได้รับสิทธิ์ใช้งานระบบ\n' +
      'กรุณาติดต่อผู้ดูแลระบบเพื่อเพิ่มสิทธิ์',
      'NOT_REGISTERED'
    );
  }
  if (String(user.Status).toUpperCase() !== 'ACTIVE') {
    throw new AppError('บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ', 'DISABLED');
  }

  // ── บันทึกการเข้าใช้ ─────────────────────────────────────────────────────
  touchLoginRow_('Email', email);
  audit_(email, 'LOGIN', 'Users', email, { name: info.name || '' });

  if (!user.Name && info.name) user.Name = info.name;
  return makeSessionFor_(user);
}


/**
 * ออก session ให้ผู้ใช้ 1 แถว — ใช้ร่วมกันทั้งบัญชี Google และบัญชีรหัสผ่าน
 *
 *  payload ที่เซ็น: { k:ชนิดบัญชี, u:ตัวระบุ, sv:รุ่นของ session, exp:หมดอายุ }
 *  เก็บแค่ตัวระบุ ไม่เก็บ name/role ลงใน token เพราะสิทธิ์อาจถูกเปลี่ยนภายหลัง
 *  → authVerify_ จะไปอ่านสิทธิ์จริงจากตาราง Users ทุกครั้ง
 */
function makeSessionFor_(user) {
  var kind = String(user.LoginKind || '').toUpperCase() === 'PASSWORD' ? 'PASSWORD' : 'GOOGLE';
  var id   = kind === 'PASSWORD'
           ? normUsername_(user.Username)
           : String(user.Email || '').toLowerCase().trim();
  if (!id) throw new AppError('แถวผู้ใช้ไม่มีตัวระบุบัญชี', 'BAD_USER_ROW');

  var role = String(user.Role || 'viewer').toLowerCase();
  var name = String(user.Name || '').trim() || id.split('@')[0];
  var sv   = parseInt(user.SessionVer, 10) || 1;
  var exp  = Date.now() + SESSION_TTL_HOURS * 3600 * 1000;

  return {
    session:   makeSession_({ k: kind, u: id, sv: sv, exp: exp }),
    user: {
      email:    kind === 'GOOGLE'   ? id : '',
      username: kind === 'PASSWORD' ? id : '',
      kind:     kind,
      name:     name,
      role:     role
    },
    expiresAt: exp
  };
}


// ─────────────────────────────────────────────────────────────────────────────
//  Session token  (payload.signature  — รูปแบบเดียวกับ JWT แต่ใช้ HMAC)
// ─────────────────────────────────────────────────────────────────────────────

function makeSession_(payload) {
  var body = Utilities.base64EncodeWebSafe(JSON.stringify(payload))
                      .replace(/=+$/, '');
  return body + '.' + signBody_(body);
}

function signBody_(body) {
  var secret = cfg_('SESSION_SECRET', true);
  var raw    = Utilities.computeHmacSha256Signature(body, secret);
  return Utilities.base64EncodeWebSafe(raw).replace(/=+$/, '');
}

/**
 * ตรวจ session token → คืน context ของผู้ใช้
 *
 *  ลายเซ็นถูกต้องและยังไม่หมดอายุ "ยังไม่พอ" — ต้องตรวจตาราง Users ซ้ำทุกครั้ง
 *  มิฉะนั้นการปิดบัญชี ลดสิทธิ์ หรือเปลี่ยนรหัสผ่าน จะไม่มีผลจนกว่า session
 *  จะหมดอายุเอง (8 ชั่วโมง) ซึ่งช้าเกินไปเวลาต้องตัดคนออกจากระบบจริง ๆ
 *
 *  การอ่านซ้ำนี้แทบไม่เสียเวลา เพราะตาราง Users ถูก cache ไว้ 5 นาที
 *  และทุกคำสั่งที่เปลี่ยนตาราง Users จะล้าง cache ทันที (dropUsersCache_)
 *
 * @return {Object} { kind, email, username, name, role }
 */
function authVerify_(session) {
  if (!session) throw new AppError('ยังไม่ได้ล็อกอิน', 'NO_SESSION');

  var parts = String(session).split('.');
  if (parts.length !== 2) throw new AppError('Session ไม่ถูกต้อง', 'BAD_SESSION');

  if (signBody_(parts[0]) !== parts[1]) {
    throw new AppError('Session ถูกแก้ไขหรือไม่ถูกต้อง', 'BAD_SIGNATURE');
  }

  var payload;
  try {
    payload = JSON.parse(
      Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString()
    );
  } catch (e) {
    throw new AppError('อ่าน Session ไม่ได้', 'BAD_SESSION');
  }

  if (!payload.exp || Date.now() > payload.exp) {
    throw new AppError('Session หมดอายุ กรุณาล็อกอินใหม่', 'EXPIRED');
  }

  var kind = String(payload.k || 'GOOGLE').toUpperCase();
  if (LOGIN_KINDS.indexOf(kind) === -1) throw new AppError('Session ไม่ถูกต้อง', 'BAD_SESSION');

  var id = String(payload.u || '').trim().toLowerCase();
  if (!id) throw new AppError('Session รุ่นเก่า กรุณาล็อกอินใหม่', 'EXPIRED');

  var live = usersLiveMap_()[kind + ':' + id];
  if (!live) {
    throw new AppError('บัญชีนี้ไม่มีสิทธิ์ใช้งานระบบแล้ว กรุณาติดต่อผู้ดูแลระบบ', 'NOT_REGISTERED');
  }
  if (live.status !== 'ACTIVE') {
    throw new AppError('บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ', 'DISABLED');
  }
  if ((parseInt(payload.sv, 10) || 0) !== live.sv) {
    throw new AppError('ข้อมูลบัญชีถูกเปลี่ยน กรุณาล็อกอินใหม่', 'SESSION_STALE');
  }

  return {
    kind:     kind,
    // ใช้เป็นชื่อผู้ทำรายการในประวัติทุกตาราง — บัญชีรหัสผ่านใช้รูปแบบ user:<ชื่อผู้ใช้>
    email:    kind === 'PASSWORD' ? 'user:' + id : id,
    username: kind === 'PASSWORD' ? id : '',
    name:     live.name,
    role:     live.role
  };
}


// ─────────────────────────────────────────────────────────────────────────────
//  ตาราง Users ฉบับย่อที่ cache ไว้  (ใช้ตรวจทุก request)
// ─────────────────────────────────────────────────────────────────────────────

function usersLiveMap_() {
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) { cache = null; }

  if (cache) {
    var hit = cache.get(USERS_CACHE_KEY);
    if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  }

  var map = {};
  readTable_('USERS').forEach(function (u) {
    var kind = String(u.LoginKind || '').toUpperCase() === 'PASSWORD' ? 'PASSWORD' : 'GOOGLE';
    var id   = kind === 'PASSWORD'
             ? normUsername_(u.Username)
             : String(u.Email || '').trim().toLowerCase();
    if (!id) return;
    map[kind + ':' + id] = {
      name:   String(u.Name || '').trim(),
      role:   String(u.Role || 'viewer').toLowerCase(),
      status: String(u.Status || 'ACTIVE').toUpperCase(),
      sv:     parseInt(u.SessionVer, 10) || 1
    };
  });

  if (cache) { try { cache.put(USERS_CACHE_KEY, JSON.stringify(map), USERS_CACHE_TTL); } catch (e) {} }
  return map;
}

/** ต้องเรียกทุกครั้งที่แก้ตาราง Users ไม่งั้นการเปลี่ยนสิทธิ์จะช้าไป 5 นาที */
function dropUsersCache_() {
  try { CacheService.getScriptCache().remove(USERS_CACHE_KEY); } catch (e) {}
}

/** หาแถวผู้ใช้จาก context — รองรับทั้งบัญชี Google และบัญชีรหัสผ่าน */
function findUserByAny_(ctx) {
  return ctx.kind === 'PASSWORD' ? findUserByUsername_(ctx.username) : findUser_(ctx.email);
}


// ─────────────────────────────────────────────────────────────────────────────
//  ตรวจสิทธิ์
// ─────────────────────────────────────────────────────────────────────────────

/** สิทธิ์ขั้นต่ำที่ต้องมี — admin > staff > viewer */
function requireRole_(ctx, minRole) {
  var have = ROLES.indexOf(String(ctx.role).toLowerCase());
  var need = ROLES.indexOf(minRole);
  if (have === -1 || need === -1 || have > need) {
    throw new AppError('คุณไม่มีสิทธิ์ใช้คำสั่งนี้ (ต้องเป็น ' + minRole + ')', 'FORBIDDEN');
  }
  return true;
}


// ─────────────────────────────────────────────────────────────────────────────
//  อ่าน/เขียนตารางผู้ใช้
// ─────────────────────────────────────────────────────────────────────────────

/** หาแถวบัญชี Google จากอีเมล (ไม่แตะแถวบัญชีรหัสผ่าน ซึ่งช่อง Email ว่าง) */
function findUser_(email) {
  var rows = readTable_('USERS');
  var key  = String(email).toLowerCase().trim();
  if (!key) return null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].LoginKind || '').toUpperCase() === 'PASSWORD') continue;
    if (String(rows[i].Email).toLowerCase().trim() === key) return rows[i];
  }
  return null;
}

// ═════════════════════ Password.gs ═════════════════════
/**
 * ============================================================================
 *  Password.gs  —  บัญชีรหัสผ่าน (ควบคู่กับ Google Sign-In)
 * ============================================================================
 *  ไว้ให้คนที่ไม่มีอีเมล @rmutr.ac.th เช่น นักศึกษาช่วยงาน หรือคนนอกที่มาช่วยนับสต็อก
 *  เป็นคนละบัญชีกับบัญชี Google โดยสิ้นเชิง (คนละแถวในตาราง Users)
 *
 *  ข้อจำกัดโดยตั้งใจ: บัญชีรหัสผ่านเป็น admin ไม่ได้ (PASSWORD_MAX_ROLE)
 *  เพราะรหัสผ่านหลุดง่ายกว่าบัญชีองค์กรที่มี 2FA — การจัดการผู้ใช้และนำเข้าข้อมูล
 *  จึงยังต้องทำจากบัญชี Google เท่านั้น
 *
 *  รหัสผ่านไม่เคยถูกเก็บเป็นข้อความ — เก็บเป็นค่าแฮชที่ถอดกลับไม่ได้
 */

// ─────────────────────────────────────────────────────────────────────────────
//  แฮชรหัสผ่าน
// ─────────────────────────────────────────────────────────────────────────────

function bytesToHex_(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var v = (bytes[i] & 255).toString(16);
    out += v.length === 1 ? '0' + v : v;
  }
  return out;
}

/**
 * ยืดรหัสผ่านด้วยการแฮชซ้ำหลายรอบ (ชะลอการเดารหัสแบบสุ่มไล่)
 * หมายเหตุ: Apps Script ต้องการพารามิเตอร์ชนิดเดียวกันทั้งคู่ — ส่ง byte[] ทั้งสองตัว
 */
function pbkdf_(password, salt, iterations) {
  var key = Utilities.newBlob(password + ':' + salt).getBytes();
  var h = Utilities.computeHmacSha256Signature(Utilities.newBlob(salt).getBytes(), key);
  for (var i = 1; i < iterations; i++) {
    h = Utilities.computeHmacSha256Signature(h, key);
  }
  return bytesToHex_(h);
}

/** คืนค่า "v1$รอบ$salt$hex" — เก็บ salt และจำนวนรอบไว้ในตัวเอง */
function hashPassword_(password) {
  var salt = Utilities.getUuid().replace(/-/g, '');
  return ['v1', HASH_ITERATIONS, salt, pbkdf_(String(password), salt, HASH_ITERATIONS)].join('$');
}

/** เทียบแบบใช้เวลาคงที่ กันการเดาจากเวลาที่ใช้ตอบ */
function safeEqual_(a, b) {
  var x = String(a), y = String(b);
  if (x.length !== y.length) return false;
  var diff = 0;
  for (var i = 0; i < x.length; i++) diff |= (x.charCodeAt(i) ^ y.charCodeAt(i));
  return diff === 0;
}

function verifyPassword_(password, stored) {
  var parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  var iter = parseInt(parts[1], 10);
  if (!iter || iter < 1 || iter > 100000) return false;
  return safeEqual_(pbkdf_(String(password), parts[2], iter), parts[3]);
}

/** แฮชหลอกไว้เทียบตอนไม่พบชื่อผู้ใช้ — เวลาตอบจะได้ไม่ต่างจากตอนพบ */
function dummyHash_() {
  return 'v1$' + HASH_ITERATIONS + '$0000000000000000000000000000000f$' +
         '0000000000000000000000000000000000000000000000000000000000000000';
}

function assertPasswordOk_(password, username) {
  var p = String(password === undefined || password === null ? '' : password);
  if (p.length < PASSWORD_MIN_LEN) {
    throw new AppError('รหัสผ่านต้องยาวอย่างน้อย ' + PASSWORD_MIN_LEN + ' ตัวอักษร', 'WEAK_PASSWORD');
  }
  if (p.length > PASSWORD_MAX_LEN) {
    throw new AppError('รหัสผ่านยาวเกิน ' + PASSWORD_MAX_LEN + ' ตัวอักษร', 'WEAK_PASSWORD');
  }
  if (!/[A-Za-z฀-๿]/.test(p) || !/[0-9]/.test(p)) {
    throw new AppError('รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลข', 'WEAK_PASSWORD');
  }
  if (username && p.toLowerCase() === String(username).toLowerCase()) {
    throw new AppError('รหัสผ่านต้องไม่เหมือนชื่อผู้ใช้', 'WEAK_PASSWORD');
  }
}

/** ชื่อผู้ใช้: a–z ตัวเลข จุด ขีดล่าง ขีดกลาง ยาว 3–30 */
function normUsername_(v) {
  return String(v === undefined || v === null ? '' : v).trim().toLowerCase();
}
function checkUsername_(v) {
  var u = normUsername_(v);
  if (!/^[a-z0-9._-]{3,30}$/.test(u)) {
    throw new AppError('ชื่อผู้ใช้ต้องเป็น a-z ตัวเลข . _ - ยาว 3–30 ตัว', 'BAD_USERNAME');
  }
  return u;
}


// ─────────────────────────────────────────────────────────────────────────────
//  ล็อกกันเดารหัส
// ─────────────────────────────────────────────────────────────────────────────

function assertNotLocked_(username) {
  var cache = CacheService.getScriptCache();
  if (cache.get('lock_' + username)) {
    throw new AppError('ใส่รหัสผ่านผิดหลายครั้ง บัญชีนี้ถูกล็อกชั่วคราว 15 นาที', 'LOCKED');
  }
}
function registerFail_(username) {
  var cache = CacheService.getScriptCache();
  var key = 'fail_' + username;
  var n = (parseInt(cache.get(key), 10) || 0) + 1;
  cache.put(key, String(n), LOGIN_LOCK_SECONDS);
  if (n >= LOGIN_MAX_FAILS) cache.put('lock_' + username, '1', LOGIN_LOCK_SECONDS);
}
function clearFails_(username) {
  CacheService.getScriptCache().removeAll(['fail_' + username, 'lock_' + username]);
}


// ─────────────────────────────────────────────────────────────────────────────
//  ล็อกอินด้วยรหัสผ่าน
// ─────────────────────────────────────────────────────────────────────────────

function findUserByUsername_(username) {
  var u = normUsername_(username);
  if (!u) return null;
  return readTable_('USERS').filter(function (r) {
    return String(r.LoginKind || '').toUpperCase() === 'PASSWORD' && normUsername_(r.Username) === u;
  })[0] || null;
}

/**
 * @param {Object} p { username, password }
 */
function authLoginPassword_(p, ctx) {
  var username = normUsername_(p.username);
  if (!username) throw new AppError('กรุณากรอกชื่อผู้ใช้', 'NO_USERNAME');
  assertNotLocked_(username);

  var user = findUserByUsername_(username);
  var hash = user ? String(user.PassHash || '') : dummyHash_();
  var okPass = verifyPassword_(String(p.password || ''), hash);

  // ข้อความเดียวกันไม่ว่าจะไม่มีชื่อนี้หรือรหัสผิด — ไม่บอกใบ้ว่าชื่อไหนมีอยู่จริง
  if (!user || !okPass) {
    registerFail_(username);
    Utilities.sleep(400);
    throw new AppError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 'BAD_LOGIN');
  }
  // บอกว่าบัญชีถูกปิด ต่อเมื่อรหัสผ่านถูกแล้วเท่านั้น
  if (String(user.Status || '').toUpperCase() !== 'ACTIVE') {
    throw new AppError('บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ', 'DISABLED');
  }

  clearFails_(username);
  touchLoginRow_('Username', username);
  audit_('user:' + username, 'LOGIN_PASSWORD', 'Users', username, null);
  return makeSessionFor_(user);
}

/** เปลี่ยนรหัสผ่านของตัวเอง — ได้ session ใหม่กลับไป เครื่องอื่นหลุดหมด */
function authChangePassword_(p, ctx) {
  if (ctx.kind !== 'PASSWORD') {
    throw new AppError('บัญชี Google เปลี่ยนรหัสผ่านที่นี่ไม่ได้ — รหัสผ่านอยู่กับบัญชี Google ของคุณ', 'NOT_PASSWORD_ACCOUNT');
  }
  var username = normUsername_(ctx.username);
  if (String(p.newPassword) === String(p.oldPassword)) {
    throw new AppError('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม', 'WEAK_PASSWORD');
  }
  assertPasswordOk_(p.newPassword, username);
  assertNotLocked_(username);

  return withLock_(function () {
    var user = findUserByUsername_(username);
    if (!user) throw new AppError('ไม่พบบัญชี', 'NOT_FOUND');

    if (!verifyPassword_(String(p.oldPassword || ''), String(user.PassHash || ''))) {
      registerFail_(username);
      Utilities.sleep(400);
      throw new AppError('รหัสผ่านเดิมไม่ถูกต้อง', 'BAD_LOGIN');
    }
    clearFails_(username);

    var sv = (parseInt(user.SessionVer, 10) || 1) + 1;
    updateRowById_('USERS', 'Username', username, {
      PassHash: hashPassword_(String(p.newPassword)),
      SessionVer: sv,
      PassChangedAt: new Date()
    });
    dropUsersCache_();
    audit_('user:' + username, 'PASSWORD_CHANGE', 'Users', username, null);

    user.SessionVer = sv;
    return makeSessionFor_(user);
  });
}

/** ออกจากระบบทุกเครื่อง (ใช้ได้ทั้งบัญชี Google และบัญชีรหัสผ่าน) */
function authLogoutAll_(p, ctx) {
  return withLock_(function () {
    var idField = ctx.kind === 'PASSWORD' ? 'Username' : 'Email';
    var idValue = ctx.kind === 'PASSWORD' ? normUsername_(ctx.username) : normEmail_(ctx.email);
    var user = findUserByAny_(ctx);
    if (!user) throw new AppError('ไม่พบบัญชี', 'NOT_FOUND');
    updateRowById_('USERS', idField, idValue, {
      SessionVer: (parseInt(user.SessionVer, 10) || 1) + 1
    });
    dropUsersCache_();
    audit_(idValue, 'LOGOUT_ALL', 'Users', idValue, null);
    return { done: true };
  });
}

/** บันทึกเวลาเข้าใช้ล่าสุด (ใช้ได้กับทั้งสองชนิดบัญชี) */
function touchLoginRow_(idField, idValue) {
  try {
    var user = readTable_('USERS').filter(function (r) {
      return String(r[idField] || '').trim().toLowerCase() === String(idValue).trim().toLowerCase();
    })[0];
    if (!user) return;
    updateRowById_('USERS', idField, idValue, {
      LastLogin:  new Date(),
      LoginCount: (parseInt(user.LoginCount, 10) || 0) + 1
    });
    dropUsersCache_();
  } catch (e) { console.warn('บันทึกเวลาเข้าใช้ไม่สำเร็จ: ' + e.message); }
}

// ═════════════════════ Users.gs ═════════════════════
/**
 * ============================================================================
 *  Users.gs  —  จัดการผู้ใช้ (เฉพาะ admin)
 * ============================================================================
 *  มีบัญชี 2 ชนิดในตารางเดียวกัน แยกกันด้วยคอลัมน์ LoginKind:
 *
 *    GOOGLE   — ล็อกอินด้วย Google Sign-In โดเมน @rmutr.ac.th
 *               ระบบไม่เก็บรหัสผ่าน (เป็นหน้าที่ของ Google ทั้งหมด)
 *               ช่อง Email มีค่า / Username ว่าง
 *
 *    PASSWORD — ล็อกอินด้วยชื่อผู้ใช้ + รหัสผ่านที่ admin ตั้งให้
 *               สำหรับคนที่ไม่มีอีเมลองค์กร เช่น นักศึกษาช่วยงาน
 *               ช่อง Username มีค่า / Email ว่าง / เก็บเฉพาะค่าแฮชของรหัสผ่าน
 *               สิทธิ์สูงสุดได้แค่ staff (PASSWORD_MAX_ROLE)
 *
 *  คนหนึ่งคนอาจมีได้ทั้งสองบัญชี แต่เป็น "คนละบัญชี" คนละแถว ไม่ผูกกัน
 */


function usersList_() {
  var rows = readTable_('USERS');
  return {
    users: rows.map(function (u) {
      var kind = String(u.LoginKind || '').toUpperCase() === 'PASSWORD' ? 'PASSWORD' : 'GOOGLE';
      return {
        kind:          kind,
        email:         String(u.Email || '').toLowerCase(),
        username:      kind === 'PASSWORD' ? normUsername_(u.Username) : '',
        name:          u.Name || '',
        role:          String(u.Role || 'viewer').toLowerCase(),
        status:        String(u.Status || 'ACTIVE').toUpperCase(),
        notes:         u.Notes || '',
        addedBy:       u.AddedBy || '',
        addedAt:       isoSafe_(u.AddedAt) || '',
        lastLogin:     isoSafe_(u.LastLogin) || '',
        loginCount:    parseInt(u.LoginCount, 10) || 0,
        passChangedAt: isoSafe_(u.PassChangedAt) || ''
      };
    })
  };
}


// ─────────────────────────────────────────────────────────────────────────────
//  ชี้ตัวผู้ใช้  — รับ email (บัญชี Google) หรือ username (บัญชีรหัสผ่าน)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @return {Object} { kind, idField, idValue, label }
 */
function userRef_(p) {
  var hasUser  = p.username !== undefined && String(p.username).trim() !== '';
  var hasEmail = p.email    !== undefined && String(p.email).trim()    !== '';

  if (hasUser && hasEmail) {
    throw new AppError('ระบุได้อย่างใดอย่างหนึ่ง: อีเมล หรือ ชื่อผู้ใช้', 'AMBIGUOUS_USER');
  }
  if (hasUser) {
    var u = checkUsername_(p.username);
    return { kind: 'PASSWORD', idField: 'Username', idValue: u, label: u };
  }
  var e = normEmail_(p.email);
  return { kind: 'GOOGLE', idField: 'Email', idValue: e, label: e };
}

function findUserRef_(ref) {
  return ref.kind === 'PASSWORD' ? findUserByUsername_(ref.idValue) : findUser_(ref.idValue);
}

/** บัญชีรหัสผ่านเป็น admin ไม่ได้ — รหัสผ่านหลุดง่ายกว่าบัญชีองค์กรที่มี 2FA */
function assertRoleAllowed_(kind, role) {
  if (ROLES.indexOf(role) === -1) throw new AppError('สิทธิ์ไม่ถูกต้อง: ' + role, 'BAD_ROLE');
  if (kind === 'PASSWORD' && ROLES.indexOf(role) < ROLES.indexOf(PASSWORD_MAX_ROLE)) {
    throw new AppError(
      'บัญชีรหัสผ่านตั้งสิทธิ์ได้สูงสุด ' + PASSWORD_MAX_ROLE + ' เท่านั้น\n' +
      'ถ้าต้องการสิทธิ์ผู้ดูแลระบบ ให้ใช้บัญชี Google โดเมน @' + ALLOWED_DOMAIN,
      'ROLE_TOO_HIGH'
    );
  }
  return role;
}


// ─────────────────────────────────────────────────────────────────────────────
//  เพิ่ม / แก้ไข / ระงับ
// ─────────────────────────────────────────────────────────────────────────────

function usersAdd_(p, ctx) {
  var kind = String(p.kind || '').toUpperCase() === 'PASSWORD' ? 'PASSWORD' : 'GOOGLE';
  var name = String(p.name || '').trim();
  var role = String(p.role || 'staff').toLowerCase().trim();

  if (!name) throw new AppError('กรุณากรอกชื่อ-นามสกุล', 'NO_NAME');
  assertRoleAllowed_(kind, role);

  var row = {
    Name: name, Role: role, Status: 'ACTIVE',
    Notes: String(p.notes || '').trim(),
    AddedBy: ctx.email, AddedAt: new Date(),
    LastLogin: '', LoginCount: 0,
    LoginKind: kind, SessionVer: 1
  };

  var label;
  if (kind === 'PASSWORD') {
    var username = checkUsername_(p.username);
    assertPasswordOk_(p.password, username);
    row.Email         = '';
    row.Username      = username;
    row.PassHash      = hashPassword_(String(p.password));
    row.PassChangedAt = new Date();
    label = username;
  } else {
    var email = normEmail_(p.email);
    assertDomain_(email);
    row.Email         = email;
    row.Username      = '';
    row.PassHash      = '';
    row.PassChangedAt = '';
    label = email;
  }

  return withLock_(function () {
    if (kind === 'PASSWORD') {
      if (findUserByUsername_(label)) {
        throw new AppError('ชื่อผู้ใช้ ' + label + ' ถูกใช้แล้ว', 'DUPLICATE');
      }
    } else if (findUser_(label)) {
      throw new AppError('อีเมล ' + label + ' มีอยู่ในระบบแล้ว', 'DUPLICATE');
    }

    appendRows_('USERS', [row]);
    dropUsersCache_();
    audit_(ctx.email, 'USER_ADD', 'Users', label, { name: name, role: role, kind: kind });

    return {
      kind: kind, email: row.Email, username: row.Username,
      name: name, role: role, status: 'ACTIVE'
    };
  });
}


function usersUpdate_(p, ctx) {
  var ref   = userRef_(p);
  var patch = {};

  if (p.name !== undefined) {
    var name = String(p.name).trim();
    if (!name) throw new AppError('ชื่อว่างไม่ได้', 'NO_NAME');
    patch.Name = name;
  }

  if (p.role !== undefined) {
    patch.Role = assertRoleAllowed_(ref.kind, String(p.role).toLowerCase().trim());
  }

  if (p.notes !== undefined) patch.Notes = String(p.notes).trim();

  if (!Object.keys(patch).length) throw new AppError('ไม่มีข้อมูลที่จะแก้ไข', 'NO_CHANGE');

  return withLock_(function () {
    var target = findUserRef_(ref);
    if (!target) throw new AppError('ไม่พบผู้ใช้ ' + ref.label, 'NOT_FOUND');

    // กันไม่ให้ admin คนสุดท้ายถอดสิทธิ์ตัวเอง → ระบบจะไม่มีใครดูแลได้อีก
    if (patch.Role && patch.Role !== 'admin' &&
        String(target.Role).toLowerCase() === 'admin') {
      assertNotLastAdmin_(ref.idValue);
    }

    // เปลี่ยนสิทธิ์แล้วต้องตัด session เดิมทุกเครื่อง ไม่งั้นสิทธิ์เก่ายังใช้ได้
    if (patch.Role && patch.Role !== String(target.Role).toLowerCase()) {
      patch.SessionVer = (parseInt(target.SessionVer, 10) || 1) + 1;
    }

    updateRowById_('USERS', ref.idField, ref.idValue, patch);
    dropUsersCache_();
    audit_(ctx.email, 'USER_UPDATE', 'Users', ref.label, patch);
    return { kind: ref.kind, id: ref.label, updated: Object.keys(patch) };
  });
}


function usersSetStatus_(p, ctx) {
  var ref    = userRef_(p);
  var status = String(p.status || '').toUpperCase().trim();

  if (['ACTIVE', 'DISABLED'].indexOf(status) === -1) {
    throw new AppError('สถานะต้องเป็น ACTIVE หรือ DISABLED', 'BAD_STATUS');
  }
  if (status === 'DISABLED' &&
      ref.idValue === (ref.kind === 'PASSWORD' ? ctx.username : ctx.email)) {
    throw new AppError('ไม่สามารถระงับบัญชีของตัวเองได้', 'SELF_DISABLE');
  }

  return withLock_(function () {
    var target = findUserRef_(ref);
    if (!target) throw new AppError('ไม่พบผู้ใช้ ' + ref.label, 'NOT_FOUND');

    if (status === 'DISABLED' && String(target.Role).toLowerCase() === 'admin') {
      assertNotLastAdmin_(ref.idValue);
    }

    var patch = { Status: status };
    // ระงับบัญชีแล้วต้องเตะออกทันที — ไม่รอ session หมดอายุเอง
    if (status === 'DISABLED') {
      patch.SessionVer = (parseInt(target.SessionVer, 10) || 1) + 1;
    }

    updateRowById_('USERS', ref.idField, ref.idValue, patch);
    dropUsersCache_();
    audit_(ctx.email, 'USER_STATUS', 'Users', ref.label, { status: status });
    return { kind: ref.kind, id: ref.label, status: status };
  });
}


/**
 * admin ตั้งรหัสผ่านใหม่ให้บัญชีรหัสผ่าน (ใช้เวลาผู้ใช้ลืมรหัส)
 * ผลข้างเคียงโดยตั้งใจ: บัญชีนั้นหลุดจากระบบทุกเครื่องทันที และปลดล็อกการเดารหัส
 */
function usersResetPassword_(p, ctx) {
  var username = checkUsername_(p.username);
  assertPasswordOk_(p.password, username);

  return withLock_(function () {
    var target = findUserByUsername_(username);
    if (!target) throw new AppError('ไม่พบบัญชีรหัสผ่าน ' + username, 'NOT_FOUND');

    updateRowById_('USERS', 'Username', username, {
      PassHash:      hashPassword_(String(p.password)),
      SessionVer:    (parseInt(target.SessionVer, 10) || 1) + 1,
      PassChangedAt: new Date()
    });
    dropUsersCache_();
    clearFails_(username);
    audit_(ctx.email, 'USER_PASSWORD_RESET', 'Users', username, null);
    return { username: username, done: true };
  });
}


// ─────────────────────────────────────────────────────────────────────────────
//  ตัวช่วยตรวจความถูกต้อง
// ─────────────────────────────────────────────────────────────────────────────

function normEmail_(v) {
  var e = String(v || '').toLowerCase().trim();
  if (!e) throw new AppError('กรุณากรอกอีเมล', 'NO_EMAIL');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    throw new AppError('รูปแบบอีเมลไม่ถูกต้อง: ' + e, 'BAD_EMAIL');
  }
  return e;
}

function assertDomain_(email) {
  var suffix = '@' + ALLOWED_DOMAIN.toLowerCase();
  if (email.slice(-suffix.length) !== suffix) {
    throw new AppError(
      'ระบบอนุญาตเฉพาะอีเมลโดเมน ' + suffix + ' เท่านั้น\n' +
      '(หากต้องการเปิดให้โดเมนอื่น แก้ค่า ALLOWED_DOMAIN ใน Config.gs)',
      'WRONG_DOMAIN'
    );
  }
}

/** ต้องมี admin ที่ ACTIVE เหลืออยู่อย่างน้อย 1 คนเสมอ */
function assertNotLastAdmin_(emailBeingChanged) {
  var others = readTable_('USERS').filter(function (u) {
    return String(u.Role).toLowerCase() === 'admin'
        && String(u.Status).toUpperCase() === 'ACTIVE'
        && String(u.Email).toLowerCase().trim() !== emailBeingChanged;
  });
  if (!others.length) {
    throw new AppError(
      'นี่คือผู้ดูแลระบบ (admin) คนสุดท้ายที่ใช้งานได้ — ' +
      'กรุณาตั้งผู้ดูแลระบบคนอื่นก่อนจึงจะเปลี่ยนบัญชีนี้ได้',
      'LAST_ADMIN'
    );
  }
}

// ═════════════════════ Inventory.gs ═════════════════════
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
  var byType = {};
  byType[type] = values;
  return addSettingsBatch_(byType, actor)[type];
}

/**
 * เหมือน addSettingsIfMissing_ แต่ทำหลายชนิดในครั้งเดียว: อ่านชีตตัวเลือก 1 ครั้ง เขียน 1 ครั้ง
 * เดิมการรับเข้า 1 ครั้งเรียกทีละชนิด → อ่านทั้งชีตซ้ำได้ถึง 8 รอบ ซึ่งเป็นส่วนหนึ่งที่ทำให้กดบันทึกช้า
 * ⚠️ ต้องเรียกอยู่ภายใน withLock_
 * @param {Object} byType { Type: [values] }
 * @return {Object} { Type: [ค่าที่ถูกเพิ่มจริง] }
 */
function addSettingsBatch_(byType, actor) {
  var types = Object.keys(byType || {});
  var out = {};
  types.forEach(function (t) { out[t] = []; });

  // ไม่มีค่าอะไรให้เพิ่มเลย → ไม่ต้องอ่านชีต
  var any = types.some(function (t) {
    return (byType[t] || []).some(function (v) { return String(v || '').trim() !== ''; });
  });
  if (!any) return out;

  var existing = {}, maxSort = {};
  readTable_('SETTINGS').forEach(function (r) {
    var t = String(r.Type).trim();
    if (!out.hasOwnProperty(t)) return;
    existing[t + '\u0001' + String(r.Value).trim().toLowerCase()] = true;
    var s = parseInt(r.Sort, 10) || 0;
    if (s > (maxSort[t] || 0)) maxSort[t] = s;
  });

  var rows = [];
  types.forEach(function (t) {
    (byType[t] || []).forEach(function (v) {
      var value = String(v || '').trim();
      if (!value) return;
      var key = t + '\u0001' + value.toLowerCase();
      if (existing[key]) return;
      existing[key] = true;
      out[t].push(value);
      rows.push({
        Type: t, Value: value, Sort: (maxSort[t] || 0) + out[t].length, Active: true,
        CreatedBy: actor || 'SYSTEM', CreatedAt: new Date()
      });
    });
  });

  if (rows.length) appendRows_('SETTINGS', rows);
  return out;
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

// ═════════════════════ Catalog.gs ═════════════════════
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
  addSettingsBatch_({
    Function: [f.Function], State: [f.State], Unit: [f.Unit], Supplier: [f.DefaultSupplier]
  }, actor);
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
    }, ctx.email, {});   // ล็อตเพิ่งสร้าง ยอดก่อนรับเข้า = 0 แน่นอน ไม่ต้องอ่านบัญชีทั้งชีตมาคำนวณ
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
  addSettingsBatch_({
    Room: [f.Room], Shelf: [f.Shelf], Supplier: [f.Supplier], FiscalYear: [f.FiscalYear]
  }, actor);
}

// ═════════════════════ Places.gs ═════════════════════
/**
 * ============================================================================
 *  Places.gs  —  ที่เก็บแบบลำดับชั้น: ห้อง → ตู้/โต๊ะ → ชั้น → กล่อง
 * ============================================================================
 *  ปุ่มบนรูป: แต่ละที่เก็บวาง "ปุ่ม" ทับบนรูปของที่เก็บแม่ได้ โดยเก็บตำแหน่ง
 *  เป็นสัดส่วน 0–1 ของรูป (X, Y, W, H) ปุ่มจึงอยู่ตรงเสมอไม่ว่าจอจะกว้างเท่าไร
 *
 *  ความเข้ากันได้กับข้อมูลเดิม: คอลัมน์ Room / Shelf ที่เป็นข้อความบนตาราง Lots
 *  ยังอยู่ครบและถูกเขียนให้ตรงกับที่เก็บใหม่เสมอ รายงานและ CSV เดิมจึงใช้ได้ต่อ
 */

/** ที่เก็บทั้งหมดที่ยังไม่ถูกลบ */
function activePlaces_() {
  return readTable_('PLACES').filter(function (p) {
    return String(p.PlaceID || '') !== '' && String(p.Status || 'ACTIVE').toUpperCase() !== 'DELETED';
  });
}

/** รหัสของลูกหลานทุกชั้นของ id */
function descendantPlaceIds_(places, id) {
  var out = [], stack = [String(id)];
  while (stack.length) {
    var cur = stack.pop();
    places.forEach(function (p) {
      if (String(p.ParentID) === cur) { out.push(String(p.PlaceID)); stack.push(String(p.PlaceID)); }
    });
  }
  return out;
}

/** เส้นทางจากบนลงล่าง เช่น ["Room 101", "ตู้ A", "ชั้น 2"] */
function placePath_(places, id) {
  var byId = {};
  places.forEach(function (p) { byId[String(p.PlaceID)] = p; });
  var out = [], cur = byId[String(id)], guard = 0;
  while (cur && guard++ < 10) {
    out.unshift(String(cur.Name));
    cur = cur.ParentID ? byId[String(cur.ParentID)] : null;
  }
  return out;
}

/**
 * ตรวจและปัดเศษตำแหน่งปุ่ม {x,y,w,h} (สัดส่วน 0–1)
 * @return {Object} { X, Y, W, H }
 */
function parseZone_(g) {
  var x = Number(g.x), y = Number(g.y), w = Number(g.w), h = Number(g.h);
  if ([x, y, w, h].some(function (n) { return isNaN(n) || !isFinite(n); })) {
    throw new AppError('ตำแหน่งปุ่มไม่ถูกต้อง', 'BAD_ZONE');
  }
  if (w < MIN_ZONE_SIZE || h < MIN_ZONE_SIZE) throw new AppError('ปุ่มเล็กเกินไป', 'BAD_ZONE');
  if (x < -0.0001 || y < -0.0001 || x + w > 1.0001 || y + h > 1.0001) {
    throw new AppError('ปุ่มต้องอยู่ภายในกรอบรูป', 'BAD_ZONE');
  }
  function r5(n) { return Math.round(Math.max(0, n) * 100000) / 100000; }
  return { X: r5(x), Y: r5(y), W: r5(w), H: r5(h) };
}

function parsePlaceColor_(v) {
  var t = s_(v, 9);
  if (!t) return '';
  if (!/^#[0-9a-fA-F]{6}$/.test(t)) throw new AppError('รูปแบบสีไม่ถูกต้อง (ต้องเป็น #rrggbb)', 'BAD_COLOR');
  return t.toLowerCase();
}

/** ชื่อที่เก็บห้ามซ้ำกันภายใต้พ่อเดียวกัน (กันสับสนเวลามองหาของ) */
function assertPlaceNameFree_(places, parentId, name, exceptId) {
  var key = String(name).toLowerCase();
  places.forEach(function (p) {
    if (exceptId && String(p.PlaceID) === String(exceptId)) return;
    if (String(p.ParentID || '') !== String(parentId || '')) return;
    if (String(p.Name).toLowerCase() === key) {
      throw new AppError('มีที่เก็บชื่อ "' + name + '" อยู่แล้วในระดับเดียวกัน', 'DUPLICATE_PLACE');
    }
  });
}

/**
 * สร้างหรือแก้ไขที่เก็บ
 * @param {Object} p { placeId?, parentId?, kind?, name, color?, notes?, zone? }
 *                   zone = {x,y,w,h} วางปุ่มบนรูปแม่ · zone = null เอาปุ่มออก
 */
function placeSave_(p, ctx) {
  var id = s_(p.placeId, 20);

  return withLock_(function () {
    var places = activePlaces_();
    var byId = {};
    places.forEach(function (x) { byId[String(x.PlaceID)] = x; });

    var cur = id ? byId[id] : null;
    if (id && !cur) throw new AppError('ไม่พบที่เก็บ ' + id, 'NOT_FOUND');

    var parentId = p.parentId !== undefined ? s_(p.parentId, 20) : (cur ? String(cur.ParentID || '') : '');
    var parent   = parentId ? byId[parentId] : null;
    if (parentId && !parent) throw new AppError('ไม่พบที่เก็บแม่ ' + parentId, 'NOT_FOUND');

    var name = p.name !== undefined ? s_(p.name, 80) : (cur ? String(cur.Name) : '');
    if (!name) throw new AppError('กรุณากรอกชื่อที่เก็บ', 'NO_NAME');

    var kind;
    if (p.kind !== undefined && p.kind !== '') kind = String(p.kind).toUpperCase();
    else if (cur) kind = String(cur.Kind).toUpperCase();
    else kind = parent ? PLACE_KINDS[Math.min(placeRank_(parent.Kind) + 1, PLACE_KINDS.length - 1)] : 'ROOM';
    if (placeRank_(kind) === -1) throw new AppError('ชนิดที่เก็บไม่ถูกต้อง: ' + kind, 'BAD_KIND');

    // ── กฎลำดับชั้น ───────────────────────────────────────────────────────
    if (parent && placeRank_(kind) <= placeRank_(parent.Kind)) {
      throw new AppError('"' + kind + '" ต้องอยู่ลึกกว่า ' + parent.Kind + ' (ห้อง → ตู้ → ชั้น → กล่อง)', 'BAD_HIERARCHY');
    }
    if (cur) {
      if (parentId === String(cur.PlaceID) ||
          descendantPlaceIds_(places, cur.PlaceID).indexOf(parentId) !== -1) {
        throw new AppError('ย้ายที่เก็บเข้าไปอยู่ในตัวเองหรือลูกของตัวเองไม่ได้', 'BAD_HIERARCHY');
      }
      places.forEach(function (c) {
        if (String(c.ParentID) === String(cur.PlaceID) && placeRank_(c.Kind) <= placeRank_(kind)) {
          throw new AppError('เปลี่ยนชนิดไม่ได้ เพราะที่เก็บข้างในต้องลึกกว่า', 'BAD_HIERARCHY');
        }
      });
    }

    assertPlaceNameFree_(places, parentId, name, cur ? cur.PlaceID : null);

    var now = new Date();
    var row = {
      Kind: kind, Name: name, ParentID: parentId,
      Notes: p.notes !== undefined ? t_(p.notes, 500) : (cur ? cur.Notes : ''),
      Color: p.color !== undefined ? parsePlaceColor_(p.color) : (cur ? cur.Color : ''),
      UpdatedBy: ctx.email, UpdatedAt: now
    };

    // ── ตำแหน่งปุ่มบนรูปของแม่ ────────────────────────────────────────────
    var parentChanged = cur && String(cur.ParentID || '') !== parentId;
    if (p.zone === null) {
      row.X = ''; row.Y = ''; row.W = ''; row.H = '';
    } else if (p.zone) {
      if (!parent) throw new AppError('ปุ่มต้องวางบนรูปของที่เก็บแม่ — ที่เก็บระดับบนสุดไม่มีรูปให้วาง', 'BAD_ZONE');
      var z = parseZone_(p.zone);
      row.X = z.X; row.Y = z.Y; row.W = z.W; row.H = z.H;
    } else if (parentChanged) {
      row.X = ''; row.Y = ''; row.W = ''; row.H = '';   // ย้ายแม่ → ตำแหน่งเดิมใช้ไม่ได้
    }

    if (!cur) {
      var maxSort = 0;
      places.forEach(function (x) {
        if (String(x.ParentID || '') === parentId) maxSort = Math.max(maxSort, parseInt(x.Sort, 10) || 0);
      });
      row.PlaceID   = newPlaceId_();
      row.Sort      = maxSort + 1;
      row.Status    = 'ACTIVE';
      row.CreatedBy = ctx.email; row.CreatedAt = now;
      appendRows_('PLACES', [row]);
      audit_(ctx.email, 'PLACE_ADD', 'Places', row.PlaceID, { name: name, kind: kind, parent: parentId });
      return { placeId: row.PlaceID, name: name, kind: kind };
    }

    updateRowById_('PLACES', 'PlaceID', cur.PlaceID, row);
    // ชื่อหรือที่อยู่เปลี่ยน → ข้อความ Room/Shelf บนล็อตที่อยู่ข้างในต้องตามไปด้วย
    syncLotPlaceText_(String(cur.PlaceID), ctx.email);
    audit_(ctx.email, 'PLACE_UPDATE', 'Places', cur.PlaceID, { name: name });
    return { placeId: String(cur.PlaceID), name: name, kind: kind };
  });
}

/** ลบที่เก็บ — ต้องไม่มีที่เก็บข้างในและไม่มีของค้างอยู่ */
function placeDelete_(p, ctx) {
  var id = s_(p.placeId, 20);

  return withLock_(function () {
    var places = activePlaces_();
    var cur = places.filter(function (x) { return String(x.PlaceID) === id; })[0];
    if (!cur) throw new AppError('ไม่พบที่เก็บ ' + id, 'NOT_FOUND');

    var kids = places.filter(function (x) { return String(x.ParentID) === id; });
    if (kids.length) {
      throw new AppError('"' + cur.Name + '" ยังมีที่เก็บข้างใน ' + kids.length +
        ' แห่ง (เช่น ' + kids[0].Name + ') — ลบหรือย้ายออกก่อน', 'NOT_EMPTY');
    }

    var held = readTable_('LOTS').filter(function (l) {
      return String(l.PlaceID) === id && String(l.Status || 'ACTIVE').toUpperCase() === 'ACTIVE';
    });
    if (held.length) {
      throw new AppError('"' + cur.Name + '" ยังมีของอยู่ ' + held.length +
        ' ล็อต — ย้ายของออกก่อนจึงจะลบได้', 'NOT_EMPTY');
    }

    photosTrashFor_('PLACE', id);
    updateRowById_('PLACES', 'PlaceID', id, {
      Status: 'DELETED', UpdatedBy: ctx.email, UpdatedAt: new Date()
    });
    audit_(ctx.email, 'PLACE_DELETE', 'Places', id, { name: cur.Name });
    return { placeId: id, deleted: true };
  });
}


// ─────────────────────────────────────────────────────────────────────────────
//  ย้ายที่เก็บของล็อต
// ─────────────────────────────────────────────────────────────────────────────

/**
 * เขียนข้อความ Room / Shelf บนล็อตให้ตรงกับที่เก็บใหม่
 * Room = ที่เก็บระดับบนสุด · Shelf = เส้นทางที่เหลือ เช่น "ตู้ A › ชั้น 2"
 */
function placeTextFor_(places, placeId) {
  var path = placePath_(places, placeId);
  if (!path.length) return { Room: '', Shelf: '' };
  return { Room: path[0], Shelf: path.slice(1).join(' › ') };
}

/** ล็อตทุกตัวที่อยู่ใน placeId หรือข้างใน — อัปเดตข้อความ Room/Shelf ให้ตรง */
function syncLotPlaceText_(placeId, actor) {
  var places = activePlaces_();
  var ids = [String(placeId)].concat(descendantPlaceIds_(places, placeId));
  var want = {};
  ids.forEach(function (id) { want[id] = placeTextFor_(places, id); });

  var patches = {};
  readTable_('LOTS').forEach(function (l) {
    var pid = String(l.PlaceID || '');
    if (!want[pid]) return;
    var w = want[pid];
    if (String(l.Room || '') === w.Room && String(l.Shelf || '') === w.Shelf) return;
    patches[String(l.LotID)] = { Room: w.Room, Shelf: w.Shelf, UpdatedBy: actor, UpdatedAt: new Date() };
  });

  var n = Object.keys(patches).length;
  if (n) patchRowsById_('LOTS', 'LotID', patches);
  return n;
}

/**
 * ย้ายล็อตไปที่เก็บอื่น — รองรับหลายล็อตพร้อมกัน
 * บันทึกเป็นรายการ MOVE ในบัญชีเดินสะพัด (จำนวน 0 ไม่กระทบยอด)
 * @param {Object} p { lotIds:[...] หรือ lotId, toPlaceId, person?, notes? }
 */
function lotMove_(p, ctx) {
  var ids = Array.isArray(p.lotIds) ? p.lotIds : [p.lotId];
  ids = ids.map(function (x) { return s_(x, 30); }).filter(Boolean);
  if (!ids.length) throw new AppError('กรุณาเลือกล็อตอย่างน้อย 1 รายการ', 'NO_SELECTION');

  var toPlaceId = s_(p.toPlaceId, 20);
  if (!toPlaceId) throw new AppError('กรุณาเลือกที่เก็บปลายทาง', 'NO_PLACE');

  return withLock_(function () {
    var places = activePlaces_();
    var dest = places.filter(function (x) { return String(x.PlaceID) === toPlaceId; })[0];
    if (!dest) throw new AppError('ไม่พบที่เก็บปลายทาง ' + toPlaceId, 'NOT_FOUND');

    var lots = readTable_('LOTS');
    var byId = {};
    lots.forEach(function (l) {
      byId[String(l.LotID).toLowerCase()] = l;
      var code = String(l.LegacyCode || '').trim().toLowerCase();
      if (code && !byId[code]) byId[code] = l;
    });

    var text = placeTextFor_(places, toPlaceId);
    var now = new Date();
    var patches = {}, moves = [], moved = 0, skipped = 0;

    ids.forEach(function (raw) {
      var lot = byId[raw.toLowerCase()];
      if (!lot) { skipped++; return; }
      var fromId = String(lot.PlaceID || '');
      if (fromId === toPlaceId) { skipped++; return; }   // อยู่ที่นั่นอยู่แล้ว

      patches[String(lot.LotID)] = {
        PlaceID: toPlaceId, Room: text.Room, Shelf: text.Shelf,
        UpdatedBy: ctx.email, UpdatedAt: now
      };
      moves.push({
        TxnID:        '',                 // เติมทีหลังพร้อมกันทีเดียว
        LotID:        String(lot.LotID),
        MaterialID:   String(lot.MaterialID || ''),
        Type:         'MOVE',
        Qty:          0,
        BalanceAfter: 0,                  // เติมทีหลังจากยอดจริง
        Person:       s_(p.person, 80) || ctx.name || ctx.email,
        Purpose:      'ย้ายที่เก็บ',
        RefDoc:       '',
        TxnAt:        now,
        Status:       'ACTIVE',
        CancelOf:     '',
        Notes:        [placePath_(places, fromId).join(' › ') || 'ไม่ระบุที่เก็บ',
                       '→', placePath_(places, toPlaceId).join(' › '),
                       s_(p.notes, 200)].filter(Boolean).join(' '),
        RecordedBy:   ctx.email,
        RecordedAt:   now
      });
      moved++;
    });

    if (!moved) throw new AppError('ไม่มีล็อตที่ต้องย้าย (อาจอยู่ที่เก็บปลายทางอยู่แล้ว)', 'NOTHING');

    var balances = computeBalances_();
    var txnIds = reserveTxnIds_(moves.length);
    moves.forEach(function (m, i) {
      m.TxnID = txnIds[i];
      m.BalanceAfter = balances[m.LotID] || 0;
    });

    patchRowsById_('LOTS', 'LotID', patches);
    appendRows_('TRANSACTIONS', moves);
    audit_(ctx.email, 'LOT_MOVE', 'Lots', toPlaceId, { moved: moved, skipped: skipped });

    return { moved: moved, skipped: skipped, toPlaceId: toPlaceId, path: placePath_(places, toPlaceId) };
  });
}

/** จองรหัสรายการหลายตัวรวดเดียว (เลี่ยงการอ่านชีตซ้ำทีละแถว) */
function reserveTxnIds_(count) {
  var start = reserveSeq_('TXN', 'TRANSACTIONS', 'TxnID', 'TXN-', count);
  var out = [];
  for (var i = 0; i < count; i++) out.push('TXN-' + pad_(start + i, 8));
  return out;
}

// ═════════════════════ Photos.gs ═════════════════════
/**
 * ============================================================================
 *  Photos.gs  —  รูปภาพของที่เก็บ / สาร / ล็อต (เก็บไฟล์จริงใน Google Drive)
 * ============================================================================
 *  หน้าเว็บย่อรูปให้เล็กก่อนส่งมาแล้ว (ดู docs/js/photo.js) ที่นี่จึงรับ base64
 *  ตรวจชนิดไฟล์จาก "ไบต์หัวไฟล์" ไม่เชื่อนามสกุลหรือ MIME ที่เบราว์เซอร์แจ้งมา
 *
 *  ข้อแลกเปลี่ยน: ไฟล์ถูกตั้งเป็น "ทุกคนที่มีลิงก์ดูได้" เพื่อให้หน้าเว็บแสดงรูปได้
 *  ลิงก์เดาไม่ได้ แต่ใครได้รับลิงก์ก็เปิดรูปนั้นได้ — อย่าถ่ายรูปเอกสารสำคัญ
 */

/** โฟลเดอร์เก็บรูป (จำ ID ไว้ใน Script Properties ครั้งแรก) */
function photoFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); }
    catch (e) { /* โฟลเดอร์ถูกลบ — สร้างใหม่ด้านล่าง */ }
  }
  var folder = DriveApp.createFolder(PHOTO_FOLDER_NAME);
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

/** ตรวจชนิดรูปจากไบต์หัวไฟล์ → { mime, ext } หรือ null ถ้าไม่ใช่รูปที่รองรับ */
function sniffImage_(bytes) {
  function at(i) { return bytes[i] & 255; }
  if (bytes.length > 3 && at(0) === 0xFF && at(1) === 0xD8 && at(2) === 0xFF) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (bytes.length > 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4E && at(3) === 0x47) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (bytes.length > 12 && at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
      at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

function activePhotosOf_(ownerType, ownerId) {
  return readTable_('PHOTOS').filter(function (ph) {
    return String(ph.OwnerType) === ownerType && String(ph.OwnerID) === String(ownerId) &&
           String(ph.Status || 'ACTIVE').toUpperCase() !== 'DELETED';
  });
}

function assertPhotoOwnerExists_(ownerType, ownerId) {
  var map = { PLACE: ['PLACES', 'PlaceID'], MATERIAL: ['MATERIALS', 'MaterialID'], LOT: ['LOTS', 'LotID'] };
  var spec = map[ownerType];
  var hit = readTable_(spec[0]).filter(function (r) {
    return String(r[spec[1]]) === String(ownerId) && String(r.Status || 'ACTIVE').toUpperCase() !== 'DELETED';
  })[0];
  if (!hit) throw new AppError('ไม่พบรายการที่จะแนบรูป: ' + ownerId, 'NOT_FOUND');
}

/**
 * อัปโหลดรูป
 * @param {Object} p { ownerType, ownerId, data (base64), width?, height?, caption? }
 */
function photoUpload_(p, ctx) {
  var ownerType = String(p.ownerType || '').toUpperCase();
  var ownerId   = s_(p.ownerId, 20);
  if (PHOTO_OWNERS.indexOf(ownerType) === -1) throw new AppError('ชนิดเจ้าของรูปไม่ถูกต้อง', 'BAD_OWNER');
  assertPhotoOwnerExists_(ownerType, ownerId);

  var b64 = String(p.data || '').replace(/^data:[^;]*;base64,/, '').replace(/\s+/g, '');
  if (!b64) throw new AppError('ไม่พบข้อมูลรูป', 'NO_DATA');
  if (b64.length > MAX_PHOTO_BYTES * 1.4) throw new AppError('รูปใหญ่เกินไป (เกิน 3.5 MB หลังย่อ)', 'TOO_BIG');

  var bytes;
  try { bytes = Utilities.base64Decode(b64); }
  catch (e) { throw new AppError('ข้อมูลรูปไม่ถูกต้อง', 'BAD_IMAGE'); }
  if (bytes.length > MAX_PHOTO_BYTES) throw new AppError('รูปใหญ่เกินไป (เกิน 3.5 MB หลังย่อ)', 'TOO_BIG');

  var kind = sniffImage_(bytes);
  if (!kind) throw new AppError('รองรับเฉพาะไฟล์ภาพ JPEG / PNG / WebP', 'BAD_IMAGE');

  if (activePhotosOf_(ownerType, ownerId).length >= MAX_PHOTOS_PER_OWNER) {
    throw new AppError('แนบรูปได้สูงสุด ' + MAX_PHOTOS_PER_OWNER + ' รูปต่อรายการ', 'PHOTO_LIMIT');
  }

  // อัปโหลดขึ้น Drive ก่อนเข้าล็อก (ขั้นนี้ช้า ไม่ควรให้คนอื่นรอ)
  var file = photoFolder_().createFile(
    Utilities.newBlob(bytes, kind.mime, ownerType + '_' + ownerId + '_' + Date.now() + '.' + kind.ext));
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
  catch (e) { /* โฟลเดอร์อาจแชร์ไว้แล้ว */ }

  try {
    return withLock_(function () {
      var existing = activePhotosOf_(ownerType, ownerId);
      if (existing.length >= MAX_PHOTOS_PER_OWNER) {
        throw new AppError('แนบรูปได้สูงสุด ' + MAX_PHOTOS_PER_OWNER + ' รูปต่อรายการ', 'PHOTO_LIMIT');
      }
      var maxSort = 0;
      existing.forEach(function (ph) { maxSort = Math.max(maxSort, parseInt(ph.Sort, 10) || 0); });

      var row = {
        PhotoID:     newPhotoId_(),
        OwnerType:   ownerType,
        OwnerID:     ownerId,
        DriveFileID: file.getId(),
        Width:       parseInt(p.width, 10) || 0,
        Height:      parseInt(p.height, 10) || 0,
        Caption:     s_(p.caption, 120),
        Sort:        maxSort + 1,
        Status:      'ACTIVE',
        CreatedBy:   ctx.email,
        CreatedAt:   new Date()
      };
      appendRows_('PHOTOS', [row]);
      audit_(ctx.email, 'PHOTO_ADD', 'Photos', row.PhotoID, { owner: ownerType + ':' + ownerId });
      return { photoId: row.PhotoID, fileId: row.DriveFileID, sort: row.Sort };
    });
  } catch (e) {
    trashPhotoFile_(file.getId());     // บันทึกแถวไม่สำเร็จ → อย่าทิ้งไฟล์ค้างใน Drive
    throw e;
  }
}

/** แก้คำบรรยาย หรือตั้งเป็นรูปหลัก */
function photoUpdate_(p, ctx) {
  var id = s_(p.photoId, 20);

  return withLock_(function () {
    var all = readTable_('PHOTOS');
    var cur = all.filter(function (ph) { return String(ph.PhotoID) === id; })[0];
    if (!cur || String(cur.Status || 'ACTIVE').toUpperCase() === 'DELETED') {
      throw new AppError('ไม่พบรูป ' + id, 'NOT_FOUND');
    }

    var patch = {};
    if (p.caption !== undefined) patch.Caption = s_(p.caption, 120);

    if (p.makeCover) {
      var siblings = activePhotosOf_(String(cur.OwnerType), String(cur.OwnerID));
      var minSort = 0;
      siblings.forEach(function (ph) { minSort = Math.min(minSort, parseInt(ph.Sort, 10) || 0); });
      patch.Sort = minSort - 1;        // เล็กที่สุด = รูปหลัก
    }

    if (!Object.keys(patch).length) return { photoId: id, changed: false };
    updateRowById_('PHOTOS', 'PhotoID', id, patch);
    audit_(ctx.email, 'PHOTO_UPDATE', 'Photos', id, { cover: !!p.makeCover });
    return { photoId: id, changed: true };
  });
}

function photoDelete_(p, ctx) {
  var id = s_(p.photoId, 20);

  return withLock_(function () {
    var cur = readTable_('PHOTOS').filter(function (ph) { return String(ph.PhotoID) === id; })[0];
    if (!cur || String(cur.Status || 'ACTIVE').toUpperCase() === 'DELETED') {
      throw new AppError('ไม่พบรูป ' + id, 'NOT_FOUND');
    }
    updateRowById_('PHOTOS', 'PhotoID', id, { Status: 'DELETED' });
    trashPhotoFile_(String(cur.DriveFileID));
    audit_(ctx.email, 'PHOTO_DELETE', 'Photos', id, null);
    return { photoId: id, deleted: true };
  });
}

/** ลบรูปทั้งหมดของเจ้าของรายการหนึ่ง (ใช้ตอนลบที่เก็บ) */
function photosTrashFor_(ownerType, ownerId) {
  var list = activePhotosOf_(ownerType, ownerId);
  if (!list.length) return 0;
  var patches = {};
  list.forEach(function (ph) { patches[String(ph.PhotoID)] = { Status: 'DELETED' }; });
  patchRowsById_('PHOTOS', 'PhotoID', patches);
  list.forEach(function (ph) { trashPhotoFile_(String(ph.DriveFileID)); });
  return list.length;
}

function trashPhotoFile_(fileId) {
  try { DriveApp.getFileById(fileId).setTrashed(true); }
  catch (e) { console.warn('ลบไฟล์รูปใน Drive ไม่สำเร็จ: ' + e.message); }
}

// ═════════════════════ Snapshot.gs ═════════════════════
/**
 * ============================================================================
 *  Snapshot.gs  —  ส่งข้อมูลทั้งชุดให้หน้าเว็บไปค้นหาเองในเครื่อง
 * ============================================================================
 *
 *  แนวคิด
 *  ------
 *  ระบบเดิมค้นหา 1 ครั้ง = GAS อ่าน Sheet ทั้งใบ 1 ครั้ง (2–5 วินาที)
 *  ระบบใหม่ส่ง "snapshot" ของข้อมูลให้หน้าเว็บเก็บไว้ใน IndexedDB
 *  แล้วค้นหาในเครื่อง → เร็วกว่า 300 เท่า และไม่มีปัญหาผลลัพธ์ต่างกันแต่ละเครื่อง
 *
 *  การซิงก์
 *  --------
 *    หน้าเว็บถาม ?action=version   → ตอบแค่เลขเวอร์ชัน (เบามาก ~50ms)
 *    เลขเท่าเดิม  → ใช้ข้อมูลใน IndexedDB ต่อได้เลย ไม่ต้องโหลดอะไร
 *    เลขเปลี่ยน   → โหลด snapshot ใหม่ 1 ครั้ง
 *
 *  ทุกครั้งที่มีการเขียนข้อมูล withLock_() จะเพิ่มเลขเวอร์ชันและล้าง cache ให้เอง
 */

/** คอลัมน์ที่ส่งไปหน้าเว็บ (ตัดคอลัมน์ที่ UI ไม่ใช้ออกเพื่อให้ payload เล็ก) */
var SNAP_FIELDS = {
  materials: ['MaterialID', 'INCIName', 'CASNo', 'TradeName', 'Function',
              'State', 'Unit', 'SDSLink', 'Hazard', 'StorageCondition', 'Status', 'ItemKind'],
  lots:      ['PlaceID', 'LotID', 'MaterialID', 'SupplierLotNo', 'Supplier', 'FiscalYear',
              'Room', 'Shelf', 'QtyReceived', 'UnitPrice', 'ReceiveDate',
              'ExpireDate', 'ShelfState', 'Status', 'LegacyCode',
              'ShelfStateBy', 'ShelfStateAt'],

  places:    ['PlaceID', 'ParentID', 'Kind', 'Name', 'X', 'Y', 'W', 'H', 'Color', 'Sort', 'Notes'],
  photos:    ['PhotoID', 'OwnerType', 'OwnerID', 'DriveFileID', 'Width', 'Height', 'Caption', 'Sort']
};


// ─────────────────────────────────────────────────────────────────────────────
//  สร้าง snapshot
// ─────────────────────────────────────────────────────────────────────────────

function buildSnapshot_() {
  var version = getVersion_();

  var matRows   = projectRows_('MATERIALS', SNAP_FIELDS.materials);
  // แถวเก่าที่ยังไม่ได้รัน migrateItemKind มีค่าว่าง — ตีความให้เสร็จที่นี่ หน้าเว็บจะได้ไม่ต้องเดาเอง
  var iKind = SNAP_FIELDS.materials.indexOf('ItemKind');
  matRows.forEach(function (r) { r[iKind] = itemKindOf_(r[iKind]); });
  var lotRows   = projectRows_('LOTS',      SNAP_FIELDS.lots);
  var placeRows = projectRows_('PLACES',    SNAP_FIELDS.places, 'Status');
  var photoRows = projectRows_('PHOTOS',    SNAP_FIELDS.photos, 'Status');
  var txnRaw  = readRaw_('TRANSACTIONS');

  return {
    version:  version,
    builtAt:  new Date().toISOString(),
    materials: { fields: SNAP_FIELDS.materials, rows: matRows },
    lots:      { fields: SNAP_FIELDS.lots,      rows: lotRows },
    places:    { fields: SNAP_FIELDS.places,    rows: placeRows },
    photos:    { fields: SNAP_FIELDS.photos,    rows: photoRows },
    balances:  computeBalances_(txnRaw),
    settings:  getSettingsMap_(),
    counts: {
      materials:    matRows.length,
      lots:         lotRows.length,
      places:       placeRows.length,
      photos:       photoRows.length,
      transactions: txnRaw.length
    }
  };
}

/** ดึงเฉพาะคอลัมน์ที่ต้องการ และแปลง Date → ISO */
function projectRows_(schemaKey, fields, skipDeletedCol) {
  var headers = SCHEMA[schemaKey];
  var idx     = fields.map(function (f) { return headers.indexOf(f); });
  var iStatus = skipDeletedCol ? headers.indexOf(skipDeletedCol) : -1;
  var raw     = readRaw_(schemaKey);
  var out     = [];

  for (var r = 0; r < raw.length; r++) {
    // ข้ามแถวว่าง (คอลัมน์แรกคือ ID — ถ้าว่างถือว่าไม่ใช่ข้อมูล)
    if (raw[r][0] === '' || raw[r][0] === null) continue;
    if (iStatus !== -1 && String(raw[r][iStatus] || '').toUpperCase() === 'DELETED') continue;

    var row = new Array(idx.length);
    for (var c = 0; c < idx.length; c++) {
      row[c] = (idx[c] === -1) ? '' : isoSafe_(raw[r][idx[c]]);
    }
    out.push(row);
  }
  return out;
}

/** Category ทั้งหมด → { State:[...], Function:[...], Room:[...], ... } */
function getSettingsMap_() {
  var map = {};
  SETTING_TYPES.forEach(function (t) { map[t] = []; });

  var rows = readTable_('SETTINGS');
  rows.sort(function (a, b) {
    return (parseInt(a.Sort, 10) || 999) - (parseInt(b.Sort, 10) || 999);
  });

  rows.forEach(function (r) {
    var type  = String(r.Type || '').trim();
    var value = String(r.Value || '').trim();
    var act   = String(r.Active).toUpperCase();
    if (!type || !value) return;
    if (act === 'FALSE') return;
    if (!map[type]) map[type] = [];
    if (map[type].indexOf(value) === -1) map[type].push(value);
  });

  return map;
}


// ─────────────────────────────────────────────────────────────────────────────
//  Cache  (แบ่ง chunk เพราะ CacheService เก็บได้ ~100KB ต่อ key)
// ─────────────────────────────────────────────────────────────────────────────

function getSnapshot_() {
  var version = getVersion_();
  var cache   = CacheService.getScriptCache();
  var metaStr = cache.get('snapshot_meta');

  if (metaStr) {
    try {
      var meta = JSON.parse(metaStr);
      if (meta.version === version && meta.chunks > 0) {
        var keys = [];
        for (var i = 0; i < meta.chunks; i++) keys.push('snapshot_' + i);

        var parts = cache.getAll(keys);
        var buf   = '';
        var ok    = true;
        for (var j = 0; j < meta.chunks; j++) {
          var p = parts['snapshot_' + j];
          if (p === null || p === undefined) { ok = false; break; }
          buf += p;
        }
        if (ok) return JSON.parse(buf);   // ✅ ใช้ของใน cache
      }
    } catch (e) {
      console.warn('อ่าน snapshot จาก cache ไม่ได้: ' + e.message);
    }
  }

  // ── cache ไม่มี/เก่า → สร้างใหม่แล้วเก็บลง cache ────────────────────────
  var snap = buildSnapshot_();
  putSnapshotCache_(snap);
  return snap;
}

function putSnapshotCache_(snap) {
  try {
    var str    = JSON.stringify(snap);
    var cache  = CacheService.getScriptCache();
    var chunks = {};
    var n      = 0;

    for (var pos = 0; pos < str.length; pos += CACHE_CHUNK_SIZE) {
      chunks['snapshot_' + n] = str.substr(pos, CACHE_CHUNK_SIZE);
      n++;
      if (n > 60) {           // ข้อมูลใหญ่เกินกว่าจะ cache — ข้ามไป (ยังทำงานได้ แค่ช้าลง)
        console.warn('snapshot ใหญ่เกิน 5.4MB — ไม่เก็บ cache');
        return;
      }
    }

    cache.putAll(chunks, CACHE_TTL_SECONDS);
    cache.put('snapshot_meta',
      JSON.stringify({ version: snap.version, chunks: n, builtAt: snap.builtAt }),
      CACHE_TTL_SECONDS);
  } catch (e) {
    console.warn('เก็บ snapshot ลง cache ไม่ได้: ' + e.message);
  }
}

function dropSnapshotCache_() {
  try {
    var keys = ['snapshot_meta'];
    for (var i = 0; i < 61; i++) keys.push('snapshot_' + i);
    CacheService.getScriptCache().removeAll(keys);
  } catch (e) { /* ไม่สำคัญพอให้ล้มงาน */ }
}

// ═════════════════════ Import.gs ═════════════════════
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

// ═════════════════════ Setup.gs ═════════════════════
/**
 * ============================================================================
 *  Setup.gs  —  ติดตั้งระบบครั้งแรก
 * ============================================================================
 *
 *  วิธีใช้: เปิด Apps Script → เลือกฟังก์ชัน setupSpreadsheet → กด Run
 *  รันซ้ำได้ปลอดภัย (idempotent) — ไม่ลบข้อมูลเดิม เพียงเติมสิ่งที่ขาด
 */

function setupSpreadsheet() {
  var ss  = getSpreadsheet_();
  var log = [];

  // ── 1. สร้างชีตและ header ─────────────────────────────────────────────────
  Object.keys(SHEETS).forEach(function (key) {
    var name    = SHEETS[key];
    var headers = SCHEMA[key];
    var sheet   = ss.getSheetByName(name);

    if (!sheet) {
      sheet = ss.insertSheet(name);
      log.push('สร้างชีต: ' + name);
    }

    ensureCapacity_(sheet, 1, headers.length);
    var lastCol = Math.max(sheet.getLastColumn(), 1);
    var current = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var needWrite = false;

    for (var i = 0; i < headers.length; i++) {
      if (String(current[i] || '').trim() !== headers[i]) { needWrite = true; break; }
    }

    if (needWrite) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      log.push('อัปเดต header: ' + name + ' (' + headers.length + ' คอลัมน์)');
    }

    sheet.getRange(1, 1, 1, headers.length)
         .setFontWeight('bold')
         .setBackground('#1f3864')
         .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  });

  // ── 2. สร้าง SESSION_SECRET ถ้ายังไม่มี ───────────────────────────────────
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SESSION_SECRET')) {
    props.setProperty('SESSION_SECRET', Utilities.getUuid() + Utilities.getUuid());
    log.push('สร้าง SESSION_SECRET ใหม่');
  }

  // ── 3. ใส่ Category ตั้งต้น ───────────────────────────────────────────────
  var seeded = seedSettings_(ss);
  if (seeded.length) log.push('เพิ่ม Category ตั้งต้น ' + seeded.length + ' รายการ');

  // ── 4. ใส่ผู้ดูแลระบบคนแรก ────────────────────────────────────────────────
  var admin = cfg_('BOOTSTRAP_ADMIN', false);
  if (admin) {
    var uSheet = ss.getSheetByName(SHEETS.USERS);
    var emails = uSheet.getLastRow() > 1
      ? uSheet.getRange(2, 1, uSheet.getLastRow() - 1, 1).getValues()
          .map(function (r) { return String(r[0]).toLowerCase().trim(); })
      : [];
    if (emails.indexOf(admin.toLowerCase().trim()) === -1) {
      appendRows_('USERS', [{
        Email: admin.toLowerCase().trim(), Name: 'ผู้ดูแลระบบ',
        Role: 'admin', Status: 'ACTIVE',
        Notes: 'สร้างโดยระบบตอนติดตั้ง', AddedBy: 'SYSTEM', AddedAt: new Date(),
        LastLogin: '', LoginCount: 0,
        LoginKind: 'GOOGLE', Username: '', PassHash: '',
        SessionVer: 1, PassChangedAt: ''
      }]);
      dropUsersCache_();
      log.push('เพิ่มผู้ดูแลระบบคนแรก: ' + admin);
    }
  } else {
    log.push('⚠️ ยังไม่ได้ตั้ง BOOTSTRAP_ADMIN — จะยังล็อกอินเข้าระบบไม่ได้');
  }

  bumpVersion_();

  var msg = '✅ ติดตั้งเรียบร้อย\n\n' + (log.length ? log.join('\n') : 'ไม่มีอะไรต้องเปลี่ยน');
  Logger.log(msg);
  return msg;
}


/** ใส่ Category ตั้งต้นที่ยังไม่มี */
function seedSettings_(ss) {
  var defaults = {
    State:    ['Solid', 'Liquid', 'Powder', 'Semi-solid', 'Gel'],
    Unit:     ['g', 'mL', 'kg', 'L', 'pcs'],
    Function: ['Emulsifier', 'Preservative', 'Humectant', 'Thickener',
               'Surfactant', 'Active', 'Fragrance', 'Colorant', 'Solvent'],
    Room:     [],
    Shelf:    [],
    Supplier: [],
    FiscalYear: [thaiFiscalYear_(new Date())]
  };

  var sheet   = ss.getSheetByName(SHEETS.SETTINGS);
  var existing = {};
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues().forEach(function (r) {
      existing[String(r[0]).trim() + '||' + String(r[1]).trim()] = true;
    });
  }

  var rows = [];
  Object.keys(defaults).forEach(function (type) {
    defaults[type].forEach(function (value, i) {
      if (!existing[type + '||' + value]) {
        rows.push([type, value, i + 1, true, 'SYSTEM', new Date()]);
      }
    });
  });

  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, SCHEMA.SETTINGS.length)
         .setValues(rows);
  }
  return rows;
}


/**
 * ปีงบประมาณไทย: 1 ต.ค. ปีก่อน – 30 ก.ย. ปีนั้น
 * เช่น 15 ต.ค. 2025 (พ.ศ. 2568) → ปีงบประมาณ 2569
 */
function thaiFiscalYear_(date) {
  var d  = new Date(date);
  var be = d.getFullYear() + 543;
  if (d.getMonth() >= 9) be += 1;   // เดือน ต.ค. (index 9) ขึ้นไป = ปีงบใหม่
  return String(be);
}


/** ลบ cache ทั้งหมด (ใช้เวลาแก้ข้อมูลในชีตด้วยมือแล้วอยากให้หน้าเว็บเห็นทันที) */
function clearAllCache() {
  CacheService.getScriptCache().removeAll(
    ['snapshot_meta'].concat(
      Array.apply(null, Array(60)).map(function (_, i) { return 'snapshot_' + i; })
    )
  );
  bumpVersion_();
  return '✅ ล้าง cache แล้ว และเพิ่มเลขเวอร์ชันข้อมูล';
}


/** ตรวจสุขภาพระบบ — รันก่อนเปิดใช้งานจริง */
function healthCheck() {
  var out = [];
  var props = PropertiesService.getScriptProperties();

  ['SPREADSHEET_ID', 'OAUTH_CLIENT_ID', 'BOOTSTRAP_ADMIN', 'SESSION_SECRET']
    .forEach(function (k) {
      out.push((props.getProperty(k) ? '✅' : '❌') + ' Script Property: ' + k);
    });

  try {
    var ss = getSpreadsheet_();
    out.push('✅ เปิด Spreadsheet ได้: ' + ss.getName());
    Object.keys(SHEETS).forEach(function (key) {
      var sh = ss.getSheetByName(SHEETS[key]);
      out.push((sh ? '✅' : '❌') + ' ชีต ' + SHEETS[key] +
               (sh ? ' (' + Math.max(0, sh.getLastRow() - 1) + ' แถว)' : ''));
    });
  } catch (e) {
    out.push('❌ เปิด Spreadsheet ไม่ได้: ' + e.message);
  }

  out.push('ℹ️ โดเมนที่อนุญาต: @' + ALLOWED_DOMAIN);
  out.push('ℹ️ เวอร์ชันข้อมูลปัจจุบัน: ' + getVersion_());

  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}


/**
 * ============================================================================
 *  ย้ายข้อมูล Room / Shelf เดิม เข้าตาราง Places  (รันครั้งเดียวหลังอัปเกรด)
 * ============================================================================
 *  เดิมที่เก็บเป็นข้อความ 2 ช่องบนแต่ละล็อต — ฟังก์ชันนี้อ่านคู่ (Room, Shelf)
 *  ที่ใช้จริงทั้งหมด สร้างเป็นที่เก็บแบบลำดับชั้น แล้วเติม PlaceID ให้ทุกล็อต
 *
 *  ปลอดภัยที่จะรันซ้ำ: ล็อตที่มี PlaceID แล้วจะถูกข้าม และที่เก็บชื่อซ้ำจะถูกใช้ซ้ำ
 *  ช่อง Room / Shelf เดิมไม่ถูกลบ — รายงานและ CSV เก่ายังใช้ได้ต่อ
 *
 *  รันจาก Apps Script:  เลือกฟังก์ชัน migratePlaces → Run
 */
function migratePlaces() {
  var out = [];

  var result = withLock_(function () {
    var lots   = readTable_('LOTS');
    var places = activePlaces_();

    // ── ที่เก็บที่มีอยู่แล้ว (กันสร้างซ้ำเมื่อรันหลายรอบ) ──────────────────
    var roomByName = {};     // ชื่อห้อง(ตัวพิมพ์เล็ก) → PlaceID
    var shelfByKey = {};     // "roomId|ชื่อชั้น"      → PlaceID
    places.forEach(function (p) {
      var name = String(p.Name).toLowerCase();
      if (!String(p.ParentID || '')) roomByName[name] = String(p.PlaceID);
      else shelfByKey[String(p.ParentID) + '|' + name] = String(p.PlaceID);
    });

    // ── รวบรวมคู่ (Room, Shelf) ที่ยังไม่มีในตาราง ────────────────────────
    var needRooms = {}, needShelves = {};
    lots.forEach(function (l) {
      if (String(l.PlaceID || '')) return;                 // ล็อตนี้ย้ายแล้ว
      var room  = String(l.Room  || '').replace(/\s+/g, ' ').trim();
      var shelf = String(l.Shelf || '').replace(/\s+/g, ' ').trim();
      if (!room && !shelf) return;                         // ไม่เคยระบุที่เก็บ
      if (!room) room = 'ไม่ระบุห้อง';                      // มีชั้นแต่ไม่มีห้อง
      if (!roomByName[room.toLowerCase()]) needRooms[room.toLowerCase()] = room;
      if (shelf) needShelves[room.toLowerCase() + '\u0001' + shelf.toLowerCase()] = { room: room, shelf: shelf };
    });

    // ── สร้างห้องก่อน แล้วค่อยสร้างชั้น (ลูกต้องรู้รหัสพ่อ) ────────────────
    var now = new Date();
    var roomKeys = Object.keys(needRooms);
    if (roomKeys.length) {
      var roomIds = newPlaceIds_(roomKeys.length);
      var rows = roomKeys.map(function (k, i) {
        roomByName[k] = roomIds[i];
        return {
          PlaceID: roomIds[i], ParentID: '', Kind: 'ROOM', Name: needRooms[k],
          Sort: 900 + i, Status: 'ACTIVE',
          CreatedBy: 'MIGRATION', CreatedAt: now, UpdatedBy: 'MIGRATION', UpdatedAt: now
        };
      });
      appendRows_('PLACES', rows);
      out.push('สร้างห้อง ' + rows.length + ' ห้อง: ' + roomKeys.map(function (k) { return needRooms[k]; }).join(', '));
    }

    var shelfKeys = Object.keys(needShelves);
    var madeShelves = 0;
    if (shelfKeys.length) {
      var pend = [];
      shelfKeys.forEach(function (k) {
        var x = needShelves[k];
        var roomId = roomByName[x.room.toLowerCase()];
        if (!roomId) return;
        if (shelfByKey[roomId + '|' + x.shelf.toLowerCase()]) return;   // มีอยู่แล้ว
        pend.push({ roomId: roomId, shelf: x.shelf });
      });
      if (pend.length) {
        var shelfIds = newPlaceIds_(pend.length);
        var srows = pend.map(function (x, i) {
          shelfByKey[x.roomId + '|' + x.shelf.toLowerCase()] = shelfIds[i];
          return {
            PlaceID: shelfIds[i], ParentID: x.roomId, Kind: 'SHELF', Name: x.shelf,
            Sort: 900 + i, Status: 'ACTIVE',
            CreatedBy: 'MIGRATION', CreatedAt: now, UpdatedBy: 'MIGRATION', UpdatedAt: now
          };
        });
        appendRows_('PLACES', srows);
        madeShelves = srows.length;
        out.push('สร้างชั้นวาง ' + madeShelves + ' ชั้น');
      }
    }

    // ── เติม PlaceID ให้ล็อตที่ยังไม่มี ───────────────────────────────────
    var patches = {}, linked = 0, noPlace = 0;
    lots.forEach(function (l) {
      if (String(l.PlaceID || '')) return;
      var room  = String(l.Room  || '').replace(/\s+/g, ' ').trim();
      var shelf = String(l.Shelf || '').replace(/\s+/g, ' ').trim();
      if (!room && !shelf) { noPlace++; return; }
      if (!room) room = 'ไม่ระบุห้อง';

      var roomId = roomByName[room.toLowerCase()];
      if (!roomId) { noPlace++; return; }
      var target = shelf ? (shelfByKey[roomId + '|' + shelf.toLowerCase()] || roomId) : roomId;

      patches[String(l.LotID)] = { PlaceID: target, UpdatedBy: 'MIGRATION', UpdatedAt: now };
      linked++;
    });
    if (linked) patchRowsById_('LOTS', 'LotID', patches);

    out.push('เชื่อมล็อตเข้าที่เก็บ ' + linked + ' ล็อต');
    if (noPlace) out.push('ล็อตที่ยังไม่ระบุที่เก็บ ' + noPlace + ' ล็อต (ไม่เคยกรอก Room/Shelf ไว้)');

    audit_('SYSTEM', 'MIGRATE_PLACES', 'Places', '', { rooms: roomKeys.length, shelves: madeShelves, lots: linked });
    return { rooms: roomKeys.length, shelves: madeShelves, lots: linked, noPlace: noPlace };
  });

  var msg = '✅ ย้ายข้อมูลที่เก็บเรียบร้อย\n\n' + out.join('\n') +
            '\n\nช่อง Room / Shelf เดิมยังอยู่ครบ ไม่ได้ลบ — รายงานและ CSV เก่าใช้ได้ต่อ' +
            '\nรันฟังก์ชันนี้ซ้ำได้ปลอดภัย (ล็อตที่ย้ายแล้วจะถูกข้าม)';
  Logger.log(msg);   // ขึ้นใน Execution log ของ Apps Script
  return msg;
}


/**
 * ============================================================================
 *  migrateUsers  —  เติมคอลัมน์ใหม่ของตาราง Users ให้แถวเดิม
 * ============================================================================
 *  รันหลัง setupSpreadsheet ครั้งเดียว (รันซ้ำได้ปลอดภัย)
 *  แถวเดิมทุกแถวเป็นบัญชี Google อยู่แล้ว จึงเติม LoginKind=GOOGLE และ SessionVer=1
 *
 *  ถ้าปล่อยช่องว่างไว้ระบบก็ยังทำงานถูก (ค่าว่างถูกตีความเป็น GOOGLE / 1)
 *  แต่เติมให้ครบจะอ่านในชีตเข้าใจง่ายกว่า
 */
function migrateUsers() {
  var out = [];

  withLock_(function () {
    var rows    = readTable_('USERS');
    var patches = {};
    var n = 0;

    rows.forEach(function (u) {
      var email = String(u.Email || '').trim().toLowerCase();
      if (!email) return;                                   // ข้ามบัญชีรหัสผ่าน
      var patch = {};
      if (!String(u.LoginKind || '').trim())  patch.LoginKind = 'GOOGLE';
      if (!parseInt(u.SessionVer, 10))        patch.SessionVer = 1;
      if (Object.keys(patch).length) { patches[email] = patch; n++; }
    });

    if (n) patchRowsById_('USERS', 'Email', patches);
    dropUsersCache_();
    out.push('เติมข้อมูลบัญชีเดิม ' + n + ' บัญชี (จากทั้งหมด ' + rows.length + ')');
  });

  var msg = '✅ ปรับตารางผู้ใช้เรียบร้อย\n\n' + out.join('\n') +
            '\n\nทุกคนต้องล็อกอินใหม่ 1 ครั้ง เพราะระบบเริ่มตรวจสิทธิ์สด ๆ จากตาราง Users';
  Logger.log(msg);
  return msg;
}


/**
 * ============================================================================
 *  migrateItemKind  —  เติมชนิดของให้สารเดิมที่มีอยู่ก่อนเพิ่มคอลัมน์ ItemKind
 * ============================================================================
 *  รันหลัง setupSpreadsheet (ต้องมีหัวคอลัมน์ ItemKind ก่อน)  รันซ้ำได้ปลอดภัย
 *
 *  ทุกแถวเดิมมาจากระบบสารเคมี จึงเติม CHEMICAL ให้แถวที่ว่าง
 *  ค่าที่ถูกแต่พิมพ์เล็ก (เช่น "equipment" ที่มีคนแก้ในชีตด้วยมือ) ปรับเป็นตัวพิมพ์ใหญ่
 *  ค่าที่ระบบไม่รู้จัก "ไม่แตะ" แต่รายงานรหัสออกมาให้คนตัดสินใจ — เดาแทนแล้วผิดจะแก้คืนยาก
 *
 *  ถึงไม่รันฟังก์ชันนี้ระบบก็ทำงานถูก (ค่าว่างถูกตีความเป็น CHEMICAL)
 *  แต่เติมให้ครบ คนที่เปิดอ่านในชีตจะไม่ต้องรู้กติกาข้อนี้
 */
function migrateItemKind() {
  var out = [];

  withLock_(function () {
    var sheet = sheetOf_('MATERIALS');
    var col   = SCHEMA.MATERIALS.indexOf('ItemKind') + 1;
    var head  = sheet.getLastColumn() >= col ? String(sheet.getRange(1, col).getValue()).trim() : '';
    if (head !== 'ItemKind') {
      // ถ้าเขียนไปทั้งที่ยังไม่มีหัวคอลัมน์ ค่าจะไปอยู่ในคอลัมน์ไร้ชื่อที่ไม่มีใครรู้ว่าคืออะไร
      throw new AppError('ชีต Materials ยังไม่มีคอลัมน์ ItemKind — กรุณารัน setupSpreadsheet() ก่อน ' +
                         'แล้วค่อยรัน migrateItemKind() อีกครั้ง', 'NO_HEADER');
    }

    var rows    = readTable_('MATERIALS');
    var patches = {};
    var filled = 0, fixedCase = 0, unknown = [];

    rows.forEach(function (m) {
      var id = String(m.MaterialID || '').trim();
      if (!id) return;
      var raw = String(m.ItemKind === undefined || m.ItemKind === null ? '' : m.ItemKind).trim();
      if (!raw) {
        patches[id] = { ItemKind: DEFAULT_ITEM_KIND }; filled++;
      } else if (ITEM_KINDS.indexOf(raw.toUpperCase()) === -1) {
        unknown.push(id + ' (' + raw + ')');
      } else if (raw !== raw.toUpperCase()) {
        patches[id] = { ItemKind: raw.toUpperCase() }; fixedCase++;
      }
    });

    if (filled + fixedCase) patchRowsById_('MATERIALS', 'MaterialID', patches);

    out.push('เติมชนิด ' + DEFAULT_ITEM_KIND + ' ให้รายการเดิม ' + filled + ' รายการ (จากทั้งหมด ' + rows.length + ')');
    if (fixedCase) out.push('ปรับตัวพิมพ์ของชนิดให้ถูกต้อง ' + fixedCase + ' รายการ');
    if (unknown.length) {
      out.push('⚠️ ชนิดที่ระบบไม่รู้จัก ' + unknown.length + ' รายการ (ไม่ได้แก้ — ระบบจะถือเป็น ' +
               DEFAULT_ITEM_KIND + ' จนกว่าจะแก้ในชีตเป็น ' + ITEM_KINDS.join(' / ') + '): ' + unknown.join(', '));
    }
    audit_('SYSTEM', 'MIGRATE_ITEM_KIND', 'Materials', '',
           { filled: filled, fixedCase: fixedCase, unknown: unknown.length });
  });

  var msg = '✅ เติมชนิดของเรียบร้อย\n\n' + out.join('\n') +
            '\n\nรันฟังก์ชันนี้ซ้ำได้ปลอดภัย (รายการที่มีชนิดแล้วจะถูกข้าม)';
  Logger.log(msg);
  return msg;
}

// ═════════════════════ Api.gs ═════════════════════
/**
 * ============================================================================
 *  Api.gs  —  ประตูทางเข้าเดียวของระบบ (Web App endpoint)
 * ============================================================================
 *
 *  ⚠️ ข้อสำคัญเรื่อง CORS
 *  --------------------
 *  Apps Script ไม่รองรับ CORS preflight (OPTIONS) จึงต้องส่งคำขอแบบ
 *  "simple request" เท่านั้น นั่นคือ:
 *
 *     ✅ POST  +  Content-Type: text/plain   (ส่ง JSON เป็น string ในเนื้อหา)
 *     ❌ POST  +  Content-Type: application/json   → เกิด preflight → ล้มเหลว
 *     ❌ ใส่ header Authorization เอง              → เกิด preflight → ล้มเหลว
 *
 *  ดังนั้น session token จึงส่งไปใน body ของ JSON ไม่ใช่ใน header
 *  (ดูฝั่งหน้าเว็บที่ docs/js/api.js)
 */


// ─────────────────────────────────────────────────────────────────────────────
//  ตารางคำสั่ง  —  action : { fn, role }
//    role = null  → ไม่ต้องล็อกอิน
// ─────────────────────────────────────────────────────────────────────────────

function ROUTES_() {
  return {
    // ── ระบบ ───────────────────────────────────────────────────────────────
    'ping':              { fn: function ()         { return { pong: true, time: new Date().toISOString() }; }, role: null },
    'login':             { fn: function (p)        { return authLogin_(p.idToken); },                          role: null },
    'login.password':    { fn: function (p)        { return authLoginPassword_(p); },                           role: null },
    'password.change':   { fn: function (p, ctx)   { return authChangePassword_(p, ctx); },                     role: 'viewer' },
    'logout.all':        { fn: function (p, ctx)   { return authLogoutAll_(p, ctx); },                          role: 'viewer' },
    'me':                { fn: function (p, ctx)   { return { user: ctx, version: getVersion_() }; },           role: 'viewer' },
    'version':           { fn: function ()         { return { version: getVersion_() }; },                      role: 'viewer' },
    'snapshot':          { fn: function ()         { return getSnapshot_(); },                                  role: 'viewer' },

    // ── ผู้ใช้ (admin เท่านั้น) ─────────────────────────────────────────────
    'users.list':        { fn: function (p, ctx)   { return usersList_(); },              role: 'admin' },
    'users.add':         { fn: function (p, ctx)   { return usersAdd_(p, ctx); },         role: 'admin' },
    'users.update':      { fn: function (p, ctx)   { return usersUpdate_(p, ctx); },      role: 'admin' },
    'users.setStatus':   { fn: function (p, ctx)   { return usersSetStatus_(p, ctx); },   role: 'admin' },
    'users.resetPassword': { fn: function (p, ctx) { return usersResetPassword_(p, ctx); }, role: 'admin' },

    // ── Category ───────────────────────────────────────────────────────────
    'settings.add':      { fn: function (p, ctx)   { return settingsAdd_(p, ctx); },      role: 'staff' },
    'settings.remove':   { fn: function (p, ctx)   { return settingsRemove_(p, ctx); },   role: 'admin' },

    // ── นำเข้าข้อมูลจากระบบเดิม ────────────────────────────────────────────
    'import.preview':    { fn: function (p, ctx)   { return importPreview_(p, ctx); },    role: 'admin' },
    'import.commit':     { fn: function (p, ctx)   { return importCommit_(p, ctx); },     role: 'admin' },

    // ── คลัง (ส่วนที่หน้าจอจะมาใช้ใน Phase 2) ───────────────────────────────
    'lot.setShelfState': { fn: function (p, ctx)   { return lotSetShelfState_(p, ctx); }, role: 'staff' },
    'history':         { fn: function (p)       { return historyList_(p); },                 role: 'viewer' },

    'place.save':      { fn: function (p, ctx)  { return placeSave_(p, ctx); },                  role: 'staff' },
    'place.delete':    { fn: function (p, ctx)  { return placeDelete_(p, ctx); },                role: 'staff' },
    'lot.move':        { fn: function (p, ctx)  { return lotMove_(p, ctx); },                    role: 'staff' },

    'photo.upload':    { fn: function (p, ctx)  { return photoUpload_(p, ctx); },                role: 'staff' },
    'photo.update':    { fn: function (p, ctx)  { return photoUpdate_(p, ctx); },                role: 'staff' },
    'photo.delete':    { fn: function (p, ctx)  { return photoDelete_(p, ctx); },                role: 'staff' },

    'material.save':   { fn: function (p, ctx)  { return materialSave_(p, ctx); },               role: 'staff' },
    'lot.save':        { fn: function (p, ctx)  { return lotSave_(p, ctx); },                    role: 'staff' },

    'txn.post':          { fn: function (p, ctx)   { return txnPost_(p, ctx); },          role: 'staff' },
    'txn.cancel':        { fn: function (p, ctx)   { return txnCancel_(p, ctx); },         role: 'staff' }
  };
}


// ─────────────────────────────────────────────────────────────────────────────
//  doPost  —  ทุกคำสั่งเข้าทางนี้
// ─────────────────────────────────────────────────────────────────────────────

function doPost(e) {
  var started = Date.now();
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new AppError('ไม่พบเนื้อหาคำขอ', 'NO_BODY');
    }

    var req;
    try {
      req = JSON.parse(e.postData.contents);
    } catch (err) {
      throw new AppError('เนื้อหาคำขอไม่ใช่ JSON ที่ถูกต้อง', 'BAD_JSON');
    }

    var action = String(req.action || '').trim();
    var route  = ROUTES_()[action];
    if (!route) throw new AppError('ไม่รู้จักคำสั่ง: ' + action, 'UNKNOWN_ACTION');

    // ตรวจสิทธิ์
    var ctx = null;
    if (route.role) {
      ctx = authVerify_(req.session);
      requireRole_(ctx, route.role);
    }

    var data = route.fn(req.payload || req, ctx);

    return jsonOut_({
      ok:   true,
      data: data,
      ms:   Date.now() - started
    });

  } catch (err) {
    console.error(err.stack || err.message);
    return jsonOut_({
      ok: false,
      error: {
        message: err.userFacing ? err.message : ('เกิดข้อผิดพลาดในระบบ: ' + err.message),
        code:    err.code || 'ERROR',
        // ข้อมูลประกอบที่หน้าเว็บเอาไปทำต่อได้ เช่น รหัสสารเดิมตอนเจอชื่อซ้ำ
        data:    err.data
      },
      ms: Date.now() - started
    });
  }
}


/**
 * doGet  —  ไม่ใช้รับคำสั่ง (เพื่อไม่ให้ session token ไปโผล่ใน URL/log)
 *           เปิดด้วยเบราว์เซอร์จะเห็นแค่สถานะว่า API ทำงานอยู่
 */
function doGet(e) {
  return jsonOut_({
    ok: true,
    data: {
      service: 'Lab Chem Stock API',
      version: 2,
      domain:  ALLOWED_DOMAIN,
      dataVersion: getVersion_(),
      note: 'คำสั่งทั้งหมดส่งผ่าน POST (Content-Type: text/plain)'
    }
  });
}


function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

