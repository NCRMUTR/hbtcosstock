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
