import 'dotenv/config';
import { SerialPort } from 'serialport';
import { isEsp32Candidate } from './serial-service.mjs';
import { readConfig } from './config.mjs';
import { startBridge } from './bridge.mjs';

try {
  if (process.argv.includes('--list-ports')) {
    const ports = await SerialPort.list();
    console.table(ports.map(port => ({ path: port.path, manufacturer: port.manufacturer || '', vendorId: port.vendorId || '', productId: port.productId || '', possibleESP32: isEsp32Candidate(port) })));
    if (!ports.length) console.log('No serial ports found. Connect the ESP32 using a USB data cable.');
  } else {
    const config = readConfig();
    const bridge = startBridge(config);
    bridge.server.on('listening', () => console.log(`Telemetry bridge: ws://${config.host}:${bridge.server.address().port} (${config.mock ? 'SIMULATED' : 'USB serial'})`));
    bridge.server.on('error', error => { console.error(error.message); process.exitCode = 1; void bridge.close(); });
    process.once('SIGINT', () => void bridge.close());
    process.once('SIGTERM', () => void bridge.close());
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
