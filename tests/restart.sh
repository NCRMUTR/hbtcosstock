#!/bin/bash
# เริ่มเซิร์ฟเวอร์จำลองใหม่ (ข้อมูลตัวอย่างสดทุกครั้ง)
cd "$(dirname "$0")"
[ -f /tmp/hbt-mock.pid ] && kill $(cat /tmp/hbt-mock.pid) 2>/dev/null
node server.js ${1:-8799} > /tmp/hbt-mock.log 2>&1 &
echo $! > /tmp/hbt-mock.pid
sleep 1.5
tail -2 /tmp/hbt-mock.log
