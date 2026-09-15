import { MathUtils } from 'three';

// Public configuration uses degrees. Servo state and joint transforms use radians.
export const JOINTS = {
  base: { label: 'Base', min: -90, max: 90, channel: 0, color: '#f2945b', signed: true },
  shoulder: { label: 'Shoulder', min: 15, max: 165, channel: 1, color: '#80b9d3' },
  elbow: { label: 'Elbow', min: 20, max: 160, channel: 2, color: '#b8a0d9' },
  wrist: { label: 'Wrist', min: -90, max: 90, channel: 3, color: '#8ac69c', signed: true },
};
export const HOME = { base: 0, shoulder: 90, elbow: 90, wrist: 0 };
export const DIMENSIONS = { baseRadius: 1.15, baseHeight: 0.5, shoulderHeight: 1.15, upperArm: 2.65, forearm: 2.35, wrist: 0.48, magnet: 0.48 };
export const GESTURE_MAPPING = {
  roll: { input: [-90, 90], base: [-90, 90] },
  pitch: { input: [-60, 60], shoulder: [35, 145], elbow: [145, 45], wrist: [-45, 45] },
};
export const PACKET_RATE = 32;
export const STALE_AFTER_MS = 500;
export const RENDER_QUALITY = {
  standard: { minRatio: 1, maxRatio: 1.5, shadowSize: 1024 },
  high: { minRatio: 2, maxRatio: 2.5, shadowSize: 2048 },
  ultra: { minRatio: 2.5, maxRatio: 3, shadowSize: 4096 },
};
// Native WebSocket telemetry. Change this to the ESP32 or bridge endpoint later.
export const SOCKET_CONFIG = {
  url: 'ws://localhost:8765',
  connectTimeoutMs: 6000,
  maxMessageBytes: 16384,
  // Optional sender timestamps must be Unix milliseconds, with synchronized clocks.
  maxFrameAgeMs: 5000,
  maxFutureSkewMs: 5000,
};
export const deg = MathUtils.radToDeg;
export const rad = MathUtils.degToRad;
export const toRadians = (angles) => Object.fromEntries(Object.entries(angles).map(([key, value]) => [key, rad(value)]));
export const toDegrees = (angles) => Object.fromEntries(Object.entries(angles).map(([key, value]) => [key, deg(value)]));

export function mapRange(value, inMin, inMax, outMin, outMax) {
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}
export function clampJointAngle(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
export function applyJointLimits(angles, warn = () => {}) {
  const result = {};
  for (const [key, config] of Object.entries(JOINTS)) {
    const requested = angles[key];
    if (!Number.isFinite(requested)) throw new TypeError(`Invalid ${key} angle`);
    result[key] = clampJointAngle(requested, config.min, config.max);
    if (result[key] !== requested) warn('Servo command clamped to safe angular limit');
  }
  return result;
}
export function mapGestureToJoints({ pitch, roll }) {
  const p = GESTURE_MAPPING.pitch;
  const r = GESTURE_MAPPING.roll;
  return {
    base: mapRange(roll, ...r.input, ...r.base),
    shoulder: mapRange(pitch, ...p.input, ...p.shoulder),
    elbow: mapRange(pitch, ...p.input, ...p.elbow),
    wrist: mapRange(pitch, ...p.input, ...p.wrist),
  };
}
export function angleToPulse(angle) {
  return 500 + (clampJointAngle(angle, 0, 180) / 180) * 2000;
}
export function jointToPulse(key, angleRadians) {
  const joint = JOINTS[key];
  const angle = deg(angleRadians);
  return angleToPulse(joint.signed ? mapRange(angle, joint.min, joint.max, 0, 180) : angle);
}
