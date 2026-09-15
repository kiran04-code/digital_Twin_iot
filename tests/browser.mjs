import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

await mkdir('test-results', { recursive: true });
const localChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const executablePath = process.env.CHROME_PATH || (existsSync(localChrome) ? localChrome : undefined);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.stack));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const check = name => console.log(`PASS ${name}`);
const setSlider = async (label, value) => {
  const slider = page.getByRole('slider', { name: label });
  await slider.fill(String(value));
};
try {
  await page.goto(process.env.TEST_URL || 'http://localhost:5174', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__ARC__?.sim.state.connection.received > 15);
  expect(await page.locator('.scene-error').count()).toBe(0);
  expect(await page.locator('canvas').count()).toBe(8);
  check('React dashboard, Three.js scenes and receiver telemetry initialize');

  await setSlider('Roll', 42); await setSlider('Pitch', 30);
  await expect.poll(() => page.evaluate(() => window.__ARC__.sim.state.joints.base * 180 / Math.PI), { timeout: 6000 }).toBeCloseTo(42, 0);
  await expect.poll(() => page.evaluate(() => window.__ARC__.sim.state.joints.shoulder * 180 / Math.PI), { timeout: 6000 }).toBeCloseTo(117.5, 0);
  check('gesture controls map to independent joint commands');

  await page.getByRole('button', { name: 'Manual servo' }).click();
  for (const [label, value] of [['Base', -25], ['Shoulder', 76], ['Elbow', 105], ['Wrist', 24]]) await setSlider(label, value);
  await expect.poll(() => page.evaluate(() => window.__ARC__.sim.state.joints.wrist * 180 / Math.PI), { timeout: 6000 }).toBeCloseTo(24, 0);
  check('all four manual servo sliders update receiver targets');

  await page.getByRole('switch', { name: 'Electromagnet', exact: true }).click();
  await page.waitForFunction(() => window.__ARC__.sim.state.magnet);
  await page.getByRole('button', { name: 'Emergency stop', exact: true }).click();
  const frozen = await page.evaluate(() => ({ ...window.__ARC__.sim.physicalJoints }));
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => window.__ARC__.sim.physicalJoints)).toEqual(frozen);
  expect(await page.evaluate(() => window.__ARC__.sim.state.magnet)).toBe(false);
  await expect(page.getByRole('slider', { name: 'Base', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Reset system', exact: true }).click();
  await page.getByRole('button', { name: 'Home position', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__ARC__.sim.state.joints.base * 180 / Math.PI), { timeout: 6000 }).toBeCloseTo(0, 0);
  check('emergency stop freezes movement, disables magnet and resets safely');

  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.waitForTimeout(700);
  await expect(page.locator('.scene-footer')).toContainText('STALE DATA');
  const before = await page.evaluate(() => ({ ...window.__ARC__.sim.state.joints }));
  await setSlider('Base', 40); await page.waitForTimeout(700);
  expect(await page.evaluate(() => window.__ARC__.sim.state.joints)).toEqual(before);
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await page.waitForFunction(() => !window.__ARC__.sim.state.connection.stale);
  check('wireless disconnect makes the monitoring layer stale; reconnect restores feedback');

  await page.getByRole('button', { name: 'View options', exact: true }).click();
  for (const label of ['Show joint axes', 'Show end-effector trail', 'Show workspace', 'Separate digital twin', 'Debug overlay']) await page.getByRole('checkbox', { name: label, exact: true }).check();
  await page.waitForFunction(() => window.__ARC__.scene.workspace.visible && window.__ARC__.scene.physicalArm.root.visible);
  await page.screenshot({ path: 'test-results/separate.png' });
  for (const label of ['Show joint axes', 'Show workspace', 'Separate digital twin', 'Debug overlay']) await page.getByRole('checkbox', { name: label, exact: true }).uncheck();
  await page.getByRole('button', { name: 'Close view options' }).click();
  for (const name of ['Front', 'Side', 'Top', 'Iso', 'Follow']) await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('button', { name: 'Reset camera' }).click();
  check('camera presets, joint axes, trajectory, workspace, debug and separate views work');

  await page.getByRole('button', { name: 'Start demo', exact: true }).click();
  await page.waitForFunction(() => window.__ARC__.sim.state.captured, { }, { timeout: 30000 });
  const initialY = await page.evaluate(() => window.__ARC__.scene.magnet.initial.y);
  await page.waitForFunction(y => {
    const a = window.__ARC__;
    return a.scene.magnet.cube.getWorldPosition(a.scene.arm.getEndEffectorWorldPosition()).y > y + 0.8;
  }, initialY, { timeout: 15000 });
  await page.screenshot({ path: 'test-results/pickup.png' });
  check('demo captures the cube by proximity and lifts it with the end-effector hierarchy');
  await page.waitForFunction(() => !window.__ARC__.sim.state.demoRunning, { }, { timeout: 35000 });
  const demoResult = await page.evaluate(() => {
    const { sim, scene } = window.__ARC__;
    return { captured: sim.state.captured, parent: scene.magnet.cube.parent.type, position: scene.magnet.cube.position.toArray(), initial: scene.magnet.initial.toArray(), notice: sim.state.notice };
  });
  expect(demoResult.captured).toBe(false); expect(demoResult.parent).toBe('Scene');
  expect(demoResult.position[2]).toBeLessThan(0); expect(demoResult.position[1]).toBeGreaterThanOrEqual(0.29);
  expect(demoResult.notice).toContain('complete');
  check('full pick-and-place demo releases the workpiece and returns home');

  await page.getByRole('button', { name: 'Diagnostics & packet inspector', exact: false }).click();
  await setSlider('Simulated packet loss', 10);
  await page.waitForTimeout(1400);
  expect(await page.evaluate(() => window.__ARC__.sim.wireless.packetLoss)).toBe(10);
  expect(await page.evaluate(() => window.__ARC__.sim.wireless.packets.length)).toBeLessThanOrEqual(15);
  await page.getByRole('button', { name: 'Reset target objects' }).click();
  await setSlider('Simulated packet loss', 0);
  await page.getByRole('button', { name: 'Diagnostics & packet inspector', exact: false }).click();
  await page.getByRole('button', { name: 'Pause live charts' }).click();
  await expect(page.locator('.chart-time').first()).toContainText('PAUSED');
  await page.getByRole('button', { name: 'Resume live charts' }).click();
  check('packet loss, object reset, bounded inspector and chart pause controls work');

  await page.getByRole('button', { name: 'System info', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Presentation mode', exact: true }).click();
  await expect(page.locator('.signals-panel')).toBeHidden();
  await page.getByRole('button', { name: 'Exit presentation', exact: true }).click();
  check('system information dialog and presentation mode work');

  await page.getByRole('button', { name: 'Auto gesture' }).click();
  await page.getByRole('button', { name: 'Home position', exact: true }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/desktop-final.png', fullPage: true });
  for (const width of [1024, 768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    if (width === 390) await page.screenshot({ path: 'test-results/mobile-final.png', fullPage: true });
  }
  check('desktop, tablet and mobile layouts have no horizontal overflow');
  expect(errors).toEqual([]);
  check('no browser console errors or uncaught exceptions');
} finally { await browser.close(); }
