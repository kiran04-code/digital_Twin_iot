import { chromium, expect } from '@playwright/test';
import { WebSocketServer, WebSocket } from 'ws';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { startDummySocketServer } from '../scripts/dummy-socket-server.mjs';

await mkdir('test-results', { recursive: true });
const fixture = new WebSocketServer({ port: 0, host: '127.0.0.1' });
const dummy = startDummySocketServer({ port: 0 });
await Promise.all([once(fixture, 'listening'), once(dummy, 'listening')]);
const fixtureUrl = `ws://127.0.0.1:${fixture.address().port}`;
const dummyUrl = `ws://127.0.0.1:${dummy.address().port}`;
let sentByBrowser = 0;
fixture.on('connection', socket => socket.on('message', () => sentByBrowser++));
const broadcast = value => {
  for (const socket of fixture.clients) if (socket.readyState === WebSocket.OPEN) socket.send(typeof value === 'string' ? value : JSON.stringify(value));
};
const telemetry = (seq, base, overrides = {}) => ({ type: 'telemetry', seq, joints: { base, shoulder: 104, elbow: 82, wrist: -23 }, electromagnet: false, ...overrides });
const localChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || (existsSync(localChrome) ? localChrome : undefined), headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
const errors = [];
page.on('pageerror', error => errors.push(error.stack));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const check = message => console.log(`PASS ${message}`);
try {
  await page.goto(process.env.TEST_URL || 'http://localhost:5174', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__ARC__?.sim.state.connection.received > 3);
  await page.getByRole('radio', { name: 'Dummy stream', exact: true }).click();
  await page.waitForFunction(() => window.__ARC__.sim.state.joints.base > 0.12);
  expect(await page.evaluate(() => window.__ARC__.sim.transportTimer)).toBeNull();
  await expect(page.getByRole('button', { name: 'Start demo', exact: true })).toBeDisabled();
  await expect(page.getByRole('slider', { name: 'Base', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.__ARC__.sim.socketTelemetry.received)).toBeGreaterThan(3);
  await page.screenshot({ path: 'test-results/dummy-stream.png', fullPage: true });
  await page.getByRole('button', { name: 'Stop dummy stream', exact: true }).click();
  const stoppedDummy = await page.evaluate(() => ({ ...window.__ARC__.sim.displayJoints }));
  await page.waitForTimeout(650);
  expect(await page.evaluate(() => window.__ARC__.sim.displayJoints)).toEqual(stoppedDummy);
  await expect(page.locator('.scene-footer')).toContainText('STALE DATA');
  await page.getByRole('button', { name: 'Start dummy stream', exact: true }).click();
  await page.waitForFunction(() => window.__ARC__.sim.socketTelemetry.received > 3);
  check('browser dummy source drives four joints through shared telemetry parser and stops cleanly');

  await page.getByRole('radio', { name: 'WebSocket', exact: true }).click();
  await page.getByRole('textbox', { name: 'WebSocket URL' }).fill('http://localhost:8765');
  await page.getByRole('button', { name: 'Connect socket', exact: true }).click();
  await expect(page.locator('.socket-error')).toContainText('ws://');
  await page.getByRole('textbox', { name: 'WebSocket URL' }).fill(fixtureUrl);
  await page.getByRole('button', { name: 'Connect socket', exact: true }).click();
  await page.waitForFunction(() => window.__ARC__.sim.socketTelemetry.phase === 'OPEN');
  broadcast(telemetry(1, 24));
  await expect(page.getByTestId('angle-base')).toContainText('24.0');
  await expect.poll(() => page.evaluate(() => window.__ARC__.scene.arm.joints.base.rotation.y * 180 / Math.PI)).toBeCloseTo(24, 0);
  await expect(page.getByText('No pitch / roll in stream', { exact: true })).toBeVisible();
  await expect(page.locator('.topbar-right')).toContainText('Receiving telemetry');
  check('real Node.js WebSocket frames update displayed angles and actual Three.js joint transforms');

  broadcast('{broken');
  await expect(page.locator('.socket-error')).toContainText('Invalid JSON');
  broadcast(telemetry(2, 'bad'));
  await expect(page.locator('.socket-error')).toContainText('finite');
  broadcast(telemetry(0, -60));
  await expect(page.locator('.socket-error')).toContainText('sequence');
  broadcast(telemetry(2, -60, { timestamp: Date.now() - 10000 }));
  await expect(page.locator('.socket-error')).toContainText('too old');
  await page.waitForFunction(() => window.__ARC__.sim.state.connection.stale);
  await expect(page.getByTestId('angle-base')).toContainText('24.0');
  expect(await page.evaluate(() => window.__ARC__.sim.state.connection.rejected)).toBe(4);
  check('corrupt, partial, stale and out-of-order traffic is rejected without refreshing heartbeat');

  broadcast(telemetry(2, 500, { pitch: 20, roll: 30, electromagnet: true }));
  await expect(page.getByTestId('angle-base')).toContainText('90.0');
  await expect(page.locator('.warning-banner')).toContainText('clamped');
  await page.waitForFunction(() => window.__ARC__.sim.state.magnet);
  await expect(page.getByRole('switch', { name: 'Electromagnet', exact: true })).toBeDisabled();
  await expect(page.getByRole('switch', { name: 'Electromagnet', exact: true })).toBeChecked();
  for (let seq = 3; seq < 22; seq++) broadcast(telemetry(seq, 25));
  await page.waitForFunction(() => window.__ARC__.sim.socketTelemetry.lastSequence === 21);
  expect(await page.evaluate(() => window.__ARC__.sim.socketTelemetry.packets.length)).toBe(15);
  await page.evaluate(() => {
    const { sim } = window.__ARC__;
    sim.setManual('base', -80); sim.setGesture('roll', -80); sim.home(); sim.startDemo();
  });
  await expect(page.getByTestId('angle-base')).toContainText('25.0');
  check('angle limits, incoming magnet state, bounded history and source isolation work');

  await page.getByRole('button', { name: 'Pause monitoring', exact: true }).click();
  const frozen = await page.evaluate(() => ({ ...window.__ARC__.sim.displayJoints }));
  broadcast(telemetry(22, -80));
  await page.waitForTimeout(650);
  expect(await page.evaluate(() => window.__ARC__.sim.displayJoints)).toEqual(frozen);
  await expect(page.locator('.stop-overlay')).toContainText('No hardware command was sent');
  await page.getByRole('button', { name: 'Resume monitoring', exact: true }).click();
  await page.waitForFunction(() => window.__ARC__.sim.socketTelemetry.phase === 'OPEN');
  broadcast({ seq: 0, units: 'radians', joints: { base: -0.5, shoulder: 1.7, elbow: 1.6, wrist: 0.4 }, magnet: false });
  await expect(page.getByTestId('angle-base')).toContainText('-28.6');
  expect(sentByBrowser).toBe(0);
  check('monitoring pause/resume reconnects safely, accepts radians and sends no hardware commands');

  await page.getByRole('button', { name: 'Disconnect socket', exact: true }).click();
  await page.getByRole('textbox', { name: 'WebSocket URL' }).fill(dummyUrl);
  await page.getByRole('button', { name: 'Connect socket', exact: true }).click();
  await page.waitForFunction(() => window.__ARC__.sim.socketTelemetry.received > 40);
  await page.screenshot({ path: 'test-results/socket-stream.png', fullPage: true });
  check('bundled Node.js dummy server streams the same schema over an actual WebSocket');

  for (const width of [1024, 768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
  await page.screenshot({ path: 'test-results/socket-mobile.png', fullPage: true });
  await page.getByRole('radio', { name: 'Local control', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Base', exact: true })).toBeEnabled();
  await page.getByRole('slider', { name: 'Base', exact: true }).fill('-35');
  await expect.poll(() => page.evaluate(() => window.__ARC__.sim.state.joints.base * 180 / Math.PI), { timeout: 6000 }).toBeCloseTo(-35, 0);
  expect(await page.evaluate(() => window.__ARC__.sim.socketTelemetry.socket)).toBeNull();
  check('returning to local control closes streams and restores sliders; responsive layouts fit');
  expect(errors).toEqual([]);
  check('socket flow has no console errors or uncaught exceptions');
} finally {
  await browser.close();
  for (const server of [fixture, dummy]) {
    for (const client of server.clients) client.terminate();
    await new Promise(resolve => server.close(resolve));
  }
}
