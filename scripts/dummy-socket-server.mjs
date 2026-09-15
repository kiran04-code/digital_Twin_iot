import { WebSocketServer, WebSocket } from 'ws';
import { pathToFileURL } from 'node:url';
import { createDummyTelemetry } from '../js/dummyTelemetry.js';
import { PACKET_RATE } from '../js/config.js';

/** A real WebSocket server emitting exactly the same schema as the browser dummy. */
export function startDummySocketServer({ port = 8765, host = '127.0.0.1' } = {}) {
  const server = new WebSocketServer({ port, host, maxPayload: 16384 });
  server.on('connection', socket => {
    const startedAt = performance.now();
    let seq = 0;
    const tick = () => {
      if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 65536) return;
      socket.send(JSON.stringify(createDummyTelemetry((performance.now() - startedAt) / 1000, seq++)));
    };
    tick();
    const timer = setInterval(tick, 1000 / PACKET_RATE);
    socket.on('close', () => clearInterval(timer));
    socket.on('error', () => { clearInterval(timer); socket.terminate(); });
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.SOCKET_PORT || 8765);
  const host = process.env.SOCKET_HOST || '127.0.0.1';
  const server = startDummySocketServer({ port, host });
  server.on('listening', () => {
    console.log(`Dummy telemetry server: ws://${host}:${server.address().port}`);
    console.log(`Emitting four joint angles at ${PACKET_RATE} Hz. Select WebSocket in ARC Lab and connect.`);
    console.log('This server generates test data; it does not connect to hardware.');
  });
  server.on('error', error => { console.error(`Socket server: ${error.message}`); process.exitCode = 1; });
  const shutdown = () => { for (const client of server.clients) client.terminate(); server.close(); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
