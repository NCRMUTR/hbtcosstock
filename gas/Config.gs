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
