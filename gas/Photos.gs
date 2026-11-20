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
