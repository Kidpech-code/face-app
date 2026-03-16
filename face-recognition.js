/**
 * FaceRecognitionEngine — Identity matching via 128D face embeddings.
 *
 * LIBRARY CHOICE: @vladmandic/face-api
 * ═════════════════════════════════════════════════════════════════
 * ┌────────────────────────┬──────────────────────────────────────┐
 * │ Criteria               │ @vladmandic/face-api                │
 * ├────────────────────────┼──────────────────────────────────────┤
 * │ Maintained             │ Yes (active 2024+, forked from       │
 * │                        │ face-api.js which is abandoned)     │
 * │ TF.js backend          │ WebGL / WASM / CPU auto-select      │
 * │ Model size             │ ~6 MB total (SSD + Landmark + Rec)  │
 * │ Descriptor dims        │ 128D (Float32)                      │
 * │ License                │ MIT                                 │
 * │ Browser-only           │ Yes, zero server                    │
 * └────────────────────────┴──────────────────────────────────────┘
 *
 * SIMILARITY METRIC
 * ═════════════════════════════════════════════════════════════════
 * Euclidean distance between two 128D descriptors.
 *   d = 0.0 → identical faces
 *   d < 0.4 → same person (high confidence)
 *   d < 0.6 → same person (moderate confidence)
 *   d > 0.6 → different person
 *
 * Similarity % = max(0, (1 - distance / MAX_DIST)) * 100
 *   where MAX_DIST = 1.2 (practical ceiling for normalized descriptors)
 *
 * SECURITY NOTES
 * ═════════════════════════════════════════════════════════════════
 * - Raw 128D descriptors are biometric data. NEVER store in localStorage.
 * - In production: encrypt + store server-side. See face-auth.html for demo notes.
 * - This module operates in-memory only. Storage is the caller's responsibility.
 */

// CDN path for @vladmandic/face-api (ESM build)
const FACE_API_CDN = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/dist/face-api.esm.js';
const MODEL_BASE_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model/';

// ─── Similarity thresholds ───────────────────────────────────

const MATCH_THRESHOLD = 0.6;   // Euclidean distance below this = same person
const MAX_DISTANCE = 1.2;      // Practical max for percentage mapping

// ═════════════════════════════════════════════════════════════
//  FaceRecognitionEngine CLASS
// ═════════════════════════════════════════════════════════════

export class FaceRecognitionEngine {
    constructor() {
        this._faceapi = null;
        this._ready = false;
    }

    /**
     * Load face-api.js and required models.
     * Call once at app startup.
     */
    async init() {
        if (this._ready) return;

        // Dynamic import of face-api ESM
        const faceapi = await import(FACE_API_CDN);
        this._faceapi = faceapi;

        // Load the three models required for face recognition:
        // 1. SSD MobileNet v1 — face detection
        // 2. 68-point face landmarks — alignment
        // 3. Face recognition net — 128D descriptor extraction
        await Promise.all([
            faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_BASE_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_BASE_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_BASE_URL),
        ]);

        this._ready = true;
    }

    /** @returns {boolean} Whether models are loaded and ready. */
    get isReady() {
        return this._ready;
    }

    /**
     * Extract a 128D face descriptor from an image source.
     *
     * @param {HTMLVideoElement|HTMLCanvasElement|HTMLImageElement} source
     * @returns {Promise<Float32Array|null>} 128D descriptor, or null if no face detected.
     */
    async extractDescriptor(source) {
        if (!this._ready) throw new Error('FaceRecognitionEngine not initialized. Call init() first.');

        const detection = await this._faceapi
            .detectSingleFace(source)
            .withFaceLandmarks()
            .withFaceDescriptor();

        if (!detection) return null;
        return detection.descriptor; // Float32Array(128)
    }

    /**
     * Compare two 128D descriptors and return similarity metrics.
     *
     * @param {Float32Array} descriptorA — Baseline (registered) descriptor.
     * @param {Float32Array} descriptorB — New (login attempt) descriptor.
     * @returns {{ distance: number, similarity: number, match: boolean }}
     *   - distance:   Euclidean distance (lower = more similar)
     *   - similarity:  Percentage 0–100
     *   - match:      Whether distance is below the match threshold
     */
    compare(descriptorA, descriptorB) {
        if (!descriptorA || !descriptorB) {
            return { distance: Infinity, similarity: 0, match: false };
        }

        const distance = this._euclideanDistance(descriptorA, descriptorB);
        const similarity = Math.max(0, (1 - distance / MAX_DISTANCE)) * 100;
        const match = distance < MATCH_THRESHOLD;

        return {
            distance: Math.round(distance * 10000) / 10000,
            similarity: Math.round(similarity * 100) / 100,
            match,
        };
    }

    /**
     * Capture a snapshot from a video element as a temporary canvas.
     * Useful when you need a still frame for descriptor extraction.
     *
     * @param {HTMLVideoElement} videoEl
     * @returns {HTMLCanvasElement}
     */
    snapshotFromVideo(videoEl) {
        const canvas = document.createElement('canvas');
        canvas.width = videoEl.videoWidth;
        canvas.height = videoEl.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoEl, 0, 0);
        return canvas;
    }

    /**
     * Serialize a descriptor for storage/transmission.
     * @param {Float32Array} descriptor
     * @returns {number[]} Plain array of 128 floats.
     */
    serializeDescriptor(descriptor) {
        return Array.from(descriptor);
    }

    /**
     * Deserialize a descriptor from stored format.
     * @param {number[]} arr
     * @returns {Float32Array}
     */
    deserializeDescriptor(arr) {
        return new Float32Array(arr);
    }

    // ─── Internal ────────────────────────────────────────────

    _euclideanDistance(a, b) {
        let sum = 0;
        for (let i = 0; i < a.length; i++) {
            const diff = a[i] - b[i];
            sum += diff * diff;
        }
        return Math.sqrt(sum);
    }
}
