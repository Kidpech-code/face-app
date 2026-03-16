# Face UI Engine ⚡

ระบบตรวจจับใบหน้าแบบ Real-time พร้อมบันทึกข้อมูล Facial Motion Capture ระดับ Production

---

## 1. โครงสร้างโปรเจ็ก

```
face-app/
├── index.html              ← แอปหลัก (UI + กล้อง + วาด Landmark)
├── face-data-recorder.js   ← โมดูลบันทึกข้อมูลใบหน้า (Zero-GC, TypedArray)
└── README.md               ← เอกสารนี้
```

| ไฟล์                      | หน้าที่                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| **index.html**            | เปิดกล้อง → รัน AI ตรวจจับใบหน้า → วาด Landmark บน Canvas → ส่งข้อมูลเข้า Recorder            |
| **face-data-recorder.js** | รับข้อมูลใบหน้า 60 เฟรม/วินาที → เก็บลง ArrayBuffer → Export เป็น Binary/JSON ผ่าน Web Worker |

---

## 2. Tech Stack

| เทคโนโลยี                      | ใช้ทำอะไร                                              |
| ------------------------------ | ------------------------------------------------------ |
| **MediaPipe Face Landmarker**  | AI ตรวจจับจุดบนใบหน้า 478 จุด + 52 Blendshapes (ARKit) |
| **WebAssembly + GPU Delegate** | ประมวลผล AI บน Hardware Acceleration                   |
| **Canvas 2D**                  | วาด Landmark, ตาข่ายใบหน้า, คิ้ว, ตา, ปาก              |
| **TypedArray (Float32Array)**  | เก็บข้อมูลใบหน้าแบบ Zero-GC ไม่กระตุก                  |
| **Web Worker (inline)**        | Export ข้อมูลนอก Main Thread ไม่บล็อกหน้าจอ            |
| **ES Modules**                 | โครงสร้างโค้ดแบบ Module ไม่ต้อง Build Tool             |

### วิธีรัน

**ต้องรันผ่าน HTTP Server** (ES Modules ไม่ทำงานกับ `file://`)

```bash
# วิธีที่ 1 — Python (มีติดตั้งมาแล้วบน macOS)
cd face-app
python3 -m http.server 8000

# วิธีที่ 2 — Node.js
npx serve .
```

เปิดเบราว์เซอร์ไปที่ **http://localhost:8000** → **อนุญาตกล้อง**

---

## 3. วิธีใช้งาน

### เปิดแอป

1. รัน Server ตามด้านบน
2. เปิดเบราว์เซอร์ → กด **Allow** ให้ใช้กล้อง
3. จะเห็นหน้าตัวเองพร้อมเส้น Landmark วาดทับ

### บันทึกข้อมูลใบหน้า

1. กดปุ่ม **● Record** — เริ่มบันทึก (จะเห็นจุดแดงกระพริบ + สถิติเฟรม/เวลา/ขนาด)
2. กดปุ่ม **■ Stop** — หยุดบันทึก
3. กดปุ่ม **↓ Binary** หรือ **↓ JSON** — ดาวน์โหลดไฟล์ข้อมูล

### ไฟล์ที่ได้

| รูปแบบ     | ไฟล์              | เหมาะกับ                                           |
| ---------- | ----------------- | -------------------------------------------------- |
| **Binary** | `capture.facecap` | ไฟล์เล็ก, อ่านเร็ว, ใช้กับระบบของตัวเอง            |
| **JSON**   | `capture.json`    | เปิดอ่านได้ทันที, นำเข้า Blender / Houdini / Unity |

### ตัวอย่างข้อมูล JSON ที่ได้

```json
{
  "meta": {
    "version": 1,
    "frameCount": 3600,
    "fps": 60,
    "hasLandmarks": true,
    "durationMs": 60000
  },
  "frames": [
    {
      "t": 0,
      "bs": {
        "browDownLeft": 0.012,
        "eyeBlinkLeft": 0.95,
        "jawOpen": 0.34,
        "mouthSmileLeft": 0.78
      },
      "lm": [
        [0.513, 0.342, -0.028],
        [0.518, 0.339, -0.031]
      ]
    }
  ]
}
```

- **`t`** = เวลา (มิลลิวินาที นับจากเริ่มบันทึก)
- **`bs`** = 52 ค่า Blendshape (0–1) เช่น กระพริบตา, ยิ้ม, อ้าปาก
- **`lm`** = พิกัด 478 จุดบนใบหน้า [x, y, z] (มีเฉพาะเมื่อเปิด `recordLandmarks: true`)
