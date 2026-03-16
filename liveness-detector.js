/**
 * LivenessDetector — Anti-Spoofing via MediaPipe Blendshapes Challenge-Response.
 *
 * ARCHITECTURE
 * ============
 * Static photos/videos cannot reproduce real-time, random facial actions.
 * This module issues a random challenge (e.g. "Blink twice", "Turn head right")
 * and validates it against the live blendshape stream from MediaPipe Face Landmarker.
 *
 * CHALLENGES SUPPORTED:
 * ─────────────────────────────────────────────────────────────────
 * 1. BLINK        — eyeBlinkLeft + eyeBlinkRight > threshold
 * 2. SMILE        — mouthSmileLeft + mouthSmileRight > threshold
 * 3. OPEN_MOUTH   — jawOpen > threshold
 * 4. TURN_LEFT    — Derived from landmark head pose (yaw angle)
 * 5. TURN_RIGHT   — Derived from landmark head pose (yaw angle)
 * 6. RAISE_BROWS  — browInnerUp > threshold
 *
 * FLOW:
 * 1. Call pickChallenge() to get a random challenge descriptor.
 * 2. Display the instruction text to the user via UI.
 * 3. Feed every MediaPipe frame into feed(blendshapes, landmarks).
 * 4. The detector watches for the required action sequence.
 * 5. Once satisfied → status becomes 'passed'. If timeout → 'failed'.
 */

// ─── Challenge Definitions ──────────────────────────────────

const CHALLENGES = [
    {
        id: 'BLINK_TWICE',
        instruction: '👁️ Blink twice slowly',
        requiredCount: 2,
        type: 'blink',
    },
    {
        id: 'SMILE',
        instruction: '😊 Smile widely',
        requiredCount: 1,
        type: 'smile',
    },
    {
        id: 'OPEN_MOUTH',
        instruction: '😮 Open your mouth wide',
        requiredCount: 1,
        type: 'open_mouth',
    },
    {
        id: 'TURN_LEFT',
        instruction: '← Turn your head to the left',
        requiredCount: 1,
        type: 'turn_left',
    },
    {
        id: 'TURN_RIGHT',
        instruction: '→ Turn your head to the right',
        requiredCount: 1,
        type: 'turn_right',
    },
    {
        id: 'RAISE_BROWS',
        instruction: '🤨 Raise your eyebrows',
        requiredCount: 1,
        type: 'raise_brows',
    },
];

// ─── Thresholds (tuned for MediaPipe Face Landmarker v0.10.x) ───

const THRESHOLDS = {
    blink: 0.45,           // eyeBlinkLeft/Right score to count as "closed"
    blinkOpen: 0.15,       // score to count as "open" again (hysteresis)
    smile: 0.55,           // mouthSmileLeft/Right average
    openMouth: 0.50,       // jawOpen score
    turnAngle: 18,         // degrees of yaw for head turn
    raiseBrows: 0.45,      // browInnerUp score
};

const DEFAULT_TIMEOUT_MS = 10_000; // 10 seconds to complete the challenge

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Extract a blendshape score by name from the MediaPipe categories array.
 */
function bs(categories, name) {
    const entry = categories.find(c => c.categoryName === name);
    return entry ? entry.score : 0;
}

/**
 * Estimate head yaw angle from 468/478 landmarks.
 * Uses nose tip (1), left cheek (234), right cheek (454) triangle.
 */
function estimateYaw(landmarks) {
    if (!landmarks || landmarks.length < 455) return 0;
    const nose = landmarks[1];
    const leftCheek = landmarks[234];
    const rightCheek = landmarks[454];

    // Horizontal ratio: if nose is centered → 0.5, turned left → <0.5, right → >0.5
    const faceWidth = rightCheek.x - leftCheek.x;
    if (Math.abs(faceWidth) < 0.001) return 0;
    const ratio = (nose.x - leftCheek.x) / faceWidth;

    // Map ratio to approximate yaw degrees (-45 to +45)
    return (ratio - 0.5) * 90;
}

// ═════════════════════════════════════════════════════════════
//  LivenessDetector CLASS
// ═════════════════════════════════════════════════════════════

export class LivenessDetector {
    /**
     * @param {Object} [options]
     * @param {number} [options.timeoutMs=10000] Max time to complete challenge.
     */
    constructor({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
        this._timeoutMs = timeoutMs;
        this.reset();
    }

    // ─── Public API ──────────────────────────────────────────

    /**
     * Select a random challenge and start the timer.
     * @returns {{ id: string, instruction: string }}  Challenge info for UI.
     */
    pickChallenge() {
        this.reset();
        const idx = crypto.getRandomValues(new Uint32Array(1))[0] % CHALLENGES.length;
        this._challenge = CHALLENGES[idx];
        this._status = 'pending';
        this._startTime = performance.now();
        return {
            id: this._challenge.id,
            instruction: this._challenge.instruction,
        };
    }

    /**
     * Feed a frame of blendshape + landmark data.
     * Call this every frame from MediaPipe results.
     *
     * @param {Array} blendshapeCategories  MediaPipe faceBlendshapes[0].categories
     * @param {Array} landmarks             MediaPipe faceLandmarks[0] (optional, needed for head turns)
     * @returns {{ status: 'pending'|'passed'|'failed', progress: number }}
     */
    feed(blendshapeCategories, landmarks) {
        if (this._status !== 'pending') {
            return { status: this._status, progress: this._actionCount / this._challenge.requiredCount };
        }

        // Timeout check
        if (performance.now() - this._startTime > this._timeoutMs) {
            this._status = 'failed';
            return { status: 'failed', progress: this._actionCount / this._challenge.requiredCount };
        }

        this._detectAction(blendshapeCategories, landmarks);

        if (this._actionCount >= this._challenge.requiredCount) {
            this._status = 'passed';
        }

        return {
            status: this._status,
            progress: Math.min(1, this._actionCount / this._challenge.requiredCount),
        };
    }

    /** Current status. */
    get status() { return this._status; }

    /** Current challenge descriptor (null before pickChallenge). */
    get challenge() { return this._challenge; }

    /** Reset to idle state. */
    reset() {
        this._challenge = null;
        this._status = 'idle';      // idle → pending → passed | failed
        this._actionCount = 0;
        this._startTime = 0;

        // Blink state machine
        this._eyesClosed = false;
    }

    // ─── Internal Detection Logic ────────────────────────────

    _detectAction(categories, landmarks) {
        switch (this._challenge.type) {
            case 'blink':
                this._detectBlink(categories);
                break;
            case 'smile':
                this._detectSmile(categories);
                break;
            case 'open_mouth':
                this._detectOpenMouth(categories);
                break;
            case 'turn_left':
                this._detectTurn(landmarks, 'left');
                break;
            case 'turn_right':
                this._detectTurn(landmarks, 'right');
                break;
            case 'raise_brows':
                this._detectRaiseBrows(categories);
                break;
        }
    }

    /**
     * Blink detection with hysteresis state machine.
     * Eyes must close (above threshold) then re-open (below open threshold)
     * to count as one blink. Prevents counting a single long close as multiple blinks.
     */
    _detectBlink(categories) {
        const left = bs(categories, 'eyeBlinkLeft');
        const right = bs(categories, 'eyeBlinkRight');
        const avg = (left + right) / 2;

        if (!this._eyesClosed && avg > THRESHOLDS.blink) {
            // Eyes just closed
            this._eyesClosed = true;
        } else if (this._eyesClosed && avg < THRESHOLDS.blinkOpen) {
            // Eyes opened again → one blink completed
            this._eyesClosed = false;
            this._actionCount++;
        }
    }

    _detectSmile(categories) {
        const left = bs(categories, 'mouthSmileLeft');
        const right = bs(categories, 'mouthSmileRight');
        if ((left + right) / 2 > THRESHOLDS.smile) {
            this._actionCount = 1;
        }
    }

    _detectOpenMouth(categories) {
        if (bs(categories, 'jawOpen') > THRESHOLDS.openMouth) {
            this._actionCount = 1;
        }
    }

    _detectTurn(landmarks, direction) {
        const yaw = estimateYaw(landmarks);
        if (direction === 'left' && yaw < -THRESHOLDS.turnAngle) {
            this._actionCount = 1;
        } else if (direction === 'right' && yaw > THRESHOLDS.turnAngle) {
            this._actionCount = 1;
        }
    }

    _detectRaiseBrows(categories) {
        if (bs(categories, 'browInnerUp') > THRESHOLDS.raiseBrows) {
            this._actionCount = 1;
        }
    }
}
