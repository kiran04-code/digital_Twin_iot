import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DIMENSIONS, HOME, toRadians, rad } from './config.js';
import { beveledCylinderGeometry } from './visualDetails.js';
import { ServoLead } from './servoLead.js';

export function makeMaterials() {
  return {
    plastic: new THREE.MeshStandardMaterial({ color: 0xeeeae0, roughness: 0.73, metalness: 0, envMapIntensity: 0.32 }),
    graphite: new THREE.MeshStandardMaterial({ color: 0x252a2c, roughness: 0.65, metalness: 0.05 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x111517, roughness: 0.58, metalness: 0.05 }),
    copper: new THREE.MeshStandardMaterial({ color: 0xc78343, roughness: 0.38, metalness: 0.7 }),
    silver: new THREE.MeshStandardMaterial({ color: 0xa8afb3, roughness: 0.28, metalness: 0.85 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x191b1b, roughness: 0.9 }),
    seam: new THREE.MeshStandardMaterial({ color: 0xb5b4ac, roughness: 0.85 }),
    case: new THREE.MeshPhysicalMaterial({ color: 0xdfe5eb, roughness: 0.22, metalness: 0,
      transparent: true, opacity: 0.19, depthWrite: false, side: THREE.DoubleSide }),
    caseEdge: new THREE.MeshStandardMaterial({ color: 0xcbd4da, roughness: 0.36, transparent: true, opacity: 0.48, depthWrite: false }),
    board: new THREE.MeshStandardMaterial({ color: 0x256253, roughness: 0.8 }),
    label: new THREE.MeshStandardMaterial({ color: 0x973f6b, roughness: 0.8 }),
    brownWire: new THREE.MeshStandardMaterial({ color: 0x623727, roughness: 0.65 }),
    redWire: new THREE.MeshStandardMaterial({ color: 0xc9422a, roughness: 0.65 }),
    orangeWire: new THREE.MeshStandardMaterial({ color: 0xeeb13c, roughness: 0.6 }),
    led: new THREE.MeshStandardMaterial({ color: 0x87261f, emissive: 0x3b0804, roughness: 0.4 }),
  };
}

export function mesh(parent, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const item = new THREE.Mesh(geometry, material);
  item.position.set(...position); item.rotation.set(...rotation);
  item.castShadow = true; item.receiveShadow = true; parent.add(item);
  return item;
}
export function box(parent, size, material, position, radius = 0.06) {
  return mesh(parent, new RoundedBoxGeometry(...size, 4, radius), material, position);
}
function cylinder(parent, radius, height, material, position, alongZ = false) {
  return mesh(parent, beveledCylinderGeometry(radius, height), material, position, alongZ ? [Math.PI / 2, 0, 0] : undefined);
}

function roundedRect(path, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  path.moveTo(x + r, y); path.lineTo(x + width - r, y);
  path.quadraticCurveTo(x + width, y, x + width, y + r);
  path.lineTo(x + width, y + height - r);
  path.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  path.lineTo(x + r, y + height); path.quadraticCurveTo(x, y + height, x, y + height - r);
  path.lineTo(x, y + r); path.quadraticCurveTo(x, y, x + r, y);
  return path;
}

// Actual openings through the printed side plates, including the pivot bores.
function slottedPlate(length, width, thickness) {
  const shape = roundedRect(new THREE.Shape(), -width / 2, -width / 2, width, length + width, width / 2);
  shape.holes.push(roundedRect(new THREE.Path(), -width * 0.27, 0.37, width * 0.54, length - 0.74, 0.16));
  for (const y of [0, length]) {
    const hole = new THREE.Path(); hole.absarc(0, y, 0.085, 0, Math.PI * 2, true); shape.holes.push(hole);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelSize: 0.025,
    bevelThickness: 0.025, bevelSegments: 3, curveSegments: 12, steps: 1 });
  geometry.translate(0, 0, -thickness / 2);
  return geometry;
}

export class RoboticArm {
  constructor({ ghost = false, dimensions = DIMENSIONS } = {}) {
    this.dimensions = dimensions; this.materials = makeMaterials();
    this.root = new THREE.Group(); this.root.name = 'robotRoot';
    this.joints = {}; this.axes = new THREE.Group(); this.axisHelpers = []; this.leads = [];
    this.createBase(); this.createHierarchy(); this.createWiring();
    this.setJointState(toRadians(HOME));
    if (ghost) {
      const material = new THREE.MeshBasicMaterial({ color: 0x6bb9de, wireframe: true, transparent: true, opacity: 0.24 });
      this.root.traverse(node => { if (node.isMesh) { node.material = material; node.castShadow = false; } });
    }
  }

  createBase() {
    const m = this.materials, d = this.dimensions;
    const enclosure = new THREE.Group(); enclosure.name = 'clearElectronicsEnclosure'; this.root.add(enclosure);
    const shell = box(enclosure, [3.0, 0.25, 3.25], m.case, [0, 0.14, 0.1], 0.12);
    shell.castShadow = false;
    // Moulded lid rim and fastening ears on the clear electronics box.
    for (const y of [0.045, 0.255]) {
      for (const x of [-1.43, 1.43]) box(enclosure, [0.045, 0.05, 3.0], m.caseEdge, [x, y, 0.1], 0.015);
      for (const z of [-1.43, 1.63]) box(enclosure, [2.84, 0.05, 0.045], m.caseEdge, [0, y, z], 0.015);
    }
    for (const x of [-1.56, 1.56]) for (const z of [-1.05, 1.18]) {
      const tab = roundedRect(new THREE.Shape(), -0.13, -0.13, 0.26, 0.26, 0.06);
      tab.holes.push(roundedRect(new THREE.Path(), -0.075, -0.04, 0.15, 0.08, 0.03));
      const geometry = new THREE.ExtrudeGeometry(tab, { depth: 0.045, bevelEnabled: false, curveSegments: 8 });
      mesh(enclosure, geometry, m.caseEdge, [x, 0.22, z], [Math.PI / 2, 0, 0]);
    }
    box(enclosure, [2.35, 0.075, 2.72], m.plastic, [0, 0.09, 0.1], 0.035).name = 'breadboard';
    const holes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.022, 0.003, 0.022), m.seam, 160);
    const transform = new THREE.Matrix4(); let n = 0;
    for (const side of [-1, 1]) for (let row = 0; row < 16; row++) for (let col = 0; col < 5; col++) {
      transform.makeTranslation(side * (0.71 + col * 0.075), 0.13, -1.02 + row * 0.145); holes.setMatrixAt(n++, transform);
    }
    enclosure.add(holes);
    box(enclosure, [0.65, 0.045, 0.9], m.board, [0.75, 0.18, 0.88], 0.025);
    box(enclosure, [0.37, 0.07, 0.42], m.dark, [0.75, 0.23, 0.85], 0.015);
    box(enclosure, [0.19, 0.09, 0.15], m.silver, [0.75, 0.22, 1.36], 0.015);
    this.magnetLED = cylinder(enclosure, 0.035, 0.025, m.led, [1.01, 0.22, 1.16]);

    const scale = d.baseHeight / 0.5;
    cylinder(this.root, d.baseRadius, 0.15 * scale, m.plastic, [0, 0.34 * scale, 0]).name = 'lowerPrintedBaseDisc';
    cylinder(this.root, d.baseRadius * 0.96, 0.045 * scale, m.seam, [0, 0.435 * scale, 0]);
    cylinder(this.root, d.baseRadius, 0.17 * scale, m.plastic, [0, 0.54 * scale, 0]).name = 'upperPrintedBaseDisc';
    for (const y of [0.30, 0.35, 0.49, 0.54, 0.59]) {
      mesh(this.root, new THREE.TorusGeometry(d.baseRadius - 0.008, 0.004, 4, 96), m.seam, [0, y * scale, 0], [Math.PI / 2, 0, 0]);
    }
    this.basePivotHeight = 0.65 * scale;
    this.joints.base = new THREE.Group(); this.joints.base.name = 'baseRotationJoint';
    this.joints.base.position.y = this.basePivotHeight; this.root.add(this.joints.base);
    const shoulderY = d.shoulderHeight - this.basePivotHeight;
    box(this.joints.base, [0.84, 0.11, 1.08], m.plastic, [0, -0.015, 0], 0.035);
    for (const z of [-0.5, 0.5]) {
      box(this.joints.base, [0.5, shoulderY, 0.14], m.plastic, [0, shoulderY / 2 - 0.04, z], 0.065);
      cylinder(this.joints.base, 0.255, 0.14, m.plastic, [0, shoulderY, z], true);
      for (const x of [-0.31, 0.31]) cylinder(this.joints.base, 0.045, 0.03, m.silver, [x, 0.05, z]);
    }
    this.shoulderCable = this.createServo(this.joints.base, shoulderY, 1, 'shoulderServo');
    this.addAxis(this.joints.base, true, 1.4);
  }

  createHierarchy() {
    const d = this.dimensions, m = this.materials;
    this.joints.shoulder = new THREE.Group(); this.joints.shoulder.name = 'shoulderJoint';
    this.joints.shoulder.position.y = d.shoulderHeight - this.basePivotHeight; this.joints.base.add(this.joints.shoulder);
    const upperArm = this.createLink(this.joints.shoulder, d.upperArm, 0.68, 'upperArm');
    this.createHorn(this.joints.shoulder, 1); this.addAxis(this.joints.shoulder, false, 0.65);
    this.elbowCable = this.createServo(upperArm, d.upperArm, 1, 'elbowServo');
    this.joints.elbow = new THREE.Group(); this.joints.elbow.name = 'elbowJoint';
    this.joints.elbow.position.y = d.upperArm; upperArm.add(this.joints.elbow);
    const forearm = this.createLink(this.joints.elbow, d.forearm, 0.63, 'forearm');
    this.createHorn(this.joints.elbow, 1); this.addAxis(this.joints.elbow, false, 0.6);
    this.wristCable = this.createServo(forearm, d.forearm, 0.72, 'wristServo');
    this.joints.wrist = new THREE.Group(); this.joints.wrist.name = 'wristJoint';
    this.joints.wrist.position.y = d.forearm; forearm.add(this.joints.wrist);
    this.createHorn(this.joints.wrist, 0.72); this.addAxis(this.joints.wrist, false, 0.5);
    const tool = new THREE.Group(); tool.name = 'whiteWristBracket'; this.joints.wrist.add(tool);
    const reach = d.wrist + d.magnet;
    box(tool, [0.34, 0.30, 0.15], m.plastic, [0, 0.10, 0.34], 0.035);
    // Open, bent white end bracket from the reference photographs.
    box(tool, [1.02, reach * 0.66, 0.13], m.plastic, [0, reach * 0.61, -0.22], 0.025);
    for (const x of [-0.45, 0.45]) box(tool, [0.12, reach * 0.66, 0.62], m.plastic, [x, reach * 0.61, 0.035], 0.025);
    box(tool, [1.02, 0.12, 0.62], m.plastic, [0, reach * 0.30, 0.035], 0.025);
    for (const x of [-0.12, 0.12]) cylinder(tool, 0.035, 0.025, m.silver, [x, 0.34, -0.30], true);
    this.endEffector = new THREE.Group(); this.endEffector.name = 'endEffector';
    this.endEffector.position.y = reach; this.joints.wrist.add(this.endEffector);
  }

  createLink(parent, length, width, name) {
    const link = new THREE.Group(); link.name = name; parent.add(link);
    const geometry = slottedPlate(length, width, 0.13);
    for (const z of [-0.37, 0.37]) mesh(link, geometry, this.materials.plastic, [0, 0, z]).name = name + 'SlottedPlate';
    for (const y of [0.27, length - 0.27]) box(link, [width * 0.82, 0.12, 0.73], this.materials.plastic, [0, y, 0], 0.03);
    return link;
  }

  createServo(parent, pivotY, scale, name) {
    const m = this.materials;
    const servo = new THREE.Group(); servo.name = name; servo.position.y = pivotY; servo.scale.setScalar(scale); parent.add(servo);
    box(servo, [0.60, 0.82, 0.61], m.dark, [0, -0.32, 0], 0.035);
    box(servo, [0.62, 0.17, 0.63], m.graphite, [0, -0.06, 0], 0.03);
    box(servo, [0.61, 0.10, 0.62], m.graphite, [0, -0.69, 0], 0.02);
    for (const y of [0.10, -0.75]) {
      box(servo, [0.83, 0.10, 0.40], m.dark, [0, y, 0], 0.015);
      for (const x of [-0.34, 0.34]) cylinder(servo, 0.035, 0.025, m.silver, [x, y + 0.06, 0]);
    }
    cylinder(servo, 0.15, 0.11, m.graphite, [0, 0, 0.36], true);
    cylinder(servo, 0.085, 0.18, m.copper, [0, 0, 0.43], true);
    box(servo, [0.36, 0.34, 0.012], m.label, [0, -0.34, -0.311], 0.005);
    for (const y of [-0.24, -0.32, -0.40]) box(servo, [0.23, 0.013, 0.014], m.seam, [0, y, -0.32], 0.002);
    const anchor = new THREE.Object3D(); anchor.position.set(0.29, -0.55, 0.22); servo.add(anchor);
    box(servo, [0.11, 0.16, 0.13], m.rubber, anchor.position.toArray(), 0.025);
    return anchor;
  }

  createHorn(parent, scale) {
    const m = this.materials;
    for (const side of [-1, 1]) {
      cylinder(parent, 0.085, 0.17, m.dark, [0, 0, side * 0.51], true);
      cylinder(parent, 0.17 * scale, 0.05, m.dark, [0, 0, side * 0.61], true);
      cylinder(parent, 0.065, 0.025, m.silver, [0, 0, side * 0.646], true);
      box(parent, [0.075, 0.015, 0.006], m.dark, [0, 0, side * 0.662], 0.002);
      for (const x of [-0.115, 0.115]) cylinder(parent, 0.022, 0.012, m.silver, [x * scale, 0, side * 0.645], true);
    }
  }

  createWiring() {
    const m = this.materials, materials = [m.brownWire, m.redWire, m.orangeWire];
    this.leads.push(new ServoLead(this.root, this.shoulderCable, [0.75, 0.24, 1.16], materials, { bow: 0.4 }));
    this.leads.push(new ServoLead(this.root, this.elbowCable, [0.65, 0.64, 0.74], materials, { bow: 0.4 }));
    this.leads.push(new ServoLead(this.root, this.wristCable, [0.55, 0.64, -0.65], materials, { bow: 0.65, side: -1 }));
  }

  addAxis(parent, vertical, radius) {
    const group = new THREE.Group(), color = vertical ? 0x70c79e : 0xef8b77;
    group.add(new THREE.ArrowHelper(new THREE.Vector3(0, vertical ? 1 : 0, vertical ? 0 : 1), new THREE.Vector3(), 1.3, color, 0.18, 0.1));
    const points = Array.from({ length: 40 }, (_, i) => {
      const a = i / 39 * Math.PI * 1.55;
      return vertical ? new THREE.Vector3(Math.cos(a) * radius, 0.1, Math.sin(a) * radius) : new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0.66);
    });
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 })));
    group.visible = false; parent.add(group); this.axisHelpers.push(group);
  }

  setJointState(angles) {
    this.joints.base.rotation.y = angles.base;
    this.joints.shoulder.rotation.z = angles.shoulder - Math.PI / 2;
    this.joints.elbow.rotation.z = angles.elbow - Math.PI;
    this.joints.wrist.rotation.z = angles.wrist - Math.PI / 2;
    this.root.updateWorldMatrix(true, true);
    this.leads.forEach(lead => lead.update());
  }
  setAxes(visible) { this.axisHelpers.forEach(axis => { axis.visible = visible; }); }
  setMagnet(on) {
    this.materials.led.color.setHex(on ? 0x87e8ad : 0x87261f);
    this.materials.led.emissive.setHex(on ? 0x329c58 : 0x3b0804);
    this.materials.led.emissiveIntensity = on ? 2 : 0.5;
  }
  getEndEffectorWorldPosition() { return this.endEffector.getWorldPosition(new THREE.Vector3()); }
}

// Existing pivots and neutral offsets, also used by the pick-and-place demo.
export function forwardKinematics(angles, d = DIMENSIONS) {
  const a = rad(angles.shoulder - 90), b = a + rad(angles.elbow - 180), c = b + rad(angles.wrist - 90);
  const reach = -Math.sin(a) * d.upperArm - Math.sin(b) * d.forearm - Math.sin(c) * (d.wrist + d.magnet);
  return new THREE.Vector3(reach * Math.cos(rad(angles.base)), d.shoulderHeight + Math.cos(a) * d.upperArm + Math.cos(b) * d.forearm + Math.cos(c) * (d.wrist + d.magnet), -reach * Math.sin(rad(angles.base)));
}
