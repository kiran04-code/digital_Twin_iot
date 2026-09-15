import { PACKET_RATE } from './config.js';

// Shared by the in-browser test source and the real local WebSocket test server.
export function createDummyTelemetry(elapsedSeconds, seq, timestamp = Date.now()) {
  const t = elapsedSeconds;
  const round = value => +value.toFixed(3);
  return {
    type: 'telemetry', seq, timestamp, units: 'degrees',
    joints: {
      base: round(55 * Math.sin(t * 0.48)),
      shoulder: round(90 + 28 * Math.sin(t * 0.36)),
      elbow: round(90 + 24 * Math.sin(t * 0.57)),
      wrist: round(35 * Math.sin(t * 0.7)),
    },
    pitch: round(24 * Math.sin(t * 0.36)),
    roll: round(55 * Math.sin(t * 0.48)),
    electromagnet: false,
  };
}

export class DummyTelemetryStream {
  constructor(onMessage) { this.onMessage = onMessage; this.generation = 0; }
  start() {
    this.stop();
    const generation = this.generation;
    const startedAt = performance.now();
    let seq = 0;
    const tick = () => {
      if (generation !== this.generation) return;
      this.onMessage(JSON.stringify(createDummyTelemetry((performance.now() - startedAt) / 1000, seq++)));
    };
    tick(); this.timer = globalThis.setInterval(tick, 1000 / PACKET_RATE);
  }
  stop() { this.generation++; globalThis.clearInterval(this.timer); this.timer = null; }
}
