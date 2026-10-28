import test from 'node:test';
import assert from 'node:assert/strict';
import { ReceiverMotion } from '../js/receiverMotion.js';
import { SerialService } from '../server/serial-service.mjs';
import { readConfig } from '../server/config.mjs';
import { parseTelemetryMessage } from '../js/socketTelemetry.js';
import { RoboticArm } from '../js/roboticArm.js';
import { rad } from '../js/config.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('supplied sensor samples follow receiver neutral offsets, filter, signs and 1-degree slew', () => {
  const motion = new ReceiverMotion();
  const samples = [{ pitch: 24.52, roll: -1.83 }, { pitch: 25.10, roll: -2.15 }, { pitch: 26.42, roll: -3.02 }];
  const expected = [
    { base: 89, shoulder: 90.624, elbow: 89.48, wrist: 89.688 },
    { base: 88.659, shoulder: 90.7632, elbow: 89.364, wrist: 89.6184 },
    { base: 88.3212, shoulder: 91.19136, elbow: 89.0072, wrist: 89.40432 },
  ];
  samples.forEach((sample, index) => {
    motion.receive(sample, index * 20);
    const frame = motion.step(index * 20);
    for (const key of Object.keys(frame.angles)) close(frame.angles[key], expected[index][key]);
    assert.equal(motion.step(index * 20 + 5), null);
  });
});

test('receiver estimate holds on sensor timeout, rejects invalid readings and resumes its filter', () => {
  const motion = new ReceiverMotion(); motion.receive({ pitch: 24, roll: -1 }, 0);
  assert.deepEqual(motion.step(0).angles, { base: 90, shoulder: 90, elbow: 90, wrist: 90 });
  for (const sample of [{ pitch: '24', roll: 0 }, { pitch: NaN, roll: 0 }, { pitch: 91, roll: 0 }, { pitch: 0, roll: 181 }, {}]) assert.throws(() => motion.receive(sample, 100));
  assert.equal(motion.receivedAt, 0);
  assert.ok(motion.step(500));
  const held = { ...motion.current }; assert.equal(motion.step(501), null); assert.deepEqual(motion.current, held);
  motion.receive({ pitch: 25, roll: -2 }, 600);
  const resumed = motion.step(600); close(resumed.gesture.pitch, 24.2); close(resumed.gesture.roll, -1.2);
});

test('sustained extreme sensor values respect all firmware joint limits in both directions', () => {
  const motion = new ReceiverMotion();
  for (let t = 0; t < 3000; t += 20) { motion.receive({ pitch: 90, roll: 180 }, t); motion.step(t); }
  close(motion.current.base, 135); close(motion.current.shoulder, 140); close(motion.current.elbow, 45); close(motion.current.wrist, 50.4);
  for (let t = 3000; t < 7000; t += 20) { motion.receive({ pitch: -90, roll: -180 }, t); motion.step(t); }
  assert.deepEqual(motion.current, { base: 45, shoulder: 40, elbow: 135, wrist: 135 });
});

test('sensor_update serial lines become calculated four-joint frames accepted by the existing model', () => {
  const serial = new SerialService(readConfig({})); const frames = []; const errors = [];
  serial.on('angles', frame => frames.push(frame)); serial.on('invalid', error => errors.push(error));
  serial.feed(Buffer.from('{"type":"sensor_update","pitch":24.52,'));
  assert.equal(frames.length, 0);
  serial.feed(Buffer.from('"roll":-1.83}\n'));
  assert.equal(frames.length, 1); assert.equal(frames[0].angleSource, 'calculated');
  const frame = parseTelemetryMessage(JSON.stringify({ type: 'joint_update', source: 'esp32', ...frames[0] }));
  assert.equal(frame.angleSource, 'calculated'); close(frame.gesture.pitch, 24.52);
  const arm = new RoboticArm(); arm.setJointState(frame.joints);
  close(arm.joints.base.rotation.y, rad(-1)); close(arm.joints.shoulder.rotation.z, rad(0.624));
  close(arm.joints.elbow.rotation.z, rad(-90.52)); close(arm.joints.wrist.rotation.z, rad(-90.312));
  const heartbeat = serial.latestAt;
  serial.feed(Buffer.from('{"type":"sensor_update","pitch":"bad","roll":1}\n'));
  assert.equal(serial.latestAt, heartbeat); assert.equal(errors.length, 1);
  serial.stop();
});

test('the supplied receiver text log yields authoritative servo angles and disables sensor extrapolation', () => {
  const serial = new SerialService(readConfig({})); const frames = [];
  serial.on('angles', frame => frames.push(frame)); serial.on('invalid', () => {});
  serial.feed(Buffer.from('{"type":"sensor_update","pitch":25,"roll":-2}\n'));
  serial.feed(Buffer.from('P: 25.1 R: -2.2 | Servo angles: 88, 91, 89, 89\r\n'));
  assert.equal(frames.length, 2); assert.equal(frames[1].angleSource, 'receiver_command');
  assert.deepEqual(frames[1].angles, { base: 88, shoulder: 91, elbow: 89, wrist: 89 });
  assert.deepEqual(frames[1].gesture, { pitch: 25.1, roll: -2.2 });
  serial.tickSensor(); assert.equal(frames.length, 2);
  serial.feed(Buffer.from('Receiver ready. Waiting for valid sender data...\n'));
  serial.feed(Buffer.from('{"base":90,"shoulder":90,"elbow":90,"wrist":90}\n'));
  assert.equal(frames.length, 3); assert.equal(frames[2].angleSource, 'receiver_command');
  serial.stop();
});
