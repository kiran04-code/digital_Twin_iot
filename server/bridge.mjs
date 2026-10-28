import { WebSocketServer, WebSocket } from 'ws';
import { SerialService } from './serial-service.mjs';
import { JOINT_KEYS, toModelAngles } from '../js/hardwareTelemetry.js';
import { JOINTS } from '../js/config.js';

export function startBridge(config, { serial = new SerialService(config), logger = console } = {}) {
  const server = new WebSocketServer({ port: config.port, host: config.host, maxPayload: 16384 });
  const source = config.mock ? 'mock' : 'esp32';
  let latest = null; let seq = 0;
  let status = { type: 'connection_status', timestamp: Date.now(), source, status: 'disconnected', detail: 'Searching for ESP32 USB serial.' };
  const connectionState = () => {
    const lastJointUpdateAt = Math.max(latest?.timestamp || 0, status.lastJointUpdateAt || 0) || null;
    const stale = status.status !== 'connected' || lastJointUpdateAt === null || Date.now() - lastJointUpdateAt > config.staleMs;
    return {
      stale, dataTimeoutMs: config.staleMs, lastJointUpdateAt,
      usbConnected: config.mock ? null : Boolean(status.usbConnected),
    };
  };
  const send = (client, message) => {
    if (client.readyState !== WebSocket.OPEN) return;
    // Disconnect slow clients rather than queueing stale poses indefinitely.
    if (client.bufferedAmount > 65536) { client.terminate(); return; }
    client.send(JSON.stringify(message), error => { if (error) client.terminate(); });
  };
  const broadcast = message => { for (const client of server.clients) send(client, message); };
  const onStatus = update => {
    status = { type: 'connection_status', timestamp: Date.now(), source, ...update };
    broadcast({ ...status, ...connectionState() });
    logger.info(`Telemetry ${source}: ${update.status}${update.detail ? ` (${update.detail})` : ''}`);
  };
  const onAngles = data => {
    latest = {
      type: 'joint_update', ...data, seq: seq++, source, connectionStatus: 'connected',
      stale: false, usbConnected: config.mock ? null : Boolean(status.usbConnected),
      lastJointUpdateAt: data.timestamp, dataTimeoutMs: config.staleMs,
    };
    broadcast(latest);
  };
  server.on('connection', client => {
    client.on('error', () => client.terminate());
    client.alive = true; client.on('pong', () => { client.alive = true; });
    const state = connectionState();
    const connectionStatus = status.status === 'connected' && state.stale ? 'waiting' : status.status;
    send(client, { ...status, ...state, status: connectionStatus });
    if (latest) send(client, { ...latest, ...state, snapshot: true, connectionStatus });
  });
  const heartbeat = setInterval(() => {
    for (const client of server.clients) {
      if (!client.alive) client.terminate();
      else { client.alive = false; client.ping(); }
    }
  }, 15000);
  let mockTimer;
  if (config.mock) {
    onStatus({ status: 'connected', detail: 'SIMULATED development data; no hardware is connected.' });
    const startedAt = Date.now();
    const tick = () => {
      const t = (Date.now() - startedAt) / 1000;
      const angles = Object.fromEntries(JOINT_KEYS.map((key, i) => {
        // Stay within both configured servo limits and model representation.
        const { scale, offset } = config.mapping[key];
        const modelLimits = [JOINTS[key].min, JOINTS[key].max];
        const mapped = modelLimits.map(value => (value - offset) / scale).sort((a, b) => a - b);
        const lo = Math.max(config.limits[key][0], mapped[0]); const hi = Math.min(config.limits[key][1], mapped[1]);
        if (lo > hi) throw new Error(`No renderable mock range for ${key}.`);
        return [key, (lo + hi) / 2 + (hi - lo) * 0.3 * Math.sin(t * (0.5 + i * 0.13))];
      }));
      onAngles({ angles, modelAngles: toModelAngles(angles, config.mapping), timestamp: Date.now() });
    };
    tick(); mockTimer = setInterval(tick, 20);
  } else {
    serial.on('status', onStatus); serial.on('angles', onAngles);
    // Boot logs and malformed messages never enter the pose stream. Rate-limit logs.
    let lastWarning = -Infinity;
    serial.on('invalid', message => { if (Date.now() - lastWarning > 2000) { logger.warn(`Ignored serial data: ${message}`); lastWarning = Date.now(); } });
    serial.start();
  }
  let closing;
  const close = () => closing ||= new Promise(resolve => {
    clearInterval(heartbeat); clearInterval(mockTimer); serial.stop();
    for (const client of server.clients) client.terminate();
    server.close(resolve);
  });
  return { server, serial, close };
}
