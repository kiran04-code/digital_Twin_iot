import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

export function createStudioEnvironment(renderer) {
  const studio = new THREE.Scene();
  studio.background = new THREE.Color(0x17212f);
  const panels = [
    [[-4, 5, 3], [4, 7], 0xe2edff, 6],
    [[5, 2, 1], [2, 6], 0xb8d6ff, 4],
    [[0, 7, -2], [5, 3], 0xffffff, 5],
    [[1, 1, -6], [4, 2], 0xffd8b4, 3],
  ];
  for (const [position, size, color, intensity] of panels) {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(...size), material);
    panel.position.set(...position); panel.lookAt(0, 0, 0); studio.add(panel);
  }
  const generator = new THREE.PMREMGenerator(renderer);
  const environment = generator.fromScene(studio, 0.015, 0.1, 30);
  studio.traverse(node => { node.geometry?.dispose(); node.material?.dispose(); });
  generator.dispose();
  return environment;
}

export function addSoftbox(scene, color, intensity, width, height, position, target = [0, 2, 0]) {
  RectAreaLightUniformsLib.init();
  const light = new THREE.RectAreaLight(color, intensity, width, height);
  light.position.set(...position); light.lookAt(...target); scene.add(light);
  return light;
}
