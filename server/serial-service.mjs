import { EventEmitter } from 'node:events';
import { SerialPort } from 'serialport';
import { validateAngles, toModelAngles } from '../js/hardwareTelemetry.js';
import { ReceiverMotion, RECEIVER_MOTION, validateSensor } from '../js/receiverMotion.js';

const receiverLog = /^P:\s*([+-]?[\d.]+)\s+R:\s*([+-]?[\d.]+)\s*\|\s*Servo angles:\s*([+-]?[\d.]+),\s*([+-]?[\d.]+),\s*([+-]?[\d.]+),\s*([+-]?[\d.]+)\s*$/;

export const isEsp32Candidate = port => /esp32|espressif|cp210|ch340|ch910|silicon labs|wch|usb.?serial/i.test(`${port.manufacturer || ''} ${port.friendlyName || ''} ${port.pnpId || ''}`)
  || ['10c4', '1a86', '303a'].includes(port.vendorId?.toLowerCase());

/** Bounded newline framing avoids accumulating boot logs or incomplete serial messages. */
export class SerialService extends EventEmitter {
  constructor(config, { listPorts = () => SerialPort.list(), createPort = options => new SerialPort(options) } = {}) {
    super(); Object.assign(this, { config, listPorts, createPort });
    this.running = false; this.port = null; this.status = 'disconnected'; this.latestAt = 0;
    this.buffer = ''; this.dropping = false;
    this.motion = new ReceiverMotion(config.limits); this.inputMode = 'joints';
  }
  setStatus(status, detail = '') {
    if (this.status === status && this.detail === detail) return;
    this.status = status; this.detail = detail;
    this.emit('status', {
      status, detail, port: this.path || null,
      usbConnected: status !== 'disconnected' && Boolean(this.port?.isOpen),
      lastJointUpdateAt: this.latestAt || null,
    });
  }
  start() {
    if (this.running) return;
    this.running = true; void this.connect();
    this.motionTimer = setInterval(() => this.tickSensor(), RECEIVER_MOTION.updateMs);
    this.staleTimer = setInterval(() => {
      if (this.inputMode !== 'sensor' && this.port?.isOpen && Date.now() - this.latestAt > this.config.staleMs) this.setStatus('waiting', 'USB open; waiting for recent valid joint data.');
    }, Math.min(250, this.config.staleMs));
  }
  retry() {
    if (this.running && !this.retryTimer) this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.connect(); }, this.config.retryMs);
  }
  async connect() {
    if (!this.running || this.port) return;
    try {
      let path = this.config.serialPath;
      if (!path) {
        const candidates = (await this.listPorts()).filter(isEsp32Candidate);
        if (!this.running) return;
        if (candidates.length !== 1) throw new Error(candidates.length ? 'Multiple USB serial candidates; set ESP32_SERIAL_PORT explicitly.' : 'No ESP32 serial candidate found.');
        path = candidates[0].path;
      }
      this.path = path; this.buffer = ''; this.dropping = false; this.latestAt = 0;
      this.motion.reset(); this.inputMode = 'joints';
      const port = this.createPort({ path, baudRate: this.config.baudRate, autoOpen: false });
      this.port = port;
      const failed = error => {
        if (this.port !== port) return;
        this.port = null;
        this.motion.reset(); this.inputMode = 'joints';
        this.setStatus('disconnected', error?.message || 'USB serial disconnected.');
        if (port.isOpen) port.close(() => {});
        this.retry();
      };
      port.on('error', failed);
      port.on('close', () => failed());
      port.on('data', data => { if (this.running && this.port === port && port.isOpen) this.feed(data); });
      port.open(error => {
        if (this.port !== port || !this.running) { if (port.isOpen) port.close(() => {}); return; }
        if (error) failed(error);
        else this.setStatus('waiting', 'USB open; waiting for joint data.');
      });
    } catch (error) {
      this.setStatus('disconnected', error.message); this.retry();
    }
  }
  feed(chunk) {
    // Iterate bytes as characters: the protocol contains ASCII JSON numbers only.
    for (const char of chunk.toString('latin1')) {
      if (char === '\n') {
        if (!this.dropping && this.buffer.trim()) {
          try {
            const match = this.buffer.trim().match(receiverLog);
            const packet = match ? {
              base: Number(match[3]), shoulder: Number(match[4]), elbow: Number(match[5]), wrist: Number(match[6]),
              gesture: { pitch: Number(match[1]), roll: Number(match[2]) },
            } : JSON.parse(this.buffer);
            if (packet?.type === 'sensor_update') {
              this.motion.receive(packet, Date.now()); this.inputMode = 'sensor'; this.tickSensor();
            } else {
              const angles = validateAngles(packet, this.config.limits);
              const gesture = packet?.gesture ? validateSensor(packet.gesture) : undefined;
              this.publishAngles({ angles, ...(gesture && { gesture }), angleSource: 'receiver_command' });
              this.motion.reset(angles); this.inputMode = 'joints';
            }
          } catch (error) { this.emit('invalid', error.message); }
        }
        this.buffer = ''; this.dropping = false;
      } else if (!this.dropping) {
        this.buffer += char;
        if (this.buffer.length > 4096) { this.buffer = ''; this.dropping = true; this.emit('invalid', 'Serial line exceeds 4 KB.'); }
      }
    }
  }
  publishAngles(data) {
    const angles = validateAngles(data.angles, this.config.limits);
    const modelAngles = toModelAngles(angles, this.config.mapping);
    this.latestAt = Date.now(); this.setStatus('connected');
    this.emit('angles', { ...data, angles, modelAngles, timestamp: this.latestAt });
  }
  tickSensor() {
    if (this.inputMode !== 'sensor') return;
    if (this.motion.isStale(Date.now())) {
      this.setStatus(this.port?.isOpen ? 'waiting' : 'disconnected', 'Sensor stream stale; holding last calculated servo pose.');
      return;
    }
    try {
      const pose = this.motion.step(Date.now());
      if (pose) this.publishAngles({ ...pose, angleSource: 'calculated' });
    } catch (error) { this.emit('invalid', error.message); }
  }
  stop() {
    this.running = false; clearTimeout(this.retryTimer); clearInterval(this.staleTimer); clearInterval(this.motionTimer); this.retryTimer = null;
    this.motion.reset(); this.inputMode = 'joints';
    const port = this.port; this.port = null;
    if (port?.isOpen) port.close(() => {});
    this.setStatus('disconnected', 'Serial service stopped.');
  }
}
