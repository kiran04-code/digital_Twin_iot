import { JOINTS, SOCKET_CONFIG, STALE_AFTER_MS, applyJointLimits, toRadians, toDegrees } from './config.js';
import { toModelAngles, validateAngles } from './hardwareTelemetry.js';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function validateConnectionMetadata(packet) {
  if (packet.dataTimeoutMs !== undefined && (!Number.isSafeInteger(packet.dataTimeoutMs) || packet.dataTimeoutMs <= 0)) throw new Error('Invalid data timeout.');
  if (packet.stale !== undefined && typeof packet.stale !== 'boolean') throw new Error('Invalid stale flag.');
  if (packet.usbConnected !== undefined && packet.usbConnected !== null && typeof packet.usbConnected !== 'boolean') throw new Error('Invalid USB status.');
}

/** Accept nested or flat joint JSON; normalize only at this protocol boundary. */
export function parseTelemetryMessage(data, { wallNow = Date.now(), warn = () => {} } = {}) {
  let text = data;
  if (data instanceof ArrayBuffer) {
    if (data.byteLength > SOCKET_CONFIG.maxMessageBytes) throw new Error('Telemetry message exceeds 16 KB.');
    text = new TextDecoder('utf-8', { fatal: true }).decode(data);
  }
  if (typeof text !== 'string') throw new Error('Expected a JSON text message.');
  if (text.length > SOCKET_CONFIG.maxMessageBytes || new TextEncoder().encode(text).length > SOCKET_CONFIG.maxMessageBytes) throw new Error('Telemetry message exceeds 16 KB.');
  let packet;
  try { packet = JSON.parse(text); } catch { throw new Error('Invalid JSON telemetry message.'); }
  if (!isRecord(packet)) throw new Error('Telemetry must be a JSON object.');
  const hardware = packet.type === 'joint_update';
  if (packet.type !== undefined && packet.type !== 'telemetry' && !hardware) throw new Error('Expected a telemetry packet.');
  if (hardware) {
    validateConnectionMetadata(packet);
    // Raw commanded servo positions and model coordinates are distinct values.
    validateAngles(packet.angles, Object.fromEntries(Object.keys(JOINTS).map(key => [key, [-Infinity, Infinity]])));
    if (!Number.isFinite(packet.timestamp)) throw new Error('Hardware timestamp must be Unix milliseconds.');
    if (!['esp32', 'mock'].includes(packet.source)) throw new Error('Invalid hardware telemetry source.');
    if (packet.units !== undefined && packet.units !== 'degrees') throw new Error('Hardware angles must use degrees.');
  }
  const source = hardware ? (packet.modelAngles ?? toModelAngles(packet.angles)) : packet.joints ?? packet;
  if (!isRecord(source) || !Object.keys(JOINTS).every(key => typeof source[key] === 'number' && Number.isFinite(source[key]))) {
    throw new Error('Telemetry needs finite base, shoulder, elbow and wrist angles.');
  }
  const units = packet.units ?? 'degrees';
  if (!['degrees', 'radians'].includes(units)) throw new Error('Units must be degrees or radians.');
  const seq = packet.seq ?? packet.gestureId;
  if (seq !== undefined && (!Number.isSafeInteger(seq) || seq < 0)) throw new Error('Sequence must be a nonnegative integer.');
  if (packet.timestamp !== undefined) {
    if (!Number.isFinite(packet.timestamp)) throw new Error('Timestamp must be Unix milliseconds.');
    if (!(hardware && packet.snapshot === true) && wallNow - packet.timestamp > SOCKET_CONFIG.maxFrameAgeMs) throw new Error('Telemetry timestamp is too old.');
    if (packet.timestamp - wallNow > SOCKET_CONFIG.maxFutureSkewMs) throw new Error('Telemetry timestamp is in the future; check device clock.');
  }
  const electromagnet = packet.electromagnet ?? packet.magnet;
  if (electromagnet !== undefined && typeof electromagnet !== 'boolean') throw new Error('Electromagnet must be true or false.');
  const gesture = packet.gesture ?? { pitch: packet.pitch, roll: packet.roll };
  if (!isRecord(gesture)) throw new Error('Gesture must contain pitch and roll.');
  for (const key of ['pitch', 'roll']) {
    if (gesture[key] !== undefined && (!Number.isFinite(gesture[key]) || Math.abs(gesture[key]) > 180)) throw new Error(`Invalid ${key} orientation.`);
  }
  const angles = Object.fromEntries(Object.keys(JOINTS).map(key => [key, source[key]]));
  if (hardware) validateAngles(angles, Object.fromEntries(Object.entries(JOINTS).map(([key, joint]) => [key, [joint.min, joint.max]])));
  const joints = toRadians(applyJointLimits(units === 'radians' ? toDegrees(angles) : angles, warn));
  return {
    source: packet.source, snapshot: hardware && packet.snapshot === true,
    ...(hardware && { dataTimeoutMs: packet.dataTimeoutMs, stale: packet.stale, usbConnected: packet.usbConnected }),
    seq, timestamp: packet.timestamp, joints, electromagnet,
    gesture: { pitch: gesture.pitch, roll: gesture.roll },
    packet: hardware ? packet : { type: 'telemetry', ...(seq !== undefined && { seq }), ...(packet.timestamp !== undefined && { timestamp: packet.timestamp }), units: 'degrees', joints: toDegrees(joints), ...(electromagnet !== undefined && { electromagnet }), ...(gesture.pitch !== undefined && { pitch: gesture.pitch }), ...(gesture.roll !== undefined && { roll: gesture.roll }) },
  };
}

export function validateSocketUrl(value, pageProtocol = globalThis.location?.protocol) {
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('Enter a valid ws:// or wss:// URL.'); }
  if (!['ws:', 'wss:'].includes(url.protocol) || !url.hostname || url.hash || url.username || url.password) throw new Error('Use a ws:// or wss:// URL without a fragment or embedded credentials.');
  if (pageProtocol === 'https:' && url.protocol !== 'wss:') throw new Error('This HTTPS page requires a secure wss:// connection.');
  return url.href;
}

export class SocketTelemetry {
  constructor(onFrame, { onChange = () => {}, warn = () => {}, socketFactory = url => new WebSocket(url), now = () => performance.now(), wallNow = Date.now, reconnectMs = SOCKET_CONFIG.reconnectMs } = {}) {
    Object.assign(this, { onFrame, onChange, warn, socketFactory, now, wallNow, reconnectMs });
    this.generation = 0;
    this.socket = null;
    this.reset();
  }
  reset() {
    this.phase = 'DISCONNECTED'; this.error = ''; this.received = 0; this.rejected = 0;
    this.lastSequence = -1; this.lastTimestamp = -Infinity; this.lastReceivedAt = -Infinity;
    this.receiveTimes = []; this.packets = []; this.latency = null;
    this.deviceStatus = null; this.telemetrySource = null; this.deviceDetail = '';
    this.dataTimeoutMs = STALE_AFTER_MS; this.serverStale = false; this.usbConnected = null;
  }
  beginDummy() {
    this.disconnect(); this.reset(); this.phase = 'OPEN'; this.onChange();
  }
  connect(value) {
    let url;
    try { url = validateSocketUrl(value); }
    catch (error) { this.error = error.message; this.onChange(); return false; }
    this.disconnect(); this.reset(); this.phase = 'CONNECTING';
    const generation = this.generation;
    let socket;
    try { socket = this.socketFactory(url); }
    catch { this.phase = 'ERROR'; this.error = 'Could not create the WebSocket connection.'; this.onChange(); return false; }
    this.socket = socket;
    socket.binaryType = 'arraybuffer';
    const current = () => this.generation === generation && this.socket === socket;
    socket.addEventListener('open', () => {
      if (!current()) return;
      globalThis.clearTimeout(this.connectTimer);
      this.phase = 'OPEN'; this.error = ''; this.onChange();
    });
    socket.addEventListener('message', event => {
      if (current() && this.phase === 'OPEN') this.receive(event.data);
    });
    socket.addEventListener('error', () => {
      if (!current()) return;
      this.error = 'Connection failed. Check the server address and that WebSocket is enabled.';
      this.phase = 'ERROR'; this.onChange();
    });
    socket.addEventListener('close', () => {
      if (!current()) return;
      globalThis.clearTimeout(this.connectTimer);
      this.socket = null;
      if (this.phase !== 'ERROR') this.phase = 'DISCONNECTED';
      this.onChange();
      this.scheduleReconnect(url);
    });
    this.connectTimer = globalThis.setTimeout(() => {
      if (!current() || this.phase !== 'CONNECTING') return;
      this.disconnect(); this.phase = 'ERROR'; this.error = 'Connection timed out. Start the server and try again.'; this.onChange();
      this.scheduleReconnect(url);
    }, SOCKET_CONFIG.connectTimeoutMs);
    this.onChange();
    return true;
  }
  receive(data) {
    if (this.phase !== 'OPEN') return false;
    let frame;
    const warnings = [];
    try {
      // Status packets describe USB health, independently of WebSocket health.
      if (typeof data === 'string' && data.length <= SOCKET_CONFIG.maxMessageBytes) {
        let packet;
        try { packet = JSON.parse(data); } catch { /* main parser reports invalid JSON */ }
        if (packet?.type === 'connection_status') {
          if (!['connected', 'waiting', 'disconnected'].includes(packet.status) || !['esp32', 'mock'].includes(packet.source) || !Number.isFinite(packet.timestamp)) throw new Error('Invalid connection status.');
          validateConnectionMetadata(packet);
          this.deviceStatus = packet.status; this.telemetrySource = packet.source;
          this.dataTimeoutMs = packet.dataTimeoutMs ?? this.dataTimeoutMs;
          this.serverStale = packet.stale ?? packet.status !== 'connected';
          this.usbConnected = packet.usbConnected ?? (packet.source === 'esp32' ? packet.status !== 'disconnected' : null);
          this.deviceDetail = typeof packet.detail === 'string' ? packet.detail : '';
          this.error = ''; this.onChange(); return true;
        }
      }
      frame = parseTelemetryMessage(data, { wallNow: this.wallNow(), warn: message => warnings.push(message) });
      if (frame.seq !== undefined && frame.seq <= this.lastSequence) throw new Error('Repeated or out-of-order sequence rejected.');
      if (frame.timestamp !== undefined && frame.timestamp < this.lastTimestamp) throw new Error('Out-of-order timestamp rejected.');
    } catch (error) {
      this.rejected++; this.error = error.message;
      // Invalid traffic does not refresh the last-good-frame heartbeat.
      this.onChange(); return false;
    }
    if (this.onFrame(frame) === false) return false;
    if (frame.seq !== undefined) this.lastSequence = frame.seq;
    if (frame.timestamp !== undefined) this.lastTimestamp = frame.timestamp;
    this.received++;
    this.lastReceivedAt = this.now() - ((frame.snapshot || frame.source === 'esp32' || frame.source === 'mock') && frame.timestamp !== undefined ? Math.max(0, this.wallNow() - frame.timestamp) : 0);
    if (frame.source) {
      this.telemetrySource = frame.source;
      this.dataTimeoutMs = frame.dataTimeoutMs ?? this.dataTimeoutMs;
      this.serverStale = frame.stale ?? (frame.snapshot ? this.serverStale : false);
      this.usbConnected = frame.usbConnected === undefined ? this.usbConnected : frame.usbConnected;
      if (!frame.snapshot) this.deviceStatus = 'connected';
    }
    this.receiveTimes.push(this.lastReceivedAt);
    this.receiveTimes = this.receiveTimes.filter(time => time > this.lastReceivedAt - 1000).slice(-1000);
    this.latency = frame.timestamp === undefined ? null : Math.max(0, this.wallNow() - frame.timestamp);
    this.packets.unshift(frame.packet); this.packets.length = Math.min(15, this.packets.length);
    this.error = '';
    if (warnings.length) this.warn(warnings[0]);
    return true;
  }
  getStatistics() {
    const now = this.now();
    this.receiveTimes = this.receiveTimes.filter(time => time > now - 1000);
    const age = now - this.lastReceivedAt;
    const stale = this.phase !== 'OPEN' || age > this.dataTimeoutMs || this.serverStale || (this.deviceStatus !== null && this.deviceStatus !== 'connected');
    const deviceLabel = this.deviceStatus === 'disconnected' ? 'DISCONNECTED' : stale ? 'WAITING' : 'CONNECTED';
    return {
      status: this.phase === 'OPEN' ? (this.deviceStatus !== null ? deviceLabel : stale ? 'DELAYED' : 'ACTIVE') : this.phase,
      source: this.telemetrySource, deviceStatus: this.deviceStatus, detail: this.deviceDetail,
      usbConnected: this.phase === 'OPEN' ? this.usbConnected : null, dataTimeoutMs: this.dataTimeoutMs,
      phase: this.phase, connected: this.phase === 'OPEN', stale,
      latency: this.latency, age: Number.isFinite(age) ? age : null,
      rate: this.receiveTimes.length, received: this.received, rejected: this.rejected,
      sent: 0, loss: 0, configuredLoss: 0, error: this.error,
    };
  }
  disconnect() {
    this.generation++;
    globalThis.clearTimeout(this.connectTimer);
    globalThis.clearTimeout(this.reconnectTimer);
    const socket = this.socket; this.socket = null;
    // Closing a connecting socket is deliberate cancellation; old callbacks are inert.
    if (socket && socket.readyState < 2) socket.close();
    this.phase = 'DISCONNECTED'; this.onChange();
  }
  scheduleReconnect(url) {
    if (this.reconnectMs <= 0) return;
    globalThis.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = globalThis.setTimeout(() => this.connect(url), this.reconnectMs);
  }
  dispose() { this.disconnect(); }
}
