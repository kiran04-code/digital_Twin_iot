import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DIMENSIONS, HOME, toRadians, rad } from './config.js';
import { beveledCylinderGeometry, surfaceLabel } from './visualDetails.js';

export function makeMaterials() {
  return {
    graphite: new THREE.MeshPhysicalMaterial({ color: 0x566674, metalness: 0.8, roughness: 0.27, clearcoat: 0.35, clearcoatRoughness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x161e27, metalness: 0.55, roughness: 0.32 }),
    copper: new THREE.MeshPhysicalMaterial({ color: 0xdd8545, metalness: 0.72, roughness: 0.24, clearcoat: 0.3 }),
    silver: new THREE.MeshStandardMaterial({ color: 0xc5d3df, metalness: 0.96, roughness: 0.19 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x111316, roughness: 0.86 }),
    led: new THREE.MeshStandardMaterial({ color: 0x4b6258, emissive: 0x111611, roughness: 0.4 }),
  };
}

export function mesh(parent, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const item = new THREE.Mesh(geometry, material);
  item.position.set(...position);
  item.rotation.set(...rotation);
  item.castShadow = true;
  item.receiveShadow = true;
  parent.add(item);
  return item;
}
export function box(parent, size, material, position, radius = 0.06) {
  return mesh(parent, new RoundedBoxGeometry(...size, 4, radius), material, position);
}
function cylinder(parent, radius, height, material, position, alongZ = false) {
  return mesh(parent, beveledCylinderGeometry(radius, height), material, position, alongZ ? [Math.PI / 2, 0, 0] : undefined);
}

export class RoboticArm {
  constructor({ ghost = false, dimensions = DIMENSIONS } = {}) {
    this.dimensions = dimensions;
    this.materials = makeMaterials();
    this.root = new THREE.Group();
    this.root.name = 'robotRoot';
    this.joints = {};
    this.axes = new THREE.Group();
    this.axisHelpers = [];
    this.createBase();
    this.createHierarchy();
    this.setJointState(toRadians(HOME));
    if (ghost) {
      const material = new THREE.MeshBasicMaterial({ color: 0x6bb9de, wireframe: true, transparent: true, opacity: 0.24 });
      this.root.traverse(node => { if (node.isMesh) { node.material = material; node.castShadow = false; } });
    }
  }

  createBase() {
    const m = this.materials;
    const d = this.dimensions;
    box(this.root, [2.65, 0.17, 2.3], m.dark, [0, 0.09, 0], 0.1);
    box(this.root, [2.48, 0.08, 2.13], m.graphite, [0, 0.215, 0], 0.08);
    for (const x of [-1.06, 1.06]) for (const z of [-0.9, 0.9]) {
      cylinder(this.root, 0.105, 0.055, m.silver, [x, 0.273, z]);
      cylinder(this.root, 0.038, 0.06, m.dark, [x, 0.28, z]);
    }
    cylinder(this.root, d.baseRadius, 0.24, m.graphite, [0, 0.38, 0]);
    cylinder(this.root, d.baseRadius * 0.96, 0.06, m.copper, [0, 0.52, 0]);
    cylinder(this.root, d.baseRadius * 0.88, 0.08, m.dark, [0, 0.59, 0]);
    for (const y of [0.3, 0.46]) {
      mesh(this.root, new THREE.TorusGeometry(d.baseRadius - 0.01, 0.012, 8, 96), m.silver, [0, y, 0], [Math.PI / 2, 0, 0]);
    }
    const plate = box(this.root, [0.78, 0.13, 0.026], m.dark, [0, 0.2, 1.078], 0.015);
    const nameplate = surfaceLabel('ARC / ARM-04', 0.71, 0.115);
    if (nameplate) { nameplate.position.z = 0.016; plate.add(nameplate); }
    for (let i = 0; i < 24; i++) {
      const angle = i / 24 * Math.PI * 2;
      const notch = box(this.root, [0.024, 0.12, 0.05], m.dark, [Math.cos(angle) * d.baseRadius, 0.38, Math.sin(angle) * d.baseRadius], 0.005);
      notch.rotation.y = -angle;
    }
    this.joints.base = new THREE.Group();
    this.joints.base.name = 'baseRotationJoint';
    const baseScale = d.baseHeight / 0.5;
    this.root.children.forEach(part => { part.position.y *= baseScale; part.scale.y *= baseScale; });
    this.basePivotHeight = 0.65 * baseScale;
    this.joints.base.position.y = this.basePivotHeight;
    this.root.add(this.joints.base);
    cylinder(this.joints.base, 0.87, 0.17, m.graphite, [0, 0, 0]);
    box(this.joints.base, [0.92, 0.55, 0.72], m.dark, [0, 0.22, 0]);
    for (const z of [-0.47, 0.47]) box(this.joints.base, [0.87, 0.57, 0.13], m.graphite, [0, 0.26, z]);
    this.addAxis(this.joints.base, true, 1.4);
  }

  createHierarchy() {
    const d = this.dimensions;
    const m = this.materials;
    this.joints.shoulder = new THREE.Group();
    this.joints.shoulder.name = 'shoulderJoint';
    this.joints.shoulder.position.y = d.shoulderHeight - this.basePivotHeight;
    this.joints.base.add(this.joints.shoulder);
    this.createJoint(this.joints.shoulder, 0.45, 'S2');
    const upperArm = this.createLink(this.joints.shoulder, d.upperArm, 0.68, 'upperArm');
    this.joints.elbow = new THREE.Group();
    this.joints.elbow.name = 'elbowJoint';
    this.joints.elbow.position.y = d.upperArm;
    upperArm.add(this.joints.elbow);
    this.createJoint(this.joints.elbow, 0.39, 'S3');
    const forearm = this.createLink(this.joints.elbow, d.forearm, 0.55, 'forearm');
    this.joints.wrist = new THREE.Group();
    this.joints.wrist.name = 'wristJoint';
    this.joints.wrist.position.y = d.forearm;
    forearm.add(this.joints.wrist);
    this.createJoint(this.joints.wrist, 0.3, 'S4');
    box(this.joints.wrist, [0.32, d.wrist, 0.4], m.graphite, [0, d.wrist / 2, 0]);
    cylinder(this.joints.wrist, 0.27, 0.1, m.copper, [0, d.wrist, 0]);
    cylinder(this.joints.wrist, 0.35, d.magnet * 0.76, m.dark, [0, d.wrist + d.magnet * 0.4, 0]);
    cylinder(this.joints.wrist, 0.36, 0.05, m.copper, [0, d.wrist + d.magnet * 0.62, 0]);
    cylinder(this.joints.wrist, 0.34, 0.09, m.silver, [0, d.wrist + d.magnet - 0.045, 0]);
    this.magnetLED = cylinder(this.joints.wrist, 0.06, 0.035, m.led, [0, d.wrist + 0.18, 0.351], true);
    this.endEffector = new THREE.Group();
    this.endEffector.name = 'endEffector';
    this.endEffector.position.y = d.wrist + d.magnet;
    this.joints.wrist.add(this.endEffector);
  }

  createJoint(parent, radius) {
    const m = this.materials;
    cylinder(parent, radius, 0.73, m.dark, [0, 0, 0], true);
    box(parent, [radius * 1.6, radius * 1.2, 0.58], m.dark, [-radius * 0.32, -radius * 0.35, 0]);
    for (const side of [-1, 1]) {
      cylinder(parent, radius, 0.085, m.graphite, [0, 0, side * 0.405], true);
      cylinder(parent, radius * 0.83, 0.06, m.copper, [0, 0, side * 0.459], true);
      cylinder(parent, radius * 0.61, 0.075, m.dark, [0, 0, side * 0.5], true);
      cylinder(parent, radius * 0.3, 0.088, m.silver, [0, 0, side * 0.538], true);
      cylinder(parent, radius * 0.11, 0.092, m.dark, [0, 0, side * 0.544], true);
      mesh(parent, new THREE.TorusGeometry(radius * 0.94, 0.012, 8, 96), m.silver, [0, 0, side * 0.455]);
      mesh(parent, new THREE.TorusGeometry(radius * 0.59, 0.009, 8, 96), m.silver, [0, 0, side * 0.546]);
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3;
        cylinder(parent, 0.035, 0.045, m.silver, [Math.cos(a) * radius * 0.72, Math.sin(a) * radius * 0.72, side * 0.51], true);
        mesh(parent, new THREE.CylinderGeometry(0.018, 0.018, 0.003, 6), m.dark, [Math.cos(a) * radius * 0.72, Math.sin(a) * radius * 0.72, side * 0.535], [Math.PI / 2, 0, 0]);
      }
    }
    this.addAxis(parent, false, radius * 1.65);
  }

  createLink(parent, length, width, name) {
    const group = new THREE.Group();
    group.name = name;
    parent.add(group);
    const m = this.materials;
    // Two load-bearing side plates straddle the joint, plus a central stiffener.
    for (const z of [-0.32, 0.32]) {
      box(group, [width, length, 0.15], m.graphite, [0, length / 2, z], 0.09);
      box(group, [width * 0.36, length * 0.6, 0.018], m.dark, [0, length / 2, z + Math.sign(z) * 0.083], 0.05);
      box(group, [0.045, length * 0.62, 0.023], m.copper, [width * 0.33, length / 2, z + Math.sign(z) * 0.09], 0.01);
      for (const y of [length * 0.24, length * 0.76]) {
        cylinder(group, 0.045, 0.045, m.silver, [-width * 0.29, y, z + Math.sign(z) * 0.09], true);
      }
    }
    box(group, [width * 0.65, length * 0.55, 0.49], m.dark, [0, length / 2, 0]);
    // Machined cooling ribs along the motor housing and a recessed serial plate.
    for (let i = 0; i < 7; i++) {
      box(group, [width * 0.7, 0.032, 0.51], m.graphite, [0, length * 0.32 + i * length * 0.055, 0], 0.01);
    }
    const serial = surfaceLabel(name === 'upperArm' ? 'ARC / S2' : 'ARC / S3', length * 0.34, width * 0.17);
    if (serial) {
      serial.position.set(-width * 0.045, length * 0.54, 0.418);
      serial.rotation.z = Math.PI / 2;
      group.add(serial);
    }
    for (const y of [length * 0.24, length * 0.76]) cylinder(group, 0.09, 0.63, m.silver, [0, y, 0], true);
    const points = [new THREE.Vector3(-width * 0.5, 0.15, -0.1), new THREE.Vector3(-width * 0.76, length * 0.3, -0.12), new THREE.Vector3(-width * 0.7, length * 0.72, -0.12), new THREE.Vector3(-width * 0.5, length - 0.15, -0.1)];
    mesh(group, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 48, 0.035, 12, false), m.rubber);
    return group;
  }

  addAxis(parent, vertical, radius) {
    const group = new THREE.Group();
    const color = vertical ? 0x70c79e : 0xef8b77;
    group.add(new THREE.ArrowHelper(new THREE.Vector3(0, vertical ? 1 : 0, vertical ? 0 : 1), new THREE.Vector3(), 1.3, color, 0.18, 0.1));
    const points = Array.from({ length: 40 }, (_, i) => {
      const a = i / 39 * Math.PI * 1.55;
      return vertical ? new THREE.Vector3(Math.cos(a) * radius, 0.1, Math.sin(a) * radius) : new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0.66);
    });
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 })));
    group.visible = false;
    parent.add(group);
    this.axisHelpers.push(group);
  }

  setJointState(angles) {
    this.joints.base.rotation.y = angles.base;
    this.joints.shoulder.rotation.z = angles.shoulder - Math.PI / 2;
    this.joints.elbow.rotation.z = angles.elbow - Math.PI;
    this.joints.wrist.rotation.z = angles.wrist - Math.PI / 2;
    this.root.updateMatrixWorld(true);
  }
  setAxes(visible) { this.axisHelpers.forEach(axis => { axis.visible = visible; }); }
  setMagnet(on) {
    this.materials.led.color.setHex(on ? 0x87e8ad : 0x4b6258);
    this.materials.led.emissive.setHex(on ? 0x329c58 : 0x000000);
    this.materials.led.emissiveIntensity = on ? 2 : 0;
  }
  getEndEffectorWorldPosition() { return this.endEffector.getWorldPosition(new THREE.Vector3()); }
}

// Matches the scene graph; used to place the demo workpiece at a reachable location.
export function forwardKinematics(angles, d = DIMENSIONS) {
  const a = rad(angles.shoulder - 90);
  const b = a + rad(angles.elbow - 180);
  const c = b + rad(angles.wrist - 90);
  const reach = -Math.sin(a) * d.upperArm - Math.sin(b) * d.forearm - Math.sin(c) * (d.wrist + d.magnet);
  return new THREE.Vector3(reach * Math.cos(rad(angles.base)), d.shoulderHeight + Math.cos(a) * d.upperArm + Math.cos(b) * d.forearm + Math.cos(c) * (d.wrist + d.magnet), -reach * Math.sin(rad(angles.base)));
}
