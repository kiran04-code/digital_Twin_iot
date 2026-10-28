import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { SerialPortMock } from 'serialport';
import { readConfig } from '../server/config.mjs';
import { SerialService, isEsp32Candidate } from '../server/serial-service.mjs';
import { startBridge } from '../server/bridge.mjs';
import { parseTelemetryMessage, SocketTelemetry } from '../js/socketTelemetry.js';
import { Simulation } from '../js/simulation.js';
import { RoboticArm } from '../js/roboticArm.js';
import { rad } from '../js/config.js';

const angles = { base: 90, shoulder: 110, elbow: 75, wrist: 120 };
const config = overrides => ({ ...readConfig({}), port: 0, retryMs: 20, ...overrides });
const until = async predicate => {
  for (let n = 0; n < 200; n++) { if (predicate()) return; await delay(10); }
  assert.fail('Timed out waiting for test condition.');
};
const quiet = { info() {}, warn() {} };
const openClient = async server => {
  const messages = [];
  const client = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
  client.on('message', data => messages.push(JSON.parse(data.toString())));
  await once(client, 'open');
  return { client, messages };
};

test('configuration defaults, joint limits, calibration and mock safeguards', () => {
  assert.equal(readConfig({}).baudRate, 115200);
  assert.equal(readConfig({}).port, 8080);
  assert.equal(readConfig({}).mock, false);
  assert.equal(readConfig({}).staleMs, 1000);
  assert.deepEqual(readConfig({}).limits, { base: [45, 135], shoulder: [40, 140], elbow: [45, 135], wrist: [45, 135] });
  for (const env of [{ WS_PORT: 'bad' }, { SERIAL_BAUD_RATE: '-1' }, { JOINT_LIMITS: '{' }, { JOINT_LIMITS: '{"base":[90,0]}' }, { JOINT_MAPPING: '{"base":{"scale":0,"offset":0}}' }, { JOINT_MAPPING: '{"base":{"scale":1,"offset":900}}' }, { MOCK_MODE: 'true' }, { MOCK_MODE: 'true', NODE_ENV: 'production' }]) assert.throws(() => readConfig(env));
  assert.equal(readConfig({ MOCK_MODE: 'true', NODE_ENV: 'development' }).mock, true);
  assert.equal(isEsp32Candidate({ vendorId: '303A' }), true);
  assert.equal(isEsp32Candidate({ manufacturer: 'Silicon Labs' }), true);
  assert.equal(isEsp32Candidate({ manufacturer: 'Microsoft', path: 'COM3' }), false);
});

test('ESP32 environment names take precedence and legacy configuration remains supported', () => {
  const cfg = readConfig({
    ESP32_SERIAL_PORT: ' COM5 ', SERIAL_PORT: 'COM3', ESP32_BAUD_RATE: '115200', SERIAL_BAUD_RATE: '9600',
    ESP32_RECONNECT_DELAY_MS: '2500', SERIAL_RECONNECT_MS: '500', ESP32_DATA_TIMEOUT_MS: '1250', STALE_AFTER_MS: '500',
    DIGITAL_TWIN_MOCK_MODE: 'false', MOCK_MODE: 'true',
  });
  assert.equal(cfg.serialPath, 'COM5'); assert.equal(cfg.baudRate, 115200);
  assert.equal(cfg.retryMs, 2500); assert.equal(cfg.staleMs, 1250); assert.equal(cfg.mock, false);
  const legacy = readConfig({ SERIAL_PORT: 'COM9', SERIAL_BAUD_RATE: '57600', STALE_AFTER_MS: '750' });
  assert.equal(legacy.serialPath, 'COM9'); assert.equal(legacy.baudRate, 57600); assert.equal(legacy.staleMs, 750);
  assert.equal(readConfig({ DIGITAL_TWIN_MOCK_MODE: 'true', NODE_ENV: 'development' }).mock, true);
  for (const env of [{ ESP32_DATA_TIMEOUT_MS: '0' }, { ESP32_BAUD_RATE: 'NaN' }, { ESP32_RECONNECT_DELAY_MS: '-1' }, { DIGITAL_TWIN_MOCK_MODE: 'yes' }, { DIGITAL_TWIN_MOCK_MODE: 'true', NODE_ENV: 'production' }]) assert.throws(() => readConfig(env));
});

test('receiver firmware limits accept boundaries and reject each out-of-range joint without updating state', () => {
  const cfg = config(); const serial = new SerialService(cfg); const valid = []; const invalid = [];
  serial.on('angles', frame => valid.push(frame)); serial.on('invalid', error => invalid.push(error));
  for (const key of Object.keys(angles)) {
    const [lo, hi] = cfg.limits[key];
    for (const value of [lo, hi, lo - 0.01, hi + 0.01]) serial.feed(Buffer.from(`${JSON.stringify({ ...angles, [key]: value })}\n`));
  }
  assert.equal(valid.length, 8); assert.equal(invalid.length, 8);
});

test('serial framing rejects malformed/unsafe data, recovers after oversized lines and preserves precision', () => {
  const serial = new SerialService(config()); const valid = []; const invalid = [];
  serial.on('angles', value => valid.push(value)); serial.on('invalid', error => invalid.push(error));
  const line = JSON.stringify(angles);
  serial.feed(Buffer.from(`Booting ESP32\r\n${line.slice(0, 16)}`));
  assert.equal(valid.length, 0);
  serial.feed(Buffer.from(`${line.slice(16)}\r\n`));
  assert.deepEqual(valid[0].angles, angles);
  assert.deepEqual(valid[0].modelAngles, { base: 0, shoulder: 110, elbow: 75, wrist: 30 });
  for (const value of ['null', '[]', '{broken', '{}', '{"base":1e999,"shoulder":90,"elbow":90,"wrist":90}', JSON.stringify({ ...angles, base: '90' }), JSON.stringify({ ...angles, base: -1 }), JSON.stringify({ ...angles, elbow: 170 })]) serial.feed(Buffer.from(`${value}\n`));
  serial.feed(Buffer.from('x'.repeat(10000)));
  assert.equal(serial.buffer.length, 0);
  serial.feed(Buffer.from(`\n${JSON.stringify({ ...angles, base: 91.25 })}\n`));
  assert.equal(valid.length, 2); assert.equal(valid[1].angles.base, 91.25);
  assert.equal(invalid.length, 10);
});

test('manual COM configuration, USB disconnect, unavailable port and automatic reconnect', async () => {
  class Port extends EventEmitter {
    open(callback) { this.isOpen = true; callback(); }
    close(callback = () => {}) { this.isOpen = false; this.emit('close'); callback(); }
  }
  let available = false; const opened = []; const selected = [];
  const serial = new SerialService(config({ serialPath: 'COM99', staleMs: 25 }), {
    listPorts: () => assert.fail('Manual port must bypass autodetection.'),
    createPort: options => {
      selected.push(options);
      if (!available) throw new Error('Port unavailable');
      const port = new Port(); opened.push(port); return port;
    },
  });
  try {
    serial.start(); assert.equal(serial.status, 'disconnected');
    available = true; await until(() => opened.length === 1);
    assert.equal(serial.status, 'waiting'); assert.equal(selected[0].path, 'COM99'); assert.equal(selected[0].baudRate, 115200);
    opened[0].emit('data', Buffer.from(`${JSON.stringify(angles)}\n`));
    assert.equal(serial.status, 'connected');
    await until(() => serial.status === 'waiting');
    opened[0].close(); assert.equal(serial.status, 'disconnected');
    await until(() => opened.length === 2);
    assert.equal(serial.status, 'waiting');
    opened[1].emit('error', new Error('USB unplugged'));
    assert.equal(serial.status, 'disconnected');
    await until(() => opened.length === 3);
  } finally { serial.stop(); }
  await delay(40); assert.equal(opened.length, 3);
});

test('custom raw limits and reversed servo mounting preserve exact commanded angles', () => {
  const cfg = readConfig({ JOINT_LIMITS: '{"base":[30,150]}', JOINT_MAPPING: '{"base":{"scale":-1,"offset":90}}' });
  const serial = new SerialService(cfg); const frames = []; const invalid = [];
  serial.on('angles', frame => frames.push(frame)); serial.on('invalid', error => invalid.push(error));
  serial.feed(Buffer.from(`${JSON.stringify({ ...angles, base: 25 })}\n${JSON.stringify({ ...angles, base: 120 })}\n`));
  assert.equal(invalid.length, 1); assert.equal(frames.length, 1);
  assert.equal(frames[0].angles.base, 120); assert.equal(frames[0].modelAngles.base, -30);
});

test('autodetection refuses ambiguity and retries until a single USB candidate exists', async () => {
  let ports = []; const attempts = [];
  const serial = new SerialService(config(), { listPorts: async () => ports, createPort: options => { attempts.push(options); throw new Error('Busy port'); } });
  try {
    serial.start(); await until(() => serial.detail?.includes('No ESP32'));
    ports = [{ path: 'COM7', vendorId: '10c4' }, { path: 'COM8', vendorId: '1a86' }];
    await until(() => serial.detail?.includes('Multiple')); assert.equal(attempts.length, 0);
    ports = [ports[0]]; await until(() => attempts.length > 0);
    assert.equal(attempts[0].path, 'COM7');
  } finally { serial.stop(); }
});

test('serialport mock binding streams fragmented JSON to multiple real WebSocket clients with latest-state replay', async () => {
  SerialPortMock.binding.reset(); SerialPortMock.binding.createPort('/dev/esp32-test');
  const cfg = config({ serialPath: '/dev/esp32-test', staleMs: 100 });
  let usb;
  const serial = new SerialService(cfg, { createPort: options => { usb = new SerialPortMock(options); return usb; } });
  const bridge = startBridge(cfg, { serial, logger: quiet });
  try {
    await once(bridge.server, 'listening'); await until(() => usb?.isOpen);
    const a = await openClient(bridge.server); const b = await openClient(bridge.server);
    await until(() => a.messages.length && b.messages.length);
    assert.equal(a.messages[0].status, 'waiting');
    assert.equal(a.messages[0].usbConnected, true); assert.equal(a.messages[0].stale, true);
    assert.equal(a.messages[0].dataTimeoutMs, 100);
    usb.port.emitData(Buffer.from('{"base":90,'));
    usb.port.emitData(Buffer.from('"shoulder":110,"elbow":75,"wrist":120}\n'));
    await until(() => a.messages.some(m => m.type === 'joint_update') && b.messages.some(m => m.type === 'joint_update'));
    const first = a.messages.find(m => m.type === 'joint_update');
    assert.deepEqual(first.angles, angles); assert.equal(first.source, 'esp32'); assert.ok(first.timestamp > 0);
    assert.equal(first.stale, false); assert.equal(first.usbConnected, true);
    assert.deepEqual(b.messages.find(m => m.type === 'joint_update'), first);
    // Burst updates arrive in order without a delay/batching queue in the bridge.
    for (let n = 0; n < 200; n++) usb.port.emitData(Buffer.from(`${JSON.stringify({ ...angles, base: 45 + n % 91 })}\n`));
    await until(() => b.messages.filter(m => m.type === 'joint_update').length === 201);
    const c = await openClient(bridge.server);
    await until(() => c.messages.some(m => m.snapshot));
    assert.equal(c.messages.find(m => m.snapshot).angles.base, 45 + 199 % 91);
    await until(() => a.messages.some(m => m.status === 'waiting' && m.timestamp > first.timestamp));
    const staleClient = await openClient(bridge.server);
    await until(() => staleClient.messages.some(m => m.snapshot));
    assert.equal(staleClient.messages[0].usbConnected, true);
    assert.equal(staleClient.messages.find(m => m.snapshot).stale, true);
    const count = a.messages.filter(m => m.type === 'joint_update').length;
    usb.port.emitData(Buffer.from('{bad\n')); await delay(20);
    assert.equal(a.messages.filter(m => m.type === 'joint_update').length, count);
    usb.close(); await until(() => a.messages.some(m => m.status === 'disconnected'));
    assert.equal(a.messages.find(m => m.status === 'disconnected').usbConnected, false);
    const d = await openClient(bridge.server); await until(() => d.messages.some(m => m.snapshot));
    assert.ok(d.messages.find(m => m.snapshot).timestamp <= Date.now());
    assert.equal(d.messages.find(m => m.snapshot).connectionStatus, d.messages[0].status);
    assert.equal(d.messages.find(m => m.snapshot).stale, true);
  } finally { await bridge.close(); SerialPortMock.binding.reset(); }
});

test('development mock is labelled and uses the hardware WebSocket protocol', async () => {
  const bridge = startBridge(config({ mock: true }), { logger: quiet });
  try {
    await once(bridge.server, 'listening');
    const { messages } = await openClient(bridge.server);
    await until(() => messages.filter(m => m.type === 'joint_update').length >= 3);
    assert.equal(messages[0].source, 'mock');
    for (const message of messages.filter(m => m.type === 'joint_update')) {
      assert.equal(message.source, 'mock'); parseTelemetryMessage(JSON.stringify(message));
    }
  } finally { await bridge.close(); }
});

test('hardware packets use existing model offsets, reject unsafe model coordinates, and stale snapshots retain their age', () => {
  const packet = { type: 'joint_update', timestamp: Date.now(), angles, source: 'esp32' };
  const frame = parseTelemetryMessage(JSON.stringify(packet));
  const arm = new RoboticArm(); arm.setJointState(frame.joints);
  assert.equal(arm.joints.base.rotation.y, 0);
  assert.ok(Math.abs(arm.joints.shoulder.rotation.z - rad(20)) < 1e-10);
  assert.ok(Math.abs(arm.joints.elbow.rotation.z - rad(-105)) < 1e-10);
  assert.ok(Math.abs(arm.joints.wrist.rotation.z - rad(-60)) < 1e-10);
  assert.throws(() => parseTelemetryMessage(JSON.stringify({ ...packet, modelAngles: { base: 200, shoulder: 110, elbow: 75, wrist: 30 } })), /outside/);
  const sim = new Simulation({ socketOptions: { now: () => 20000 } });
  try {
    sim.setSource('websocket'); sim.socketTelemetry.beginDummy();
    sim.socketTelemetry.receive(JSON.stringify({ type: 'connection_status', timestamp: Date.now(), source: 'esp32', status: 'disconnected' }));
    assert.equal(sim.socketTelemetry.receive(JSON.stringify({ ...packet, timestamp: Date.now() - 10000, snapshot: true })), true);
    assert.equal(sim.socketTelemetry.getStatistics().status, 'DISCONNECTED');
    assert.ok(sim.socketTelemetry.getStatistics().age >= 10000);
    assert.equal(sim.displayJoints.wrist, rad(30));
    const pose = { ...sim.displayJoints }; sim.update(0.1); assert.deepEqual(sim.displayJoints, pose);
  } finally { sim.dispose(); }
});

test('frontend automatically reconnects but manual disconnect cancels retries', async () => {
  class Socket extends EventTarget {
    constructor() { super(); this.readyState = 0; }
    emit(type) { this.dispatchEvent(new Event(type)); }
    close() { this.readyState = 3; this.emit('close'); }
  }
  const sockets = [];
  const stream = new SocketTelemetry(() => {}, { reconnectMs: 20, socketFactory: () => { const socket = new Socket(); sockets.push(socket); return socket; } });
  try {
    stream.connect('ws://localhost:8080'); sockets[0].emit('open'); sockets[0].close();
    await until(() => sockets.length === 2);
    sockets[1].emit('open'); sockets[1].close(); stream.disconnect();
    await delay(60); assert.equal(sockets.length, 2);
  } finally { stream.dispose(); }
});

test('frontend uses backend timeout and separates USB, WebSocket and stale telemetry', () => {
  let time = 0; const wallNow = 1800000000000;
  const stream = new SocketTelemetry(() => {}, { now: () => time, wallNow: () => wallNow + time });
  stream.beginDummy();
  const status = { type: 'connection_status', timestamp: wallNow, source: 'esp32', status: 'connected', dataTimeoutMs: 1000, usbConnected: true, stale: false };
  const packet = { type: 'joint_update', timestamp: wallNow, source: 'esp32', angles, dataTimeoutMs: 1000, usbConnected: true, stale: false };
  try {
    assert.equal(stream.receive(JSON.stringify(status)), true);
    assert.equal(stream.receive(JSON.stringify(packet)), true);
    time = 750; assert.equal(stream.getStatistics().stale, false);
    assert.equal(stream.receive('ESP-NOW timeout'), false);
    time = 1001;
    assert.equal(stream.getStatistics().stale, true); assert.equal(stream.getStatistics().usbConnected, true);
    assert.equal(stream.getStatistics().connected, true); assert.equal(stream.getStatistics().status, 'WAITING');
    // An unchanged valid commanded pose still proves a new update arrived.
    assert.equal(stream.receive(JSON.stringify({ ...packet, timestamp: wallNow + time })), true);
    assert.equal(stream.getStatistics().stale, false);
    assert.equal(stream.receive(JSON.stringify({ ...packet, timestamp: wallNow + time, snapshot: true, stale: true })), true);
    assert.equal(stream.getStatistics().stale, true);
    stream.disconnect(); assert.equal(stream.getStatistics().connected, false); assert.equal(stream.getStatistics().usbConnected, null);
  } finally { stream.dispose(); }
});
