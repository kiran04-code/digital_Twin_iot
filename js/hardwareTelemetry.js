import { JOINTS } from './config.js';

export const JOINT_KEYS = Object.keys(JOINTS);
// Existing model base/wrist controls are signed; USB receiver angles are servo degrees.
export const DEFAULT_MAPPING = {
  base: { scale: 1, offset: -90 }, shoulder: { scale: 1, offset: 0 },
  elbow: { scale: 1, offset: 0 }, wrist: { scale: 1, offset: -90 },
};
export const DEFAULT_LIMITS = {
  base: [45, 135], shoulder: [40, 140], elbow: [45, 135], wrist: [45, 135],
};

export function validateAngles(angles, limits = DEFAULT_LIMITS) {
  if (!angles || typeof angles !== 'object' || Array.isArray(angles)) throw new Error('Expected four joint angles.');
  return Object.fromEntries(JOINT_KEYS.map(key => {
    const value = angles[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${key} must be a finite number.`);
    if (value < limits[key][0] || value > limits[key][1]) throw new Error(`${key} is outside limits ${limits[key].join('..')}.`);
    return [key, value];
  }));
}

export function toModelAngles(angles, mapping = DEFAULT_MAPPING) {
  return validateAngles(Object.fromEntries(JOINT_KEYS.map(key => [key, angles[key] * mapping[key].scale + mapping[key].offset])),
    Object.fromEntries(JOINT_KEYS.map(key => [key, [JOINTS[key].min, JOINTS[key].max]])));
}
