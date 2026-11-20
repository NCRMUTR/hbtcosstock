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
