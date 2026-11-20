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
