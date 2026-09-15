import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoboticArm, mesh, forwardKinematics } from './roboticArm.js';
import { Electromagnet } from './electromagnet.js';
import { PICK_POSE, PLACE_POSE } from './demoController.js';
import { DIMENSIONS } from './config.js';
import { getRenderSettings } from './renderQuality.js';
import { createStudioEnvironment, addSoftbox } from './studioLighting.js';

function labelSprite(text, color = '#88969a', size = 0.35) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.font = '48px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = color; ctx.fillText(text, 512, 64);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(size * 8, size, 1);
  return sprite;
}

export class DigitalTwinScene {
  constructor(container, simulation) {
    this.container = container;
    this.simulation = simulation;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x171b1e);
    this.scene.fog = new THREE.Fog(0x171b1e, 18, 40);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D robotic arm. Drag to orbit, scroll to zoom, right-drag to pan.');
    this.renderer.domElement.setAttribute('role', 'img');
    container.appendChild(this.renderer.domElement);
    this.environment = createStudioEnvironment(this.renderer);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.85;
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 30;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.025;
    this.controls.target.set(1.2, 1.4, 0);
    this.setCamera('isometric', true);
    this.addLights();
    this.addFloor();
    this.arm = new RoboticArm();
    this.scene.add(this.arm.root);
    this.physicalArm = new RoboticArm();
    this.twinWireMaterial = new THREE.MeshBasicMaterial({ color: 0x79bddd, wireframe: true, transparent: true, opacity: 0.3 });
    this.arm.root.traverse(node => { if (node.isMesh) node.userData.solidMaterial = node.material; });
    this.physicalArm.root.visible = false;
    this.scene.add(this.physicalArm.root);
    this.magnet = new Electromagnet(this.scene, this.arm);
    this.addWorkspace();
    this.addTrail();
    this.separated = false;
    this.simulation.onCamera = preset => this.setCamera(preset);
    this.simulation.resetObjects = () => { this.magnet.reset(); this.simulation.state.captured = false; this.clearTrail(); };
    this.simulation.onEmergencyStop = () => this.magnet.setEnabled(false);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    this.clock = new THREE.Clock();
    this.simulation.startTransport();
    this.labelNodes = [...container.parentElement.querySelectorAll('[data-joint-label]')];
    this.frame = requestAnimationFrame(this.animate);
    this.onContextLost = event => { event.preventDefault(); this.simulation.emergencyStop(); this.simulation.warn('3D graphics context lost. Reload the page to reconnect the view.'); };
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
  }

  addLights() {
    this.scene.add(new THREE.AmbientLight(0xd0d9de, 0.15));
    this.scene.add(new THREE.HemisphereLight(0xd4e5f4, 0x20252f, 0.45));
    const key = new THREE.DirectionalLight(0xffeddf, 2.6);
    key.position.set(-3, 9, 5); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 0.5, far: 30 });
    key.shadow.normalBias = 0.012; key.shadow.bias = -0.0001; key.shadow.radius = 3;
    this.scene.add(key);
    this.keyLight = key;
    const fill = new THREE.DirectionalLight(0xa4c6e4, 0.7);
    fill.position.set(-5, 6, -5); this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xb2d4ec, 1.8);
    rim.position.set(4, 5, -7); this.scene.add(rim);
    addSoftbox(this.scene, 0xd4e8ff, 5, 4, 7, [5, 4, 3]);
    addSoftbox(this.scene, 0xffe2c4, 3, 3, 5, [-4, 3, -4]);
  }

  addFloor() {
    const floor = mesh(this.scene, new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: 0x090d10, metalness: 0.1, roughness: 0.96, envMapIntensity: 0.25 }), [0, -0.015, 0], [-Math.PI / 2, 0, 0]);
    floor.castShadow = false;
    this.grid = new THREE.Group();
    const lines = new THREE.GridHelper(40, 80, 0x44535b, 0x354148);
    lines.material.transparent = true;
    lines.material.opacity = 0.4;
    this.grid.add(lines);
    this.grid.position.y = 0.008;
    this.scene.add(this.grid);
    const circle = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 129 }, (_, i) => new THREE.Vector3(Math.cos(i / 128 * Math.PI * 2) * 5.65, 0.025, Math.sin(i / 128 * Math.PI * 2) * 5.65)));
    const reachLine = new THREE.Line(circle, new THREE.LineDashedMaterial({ color: 0x78604c, dashSize: 0.14, gapSize: 0.13, transparent: true, opacity: 0.48 }));
    reachLine.computeLineDistances(); this.grid.add(reachLine);
    for (const [name, position, color] of [['X', [6.5, 0.06, 0], '#b47865'], ['Z', [0, 0.06, 6.5], '#6e9bac'], ['Y', [0, 5.8, 0], '#86ac8f']]) {
      const label = labelSprite(name, color, 0.34); label.position.set(...position); this.grid.add(label);
    }
    for (let i = 2; i <= 6; i += 2) {
      const label = labelSprite(`${i * 100}`, '#66747a', 0.19);
      label.position.set(i, 0.04, -0.36); this.grid.add(label);
    }
    for (const [pose, color] of [[PICK_POSE, 0x8f775e], [PLACE_POSE, 0x5c7777]]) {
      const p = forwardKinematics(pose);
      const marker = mesh(this.scene, new THREE.RingGeometry(0.55, 0.565, 48), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.6 }), [p.x, 0.023, p.z], [-Math.PI / 2, 0, 0]);
      marker.castShadow = false;
      const text = labelSprite(pose === PICK_POSE ? 'PICK / 01' : 'PLACE / 02', '#819095', 0.19);
      text.position.set(p.x, 0.08, p.z + 0.75); this.scene.add(text);
    }
  }

  addWorkspace() {
    const reach = DIMENSIONS.upperArm + DIMENSIONS.forearm + DIMENSIONS.wrist + DIMENSIONS.magnet;
    this.workspace = new THREE.Mesh(new THREE.SphereGeometry(reach, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x73a8c5, transparent: true, opacity: 0.065, side: THREE.DoubleSide, depthWrite: false }));
    this.workspace.position.y = DIMENSIONS.shoulderHeight;
    this.workspace.visible = false;
    this.scene.add(this.workspace);
  }

  addTrail() {
    this.trailPoints = [];
    this.trailGeometry = new THREE.BufferGeometry();
    this.trailGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(240 * 3), 3));
    this.trailGeometry.setDrawRange(0, 0);
    this.trail = new THREE.Line(this.trailGeometry, new THREE.LineBasicMaterial({ color: 0xeeb284, transparent: true, opacity: 0.7 }));
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    this.scene.add(this.trail);
  }
  clearTrail() { this.trailPoints = []; this.trailGeometry.setDrawRange(0, 0); }
  updateTrail(position) {
    if (!this.trail.visible || this.trailPoints.at(-1)?.distanceToSquared(position) < 0.0025) return;
    this.trailPoints.push(position.clone());
    if (this.trailPoints.length > 240) this.trailPoints.shift();
    const attribute = this.trailGeometry.attributes.position;
    this.trailPoints.forEach((point, i) => attribute.setXYZ(i, point.x, point.y, point.z));
    attribute.needsUpdate = true;
    this.trailGeometry.setDrawRange(0, this.trailPoints.length);
  }
  setCamera(preset, immediate = false) {
    this.follow = preset === 'follow';
    const wide = this.simulation.state.options.separate;
    const target = new THREE.Vector3(wide ? -0.4 : 1.2, 1.7, 0);
    const presets = { front: [1.2, 3.2, 12.5], side: [13, 3.5, 0], top: [1.2, 14.5, 0.01], isometric: [7.2, 5.1, 8.5], reset: [7.2, 5.1, 8.5] };
    const position = new THREE.Vector3(...(presets[preset] || presets.isometric));
    if (wide) position.multiplyScalar(1.65);
    if (immediate) { this.camera.position.copy(position); this.controls.target.copy(target); this.controls.update(); }
    else this.cameraTransition = { position, target };
  }
  resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;
    this.camera.fov = width < 600 ? 40 : 34;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const settings = getRenderSettings(this.simulation.state.options.quality, width, height, this.renderer.capabilities.maxTextureSize);
    this.renderer.setPixelRatio(settings.pixelRatio);
    this.renderer.setSize(width, height);
    if (this.keyLight.shadow.mapSize.x !== settings.shadowSize) {
      this.keyLight.shadow.map?.dispose();
      this.keyLight.shadow.map = null;
      this.keyLight.shadow.mapSize.set(settings.shadowSize, settings.shadowSize);
    }
    this.currentQuality = this.simulation.state.options.quality;
  }
  updateLabels() {
    for (const node of this.labelNodes) {
      const key = node.dataset.jointLabel;
      const joint = key === 'tool' ? this.arm.endEffector : this.arm.joints[key];
      const point = joint.getWorldPosition(new THREE.Vector3());
      point.z += 0.45;
      point.project(this.camera);
      const x = (point.x * 0.5 + 0.5) * this.container.clientWidth;
      const y = (-point.y * 0.5 + 0.5) * this.container.clientHeight;
      node.style.transform = `translate(${x}px, ${y}px)`;
      node.style.visibility = this.separated || point.z > 1 || x < 40 || x > this.container.clientWidth - 80 || y < 35 || y > this.container.clientHeight - 70 ? 'hidden' : 'visible';
    }
  }
  animate = () => {
    this.frame = requestAnimationFrame(this.animate);
    const delta = this.clock.getDelta();
    this.simulation.update(delta);
    const state = this.simulation.state;
    if (this.currentQuality !== state.options.quality) this.resize();
    this.arm.setJointState(state.source === 'local' ? state.joints : this.simulation.displayJoints);
    this.physicalArm.setJointState(this.simulation.physicalJoints);
    this.arm.setAxes(state.options.axes);
    this.workspace.visible = state.options.workspace;
    this.grid.visible = state.options.grid;
    this.trail.visible = state.options.trail;
    if (this.separated !== state.options.separate) {
      this.separated = state.options.separate;
      this.physicalArm.root.visible = this.separated;
      this.physicalArm.root.position.set(-5.5, 0, -0.5);
      this.arm.root.traverse(node => { if (node.isMesh && node.userData.solidMaterial) node.material = this.separated ? this.twinWireMaterial : node.userData.solidMaterial; });
      this.setCamera('isometric');
    }
    this.magnet.setEnabled(state.magnet && !(state.stopped && state.source === 'local'));
    if (!state.stopped) this.magnet.update();
    state.captured = !!this.magnet.attached;
    const position = this.arm.getEndEffectorWorldPosition();
    state.toolPosition = { x: position.x, y: position.y, z: position.z };
    this.updateTrail(position);
    if (this.cameraTransition) {
      const factor = 1 - Math.exp(-delta * 6);
      this.camera.position.lerp(this.cameraTransition.position, factor);
      this.controls.target.lerp(this.cameraTransition.target, factor);
      if (this.camera.position.distanceTo(this.cameraTransition.position) < 0.02) this.cameraTransition = null;
    }
    if (this.follow) this.controls.target.lerp(position, 1 - Math.exp(-delta * 3));
    this.controls.update();
    this.updateLabels();
    this.renderer.render(this.scene, this.camera);
    state.drawCalls = this.renderer.info.render.calls;
  };
  dispose() {
    this.simulation.stopTransport();
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.controls.dispose();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.scene.traverse(node => {
      node.geometry?.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach(material => { material?.map?.dispose(); material?.dispose(); });
    });
    this.environment.dispose();
    this.twinWireMaterial.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
