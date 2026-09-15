import { STALE_AFTER_MS, clampJointAngle } from './config.js';

export function validatePacket(packet) {
  return packet !== null && typeof packet === 'object'
    && Number.isSafeInteger(packet.gestureId) && packet.gestureId >= 0
    && ['pitch', 'roll', 'base', 'shoulder', 'elbow', 'wrist', 'timestamp'].every(key => Number.isFinite(packet[key]))
    && typeof packet.electromagnet === 'boolean'
    && ['gesture', 'manual'].includes(packet.mode)
    && Math.abs(packet.pitch) <= 180 && Math.abs(packet.roll) <= 180;
}

export class ESPNowSimulator {
  constructor(onReceive, { random = Math.random, now = () => performance.now(), schedule = (...args) => globalThis.setTimeout(...args), cancel = handle => globalThis.clearTimeout(handle) } = {}) {
    Object.assign(this, { onReceive, random, now, schedule, cancel });
    this.connected = true;
    this.packetLoss = 0;
    this.latency = 0;
    this.sent = 0;
    this.received = 0;
    this.dropped = 0;
    this.lastReceivedAt = -Infinity;
    this.lastId = -1;
    this.sendTimes = [];
    this.packets = [];
    this.pending = new Set();
    this.epoch = 0;
  }

  transmitPacket(packet) {
    this.sent++;
    this.sendTimes.push(this.now());
    if (!this.connected || this.random() * 100 < this.packetLoss) { this.dropped++; return; }
    const latency = 3 + this.random() * 12;
    const epoch = this.epoch;
    const handle = this.schedule(() => {
      this.pending.delete(handle);
      if (epoch !== this.epoch || !this.connected) return;
      this.receivePacket(packet, latency);
    }, latency);
    this.pending.add(handle);
  }

  receivePacket(packet, latency) {
    if (!validatePacket(packet) || packet.gestureId <= this.lastId) { this.dropped++; return false; }
    this.lastId = packet.gestureId;
    this.received++;
    this.latency = latency;
    this.lastReceivedAt = this.now();
    this.packets.unshift({ ...packet, latency: +latency.toFixed(2) });
    this.packets.length = Math.min(this.packets.length, 15);
    this.onReceive(packet);
    return true;
  }

  setPacketLoss(percent) { this.packetLoss = clampJointAngle(percent, 0, 10); }
  setConnected(value) { this.connected = value; if (!value) this.flush(); }
  flush() {
    this.epoch++;
    this.dropped += this.pending.size;
    for (const handle of this.pending) this.cancel(handle);
    this.pending.clear();
  }
  getStatistics() {
    const now = this.now();
    this.sendTimes = this.sendTimes.filter(time => time > now - 1000);
    const stale = now - this.lastReceivedAt > STALE_AFTER_MS;
    return {
      status: !this.connected ? 'DISCONNECTED' : stale ? 'DELAYED' : 'ACTIVE',
      stale, connected: this.connected, latency: this.latency,
      rate: this.sendTimes.length, sent: this.sent, received: this.received,
      loss: this.sent ? this.dropped / this.sent * 100 : 0,
      configuredLoss: this.packetLoss,
    };
  }
  dispose() { this.flush(); }
}
