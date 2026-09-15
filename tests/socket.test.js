import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTelemetryMessage, SocketTelemetry, validateSocketUrl } from '../js/socketTelemetry.js';
import { createDummyTelemetry } from '../js/dummyTelemetry.js';
import { Simulation } from '../js/simulation.js';
import { HOME, rad, SOCKET_CONFIG, toDegrees } from '../js/config.js';

const frame = (overrides = {}) => JSON.stringify({ type: 'telemetry', seq: 1, joints: { ...HOME }, ...overrides });
class FakeSocket extends EventTarget {
  constructor() { super(); this.readyState = 0; this.closed = false; }
  emit(type, data) { const event = new Event(type); if (type === 'message') event.data = data; this.dispatchEvent(event); }
  open() { this.readyState = 1; this.emit('open'); }
  close() { this.closed = true; this.readyState = 3; this.emit('close'); }
}

test('socket schema accepts flat/nested degrees and explicitly declared radians', () => {
  const nested = parseTelemetryMessage(frame({ joints: { ...HOME, base: 45 }, electromagnet: true }));
  assert.equal(nested.joints.base, rad(45)); assert.equal(nested.electromagnet, true);
  assert.equal(parseTelemetryMessage(JSON.stringify({ ...HOME, base: -30 })).joints.base, rad(-30));
  const radians = parseTelemetryMessage(frame({ units: 'radians', joints: { base: 0.5, shoulder: 1.5, elbow: 1.2, wrist: -0.3 } }));
  assert.ok(Math.abs(radians.joints.base - 0.5) < 1e-10);
  const binary = new TextEncoder().encode(frame()).buffer;
  assert.equal(parseTelemetryMessage(binary).joints.shoulder, rad(90));
});

test('socket parser rejects malformed fields without accepting partial joint state', () => {
  for (const input of ['no JSON', 'null', '[]', '{}', frame({ joints: { base: 1 } }), frame({ joints: { ...HOME, base: '45' } }), frame({ units: 'turns' }), frame({ electromagnet: 1 }), frame({ seq: -1 }), frame({ pitch: '20' }), frame({ type: 'command' }), ' '.repeat(SOCKET_CONFIG.maxMessageBytes + 1)]) {
    assert.throws(() => parseTelemetryMessage(input));
  }
});

test('socket angles are clamped and optional orientation stays optional', () => {
  const warnings = [];
  const result = parseTelemetryMessage(frame({ joints: { base: 400, shoulder: -50, elbow: 200, wrist: -400 } }), { warn: message => warnings.push(message) });
  const values = toDegrees(result.joints);
  assert.equal(values.base, 90); assert.ok(Math.abs(values.shoulder - 15) < 1e-10);
  assert.equal(values.elbow, 160); assert.equal(values.wrist, -90); assert.equal(warnings.length, 4);
  assert.equal(result.gesture.pitch, undefined); assert.equal(result.electromagnet, undefined);
});

test('sender timestamps reject delayed/future frames and may be omitted for device uptime clocks', () => {
  const now = 1780000000000;
  assert.throws(() => parseTelemetryMessage(frame({ timestamp: now - 6000 }), { wallNow: now }), /too old/);
  assert.throws(() => parseTelemetryMessage(frame({ timestamp: now + 6000 }), { wallNow: now }), /future/);
  assert.equal(parseTelemetryMessage(frame({ timestamp: now - 50 }), { wallNow: now }).timestamp, now - 50);
  assert.equal(parseTelemetryMessage(frame(), { wallNow: now }).timestamp, undefined);
});

test('WebSocket URL checks protocols, fragments, credentials and HTTPS mixed content', () => {
  assert.equal(validateSocketUrl('ws://localhost:8765'), 'ws://localhost:8765/');
  assert.equal(validateSocketUrl('wss://example.com/telemetry', 'https:'), 'wss://example.com/telemetry');
  for (const url of ['http://localhost:8765', 'hello', 'ws://example.com/#part', 'ws://user:secret@example.com']) assert.throws(() => validateSocketUrl(url));
  assert.throws(() => validateSocketUrl('ws://localhost:8765', 'https:'), /secure/);
});

test('invalid and repeated messages do not refresh the last valid telemetry heartbeat', () => {
  let time = 0; let applied = 0;
  const stream = new SocketTelemetry(() => applied++, { now: () => time });
  stream.beginDummy(); assert.equal(stream.receive(frame()), true);
  time = 700;
  assert.equal(stream.receive(frame()), false); assert.equal(stream.receive('{}'), false);
  assert.equal(stream.getStatistics().stale, true); assert.equal(stream.rejected, 2); assert.equal(applied, 1);
  assert.equal(stream.receive(frame({ seq: 2 })), true); assert.equal(stream.getStatistics().stale, false);
  for (let seq = 3; seq < 40; seq++) stream.receive(frame({ seq }));
  assert.equal(stream.packets.length, 15); stream.dispose();
});

test('socket lifecycle cancels previous connections and allows fresh sequences on reconnect', () => {
  const sockets = []; let applied = 0;
  const stream = new SocketTelemetry(() => applied++, { socketFactory: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; } });
  stream.connect('ws://localhost:8765'); assert.equal(stream.phase, 'CONNECTING');
  const first = sockets[0]; first.open(); first.emit('message', frame()); assert.equal(applied, 1);
  stream.connect('ws://localhost:8765'); assert.equal(first.closed, true);
  first.open(); first.emit('message', frame({ seq: 2 })); assert.equal(applied, 1);
  const second = sockets[1]; second.open(); second.emit('message', frame()); assert.equal(applied, 2);
  second.emit('error'); assert.equal(stream.getStatistics().status, 'ERROR');
  stream.dispose(); assert.equal(second.closed, true);
});

test('source switching prevents synthetic or former socket commands from changing the arm', () => {
  const sockets = [];
  const sim = new Simulation({ socketOptions: { socketFactory: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; } } });
  try {
    sim.setSource('websocket'); sim.connectSocket(); sockets[0].open();
    sockets[0].emit('message', frame({ joints: { ...HOME, base: 33 } }));
    const expected = { ...sim.state.joints };
    sim.setManual('base', -80); sim.setGesture('roll', -80); sim.home(); sim.startDemo(); sim.setMagnet(true);
    sim.receivePacket({ ...sim.createGesturePacket(), base: -75, mode: 'manual' });
    sim.update(0.1); assert.deepEqual(sim.state.joints, expected); assert.equal(sim.state.demoRunning, false);
    assert.equal(sim.transportTimer, null);
    sim.setSource('dummy');
    const dummyState = { ...sim.state.joints };
    sockets[0].emit('message', frame({ seq: 9, joints: { ...HOME, base: -80 } }));
    assert.deepEqual(sim.state.joints, dummyState);
    sim.setSource('local'); assert.equal(sim.state.source, 'local'); assert.equal(sim.dummyStream.timer, null);
    assert.ok(sim.transportTimer); assert.equal(sim.socketTelemetry.phase, 'DISCONNECTED');
  } finally { sim.dispose(); }
});

test('pausing monitoring freezes the view and resuming reconnects without replaying old frames', () => {
  const sockets = [];
  const sim = new Simulation({ socketOptions: { socketFactory: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; } } });
  try {
    sim.setSource('websocket'); sim.connectSocket(); sockets[0].open();
    sockets[0].emit('message', frame({ joints: { ...HOME, base: 60 } })); sim.update(0.1);
    sim.emergencyStop(); const frozen = { ...sim.displayJoints };
    sockets[0].emit('message', frame({ seq: 2, joints: { ...HOME, base: -60 } })); sim.update(0.1);
    assert.deepEqual(sim.displayJoints, frozen); assert.match(sim.state.notice, /No command/);
    assert.equal(sim.ingestTelemetry({ joints: { ...sim.state.joints, base: rad(-50) } }), false);
    sim.resetSystem(); assert.equal(sockets.length, 2); sockets[1].open();
    sockets[1].emit('message', frame({ joints: { ...HOME, base: -20 } }));
    assert.equal(sim.state.joints.base, rad(-20)); assert.equal(sim.state.stopped, false);
  } finally { sim.dispose(); }
});

test('dummy telemetry sweeps four joints within configured limits using the real socket schema', () => {
  const home = createDummyTelemetry(0, 0);
  assert.deepEqual(home.joints, HOME);
  const moved = createDummyTelemetry(2, 64);
  for (const key of Object.keys(HOME)) assert.notEqual(moved.joints[key], home.joints[key]);
  for (let t = 0; t < 50; t += 0.25) {
    const warnings = [];
    parseTelemetryMessage(JSON.stringify(createDummyTelemetry(t, Math.round(t * 32))), { warn: message => warnings.push(message) });
    assert.equal(warnings.length, 0);
  }
});
