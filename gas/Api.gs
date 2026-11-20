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
      service: 'HBT Raw Material Stock API',
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
