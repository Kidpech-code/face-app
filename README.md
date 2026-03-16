# Face App ⚡

ระบบ AI ใบหน้าครบวงจรในเบราว์เซอร์ — ตรวจจับ Landmark, บันทึก Motion Capture และ **ล็อกอินด้วยใบหน้า** พร้อม Anti-Spoofing

---

## 1. โครงสร้างโปรเจ็ก

```
face-app/
├── index.html              ← แอป Face Landmark + Motion Capture Recorder
├── face-data-recorder.js   ← โมดูลบันทึกข้อมูลใบหน้า (Zero-GC, TypedArray)
├── face-auth.html          ← แอป Face Login (ลงทะเบียน + เข้าสู่ระบบด้วยใบหน้า)
├── liveness-detector.js    ← โมดูล Anti-Spoofing (ตรวจว่าเป็นคนจริง)
├── face-recognition.js     ← โมดูลจดจำใบหน้า (128D Embedding + Similarity)
└── README.md
```

โปรเจ็กมี **2 แอปแยกกัน** ทำงานอิสระ:

| แอป               | URL               | หน้าที่                                                                            |
| ----------------- | ----------------- | ---------------------------------------------------------------------------------- |
| **Face Landmark** | `/index.html`     | เปิดกล้อง → วาด Landmark 478 จุด → บันทึก Blendshapes + Landmarks เป็น Binary/JSON |
| **Face Auth**     | `/face-auth.html` | ลงทะเบียนใบหน้า → ท้าทาย Liveness → ล็อกอินเทียบความเหมือน                         |

### รายละเอียดแต่ละไฟล์

| ไฟล์                      | หน้าที่                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **index.html**            | เปิดกล้อง → รัน MediaPipe Face Landmarker → วาด Landmark/Mesh/Lips/Eyes บน Canvas → ส่งข้อมูลเข้า Recorder |
| **face-data-recorder.js** | รับข้อมูลใบหน้า 60 FPS → เก็บลง Pre-allocated ArrayBuffer (Zero-GC) → Export Binary/JSON ผ่าน Web Worker   |
| **face-auth.html**        | UI สำหรับ Register/Login ด้วยใบหน้า — รวม Liveness + Recognition เข้าด้วยกัน                               |
| **liveness-detector.js**  | สุ่มคำสั่ง (กะพริบตา, ยิ้ม, หันหน้า ฯลฯ) → ตรวจสอบจาก Blendshapes แบบ Real-time → ป้องกันรูปภาพ/วิดีโอปลอม |
| **face-recognition.js**   | โหลด `@vladmandic/face-api` → สกัด 128D Face Embedding → คำนวณ Euclidean Distance → คืนค่า Similarity %    |

---

## 2. Tech Stack

### Core AI

| เทคโนโลยี                               | ใช้ทำอะไร                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| **MediaPipe Face Landmarker** (v0.10.3) | AI ตรวจจับจุดบนใบหน้า 478 จุด + 52 Blendshapes (ARKit) — ใช้สำหรับ Liveness Detection |
| **@vladmandic/face-api** (v1.7.14)      | สกัด 128D Face Descriptor สำหรับเทียบตัวตน (fork ที่ยังอัปเดตของ face-api.js)         |
| **TensorFlow.js** (WebGL backend)       | รัน Face Recognition Neural Network ในเบราว์เซอร์                                     |

### Performance & Architecture

| เทคโนโลยี                      | ใช้ทำอะไร                                                         |
| ------------------------------ | ----------------------------------------------------------------- |
| **WebAssembly + GPU Delegate** | ประมวลผล AI ด้วย Hardware Acceleration                            |
| **Canvas 2D**                  | วาด Landmark, ตาข่ายใบหน้า, คิ้ว, ตา, ปาก                         |
| **TypedArray (Float32Array)**  | เก็บข้อมูลใบหน้าแบบ Zero-GC ไม่กระตุก                             |
| **Web Worker (inline)**        | Export ข้อมูลนอก Main Thread ไม่บล็อกหน้าจอ                       |
| **ES Modules**                 | โครงสร้างโค้ดแบบ Module — ไม่ต้อง Build Tool, ไม่ต้อง npm install |

### วิธีรัน

**ต้องรันผ่าน HTTP Server** (ES Modules ไม่ทำงานกับ `file://`)

```bash
# วิธีที่ 1 — Python (มีติดตั้งมาแล้วบน macOS)
cd face-app
python3 -m http.server 8000

# วิธีที่ 2 — Node.js
npx serve .
```

เปิดเบราว์เซอร์:

- **http://localhost:8000** → Face Landmark + Motion Capture
- **http://localhost:8000/face-auth.html** → Face Login System

> ทุกอย่างรันในเบราว์เซอร์ ไม่ต้องติดตั้งอะไรเพิ่ม ไม่ต้อง Backend

---

## 3. วิธีใช้งาน

### แอป 1: Face Landmark + Motion Capture (`index.html`)

**เปิดแอป**

1. รัน Server → เปิด `http://localhost:8000`
2. กด **Allow** ให้ใช้กล้อง
3. จะเห็นหน้าตัวเองพร้อมเส้น Landmark วาดทับ (ตาข่าย, ตา, คิ้ว, ปาก, กรอบหน้า)

**บันทึกข้อมูลใบหน้า**

1. กดปุ่ม **● Record** — เริ่มบันทึก (จุดแดงกระพริบ + สถิติเฟรม/เวลา/ขนาด)
2. กดปุ่ม **■ Stop** — หยุดบันทึก
3. กดปุ่ม **↓ Binary** หรือ **↓ JSON** — ดาวน์โหลดไฟล์

| รูปแบบ     | ไฟล์              | เหมาะกับ                                           |
| ---------- | ----------------- | -------------------------------------------------- |
| **Binary** | `capture.facecap` | ไฟล์เล็ก, อ่านเร็ว, ใช้กับระบบของตัวเอง            |
| **JSON**   | `capture.json`    | เปิดอ่านได้ทันที, นำเข้า Blender / Houdini / Unity |

---

### แอป 2: Face Login System (`face-auth.html`)

```
ขั้นตอนการทำงาน:

  ลงทะเบียน                          เข้าสู่ระบบ
  ──────────                          ──────────
  กดปุ่ม Register                     กดปุ่ม Login
       │                                  │
       ▼                                  ▼
  ระบบสุ่มคำสั่ง                      ระบบสุ่มคำสั่ง
  (เช่น "กะพริบตา 2 ครั้ง")           (เช่น "ยิ้มกว้างๆ")
       │                                  │
       ▼                                  ▼
  ทำตามคำสั่งภายใน 10 วินาที           ทำตามคำสั่งภายใน 10 วินาที
       │                                  │
       ▼                                  ▼
  ✓ ถ่ายภาพ + สกัด Descriptor         ✓ ถ่ายภาพ + สกัด Descriptor
  ✓ บันทึกเป็นฐาน (128D)              ✓ เทียบกับฐาน → Similarity %
                                           │
                                      ┌────┴────┐
                                    ≥50%       <50%
                                   ACCESS     ACCESS
                                   GRANTED    DENIED
```

**ขั้นตอน Register (ลงทะเบียนใบหน้า)**

1. เปิด `http://localhost:8000/face-auth.html`
2. อยู่ที่แท็บ **Register Face** → กดปุ่ม **Register My Face**
3. ระบบจะสุ่มคำสั่ง Liveness เช่น "👁️ Blink twice slowly" หรือ "😊 Smile widely"
4. **ทำตามคำสั่งภายใน 10 วินาที** — ระบบจะตรวจจากกล้อง
5. ผ่านแล้ว → ระบบถ่ายภาพ + สกัด Face Descriptor → แสดง "Face registered successfully!"

**ขั้นตอน Login (เข้าสู่ระบบ)**

1. สลับไปแท็บ **Login** → กดปุ่ม **Start Login**
2. ทำตามคำสั่ง Liveness ที่สุ่มมาใหม่
3. ผ่านแล้ว → ระบบถ่ายภาพ + เทียบกับใบหน้าที่ลงทะเบียนไว้
4. แสดงผลลัพธ์: **Similarity %** + **ACCESS GRANTED** หรือ **ACCESS DENIED**

**คำสั่ง Liveness ที่ระบบจะสุ่ม (6 แบบ)**

| คำสั่ง                   | ต้องทำอะไร                         |
| ------------------------ | ---------------------------------- |
| 👁️ Blink twice slowly    | กะพริบตา 2 ครั้ง (หลับตาแล้วลืมตา) |
| 😊 Smile widely          | ยิ้มกว้าง                          |
| 😮 Open your mouth wide  | อ้าปากกว้าง                        |
| ← Turn head to the left  | หันหน้าไปทางซ้าย                   |
| → Turn head to the right | หันหน้าไปทางขวา                    |
| 🤨 Raise your eyebrows   | ยกคิ้วขึ้น                         |

---

### ตัวอย่างข้อมูล JSON (จาก Motion Capture)

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
