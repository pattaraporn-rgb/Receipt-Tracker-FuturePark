# คู่มือการใช้งาน Receipt Tracker

## แก้ไขชื่อร้านค้า (Store Name)

**ใช้ Template 1** อัพโหลดซ้ำ ใส่ store_id เดิม + ชื่อใหม่

| store_id | store_name |
|----------|------------|
| 100033 | ชื่อใหม่ที่ต้องการ |

ระบบจะ update ชื่อให้อัตโนมัติ (upsert) — ไม่สร้าง row ซ้ำ

---

## แก้ไขยอดใบเสร็จ / Drive

**ใช้ Template 2** พร้อมกำหนด mode ต่อ row

| store_id | drive_name | receipts | mode |
|----------|------------|----------|------|
| 100033 | Drive A | 150 | replace |
| 100033 | Drive B | 50 | add |

### mode มี 2 แบบ

| mode | ความหมาย | ใช้เมื่อไหร่ |
|------|----------|-------------|
| `replace` | เขียนทับยอดเดิมทั้งหมดของ drive นั้น | อัพยอดปัจจุบันที่ถูกต้อง |
| `add` | บวกเพิ่มจากยอดเดิม | มีใบเสร็จเพิ่มเข้ามาใหม่ |

> **ใช้ทั้ง 2 mode ในไฟล์เดียวกันได้** — แต่ละ row มี mode ของตัวเอง  
> ตัวอย่าง: row1 replace Drive A (ตั้งยอดใหม่), row2 add Drive B (บวกเพิ่ม)

### เพิ่ม Drive ใหม่
ใช้ Template 2 mode=`add` — ถ้า drive ยังไม่มีในระบบ จะสร้างให้อัตโนมัติ

---

## แก้ Store ID — ต้องแก้ใน Google Sheets โดยตรง

Store ID เป็น primary key ทุกอย่างผูกกับมัน ถ้าเปลี่ยน ID ผ่านหน้าเว็บ ข้อมูล receipts และ RF จะขาดหายทันที

### ขั้นตอน
1. เปิด Google Sheets
2. แก้ `store_id` ให้ตรงกันทุก sheet ที่มี:
   - sheet **stores** (store_id, store_name)
   - sheet **receipts** (store_id, drive_name, ...)
   - sheet **roboflow** (store_id, roboflow_count)
3. กลับมาที่เว็บ → กด **Refresh / Sync**

> **ไม่ต้องลบ row เก่า** — ระบบเก็บ 1 row ต่อ store_id แต่ต้องแก้ทุก sheet ให้ตรงกัน ไม่ใช่แค่ row ใดrow หนึ่ง

---

## แก้ชื่อ Drive — ต้องแก้ใน Google Sheets โดยตรง

ระบบไม่มีคำสั่ง rename drive ทำได้ 2 ทาง:

**ทาง A — เพิ่ม drive ใหม่ชื่อใหม่ (drive เก่าค้างอยู่)**
- ใช้ Template 2 mode=`add` ชื่อ drive ใหม่
- drive เก่ายังค้างอยู่ในระบบ (ยอดไม่หาย)

**ทาง B — แก้ชื่อตรงใน Google Sheets**
1. เปิด Google Sheets → sheet receipts
2. หา row ที่มีชื่อ drive เก่า → แก้ชื่อ
3. กลับมาที่เว็บ → กด Refresh / Sync

---

## แยก Drive เดิมออกเป็นหลาย Drive (ไม่ให้ยอดบวมเป็น 2 เท่า)

**สถานการณ์:** มี `OUTPUT_organized3 = 30 ใบ` อยากแยกเป็น Drive1/Drive2/Drive3 อย่างละ 10 ใบ

### ⚠️ ทำแบบนี้ผิด — ยอดจะกลายเป็น 60

| store_id | drive_name | receipts | mode |
|---|---|---|---|
| 100033 | Drive1 | 10 | add |
| 100033 | Drive2 | 10 | add |
| 100033 | Drive3 | 10 | add |

```
OUTPUT_organized3 ยังอยู่ = 30
+ Drive1+2+3 = 30
รวม = 60 ❌
```

---

### ✅ วิธีที่ถูก — ใช้ไฟล์เดียว Template 2

ใส่ `OUTPUT_organized3` บรรทัดแรก mode=`replace` ค่า 0 เพื่อเคลียร์ยอดเดิมก่อน แล้วค่อย add drive ใหม่

| store_id | drive_name | receipts | mode |
|---|---|---|---|
| 100033 | OUTPUT_organized3 | 0 | replace |
| 100033 | Drive1 | 10 | add |
| 100033 | Drive2 | 10 | add |
| 100033 | Drive3 | 10 | add |

```
OUTPUT_organized3: 30 → 0  (replace ตั้งเป็น 0)
Drive1: 0 + 10 = 10
Drive2: 0 + 10 = 10
Drive3: 0 + 10 = 10
รวม = 30 ✅
```

> **สำคัญ:** บรรทัด replace ต้องอยู่ก่อน add เสมอ — ระบบประมวลผลตามลำดับบรรทัด

---

## สรุปสิ่งที่แก้ได้

| สิ่งที่ต้องการแก้ | วิธี | ความยาก |
|---|---|---|
| ชื่อร้านค้า | Template 1 (upsert) | ง่าย |
| ยอดใบเสร็จ drive เดิม | Template 2 mode=replace | ง่าย |
| เพิ่ม drive ใหม่ | Template 2 mode=add | ง่าย |
| Store ID | แก้ใน Google Sheets ทุก sheet | ยาก |
| ชื่อ Drive | แก้ใน Google Sheets | ยาก |
