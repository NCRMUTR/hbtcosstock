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
