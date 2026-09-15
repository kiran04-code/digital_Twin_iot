import { HOME, JOINTS, PACKET_RATE, SOCKET_CONFIG, toRadians, toDegrees, applyJointLimits, mapGestureToJoints, jointToPulse, clampJointAngle } from './config.js';
import { GestureController } from './gestureController.js';
import { ESPNowSimulator, validatePacket } from './communication.js';
import { DemoController, DEMO_STEPS } from './demoController.js';
import { SocketTelemetry } from './socketTelemetry.js';
import { DummyTelemetryStream } from './dummyTelemetry.js';

export class Simulation {
  constructor({ socketOptions = {} } = {}) {
    this.listeners = new Set();
    this.sensor = new GestureController();
    this.demo = new DemoController();
    this.wireless = new ESPNowSimulator(packet => this.receivePacket(packet));
    this.physicalJoints = toRadians(HOME);
    this.displayJoints = toRadians(HOME);
    this.state = {
      source: 'local', socketUrl: SOCKET_CONFIG.url, hasGesture: true,
      gesture: { pitch: 0, roll: 0 }, receivedGesture: { pitch: 0, roll: 0 },
      joints: toRadians(HOME), targetJoints: toRadians(HOME), manual: { ...HOME },
      mode: 'gesture', requestedMagnet: false, magnet: false, captured: false,
      stopped: false, homed: true, demoRunning: false, demoLabel: '', demoProgress: 0,
      sensor: this.sensor.sense({ pitch: 0, roll: 0 }, 1),
      connection: this.wireless.getStatistics(), packets: [], warning: '',
      toolPosition: { x: 0, y: 0, z: 0 }, fps: 0, delta: 0, drawCalls: 0,
      options: { axes: false, trail: false, workspace: false, separate: false, grid: true, debug: false, quality: 'high' },
      camera: 'isometric', presentation: false, history: [],
      notice: 'System ready. Move your hand, move the arm.',
    };
    this.packetId = 0;
    this.uiAccumulator = 0;
    this.snapshot = { ...this.state };
    this.resetObjects = () => {};
    this.socketTelemetry = new SocketTelemetry(frame => this.receiveSocketFrame(frame), {
      ...socketOptions, onChange: () => this.publish(), warn: this.warn,
    });
    this.dummyStream = new DummyTelemetryStream(data => this.socketTelemetry.receive(data));
  }

  subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = () => this.snapshot;
  startTransport() {
    if (this.transportTimer || this.state.source !== 'local') return;
    let lastSense = performance.now();
    // Wireless timing is independent of the rendering frame rate.
    this.transportTimer = globalThis.setInterval(() => {
      const now = performance.now();
      this.state.sensor = this.sensor.sense(this.state.gesture, (now - lastSense) / 1000);
      lastSense = now;
      if (!this.state.stopped && this.state.source === 'local') this.wireless.transmitPacket(this.createGesturePacket());
    }, 1000 / PACKET_RATE);
  }
  stopTransport() {
    globalThis.clearInterval(this.transportTimer);
    this.transportTimer = null;
    this.wireless.flush();
  }
  publish() {
    const transport = this.state.source === 'local' ? this.wireless : this.socketTelemetry;
    this.state.connection = transport.getStatistics();
    this.snapshot = { ...this.state, joints: { ...this.state.joints }, connection: this.state.connection, packets: [...transport.packets] };
    for (const listener of this.listeners) listener();
  }
  warn = message => { this.state.warning = message; this.warningUntil = performance.now() + 4500; };
  get localControlsEnabled() { return this.state.source === 'local' && !this.state.stopped && !this.demo.running; }
  setSource(source) {
    if (!['local', 'dummy', 'websocket'].includes(source) || this.state.stopped || source === this.state.source) return;
    this.demo.stop(); this.stopTransport(); this.dummyStream.stop(); this.socketTelemetry.disconnect();
    this.socketTelemetry.reset();
    this.physicalJoints = { ...this.displayJoints };
    Object.assign(this.state, {
      source, demoRunning: false, homed: false, mode: 'manual',
      joints: { ...this.displayJoints }, targetJoints: { ...this.displayJoints },
      manual: toDegrees(this.displayJoints), requestedMagnet: false, magnet: false,
      history: [], warning: '', captured: false, hasGesture: source === 'local',
    });
    this.lastSensorFrameAt = performance.now();
    this.resetObjects();
    if (source === 'local') {
      this.wireless.setConnected(true); this.startTransport();
      this.state.notice = 'Local controls enabled. Current pose held.';
    } else if (source === 'dummy') this.startDummyStream();
    else this.state.notice = 'WebSocket input selected. Enter your Node.js or ESP32 endpoint and connect.';
    this.publish();
  }
  startDummyStream() {
    if (this.state.source !== 'dummy' || this.state.stopped) return;
    this.socketTelemetry.beginDummy(); this.dummyStream.start();
    this.state.notice = 'Dummy JSON telemetry is driving the arm through the socket ingestion path.';
    this.publish();
  }
  setSocketUrl(value) {
    if (this.socketTelemetry.socket || this.state.stopped) return;
    this.state.socketUrl = value; this.publish();
  }
  connectSocket() {
    if (this.state.source !== 'websocket' || this.state.stopped) return false;
    const connected = this.socketTelemetry.connect(this.state.socketUrl);
    this.state.notice = connected ? 'Opening WebSocket. Waiting for joint telemetry.' : 'Check the socket connection settings.';
    this.publish(); return connected;
  }
  disconnectStream() {
    this.dummyStream.stop(); this.socketTelemetry.disconnect();
    this.state.notice = 'Telemetry stream disconnected. The digital twin holds its last displayed pose.';
    this.publish();
  }
  receiveSocketFrame(frame) {
    if (this.state.source === 'local' || this.state.stopped || !this.ingestTelemetry(frame)) return false;
    this.physicalJoints = { ...this.state.joints };
    this.state.targetJoints = { ...this.state.joints };
    this.state.manual = toDegrees(this.state.joints);
    if (frame.electromagnet !== undefined) this.state.magnet = this.state.requestedMagnet = frame.electromagnet;
    this.state.hasGesture = Number.isFinite(frame.gesture.pitch) && Number.isFinite(frame.gesture.roll);
    if (this.state.hasGesture) {
      const now = performance.now();
      this.state.gesture = { ...frame.gesture };
      this.state.receivedGesture = { ...frame.gesture };
      this.state.sensor = this.sensor.sense(this.state.gesture, Math.max(0.001, (now - this.lastSensorFrameAt) / 1000));
      this.lastSensorFrameAt = now;
    }
    return true;
  }
  setGesture(key, value) {
    if (!this.localControlsEnabled) return;
    this.state.gesture = { ...this.state.gesture, [key]: clampJointAngle(value, key === 'pitch' ? -60 : -90, key === 'pitch' ? 60 : 90) };
    this.state.homed = false;
    this.publish();
  }
  setMode(mode) {
    if (!this.localControlsEnabled) return;
    if (mode === 'manual') this.state.manual = toDegrees(this.physicalJoints);
    this.state.mode = mode;
    this.state.homed = false;
    this.publish();
  }
  setManual(key, value) {
    if (!this.localControlsEnabled) return;
    this.state.manual = applyJointLimits({ ...this.state.manual, [key]: value }, this.warn);
    this.publish();
  }
  setMagnet(value) {
    if (!this.localControlsEnabled) return;
    this.state.requestedMagnet = value;
    this.publish();
  }
  setOption(key, value) { this.state.options = { ...this.state.options, [key]: value }; this.publish(); }
  setCamera(preset) { this.state.camera = preset; this.onCamera?.(preset); this.publish(); }
  setConnection(connected) {
    if (this.state.source !== 'local') {
      if (!connected) this.disconnectStream();
      else if (this.state.source === 'dummy') this.startDummyStream();
      else this.connectSocket();
      return;
    }
    this.wireless.setConnected(connected);
    if (!connected && this.demo.running) this.stopDemo('Demo stopped: wireless link disconnected.');
    this.publish();
  }
  home() {
    if (this.state.stopped || this.state.source !== 'local') return;
    this.demo.stop();
    this.state.demoRunning = false;
    this.state.manual = { ...HOME };
    this.state.gesture = { pitch: 0, roll: 0 };
    this.state.homed = true;
    this.state.requestedMagnet = false;
    this.state.notice = 'Returning all four joints to home.';
    this.publish();
  }
  startDemo() {
    if (this.state.stopped || this.state.source !== 'local') return;
    if (!this.wireless.connected) { this.warn('Reconnect ESP-NOW before starting the demo.'); this.publish(); return; }
    this.wireless.flush();
    this.state.requestedMagnet = false;
    this.state.magnet = false;
    this.resetObjects();
    this.demo.start();
    this.state.demoRunning = true;
    this.state.homed = false;
    this.state.notice = 'Programmed pick-and-place sequence running.';
    this.publish();
  }
  stopDemo(message = 'Demo stopped. Current joint position held.') {
    this.demo.stop();
    this.state.demoRunning = false;
    this.state.manual = toDegrees(this.physicalJoints);
    this.state.mode = 'manual';
    this.state.homed = false;
    this.state.notice = message;
    this.wireless.flush();
    this.state.targetJoints = { ...this.physicalJoints };
    this.publish();
  }
  emergencyStop() {
    if (this.state.source !== 'local') {
      this.state.stopped = true;
      this.disconnectStream();
      this.state.notice = 'Monitoring paused. No command was sent to physical hardware.';
      this.publish(); return;
    }
    this.demo.stop();
    this.wireless.flush();
    Object.assign(this.state, {
      stopped: true, demoRunning: false, requestedMagnet: false, magnet: false,
      targetJoints: { ...this.physicalJoints }, joints: { ...this.physicalJoints },
      notice: 'Emergency stop engaged. Motion frozen; electromagnet disabled.',
    });
    this.onEmergencyStop?.();
    this.publish();
  }
  resetSystem() {
    if (this.state.source !== 'local') {
      this.state.stopped = false;
      if (this.state.source === 'dummy') this.startDummyStream();
      else this.connectSocket();
      this.publish(); return;
    }
    this.wireless.flush();
    this.state.stopped = false;
    this.state.mode = 'manual';
    this.state.manual = toDegrees(this.physicalJoints);
    this.state.homed = false;
    this.state.notice = 'System reset. Controls enabled; current pose held.';
    this.publish();
  }
  createGesturePacket() {
    let mode = this.state.mode;
    let targets;
    if (this.demo.running) { mode = 'manual'; targets = this.demo.step.pose; }
    else if (this.state.homed) { mode = 'manual'; targets = HOME; }
    else targets = mode === 'gesture' ? mapGestureToJoints(this.state.gesture) : this.state.manual;
    return {
      gestureId: this.packetId++, ...this.state.gesture, ...targets, mode,
      electromagnet: this.state.requestedMagnet, timestamp: Date.now(),
    };
  }
  receivePacket(packet) {
    if (!validatePacket(packet) || this.state.stopped || this.state.source !== 'local') return;
    const command = packet.mode === 'gesture' ? mapGestureToJoints(packet) : packet;
    this.state.targetJoints = toRadians(applyJointLimits(command, this.warn));
    this.state.magnet = packet.electromagnet;
    this.state.receivedGesture = { pitch: packet.pitch, roll: packet.roll };
    // Receiver feedback is the ONLY source for monitoring joint state.
    this.ingestTelemetry({ joints: this.physicalJoints });
  }
  ingestTelemetry(frame) {
    if (this.state.stopped || !frame || !frame.joints || !Object.keys(JOINTS).every(key => Number.isFinite(frame.joints[key]))) return false;
    this.state.joints = toRadians(applyJointLimits(toDegrees(frame.joints), this.warn));
    return true;
  }
  smoothJointTargets(delta) {
    if (this.state.stopped || this.state.source !== 'local') return;
    const factor = 1 - Math.pow(1 - 0.08, delta * 60);
    for (const key of Object.keys(JOINTS)) this.physicalJoints[key] += (this.state.targetJoints[key] - this.physicalJoints[key]) * factor;
  }
  update(delta) {
    const dt = Math.min(delta, 0.1);
    this.state.delta = delta * 1000;
    this.state.fps += (1 / Math.max(delta, 0.001) - this.state.fps) * 0.05;
    if (this.demo.running && !this.state.stopped) {
      const step = this.demo.update(dt, this.state.captured);
      if (step?.error) { this.stopDemo(step.error); this.state.requestedMagnet = false; this.warn(step.error); }
      else if (step?.complete) { this.home(); this.state.notice = 'Pick-and-place complete. Arm returned home.'; }
      else if (step) {
        this.state.requestedMagnet = !!step.magnet;
        this.state.demoLabel = step.label;
        this.state.demoProgress = (this.demo.index + Math.min(1, this.demo.elapsed / step.duration)) / DEMO_STEPS.length;
      }
    }
    this.smoothJointTargets(dt);
    this.state.connection = (this.state.source === 'local' ? this.wireless : this.socketTelemetry).getStatistics();
    if (this.state.source === 'local') this.displayJoints = { ...this.state.joints };
    else if (!this.state.stopped && !this.state.connection.stale) {
      // Measured telemetry remains exact; only its visual presentation interpolates.
      const factor = 1 - Math.exp(-dt * 14);
      for (const key of Object.keys(JOINTS)) this.displayJoints[key] += (this.state.joints[key] - this.displayJoints[key]) * factor;
    }
    if (this.warningUntil < performance.now()) this.state.warning = '';
    this.uiAccumulator += dt;
    if (this.uiAccumulator >= 0.1) {
      this.uiAccumulator %= 0.1;
      const sample = { ...(this.state.hasGesture ? this.state.receivedGesture : { pitch: null, roll: null }), ...toDegrees(this.state.joints) };
      this.state.history = [...this.state.history.slice(-99), sample];
      this.state.pwm = Object.fromEntries(Object.keys(JOINTS).map(key => [key, jointToPulse(key, this.state.joints[key])]));
      this.publish();
    }
  }
  dispose() { this.listeners.clear(); this.stopTransport(); this.dummyStream.stop(); this.socketTelemetry.dispose(); this.wireless.dispose(); }
}
