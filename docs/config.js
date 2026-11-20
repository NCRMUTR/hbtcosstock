/* ══════════════════════════════════════════════════════════════════════════
   config.js — ค่าตั้งต้นที่ต้องแก้ 2 บรรทัดก่อนใช้งาน

   ไฟล์นี้เป็นไฟล์เดียวที่ต้องแก้เมื่อย้ายระบบไปใช้ที่อื่น
   ค่าทั้งสองตัวนี้เปิดเผยได้ ไม่ใช่ความลับ — ความปลอดภัยอยู่ที่ฝั่ง GAS
   ที่ตรวจ ID Token และรายชื่อผู้ใช้ (ดู SETUP.md ขั้นที่ 2 และ 4)
   ══════════════════════════════════════════════════════════════════════════ */

window.APP_CONFIG = {

  /** ชื่อระบบที่แสดงบนแท็บเบราว์เซอร์ หน้าล็อกอิน และแถบเมนู — แก้ได้ตอนติดตั้ง ไม่ต้องแตะโค้ด */
  APP_NAME: 'Lab Chem Stock',
  APP_TAGLINE: 'คลังสารเคมีและวัสดุ',

  /** Client ID จาก Google Cloud Console → Credentials → OAuth 2.0 Client IDs */
  CLIENT_ID: '72769441204-43k85fcl2ls4kqcl3fs4d6je3pqiebim.apps.googleusercontent.com',

  /** URL ของ Web App ที่ deploy จาก Apps Script (ลงท้ายด้วย /exec) */
  GAS_URL: 'https://script.google.com/macros/s/AKfycbx0DFgHHuO6Zj-dmTshCXsuQxr6EcxsiQnr5kWak0Fzv8LWvZLMZ11h7LeNuiqZ1OtK/exec',

  /** โดเมนที่อนุญาต — ใช้แสดงข้อความบนหน้าจอเท่านั้น (ของจริงตรวจที่ GAS) */
  DOMAIN: 'rmutr.ac.th',

  /** จำนวนแถวที่แสดงต่อครั้งในตาราง (กด "แสดงเพิ่ม" เพื่อดูต่อ) */
  PAGE_SIZE: 200,

  /** เตือนล่วงหน้ากี่วันก่อนหมดอายุ */
  EXPIRE_WARN_DAYS: 90,

  /** ต่ำกว่าเท่าไรถือว่าสต็อกใกล้หมด (หน่วยเดียวกับที่บันทึก) */
  LOW_STOCK: 100,

  /** รูปจาก Google Drive — {id} = รหัสไฟล์, {w} = ความกว้างที่ขอ (ไม่ต้องแก้) */
  PHOTO_URL: 'https://lh3.googleusercontent.com/d/{id}=w{w}',
  PHOTO_FALLBACK_URL: 'https://drive.google.com/thumbnail?id={id}&sz=w{w}',

  /** ขนาดรูปหลังย่อที่เบราว์เซอร์ (ด้านยาวสุด, พิกเซล) */
  PHOTO_MAX_SIDE_PLACE: 1600,
  PHOTO_MAX_SIDE_ITEM: 1100,

  // ต้องตรงกับ MAX_PHOTOS_PER_OWNER ใน Config.gs — ใช้บอกโควตาตั้งแต่ตอนเลือกรูป
  PHOTO_MAX_PER_OWNER: 8
};
