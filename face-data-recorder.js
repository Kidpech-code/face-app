/**
 * FaceDataRecorder — Enterprise-grade, zero-GC facial motion capture recorder.
 *
 * ARCHITECTURE
 * ============
 * 1. DATA SCHEMA DECISION: Blendshapes (primary) + Landmarks (optional)
 *    - 52 ARKit Blendshapes are THE industry standard for facial animation.
 *      Every major engine (Unreal MetaHuman, Unity ARKit Face, Houdini, Maya)
 *      consumes this format natively. 52 floats/frame = 208 bytes.
 *    - 478 3D Landmarks are useful for spatial analysis, but are NOT directly
 *      consumable by animation pipelines without a custom retargeting solver.
 *      1434 floats/frame = 5,736 bytes (27x heavier). Record only when needed.
 *
 * 2. MEMORY STRATEGY: Pre-allocated ArrayBuffer + TypedArray views.
 *    - ZERO object allocation during recording = ZERO GC pressure.
 *    - Frame writes are direct memory copies via Float32Array indexing.
 *    - At 60 FPS with blendshapes-only: 5 min = ~3.7 MB. Trivial.
 *
 * 3. EXPORT STRATEGY: Off-main-thread via inline Web Worker.
 *    - Binary (.facecap): Compact, fast to write/read. ~3.7 MB for 5 min.
 *    - JSON: For interop with external tools. Serialized off-thread.
 *
 * FRAME BINARY LAYOUT (blendshapes-only mode, stride = 216 bytes)
 * ┌─────────────────────┬──────────────────────────────────────┐
 * │ Float64 (8 bytes)   │ Timestamp (ms, relative to start)   │
 * ├─────────────────────┼──────────────────────────────────────┤
 * │ Float32 × 52        │ ARKit Blendshape scores [0..1]      │
 * │ (208 bytes)         │                                     │
 * └─────────────────────┴──────────────────────────────────────┘
 *
 * FRAME BINARY LAYOUT (full mode, stride = 5,952 bytes)
 * ┌─────────────────────┬──────────────────────────────────────┐
 * │ Float64 (8 bytes)   │ Timestamp (ms, relative to start)   │
 * ├─────────────────────┼──────────────────────────────────────┤
 * │ Float32 × 52        │ ARKit Blendshape scores [0..1]      │
 * │ (208 bytes)         │                                     │
 * ├─────────────────────┼──────────────────────────────────────┤
 * │ Float32 × 1434      │ 478 landmarks × (x, y, z)           │
 * │ (5,736 bytes)       │                                     │
 * └─────────────────────┴──────────────────────────────────────┘
 */

// ═══════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════

const BLENDSHAPE_COUNT = 52;
const LANDMARK_COUNT = 478;
const LANDMARK_DIMS = 3;

const TIMESTAMP_BYTES = 8;                                  // Float64
const BLENDSHAPE_BYTES = BLENDSHAPE_COUNT * 4;              // 52 × Float32 = 208
const LANDMARK_BYTES = LANDMARK_COUNT * LANDMARK_DIMS * 4;  // 478 × 3 × Float32 = 5736

// Canonical ARKit blendshape names (MediaPipe output order)
const ARKIT_BLENDSHAPE_NAMES = [
    '_neutral', 'browDownLeft', 'browDownRight', 'browInnerUp',
    'browOuterUpLeft', 'browOuterUpRight', 'cheekPuff',
    'cheekSquintLeft', 'cheekSquintRight', 'eyeBlinkLeft',
    'eyeBlinkRight', 'eyeLookDownLeft', 'eyeLookDownRight',
    'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft',
    'eyeLookOutRight', 'eyeLookUpLeft', 'eyeLookUpRight',
    'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft',
    'eyeWideRight', 'jawForward', 'jawLeft', 'jawOpen',
    'jawRight', 'mouthClose', 'mouthDimpleLeft', 'mouthDimpleRight',
    'mouthFrownLeft', 'mouthFrownRight', 'mouthFunnel', 'mouthLeft',
    'mouthLowerDownLeft', 'mouthLowerDownRight', 'mouthPressLeft',
    'mouthPressRight', 'mouthPucker', 'mouthRight', 'mouthRollLower',
    'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper',
    'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft',
    'mouthStretchRight', 'mouthUpperUpLeft', 'mouthUpperUpRight',
    'noseSneerLeft', 'noseSneerRight'
];

// ═══════════════════════════════════════════════════════════════
//  WEB WORKER SOURCE (inline, no separate file needed)
// ═══════════════════════════════════════════════════════════════

const WORKER_SOURCE = `
const TIMESTAMP_BYTES = 8;
const BLENDSHAPE_COUNT = 52;
const BLENDSHAPE_BYTES = BLENDSHAPE_COUNT * 4;
const LANDMARK_COUNT = 478;
const LANDMARK_DIMS = 3;

self.onmessage = function(e) {
    const { action, data } = e.data;

    if (action === 'exportBinary') {
        const { header, payload } = data;
        const headerJSON = JSON.stringify(header);
        const headerBytes = new TextEncoder().encode(headerJSON);

        // Binary format: [4-byte header length LE][header JSON UTF-8][raw frame data]
        const totalSize = 4 + headerBytes.length + payload.byteLength;
        const output = new ArrayBuffer(totalSize);
        const view = new DataView(output);

        view.setUint32(0, headerBytes.length, true);
        new Uint8Array(output, 4, headerBytes.length).set(headerBytes);
        new Uint8Array(output, 4 + headerBytes.length).set(new Uint8Array(payload));

        self.postMessage(
            { result: new Blob([output], { type: 'application/octet-stream' }) }
        );
    }

    if (action === 'exportJSON') {
        const { meta, payload } = data;
        const dv = new DataView(payload);
        const f32 = new Float32Array(payload);
        const frames = new Array(meta.frameCount);

        for (let i = 0; i < meta.frameCount; i++) {
            const offset = i * meta.frameStride;
            const timestamp = dv.getFloat64(offset, true);

            const bsOffset = (offset + TIMESTAMP_BYTES) >> 2;
            const blendshapes = {};
            for (let j = 0; j < BLENDSHAPE_COUNT; j++) {
                blendshapes[meta.blendshapeNames[j]] = Math.round(f32[bsOffset + j] * 1e6) / 1e6;
            }

            const frame = { t: Math.round(timestamp * 100) / 100, bs: blendshapes };

            if (meta.hasLandmarks) {
                const lmOffset = (offset + TIMESTAMP_BYTES + BLENDSHAPE_BYTES) >> 2;
                const landmarks = new Array(LANDMARK_COUNT);
                for (let k = 0; k < LANDMARK_COUNT; k++) {
                    const base = lmOffset + k * LANDMARK_DIMS;
                    landmarks[k] = [
                        Math.round(f32[base]     * 1e6) / 1e6,
                        Math.round(f32[base + 1] * 1e6) / 1e6,
                        Math.round(f32[base + 2] * 1e6) / 1e6
                    ];
                }
                frame.lm = landmarks;
            }

            frames[i] = frame;
        }

        const result = JSON.stringify({ meta, frames });
        self.postMessage(
            { result: new Blob([result], { type: 'application/json' }) }
        );
    }
};
`;

// ═══════════════════════════════════════════════════════════════
//  FaceDataRecorder CLASS
// ═══════════════════════════════════════════════════════════════

export class FaceDataRecorder {
    /**
     * @param {Object}  [options]
     * @param {number}  [options.maxDurationSec=300]  Max recording length (seconds).
     * @param {number}  [options.fps=60]              Expected capture frame rate.
     * @param {boolean} [options.recordLandmarks=false] Also record 478 3D landmarks.
     */
    constructor({ maxDurationSec = 300, fps = 60, recordLandmarks = false } = {}) {
        this._fps = fps;
        this._recordLandmarks = recordLandmarks;

        // Frame stride (bytes per frame) — guaranteed 8-byte aligned for Float64
        this._frameStride = TIMESTAMP_BYTES + BLENDSHAPE_BYTES;
        if (recordLandmarks) {
            this._frameStride += LANDMARK_BYTES;
        }

        // Pre-allocate the full buffer up front — no runtime allocation
        const maxFrames = maxDurationSec * fps;
        this._maxFrames = maxFrames;
        this._buffer = new ArrayBuffer(maxFrames * this._frameStride);
        this._dataView = new DataView(this._buffer);
        this._f32 = new Float32Array(this._buffer);

        // State
        this._frameCount = 0;
        this._recording = false;
        this._startTime = 0;
    }

    // ─── Public getters ──────────────────────────────────────

    get isRecording()  { return this._recording; }
    get frameCount()   { return this._frameCount; }
    get maxFrames()    { return this._maxFrames; }

    get durationMs() {
        if (this._frameCount < 2) return 0;
        return this._readTimestamp(this._frameCount - 1) - this._readTimestamp(0);
    }

    get memoryUsageMB() {
        return (this._frameCount * this._frameStride) / (1024 * 1024);
    }

    get bufferUsagePercent() {
        return (this._frameCount / this._maxFrames) * 100;
    }

    // ─── Recording controls ─────────────────────────────────

    start() {
        this._frameCount = 0;
        this._startTime = performance.now();
        this._recording = true;
    }

    stop() {
        this._recording = false;
    }

    reset() {
        this._frameCount = 0;
        this._recording = false;
    }

    // ─── Core: record a single frame (HOT PATH — zero alloc) ────

    /**
     * Write one frame of face data into the pre-allocated buffer.
     * Called once per rAF tick from the render loop.
     *
     * PERFORMANCE CONTRACT:
     *   - Zero object allocation
     *   - Zero array creation
     *   - Pure typed-array index writes
     *   - O(n) where n = blendshape count (52) or landmark count (478)
     *
     * @param {number} timestampMs   performance.now() value
     * @param {Array}  blendshapes   MediaPipe blendshapes: [{categoryName, score}, ...]
     * @param {Array}  [landmarks]   MediaPipe landmarks: [{x, y, z}, ...]
     */
    recordFrame(timestampMs, blendshapes, landmarks) {
        if (!this._recording || this._frameCount >= this._maxFrames) return;

        const byteOffset = this._frameCount * this._frameStride;

        // ── Timestamp (Float64, 8 bytes) ──
        this._dataView.setFloat64(byteOffset, timestampMs - this._startTime, true);

        // ── Blendshapes (Float32 × 52) ──
        const bsIndex = (byteOffset + TIMESTAMP_BYTES) >> 2; // byte→float32 index
        const len = blendshapes.length < BLENDSHAPE_COUNT ? blendshapes.length : BLENDSHAPE_COUNT;
        for (let i = 0; i < len; i++) {
            this._f32[bsIndex + i] = blendshapes[i].score;
        }

        // ── Landmarks (Float32 × 1434) — optional ──
        if (this._recordLandmarks && landmarks) {
            const lmIndex = (byteOffset + TIMESTAMP_BYTES + BLENDSHAPE_BYTES) >> 2;
            const lmLen = landmarks.length < LANDMARK_COUNT ? landmarks.length : LANDMARK_COUNT;
            for (let i = 0; i < lmLen; i++) {
                const base = lmIndex + i * 3;
                this._f32[base]     = landmarks[i].x;
                this._f32[base + 1] = landmarks[i].y;
                this._f32[base + 2] = landmarks[i].z;
            }
        }

        this._frameCount++;
    }

    // ─── Export: off-thread serialization ────────────────────

    /**
     * Export as compact binary (.facecap format).
     * Serialization runs in a Web Worker — non-blocking.
     * @returns {Promise<Blob>}
     */
    async exportBinary() {
        this._assertHasFrames();
        const payload = this._sliceUsedBuffer();

        const header = this._buildMeta();
        return this._offThreadExport('exportBinary', { header, payload }, [payload]);
    }

    /**
     * Export as JSON for interop with external tools (Blender, Houdini, etc).
     * Serialization runs in a Web Worker — non-blocking.
     * @returns {Promise<Blob>}
     */
    async exportJSON() {
        this._assertHasFrames();
        const payload = this._sliceUsedBuffer();

        const meta = this._buildMeta();
        return this._offThreadExport('exportJSON', { meta, payload }, [payload]);
    }

    /** Trigger browser download of binary capture file. */
    async downloadBinary(filename = 'capture.facecap') {
        const blob = await this.exportBinary();
        this._triggerDownload(blob, filename);
    }

    /** Trigger browser download of JSON capture file. */
    async downloadJSON(filename = 'capture.json') {
        const blob = await this.exportJSON();
        this._triggerDownload(blob, filename);
    }

    // ─── Private helpers ────────────────────────────────────

    _readTimestamp(frameIndex) {
        return this._dataView.getFloat64(frameIndex * this._frameStride, true);
    }

    _assertHasFrames() {
        if (this._frameCount === 0) {
            throw new Error('FaceDataRecorder: No frames recorded.');
        }
    }

    _sliceUsedBuffer() {
        return this._buffer.slice(0, this._frameCount * this._frameStride);
    }

    _buildMeta() {
        return {
            version: 1,
            frameCount: this._frameCount,
            frameStride: this._frameStride,
            fps: this._fps,
            hasLandmarks: this._recordLandmarks,
            blendshapeNames: ARKIT_BLENDSHAPE_NAMES,
            durationMs: this.durationMs,
        };
    }

    /**
     * Spawn an inline Web Worker, transfer the payload buffer, and
     * resolve with the serialized Blob when the worker completes.
     */
    _offThreadExport(action, data, transferables) {
        return new Promise((resolve, reject) => {
            const blob = new Blob([WORKER_SOURCE], { type: 'application/javascript' });
            const url = URL.createObjectURL(blob);
            const worker = new Worker(url);

            worker.onmessage = (e) => {
                resolve(e.data.result);
                worker.terminate();
                URL.revokeObjectURL(url);
            };

            worker.onerror = (err) => {
                reject(new Error(`Export worker failed: ${err.message}`));
                worker.terminate();
                URL.revokeObjectURL(url);
            };

            worker.postMessage({ action, data }, transferables);
        });
    }

    _triggerDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}
