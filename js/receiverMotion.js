import { RECEIVER_HOME, clampJointAngle } from './config.js';
import { DEFAULT_LIMITS, JOINT_KEYS } from './hardwareTelemetry.js';

// Matches the supplied receiver firmware. Angles here are raw servo degrees.
export const RECEIVER_MOTION = {
  neutralPitch: 24, neutralRoll: -1, filterAlpha: 0.20,
  updateMs: 20, maxStepDeg: 1, linkTimeoutMs: 500,
};

export function validateSensor(sample) {
  if (!sample || !Number.isFinite(sample.pitch) || !Number.isFinite(sample.roll)
      || Math.abs(sample.pitch) > 90 || Math.abs(sample.roll) > 180) {
    throw new Error('Sensor update needs finite pitch within ±90 and roll within ±180 degrees.');
  }
  return { pitch: sample.pitch, roll: sample.roll };
}

/** A receiver-side motion estimate; direct commanded angles remain authoritative. */
export class ReceiverMotion {
  constructor(limits = DEFAULT_LIMITS) { this.limits = limits; this.reset(); }
  reset(angles = RECEIVER_HOME) {
    this.current = { ...angles }; this.filtered = null; this.sample = null;
    this.receivedAt = -Infinity; this.lastStepAt = -Infinity;
  }
  receive(sample, timestamp) {
    this.sample = validateSensor(sample); this.receivedAt = timestamp;
  }
  isStale(now) { return !this.sample || now - this.receivedAt > RECEIVER_MOTION.linkTimeoutMs; }
  step(now) {
    if (this.isStale(now) || now - this.lastStepAt < RECEIVER_MOTION.updateMs) return null;
    this.lastStepAt = now;
    if (!this.filtered) this.filtered = { ...this.sample };
    else for (const key of ['pitch', 'roll']) this.filtered[key] += RECEIVER_MOTION.filterAlpha * (this.sample[key] - this.filtered[key]);
    const pitchDelta = this.filtered.pitch - RECEIVER_MOTION.neutralPitch;
    const rollDelta = this.filtered.roll - RECEIVER_MOTION.neutralRoll;
    const targets = {
      base: 90 + rollDelta * 1.5, shoulder: 90 + pitchDelta * 1.2,
      elbow: 90 - pitchDelta, wrist: 90 - pitchDelta * 0.6,
    };
    for (const key of JOINT_KEYS) {
      const target = clampJointAngle(targets[key], ...this.limits[key]);
      this.current[key] += clampJointAngle(target - this.current[key], -RECEIVER_MOTION.maxStepDeg, RECEIVER_MOTION.maxStepDeg);
    }
    return { angles: { ...this.current }, gesture: { ...this.filtered }, sensorTimestamp: this.receivedAt };
  }
}
