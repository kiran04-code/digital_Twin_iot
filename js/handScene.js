import * as THREE from 'three';
import { box, mesh } from './roboticArm.js';
import { rad } from './config.js';
import { getRenderSettings } from './renderQuality.js';
import { createStudioEnvironment, addSoftbox } from './studioLighting.js';
import { surfaceLabel, beveledCylinderGeometry } from './visualDetails.js';

function fabricNormalMap() {
  const size = 128, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    data[i] = 128 + Math.round(Math.sin(x * Math.PI / 2) * 35);
    data[i + 1] = 128 + Math.round(Math.sin(y * Math.PI / 2) * 35);
    data[i + 2] = 250; data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4); texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 8; texture.needsUpdate = true;
  return texture;
}

export class HandScene {
  constructor(container, simulation) {
    this.container = container; this.simulation = simulation;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 30);
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.setAttribute('aria-label', 'Detailed 3D gesture glove with an MPU6050 sensor. Drag to inspect, scroll to zoom.');
    container.appendChild(this.renderer.domElement);
    this.environment = createStudioEnvironment(this.renderer);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.8;
    this.scene.add(new THREE.HemisphereLight(0xddeaff, 0x28303b, 0.75));
    this.light = new THREE.DirectionalLight(0xffecdf, 2.5);
    this.light.position.set(-3, 6, 4); this.light.castShadow = true;
    this.light.shadow.mapSize.set(1024, 1024);
    Object.assign(this.light.shadow.camera, { left: -2.7, right: 2.7, top: 2.7, bottom: -2.7, near: 0.5, far: 15 });
    this.light.shadow.normalBias = 0.015; this.light.shadow.bias = -0.0002;
    this.scene.add(this.light);
    addSoftbox(this.scene, 0xc4e0ff, 5, 3, 4, [3, 3, -3], [0, 0, 0]);
    this.hand = new THREE.Group(); this.hand.name = 'gestureGlove';
    this.scene.add(this.hand);
    this.createGlove();
    const bounds = new THREE.Box3().setFromObject(this.hand);
    this.modelCenter = bounds.getCenter(new THREE.Vector3());
    this.boundsCorners = [];
    // Fit the individual parts, avoiding the empty corners around a spread hand.
    this.hand.traverse(node => {
      if (!node.isMesh) return;
      node.geometry.computeBoundingBox();
      const part = node.geometry.boundingBox;
      for (let i = 0; i < 8; i++) this.boundsCorners.push(new THREE.Vector3(
        i & 1 ? part.max.x : part.min.x,
        i & 2 ? part.max.y : part.min.y,
        i & 4 ? part.max.z : part.min.z,
      ).applyMatrix4(node.matrixWorld));
    });
    this.viewDirection = new THREE.Vector3();
    this.viewTarget = new THREE.Vector3();
    this.viewCorner = new THREE.Vector3();
    this.viewInverse = new THREE.Quaternion();
    const floor = mesh(this.scene, new THREE.PlaneGeometry(12, 12), new THREE.ShadowMaterial({ color: 0x05090e, opacity: 0.24 }), [0, -1.65, 0], [-Math.PI / 2, 0, 0]);
    floor.castShadow = false;
    const ring = mesh(this.scene, new THREE.TorusGeometry(1.6, 0.009, 8, 128), new THREE.MeshBasicMaterial({ color: 0x5a788b, transparent: true, opacity: 0.35 }), [0, -1.62, 0], [Math.PI / 2, 0, 0]);
    ring.castShadow = false;
    this.orbit = { yaw: 0.3, elevation: 0.94, distance: 4.6 };
    this.bindInspection();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.frame = requestAnimationFrame(this.animate);
  }

  createGlove() {
    const glove = new THREE.MeshStandardMaterial({ color: 0xa8b5c0, metalness: 0.06, roughness: 0.7, normalMap: fabricNormalMap(), normalScale: new THREE.Vector2(0.13, 0.13) });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x202a36, roughness: 0.72 });
    const armor = new THREE.MeshPhysicalMaterial({ color: 0xd5dee5, metalness: 0.38, roughness: 0.28, clearcoat: 0.3 });
    const copper = new THREE.MeshStandardMaterial({ color: 0xe48c4d, metalness: 0.55, roughness: 0.3 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xbacbd6, metalness: 0.95, roughness: 0.22 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd9b76a, metalness: 0.82, roughness: 0.3 });
    box(this.hand, [1.06, 0.31, 1.15], glove, [0, 0, 0], 0.15);
    box(this.hand, [0.88, 0.14, 0.91], rubber, [0, -0.17, 0.08], 0.12);
    box(this.hand, [0.68, 0.3, 0.59], rubber, [0, -0.015, 0.79], 0.12);
    box(this.hand, [0.81, 0.38, 0.22], copper, [0, 0, 0.62], 0.07);
    box(this.hand, [0.57, 0.04, 0.18], rubber, [0, 0.2, 0.62], 0.04);
    box(this.hand, [0.19, 0.035, 0.22], steel, [0.23, 0.22, 0.62], 0.025);

    const lengths = [0.8, 1.01, 0.94, 0.73];
    const widths = [0.112, 0.116, 0.109, 0.092];
    for (let i = 0; i < 4; i++) {
      const finger = new THREE.Group();
      finger.position.set(-0.365 + i * 0.245, 0, -0.46);
      finger.rotation.y = (i - 1.5) * -0.035;
      this.hand.add(finger);
      let z = 0;
      for (let j = 0; j < 3; j++) {
        const length = lengths[i] * [0.41, 0.33, 0.26][j];
        const radius = widths[i] * (1 - j * 0.09);
        const part = mesh(finger, new THREE.CapsuleGeometry(radius, Math.max(0.015, length - radius * 2), 8, 24), glove, [0, -j * 0.013, z - length / 2], [Math.PI / 2, 0, 0]);
        part.scale.y = length / (Math.max(0.015, length - radius * 2) + radius * 2);
        box(finger, [radius * 1.6, 0.055, length * 0.55], j === 2 ? rubber : armor, [0, radius * 0.83 - j * 0.013, z - length * 0.48], 0.026);
        if (j < 2) mesh(finger, new THREE.TorusGeometry(radius * 0.8, 0.018, 8, 24), rubber, [0, -j * 0.013, z - length + 0.025]);
        z -= length - 0.024;
      }
      box(this.hand, [widths[i] * 1.8, 0.07, 0.21], armor, [finger.position.x, 0.16, -0.42], 0.034);
    }
    const thumb = new THREE.Group();
    thumb.position.set(-0.46, -0.015, 0.22); thumb.rotation.y = 0.72;
    this.hand.add(thumb);
    mesh(thumb, new THREE.CapsuleGeometry(0.145, 0.24, 10, 28), glove, [-0.13, 0, -0.13], [Math.PI / 2, 0, -0.12]);
    mesh(thumb, new THREE.CapsuleGeometry(0.12, 0.15, 10, 28), glove, [-0.16, -0.025, -0.43], [Math.PI / 2, 0, 0]);
    box(thumb, [0.18, 0.06, 0.19], armor, [-0.13, 0.14, -0.14], 0.03);

    // Raised PCB, mounting posts, traces, IMU chip, pins and power indicator.
    box(this.hand, [0.62, 0.07, 0.65], rubber, [0, 0.18, 0.05], 0.06);
    const pcb = box(this.hand, [0.54, 0.035, 0.57], new THREE.MeshPhysicalMaterial({ color: 0x137765, metalness: 0.35, roughness: 0.3, clearcoat: 0.55 }), [0, 0.235, 0.05], 0.018);
    pcb.name = 'MPU6050-board';
    box(this.hand, [0.21, 0.055, 0.21], rubber, [0, 0.273, 0.02], 0.013);
    for (const x of [-0.21, 0.21]) for (const z of [-0.18, 0.28]) mesh(this.hand, beveledCylinderGeometry(0.025, 0.024), steel, [x, 0.262, z]);
    for (let i = 0; i < 6; i++) {
      box(this.hand, [0.033, 0.023, 0.055], gold, [-0.18 + i * 0.071, 0.268, 0.22], 0.006);
      box(this.hand, [0.012, 0.004, 0.08], gold, [-0.18 + i * 0.071, 0.256, 0.14], 0.002);
    }
    for (const x of [-0.142, 0.142]) for (const z of [-0.04, 0.02, 0.08]) box(this.hand, [0.047, 0.01, 0.015], steel, [x, 0.26, z], 0.003);
    const label = surfaceLabel('MPU6050', 0.3, 0.075, '#e2f0e8');
    if (label) { label.rotation.x = -Math.PI / 2; label.position.set(0, 0.257, -0.17); this.hand.add(label); }
    const power = new THREE.MeshStandardMaterial({ color: 0x91ffd1, emissive: 0x25c787, emissiveIntensity: 1.2, roughness: 0.25 });
    mesh(this.hand, new THREE.SphereGeometry(0.022, 16, 12), power, [0.176, 0.269, -0.133]);
    const cable = new THREE.CatmullRomCurve3([new THREE.Vector3(0.19, 0.25, 0.28), new THREE.Vector3(0.35, 0.22, 0.4), new THREE.Vector3(0.31, 0.19, 0.66), new THREE.Vector3(0.22, 0.13, 0.87)]);
    mesh(this.hand, new THREE.TubeGeometry(cable, 32, 0.022, 12, false), rubber);
  }

  bindInspection() {
    const canvas = this.renderer.domElement;
    canvas.style.touchAction = 'none';
    this.pointerDown = event => { this.drag = { x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId); };
    this.pointerMove = event => {
      if (!this.drag) return;
      this.orbit.yaw -= (event.clientX - this.drag.x) * 0.008;
      this.orbit.elevation = THREE.MathUtils.clamp(this.orbit.elevation + (event.clientY - this.drag.y) * 0.006, 0.25, 1.45);
      this.drag = { x: event.clientX, y: event.clientY };
    };
    this.pointerUp = () => { this.drag = null; };
    this.wheel = event => { event.preventDefault(); this.orbit.distance = THREE.MathUtils.clamp(this.orbit.distance + event.deltaY * 0.003, 3, 6); };
    this.resetView = () => { this.orbit = { yaw: 0.3, elevation: 0.94, distance: 4.6 }; };
    canvas.addEventListener('pointerdown', this.pointerDown);
    canvas.addEventListener('pointermove', this.pointerMove);
    canvas.addEventListener('pointerup', this.pointerUp);
    canvas.addEventListener('pointercancel', this.pointerUp);
    canvas.addEventListener('wheel', this.wheel, { passive: false });
    canvas.addEventListener('dblclick', this.resetView);
  }

  resize() {
    const width = this.container.clientWidth, height = this.container.clientHeight;
    if (!width || !height) return;
    const settings = getRenderSettings(this.simulation.state.options.quality, width, height, this.renderer.capabilities.maxTextureSize);
    this.renderer.setPixelRatio(settings.pixelRatio);
    this.renderer.setSize(width, height);
    if (this.light.shadow.mapSize.x !== settings.shadowSize) {
      this.light.shadow.map?.dispose();
      this.light.shadow.map = null;
      this.light.shadow.mapSize.set(settings.shadowSize, settings.shadowSize);
    }
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.currentQuality = this.simulation.state.options.quality;
  }
  animate = () => {
    this.frame = requestAnimationFrame(this.animate);
    if (this.currentQuality !== this.simulation.state.options.quality) this.resize();
    this.hand.rotation.x = rad(this.simulation.state.gesture.pitch);
    this.hand.rotation.z = -rad(this.simulation.state.gesture.roll);
    this.hand.updateMatrixWorld(true);
    const { yaw, elevation, distance } = this.orbit;
    this.viewDirection.set(Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation), Math.cos(yaw) * Math.cos(elevation));
    this.viewTarget.copy(this.modelCenter).applyMatrix4(this.hand.matrixWorld);
    this.camera.position.copy(this.viewTarget).add(this.viewDirection);
    this.camera.lookAt(this.viewTarget);
    this.viewInverse.copy(this.camera.quaternion).invert();
    const padding = THREE.MathUtils.clamp(1 - 68 / this.container.clientHeight, 0.58, 0.84);
    const tangent = Math.tan(rad(this.camera.fov / 2)) * padding;
    let fitDistance = 0;
    // Fit the model after applying live orientation, leaving room for captions.
    for (const corner of this.boundsCorners) {
      this.viewCorner.copy(corner).applyMatrix4(this.hand.matrixWorld).sub(this.viewTarget).applyQuaternion(this.viewInverse);
      fitDistance = Math.max(fitDistance, this.viewCorner.z + Math.max(Math.abs(this.viewCorner.y) / tangent, Math.abs(this.viewCorner.x) / (tangent * this.camera.aspect)));
    }
    this.camera.position.copy(this.viewTarget).addScaledVector(this.viewDirection, fitDistance * distance / 4.6);
    this.renderer.render(this.scene, this.camera);
  };
  dispose() {
    cancelAnimationFrame(this.frame); this.observer.disconnect();
    const canvas = this.renderer.domElement;
    for (const [name, handler] of [['pointerdown', this.pointerDown], ['pointermove', this.pointerMove], ['pointerup', this.pointerUp], ['pointercancel', this.pointerUp], ['wheel', this.wheel], ['dblclick', this.resetView]]) canvas.removeEventListener(name, handler);
    const materials = new Set(), textures = new Set();
    this.scene.traverse(node => { node.geometry?.dispose(); if (node.material) materials.add(node.material); });
    materials.forEach(material => { for (const value of Object.values(material)) if (value?.isTexture) textures.add(value); material.dispose(); });
    textures.forEach(texture => texture.dispose());
    this.environment.dispose();
    this.renderer.dispose(); canvas.remove();
  }
}
