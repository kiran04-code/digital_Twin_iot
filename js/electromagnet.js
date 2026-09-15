import * as THREE from 'three';
import { mesh, box, makeMaterials, forwardKinematics } from './roboticArm.js';
import { PICK_POSE } from './demoController.js';
import { beveledCylinderGeometry } from './visualDetails.js';

export class Electromagnet {
  constructor(scene, arm) {
    this.scene = scene;
    this.arm = arm;
    this.enabled = false;
    this.attached = null;
    this.materials = makeMaterials();
    const position = forwardKinematics(PICK_POSE);
    this.initial = new THREE.Vector3(position.x, 0.34, position.z);
    this.cube = box(scene, [0.6, 0.6, 0.6], this.materials.silver, this.initial.toArray(), 0.035);
    this.cube.name = 'metalCube';
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.6, 0.6, 0.6)), new THREE.LineBasicMaterial({ color: 0xc0cbd0, transparent: true, opacity: 0.45 }));
    this.cube.add(edges);
    this.cylinder = mesh(scene, beveledCylinderGeometry(0.3, 0.45), this.materials.silver, [4.35, 0.27, 0.45]);
    this.washer = mesh(scene, new THREE.TorusGeometry(0.31, 0.09, 24, 96), this.materials.silver, [3.9, 0.14, -0.55], [Math.PI / 2, 0, 0]);
  }
  setEnabled(enabled) {
    this.enabled = enabled;
    this.arm.setMagnet(enabled);
    if (!enabled && this.attached) {
      this.scene.attach(this.attached); // Keeps the exact last world-space transform.
      this.attached = null;
    }
  }
  update() {
    if (!this.enabled || this.attached) return;
    const distance = this.arm.getEndEffectorWorldPosition().distanceTo(this.cube.getWorldPosition(new THREE.Vector3()));
    if (distance <= 0.5) {
      this.arm.endEffector.attach(this.cube);
      // Magnetic attraction seats the cube against the contact face.
      this.cube.position.set(0, 0.3, 0);
      this.cube.quaternion.identity();
      this.attached = this.cube;
    }
  }
  reset() {
    this.setEnabled(false);
    this.scene.attach(this.cube);
    this.cube.position.copy(this.initial);
    this.cube.rotation.set(0, 0, 0);
  }
}
