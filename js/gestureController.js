import { rad, deg } from './config.js';

export class GestureController {
  constructor() { this.previous = { pitch: 0, roll: 0 }; }

  sense(gesture, delta) {
    const pitch = rad(gesture.pitch);
    const roll = rad(gesture.roll);
    // Gravity in the local sensor frame, in g. Angular velocity is in degrees/s.
    const ax = -Math.sin(pitch);
    const ay = Math.sin(roll) * Math.cos(pitch);
    const az = Math.cos(roll) * Math.cos(pitch);
    const sensor = {
      ax, ay, az,
      gx: (gesture.roll - this.previous.roll) / Math.max(delta, 0.001),
      gy: (gesture.pitch - this.previous.pitch) / Math.max(delta, 0.001),
      gz: 0,
      pitch: deg(Math.atan2(-ax, Math.sqrt(ay * ay + az * az))),
      roll: deg(Math.atan2(ay, az)),
    };
    this.previous = { ...gesture };
    return sensor;
  }
}
