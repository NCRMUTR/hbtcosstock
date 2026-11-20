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
