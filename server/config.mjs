import { DEFAULT_LIMITS, DEFAULT_MAPPING, JOINT_KEYS } from '../js/hardwareTelemetry.js';
import { JOINTS } from '../js/config.js';

export function readConfig(env = process.env) {
  // Prefer the ESP32 names while retaining existing .env compatibility.
  const valueFor = (name, legacy, fallback) => env[name] ?? env[legacy] ?? fallback;
  const integer = (name, fallback, min = 1, max = 2147483647) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}.`);
    return value;
  };
  const limits = { ...DEFAULT_LIMITS, ...JSON.parse(env.JOINT_LIMITS || '{}') };
  const mapping = { ...DEFAULT_MAPPING, ...JSON.parse(env.JOINT_MAPPING || '{}') };
  for (const key of JOINT_KEYS) {
    const range = limits[key]; const transform = mapping[key];
    if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite) || range[0] >= range[1]) throw new Error(`Invalid limits for ${key}.`);
    if (!transform || !Number.isFinite(transform.scale) || transform.scale === 0 || !Number.isFinite(transform.offset)) throw new Error(`Invalid mapping for ${key}.`);
    const modelRange = [JOINTS[key].min, JOINTS[key].max].map(value => (value - transform.offset) / transform.scale).sort((a, b) => a - b);
    if (Math.max(range[0], modelRange[0]) >= Math.min(range[1], modelRange[1])) throw new Error(`No renderable range for ${key}; check JOINT_MAPPING and JOINT_LIMITS.`);
  }
  const mockMode = valueFor('DIGITAL_TWIN_MOCK_MODE', 'MOCK_MODE', 'false');
  if (!['true', 'false'].includes(mockMode)) throw new Error('DIGITAL_TWIN_MOCK_MODE must be true or false.');
  const mock = mockMode === 'true';
  if (mock && env.NODE_ENV !== 'development') throw new Error('Mock mode requires NODE_ENV=development.');
  const esp32Integer = (name, legacy, fallback) => {
    const value = Number(valueFor(name, legacy, fallback));
    if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) throw new Error(`Invalid ${name}.`);
    return value;
  };
  return {
    port: integer('WS_PORT', 8080, 0, 65535), host: env.WS_HOST || '127.0.0.1',
    serialPath: valueFor('ESP32_SERIAL_PORT', 'SERIAL_PORT', '').trim(),
    baudRate: esp32Integer('ESP32_BAUD_RATE', 'SERIAL_BAUD_RATE', 115200),
    retryMs: esp32Integer('ESP32_RECONNECT_DELAY_MS', 'SERIAL_RECONNECT_MS', 2000),
    staleMs: esp32Integer('ESP32_DATA_TIMEOUT_MS', 'STALE_AFTER_MS', 1000),
    limits, mapping, mock,
  };
}
