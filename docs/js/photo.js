/* ══════════════════════════════════════════════════════════════════════════
   photo.js — รูปภาพ: สร้างลิงก์ · ย่อ/หมุนรูปในเบราว์เซอร์ก่อนอัปโหลด · เลือกไฟล์

   ทุกอย่างทำในเครื่องผู้ใช้ก่อนส่ง เพราะรูปจากกล้องมือถือใบละ 3–8 MB
   ถ้าส่งดิบ ๆ จะช้ามากบนเน็ตมือถือ และชนเพดานขนาดคำขอของ Apps Script
   ══════════════════════════════════════════════════════════════════════════ */
import { esc } from './ui.js';

const CFG = window.APP_CONFIG;

export function photoSrc(fileId, w) {
  return CFG.PHOTO_URL.replace('{id}', encodeURIComponent(fileId)).replace('{w}', String(w || 400));
}

/** แท็ก <img> ที่ลองลิงก์สำรองเองถ้าโหลดไม่ได้ (ดู installImgFallback ใน ui.js) */
export function photoImg(photo, w, opts) {
  if (!photo) return '';
  const o = opts || {};
  const ratio = photo.width && photo.height ? ` style="aspect-ratio:${photo.width}/${photo.height}"` : '';
  return `<img class="${esc(o.cls || '')}" src="${esc(photoSrc(photo.fileId, w))}" data-fid="${esc(photo.fileId)}" data-w="${w}"
              alt="${esc(o.alt || photo.caption || '')}" loading="${o.eager ? 'eager' : 'lazy'}" decoding="async"${o.noRatio ? '' : ratio}>`;
}


/* ── อุปกรณ์ที่ถืออยู่มีกล้องให้ถ่ายตรงนี้ไหม ───────────────────────────── */

/**
 * ใช้ตัดสินว่าจะโชว์ปุ่ม "ถ่ายรูป" หรือไม่
 * บนโน้ตบุ๊ก ปุ่มถ่ายรูป (capture) จะเปิดหน้าต่างเลือกไฟล์เฉย ๆ ซึ่งสับสน
 * จึงโชว์เฉพาะเครื่องที่สัมผัสได้และจอไม่กว้าง — ครอบคลุมมือถือกับแท็บเล็ต
 */
export function hasCamera() {
  try {
    const touch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    return !!(touch && (coarse || window.innerWidth <= 1024));
  } catch { return false; }
}


/* ── ไฟล์ที่เบราว์เซอร์เปิดไม่ได้ ─────────────────────────────────────────── */

const HEIC_RE = /\.(heic|heif)$/i;

/** iPhone ตั้งค่าโรงงานถ่ายเป็น HEIC ซึ่งเบราว์เซอร์ส่วนใหญ่เปิดไม่ได้ */
export function looksHeic(file) {
  const type = String(file.type || '').toLowerCase();
  return type.indexOf('heic') !== -1 || type.indexOf('heif') !== -1 || HEIC_RE.test(file.name || '');
}

export const HEIC_HELP =
  'รูปนี้เป็นไฟล์ HEIC ซึ่งเบราว์เซอร์เปิดไม่ได้\n' +
  'วิธีแก้ถาวรบน iPhone: ตั้งค่า → กล้อง → รูปแบบ → เลือก "ประสิทธิภาพสูงสุด" เป็น "ความเข้ากันได้สูงสุด"\n' +
  'แก้เฉพาะรูปนี้: เปิดรูปในแอปรูปภาพ แล้วกดแชร์ → บันทึกเป็น JPEG หรือส่งเข้าแชตก่อนแล้วค่อยเลือกจากที่นั่น';


/* ── ย่อ + หมุนรูป ───────────────────────────────────────────────────────── */

/** ถอดไฟล์ภาพเป็นวัตถุที่วาดลง canvas ได้ พร้อมขนาดจริง */
async function decode(file) {
  if (!file || !/^image\//.test(file.type || '')) {
    if (looksHeic(file)) throw new Error(HEIC_HELP);
    throw new Error('ไฟล์นี้ไม่ใช่รูปภาพ');
  }

  let bmp = null;
  try {
    if ('createImageBitmap' in window) {
      // from-image = หมุนตามข้อมูล EXIF ให้แล้ว รูปจากมือถือจะได้ไม่ตะแคง
      try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
      catch { bmp = await createImageBitmap(file); }
    }
  } catch { bmp = null; }
  if (bmp) return { source: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close && bmp.close() };

  const url = URL.createObjectURL(file);
  try {
    const im = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(looksHeic(file) ? HEIC_HELP : 'เปิดรูปนี้ไม่ได้ (รูปแบบไฟล์ที่เบราว์เซอร์ไม่รองรับ)'));
      el.src = url;
    });
    return { source: im, w: im.naturalWidth, h: im.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (e) { URL.revokeObjectURL(url); throw e; }
}

/**
 * อ่านไฟล์ภาพ → หมุนตามที่สั่ง → ย่อด้านยาวสุดไม่เกิน maxSide → JPEG base64
 * @param {File}   file
 * @param {number} maxSide
 * @param {number} [quality=0.82]
 * @param {number} [rotate=0]  องศาตามเข็ม: 0 / 90 / 180 / 270
 * @return {Promise<{data:string, dataUrl:string, width:number, height:number, bytes:number}>}
 */
export async function resizeImage(file, maxSide, quality, rotate) {
  const rot = ((Math.round((rotate || 0) / 90) * 90) % 360 + 360) % 360;
  const img = await decode(file);

  try {
    const scale = Math.min(1, maxSide / Math.max(img.w, img.h));
    const dw = Math.max(1, Math.round(img.w * scale));
    const dh = Math.max(1, Math.round(img.h * scale));
    const swap = rot === 90 || rot === 270;            // หมุนตะแคง → ด้านกว้าง/สูงสลับกัน

    const canvas = document.createElement('canvas');
    canvas.width  = swap ? dh : dw;
    canvas.height = swap ? dw : dh;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';                            // PNG โปร่งใส → พื้นขาว (JPEG ไม่มีความโปร่งใส)
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    if (rot) ctx.rotate(rot * Math.PI / 180);
    ctx.drawImage(img.source, -dw / 2, -dh / 2, dw, dh);

    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality || 0.82));
    if (!blob) throw new Error('ย่อรูปไม่สำเร็จ');

    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('อ่านรูปไม่สำเร็จ'));
      fr.readAsDataURL(blob);
    });

    return {
      data: String(dataUrl).split(',')[1], dataUrl,
      width: canvas.width, height: canvas.height, bytes: blob.size
    };
  } finally { img.close(); }
}


/* ── เลือกไฟล์ ───────────────────────────────────────────────────────────── */

/**
 * เปิดหน้าต่างเลือกไฟล์ภาพ (capture = เปิดกล้องบนมือถือ)
 *
 * Safari บางรุ่นไม่ยิง event "cancel" ตอนผู้ใช้กดยกเลิก ถ้ารอ event อย่างเดียว
 * promise จะค้างถาวรและ <input> จะค้างใน DOM จึงเก็บกวาดตอนหน้าต่างกลับมาโฟกัสด้วย
 */
export function pickImages({ multiple, capture } = {}) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.multiple = !!multiple;
    if (capture) inp.setAttribute('capture', 'environment');
    inp.style.display = 'none';
    document.body.appendChild(inp);

    let settled = false;
    const finish = files => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      inp.remove();
      resolve(files);
    };
    const onFocus = () => {
      // กลับมาที่หน้าเว็บแล้ว ให้เวลา event change มาก่อน ถ้าไม่มาแปลว่ากดยกเลิก
      setTimeout(() => finish([...inp.files]), 800);
    };

    inp.addEventListener('change', () => finish([...inp.files]));
    inp.addEventListener('cancel', () => finish([]));
    setTimeout(() => window.addEventListener('focus', onFocus), 0);
    inp.click();
  });
}
