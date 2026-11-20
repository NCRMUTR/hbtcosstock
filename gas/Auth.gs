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
