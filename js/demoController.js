import { HOME } from './config.js';

// Explicit joint-space waypoints: this is a repeatable programmed sequence.
export const PICK_POSE = { base: -32, shoulder: 49, elbow: 90, wrist: 41 };
export const PLACE_POSE = { ...PICK_POSE, base: 38 };
const LIFT = { shoulder: 78, elbow: 90, wrist: 12 };
export const DEMO_STEPS = [
  { label: 'Rotate toward the workpiece', pose: { ...HOME, base: -32 }, duration: 1.6 },
  { label: 'Lower shoulder', pose: { ...HOME, base: -32, shoulder: 60 }, duration: 1.5 },
  { label: 'Extend elbow', pose: { ...HOME, base: -32, shoulder: 60, elbow: 90 }, duration: 1.3 },
  { label: 'Align magnetic tool', pose: { ...PICK_POSE, shoulder: 60 }, duration: 1.3 },
  { label: 'Energize electromagnet', pose: { ...PICK_POSE, shoulder: 60 }, magnet: true, duration: 0.7 },
  { label: 'Approach and capture cube', pose: PICK_POSE, magnet: true, duration: 2.3, requirePickup: true },
  { label: 'Lift workpiece', pose: { base: -32, ...LIFT }, magnet: true, duration: 2 },
  { label: 'Transfer to destination', pose: { base: 38, ...LIFT }, magnet: true, duration: 2.3 },
  { label: 'Lower workpiece', pose: PLACE_POSE, magnet: true, duration: 2.5 },
  { label: 'Release workpiece', pose: PLACE_POSE, magnet: false, duration: 0.8 },
  { label: 'Raise tool clear of table', pose: { base: 38, ...LIFT }, duration: 1.6 },
  { label: 'Return to home position', pose: HOME, duration: 2 },
];

export class DemoController {
  constructor() { this.running = false; this.index = 0; this.elapsed = 0; }
  start() { this.running = true; this.index = 0; this.elapsed = 0; }
  stop() { this.running = false; }
  get step() { return DEMO_STEPS[this.index]; }
  update(delta, captured) {
    if (!this.running) return null;
    this.elapsed += delta;
    if (this.elapsed >= this.step.duration) {
      if (this.step.requirePickup && !captured) {
        if (this.elapsed > 6) { this.stop(); return { error: 'Pickup missed. Reset the objects and try again.' }; }
      } else {
        this.elapsed = 0;
        this.index++;
        if (this.index >= DEMO_STEPS.length) { this.index = DEMO_STEPS.length - 1; this.stop(); return { complete: true }; }
      }
    }
    return this.step;
  }
}
