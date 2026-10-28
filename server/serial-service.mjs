import { EventEmitter } from 'node:events';
import { SerialPort } from 'serialport';
import { validateAngles, toModelAngles } from '../js/hardwareTelemetry.js';

export const isEsp32Candidate = port => /esp32|espressif|cp210|ch340|ch910|silicon labs|wch|usb.?serial/i.test(`${port.manufacturer || ''} ${port.friendlyName || ''} ${port.pnpId || ''}`)
  || ['10c4', '1a86', '303a'].includes(port.vendorId?.toLowerCase());

/** Bounded newline framing avoids accumulating boot logs or incomplete serial messages. */
export class SerialService extends EventEmitter {
  constructor(config, { listPorts = () => SerialPort.list(), createPort = options => new SerialPort(options) } = {}) {
    super(); Object.assign(this, { config, listPorts, createPort });
    this.running = false; this.port = null; this.status = 'disconnected'; this.latestAt = 0;
    this.buffer = ''; this.dropping = false;
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
    this.staleTimer = setInterval(() => {
      if (this.port?.isOpen && Date.now() - this.latestAt > this.config.staleMs) this.setStatus('waiting', 'USB open; waiting for recent valid joint data.');
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
      const port = this.createPort({ path, baudRate: this.config.baudRate, autoOpen: false });
      this.port = port;
      const failed = error => {
        if (this.port !== port) return;
        this.port = null;
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
            const angles = validateAngles(JSON.parse(this.buffer), this.config.limits);
            const modelAngles = toModelAngles(angles, this.config.mapping);
            this.latestAt = Date.now(); this.setStatus('connected');
            this.emit('angles', { angles, modelAngles, timestamp: this.latestAt });
          } catch (error) { this.emit('invalid', error.message); }
        }
        this.buffer = ''; this.dropping = false;
      } else if (!this.dropping) {
        this.buffer += char;
        if (this.buffer.length > 4096) { this.buffer = ''; this.dropping = true; this.emit('invalid', 'Serial line exceeds 4 KB.'); }
      }
    }
  }
  stop() {
    this.running = false; clearTimeout(this.retryTimer); clearInterval(this.staleTimer); this.retryTimer = null;
    const port = this.port; this.port = null;
    if (port?.isOpen) port.close(() => {});
    this.setStatus('disconnected', 'Serial service stopped.');
  }
}
