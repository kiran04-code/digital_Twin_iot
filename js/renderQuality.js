import { RENDER_QUALITY } from './config.js';

// Supersample ordinary desktop displays; cap large canvases to a safe GPU budget.
export function getRenderSettings(quality, width, height, maxTextureSize = 8192) {
  const profile = RENDER_QUALITY[quality] || RENDER_QUALITY.high;
  const nativeRatio = globalThis.devicePixelRatio || 1;
  const desired = Math.min(profile.maxRatio, Math.max(profile.minRatio, nativeRatio));
  const pixelBudgetRatio = Math.sqrt(6_000_000 / Math.max(1, width * height));
  const textureLimitRatio = maxTextureSize / Math.max(1, width, height);
  return {
    pixelRatio: Math.min(desired, pixelBudgetRatio, textureLimitRatio),
    shadowSize: Math.min(profile.shadowSize, maxTextureSize),
  };
}
