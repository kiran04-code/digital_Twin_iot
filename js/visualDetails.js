import * as THREE from 'three';

// Rounded rims catch highlights without changing a joint's pivot or dimensions.
export function beveledCylinderGeometry(radius, height, bevel = Math.min(height * 0.18, radius * 0.09)) {
  const points = [new THREE.Vector2(0, -height / 2), new THREE.Vector2(radius - bevel, -height / 2)];
  for (let i = 1; i <= 5; i++) {
    const a = -Math.PI / 2 + i / 5 * Math.PI / 2;
    points.push(new THREE.Vector2(radius - bevel + Math.cos(a) * bevel, -height / 2 + bevel + Math.sin(a) * bevel));
  }
  points.push(new THREE.Vector2(radius, height / 2 - bevel));
  for (let i = 1; i <= 5; i++) {
    const a = i / 5 * Math.PI / 2;
    points.push(new THREE.Vector2(radius - bevel + Math.cos(a) * bevel, height / 2 - bevel + Math.sin(a) * bevel));
  }
  points.push(new THREE.Vector2(0, height / 2));
  return new THREE.LatheGeometry(points, radius > 0.2 ? 96 : 32);
}

export function surfaceLabel(text, width, height, color = '#b9cedb') {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.font = '500 100px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = color; ctx.fillText(text, 512, 128, 960);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
  return label;
}
