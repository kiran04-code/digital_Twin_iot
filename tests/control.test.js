import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { JOINTS, HOME, DIMENSIONS, mapRange, mapGestureToJoints, applyJointLimits, angleToPulse, jointToPulse, rad, toRadians, toDegrees } from '../js/config.js';
import { GestureController } from '../js/gestureController.js';
import { ESPNowSimulator, validatePacket } from '../js/communication.js';
import { Simulation } from '../js/simulation.js';
import { RoboticArm, forwardKinematics } from '../js/roboticArm.js';
import { Electromagnet } from '../js/electromagnet.js';
import { PICK_POSE, PLACE_POSE } from '../js/demoController.js';

const close = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} should equal ${expected}`);
const packet = (overrides = {}) => ({ gestureId: 1, pitch: 0, roll: 0, ...HOME, electromagnet: false, timestamp: Date.now(), mode: 'gesture', ...overrides });

test('gesture mapping reverses elbow motion and uses independent joint ratios', () => {
  assert.deepEqual(mapGestureToJoints({ pitch: -60, roll: -90 }), { base: -90, shoulder: 35, elbow: 145, wrist: -45 });
  assert.deepEqual(mapGestureToJoints({ pitch: 60, roll: 90 }), { base: 90, shoulder: 145, elbow: 45, wrist: 45 });
  assert.deepEqual(mapGestureToJoints({ pitch: 0, roll: 0 }), { base: 0, shoulder: 90, elbow: 95, wrist: 0 });
  close(mapRange(30, -60, 60, -45, 45), 22.5);
});

test('joint limits clamp every axis and report unsafe input', () => {
  const warnings = [];
  assert.deepEqual(applyJointLimits({ base: -120, shoulder: 200, elbow: -40, wrist: 140 }, message => warnings.push(message)), { base: -90, shoulder: 165, elbow: 20, wrist: 90 });
  assert.equal(warnings.length, 4);
  assert.throws(() => applyJointLimits({ ...HOME, base: NaN }), /Invalid/);
});

test('PWM conversion handles signed joints and unsigned servo angles', () => {
  close(angleToPulse(0), 500); close(angleToPulse(90), 1500); close(angleToPulse(180), 2500);
  close(jointToPulse('base', rad(-90)), 500); close(jointToPulse('base', 0), 1500); close(jointToPulse('wrist', rad(90)), 2500);
  close(jointToPulse('shoulder', rad(90)), 1500); close(jointToPulse('elbow', rad(45)), 1000);
});

test('sensor gravity reconstructs pitch/roll and gyro measures angular velocity', () => {
  const sensor = new GestureController();
  const reading = sensor.sense({ pitch: 30, roll: -45 }, 0.5);
  close(reading.pitch, 30); close(reading.roll, -45);
  close(reading.ax ** 2 + reading.ay ** 2 + reading.az ** 2, 1);
  close(reading.gx, -90); close(reading.gy, 60);
  close(sensor.sense({ pitch: 30, roll: -45 }, 0.5).gy, 0);
});

test('packet validation rejects missing fields, invalid types and corrupt commands', () => {
  assert.equal(validatePacket(packet()), true);
  for (const candidate of [null, {}, packet({ base: Infinity }), packet({ pitch: NaN }), packet({ electromagnet: 'true' }), packet({ mode: 'ai' }), packet({ gestureId: 1.5 })]) assert.equal(validatePacket(candidate), false);
});

test('wireless delivery is delayed, ordered, bounded and becomes stale', () => {
  let time = 0; let timer; let delay; let deliveries = 0;
  const wireless = new ESPNowSimulator(() => deliveries++, { now: () => time, random: () => 0.5, schedule: (fn, ms) => { timer = fn; delay = ms; return 1; }, cancel: () => {} });
  wireless.transmitPacket(packet());
  assert.equal(deliveries, 0); assert.ok(delay >= 3 && delay <= 15);
  time = delay; timer(); assert.equal(deliveries, 1); assert.equal(wireless.getStatistics().stale, false);
  assert.equal(wireless.receivePacket(packet(), 5), false);
  time = 600; assert.equal(wireless.getStatistics().stale, true);
  for (let i = 2; i < 30; i++) wireless.receivePacket(packet({ gestureId: i }), 5);
  assert.equal(wireless.packets.length, 15);
  wireless.dispose();
});

test('disconnect invalidates pending callbacks; configured packet loss drops packets', () => {
  let timer; let deliveries = 0;
  const wireless = new ESPNowSimulator(() => deliveries++, { random: () => 0, schedule: fn => { timer = fn; return 1; }, cancel: () => {} });
  wireless.transmitPacket(packet()); wireless.setConnected(false); timer(); assert.equal(deliveries, 0);
  wireless.setConnected(true); wireless.setPacketLoss(10); wireless.transmitPacket(packet({ gestureId: 2 }));
  assert.equal(wireless.dropped, 2); assert.equal(wireless.received, 0); wireless.dispose();
});

test('receiver commands are smoothed independently from monitoring state', () => {
  const sim = new Simulation();
  sim.setGesture('roll', 60);
  close(sim.state.joints.base, 0); close(sim.state.targetJoints.base, 0);
  sim.receivePacket(packet({ roll: 60 }));
  close(sim.state.targetJoints.base, rad(60)); close(sim.state.joints.base, 0);
  sim.smoothJointTargets(1 / 60);
  assert.ok(sim.physicalJoints.base > 0 && sim.physicalJoints.base < rad(60));
  close(sim.state.joints.base, 0);
  sim.receivePacket(packet({ gestureId: 2, roll: 60 }));
  close(sim.state.joints.base, sim.physicalJoints.base);
  sim.dispose();
});

test('servo smoothing has consistent speed at different frame rates', () => {
  const a = new Simulation(), b = new Simulation();
  a.state.targetJoints.base = b.state.targetJoints.base = rad(80);
  for (let i = 0; i < 60; i++) a.smoothJointTargets(1 / 60);
  for (let i = 0; i < 30; i++) b.smoothJointTargets(1 / 30);
  close(a.physicalJoints.base, b.physicalJoints.base);
  a.dispose(); b.dispose();
});

test('emergency stop rejects subsequent commands and freezes all joints until reset', () => {
  const sim = new Simulation();
  sim.receivePacket(packet({ roll: 75, electromagnet: true })); sim.smoothJointTargets(0.1);
  sim.emergencyStop();
  const frozen = { ...sim.physicalJoints };
  sim.receivePacket(packet({ gestureId: 2, roll: -75, electromagnet: true }));
  for (let i = 0; i < 20; i++) sim.update(0.02);
  assert.deepEqual(sim.physicalJoints, frozen); assert.equal(sim.state.magnet, false); assert.equal(sim.demo.running, false);
  sim.resetSystem(); assert.equal(sim.state.stopped, false);
  assert.deepEqual(sim.state.manual, toDegrees(frozen));
  sim.home(); assert.deepEqual(sim.createGesturePacket().base, HOME.base);
  sim.dispose();
});

test('four-joint hierarchy agrees with end-effector kinematics and preserves link lengths', () => {
  const arm = new RoboticArm();
  assert.equal(Object.keys(arm.joints).length, 4);
  assert.equal(arm.joints.elbow.parent.name, 'upperArm');
  assert.equal(arm.joints.elbow.parent.parent, arm.joints.shoulder);
  assert.equal(arm.joints.wrist.parent.parent, arm.joints.elbow);
  for (const pose of [HOME, PICK_POSE, PLACE_POSE, { base: 85, shoulder: 130, elbow: 40, wrist: -60 }]) {
    arm.setJointState(toRadians(pose));
    close(arm.getEndEffectorWorldPosition().distanceTo(forwardKinematics(pose)), 0);
    close(arm.joints.shoulder.getWorldPosition(new THREE.Vector3()).distanceTo(arm.joints.elbow.getWorldPosition(new THREE.Vector3())), DIMENSIONS.upperArm);
    close(arm.joints.elbow.getWorldPosition(new THREE.Vector3()).distanceTo(arm.joints.wrist.getWorldPosition(new THREE.Vector3())), DIMENSIONS.forearm);
  }
});

test('servo leads stay attached through joint motion and reuse their GPU buffers', () => {
  const arm = new RoboticArm();
  const parent = new THREE.Group(); parent.add(arm.root);
  parent.position.set(4, 2, -3); parent.rotation.set(0.1, 0.7, -0.2);
  const buffers = arm.leads.map(lead => lead.position.array);
  const ringCenter = (lead, segment) => {
    const center = new THREE.Vector3();
    for (let j = 0; j < lead.sides; j++) {
      const index = (lead.segments + 1 + segment) * lead.sides + j;
      center.add(new THREE.Vector3().fromBufferAttribute(lead.position, index));
    }
    return center.divideScalar(lead.sides);
  };
  for (const pose of [HOME, PICK_POSE, PLACE_POSE, { base: -90, shoulder: 165, elbow: 20, wrist: 90 }]) {
    arm.setJointState(toRadians(pose));
    arm.leads.forEach((lead, i) => {
      const anchor = arm.root.worldToLocal(lead.anchor.getWorldPosition(new THREE.Vector3()));
      close(ringCenter(lead, 0).distanceTo(anchor), 0, 1e-6);
      close(ringCenter(lead, lead.segments).distanceTo(lead.destination), 0, 1e-6);
      assert.equal(lead.position.array, buffers[i]);
      assert.ok(lead.position.array.every(Number.isFinite));
      assert.ok(lead.normal.array.every(Number.isFinite));
    });
  }
});

test('printed link windows remain open through the plate thickness', () => {
  const arm = new RoboticArm();
  for (const [name, length, width] of [['upperArm', DIMENSIONS.upperArm, 0.68], ['forearm', DIMENSIONS.forearm, 0.63]]) {
    const plate = arm.root.getObjectByName(name + 'SlottedPlate');
    const probe = new THREE.Mesh(plate.geometry, plate.material);
    probe.updateMatrixWorld();
    const ray = new THREE.Raycaster(new THREE.Vector3(0, length / 2, 1), new THREE.Vector3(0, 0, -1));
    assert.equal(ray.intersectObject(probe).length, 0, 'window should be a real opening');
    ray.ray.origin.x = width * 0.4;
    assert.ok(ray.intersectObject(probe).length > 0, 'side rail should remain solid');
  }
});

test('magnetic pickup attaches at contact, transports cube and preserves release transform', () => {
  const scene = new THREE.Scene(), arm = new RoboticArm(); scene.add(arm.root);
  const magnet = new Electromagnet(scene, arm);
  magnet.setEnabled(true); magnet.update(); assert.equal(magnet.attached, null);
  arm.setJointState(toRadians(PICK_POSE)); magnet.update();
  assert.equal(magnet.cube.parent, arm.endEffector); assert.equal(magnet.attached, magnet.cube);
  arm.setJointState(toRadians(PLACE_POSE));
  const position = magnet.cube.getWorldPosition(new THREE.Vector3());
  const rotation = magnet.cube.getWorldQuaternion(new THREE.Quaternion());
  assert.ok(position.y >= 0.3, 'released cube should not penetrate the table');
  magnet.setEnabled(false);
  assert.equal(magnet.cube.parent, scene); assert.equal(magnet.attached, null);
  close(magnet.cube.position.distanceTo(position), 0); close(magnet.cube.quaternion.angleTo(rotation), 0, 1e-7);
  magnet.reset(); close(magnet.cube.position.distanceTo(magnet.initial), 0);
});
