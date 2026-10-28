import * as THREE from 'three';

// Reuse tube buffers while the three insulated wires follow articulated endpoints.
export class ServoLead {
  constructor(root, anchor, destination, materials, { bow = 0.35, side = 1 } = {}) {
    Object.assign(this, { root, anchor, destination: new THREE.Vector3(...destination), bow, side });
    this.segments = 32; this.sides = 6;
    const count = 3 * (this.segments + 1) * this.sides;
    this.geometry = new THREE.BufferGeometry();
    this.position = new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3);
    this.normal = new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3);
    this.position.setUsage(THREE.DynamicDrawUsage); this.normal.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.position); this.geometry.setAttribute('normal', this.normal);
    const indices = [];
    for (let wire = 0; wire < 3; wire++) {
      const first = indices.length;
      for (let s = 0; s < this.segments; s++) for (let j = 0; j < this.sides; j++) {
        const a = (wire * (this.segments + 1) + s) * this.sides + j;
        const b = (wire * (this.segments + 1) + s) * this.sides + (j + 1) % this.sides;
        indices.push(a, b, a + this.sides, b, b + this.sides, a + this.sides);
      }
      this.geometry.addGroup(first, indices.length - first, wire);
    }
    this.geometry.setIndex(indices);
    this.mesh = new THREE.Mesh(this.geometry, materials);
    this.mesh.name = 'threeWireServoLead'; this.mesh.frustumCulled = false; root.add(this.mesh);
    this.curve = new THREE.CubicBezierCurve3();
    this.point = new THREE.Vector3(); this.tangent = new THREE.Vector3();
    this.axis = new THREE.Vector3(); this.binormal = new THREE.Vector3();
    this.bend1 = new THREE.Vector3(bow, -0.18, side * 0.35);
    this.bend2 = new THREE.Vector3(bow, -0.28, side * 0.32);
  }
  update() {
    const c = this.curve;
    this.anchor.getWorldPosition(c.v0); this.root.worldToLocal(c.v0); c.v3.copy(this.destination);
    c.v1.lerpVectors(c.v0, c.v3, 0.3).add(this.bend1);
    c.v2.lerpVectors(c.v0, c.v3, 0.72).add(this.bend2);
    for (let s = 0; s <= this.segments; s++) {
      c.getPoint(s / this.segments, this.point); c.getTangent(s / this.segments, this.tangent);
      this.axis.set(0, 0, 1);
      if (Math.abs(this.tangent.z) > 0.95) this.axis.set(1, 0, 0);
      this.axis.cross(this.tangent).normalize(); this.binormal.crossVectors(this.tangent, this.axis).normalize();
      for (let wire = 0; wire < 3; wire++) for (let j = 0; j < this.sides; j++) {
        const angle = j * Math.PI * 2 / this.sides;
        const nx = this.axis.x * Math.cos(angle) + this.binormal.x * Math.sin(angle);
        const ny = this.axis.y * Math.cos(angle) + this.binormal.y * Math.sin(angle);
        const nz = this.axis.z * Math.cos(angle) + this.binormal.z * Math.sin(angle);
        const index = (wire * (this.segments + 1) + s) * this.sides + j, offset = (wire - 1) * 0.035;
        this.position.setXYZ(index, this.point.x + this.axis.x * offset + nx * 0.015,
          this.point.y + this.axis.y * offset + ny * 0.015, this.point.z + this.axis.z * offset + nz * 0.015);
        this.normal.setXYZ(index, nx, ny, nz);
      }
    }
    this.position.needsUpdate = true; this.normal.needsUpdate = true;
  }
}
