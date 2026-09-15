# Dummy data now, Node.js telemetry later

The dashboard has three sources. Exactly one source owns the displayed joint data at a time.

| Source | Where data comes from | Controls |
| --- | --- | --- |
| Local control | Existing gesture/manual simulation and programmed demo | Original controls, home, electromagnet, emergency stop |
| Dummy stream | Generated four-joint JSON in the browser | Starts on selection; stop/start stream; pause/resume monitoring |
| WebSocket | Your Node.js or ESP32 `ws://` or `wss://` endpoint | URL, connect/disconnect, cancel connection, pause/resume monitoring |

The dummy stream and real socket share `SocketTelemetry.receive()` and `parseTelemetryMessage()`. They validate and normalize data before `Simulation.receiveSocketFrame()` updates the joint state. The Three.js arm consumes that state through its existing four-joint hierarchy.

## Quick test without hardware

1. Run `npm run dev` and open the Vite URL.
2. Select **Dummy stream** above the dashboard.
3. Observe the moving arm, live joint values, charts, received frame count, and packet inspector.
4. Click **Stop dummy stream**. The pose holds and telemetry becomes stale.
5. Select **Local control** to restore the original sliders and demo.

This first test uses an in-browser JSON generator. It does not open a network socket.

## Test a real network connection with the included Node.js server

Run the frontend and server in separate terminals:

```sh
npm run dev
```

```sh
npm run socket:demo
```

Select **WebSocket**, use `ws://localhost:8765`, and click **Connect socket**. If your system resolves localhost differently, use the exact printed address, `ws://127.0.0.1:8765`.

The server in `scripts/dummy-socket-server.mjs` sends independent, continuous motion for all four joints at approximately 32 Hz. It uses the same generator as the browser dummy source, but these messages travel through a real WebSocket connection. Each connection has its own monotonic sequence counter. Timers stop when a client disconnects.

Optional PowerShell configuration:

```powershell
$env:SOCKET_PORT = '8766'
# Set SOCKET_HOST only when you need a specific listening interface.
$env:SOCKET_HOST = '127.0.0.1'
npm run socket:demo
```

## Connect the real Node.js server later

Replace the URL in the dashboard with your server's address, for example `ws://192.168.1.50:8765/telemetry`. You can also change `SOCKET_CONFIG.url` in `js/config.js`. No arm model or React changes are required if your messages follow the contract below.

Use a **standard WebSocket JSON endpoint**. Socket.IO uses an additional protocol and needs a Socket.IO adapter; it cannot be connected by entering a Socket.IO URL here. When the actual endpoint and sample JSON are provided, its field names can be adapted at the parser boundary if necessary.

This connection receives telemetry only. It sends no application messages, servo targets, magnet commands, or hardware emergency-stop commands. Keep physical control and safety on the device/controller. **Pause monitoring** only pauses this browser's view and disconnects its telemetry stream.

## JSON message contract

Send one JSON object per WebSocket message. All four joints must be present in each message.

```json
{
  "type": "telemetry",
  "seq": 123,
  "units": "degrees",
  "joints": {
    "base": 25,
    "shoulder": 100,
    "elbow": 85,
    "wrist": -15
  },
  "electromagnet": false,
  "pitch": 12.5,
  "roll": 25
}
```

The smallest accepted message is:

```json
{"base":25,"shoulder":100,"elbow":85,"wrist":-15}
```

| Field | Required | Rules |
| --- | --- | --- |
| `joints.base`, `joints.shoulder`, `joints.elbow`, `joints.wrist` | Yes | Finite JSON numbers. Flat top-level equivalents are also accepted. Numeric strings are rejected. |
| `type` | No | Must be `telemetry` when present. |
| `units` | No | `degrees` by default; `radians` is supported. Applies to joint angles only. |
| `seq` | No, recommended | Nonnegative safe integer, strictly increasing within a connection. `gestureId` is an accepted alias. Counter resets are accepted after reconnecting. |
| `timestamp` | No | Unix milliseconds. Requires synchronized clocks. More than 5 seconds old or 5 seconds in the future is rejected. Omit if the ESP32 only reports uptime. |
| `electromagnet` | No | Boolean; `magnet` is an alias. Missing values retain the last known magnet state within the session; a new source starts off. |
| `pitch`, `roll` | No | Degrees, finite and within ±180°. Both are needed for the hand preview. `gesture: {pitch, roll}` is also supported. Missing orientation is shown as unavailable. |

Payloads are limited to 16 KB. UTF-8 JSON sent as a binary WebSocket frame is accepted as well. Arrays, partial joint frames, malformed JSON, invalid units, invalid field types, repeated/out-of-order sequence IDs, and old timestamps are rejected. Nondecreasing timestamps are required within a connection when supplied. Sequence numbers and timestamps are optional for simple initial integration; provide them for ordering/replay checks.

Finite angles outside the configured limits are clamped for the digital display and produce a warning. The limits are the existing `JOINTS` values in `js/config.js`. This does not change any physical hardware command.

## Publish measured joint data from Node.js

Your existing Node.js server can broadcast the following shape using the [`ws` package](https://github.com/websockets/ws):

```js
import { WebSocketServer, WebSocket } from 'ws';

const server = new WebSocketServer({ port: 8765 });
let seq = 0;

// Call from the ESP32 telemetry/serial/MQTT callback, using actual measurements.
export function publishJointState(measuredJoints, electromagnet = false) {
  const packet = JSON.stringify({
    type: 'telemetry',
    seq: seq++,
    timestamp: Date.now(),
    units: 'degrees',
    joints: measuredJoints,
    electromagnet,
  });

  for (const client of server.clients) {
    if (client.readyState === WebSocket.OPEN && client.bufferedAmount < 65536) {
      client.send(packet);
    }
  }
}

// Example callback shape; replace this with your actual incoming data:
// onEsp32Telemetry(data => publishJointState(data.joints, data.electromagnet));
```

The bundled dummy server is ready to run. The measured-data callback above is an integration example; your actual Node.js endpoint and ESP32 schema have not been supplied yet.

## What happens on transitions and failures

- Switching sources stops the local packet timer and dummy generator, closes the former WebSocket, cancels the local demo, and resets packet history. The arm holds its current display pose until the newly selected source provides data.
- Each connection has a generation identity. Events from a canceled or previous socket cannot update the current source. Reconnecting starts a fresh ordering baseline.
- The UI distinguishes connecting, open-but-waiting, active, stale, disconnected, and error states. Connection attempts time out after 6 seconds and can be canceled. Reconnect is explicit.
- Only valid accepted frames refresh the 500 ms heartbeat. Invalid traffic cannot keep the synchronization indicator green.
- The received rate counts accepted frames in the last second. The last-frame age is measured locally. Rejected packets are shown separately; socket statistics do not invent ESP-NOW packet loss or hardware latency.
- On a stale or disconnected stream, the rendered model freezes at its last displayed pose. There is no automatic switch to dummy data.
- Received joint telemetry remains exact within limits. The 3D rendering interpolates toward it for smooth motion, with no autonomous control decisions. The wireframe comparison view can show the difference between received state and its interpolated display.
- Local sliders, demo, home, and magnet commands are disabled while a stream owns the arm. Source changes are disabled while monitoring is paused; resume first.
- Pausing closes the stream and freezes the visual state. Resuming reconnects rather than replaying queued messages.

The browser uses the [native WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket). If the dashboard is served through HTTPS, use `wss://`; the connection form rejects insecure `ws://` endpoints in that context. The bundled localhost test server uses `ws://` with Vite's local HTTP server.

## Where to customize

| File | Purpose |
| --- | --- |
| `js/config.js` → `SOCKET_CONFIG` | Default URL, connection timeout, message-size limit, timestamp tolerance |
| `js/socketTelemetry.js` → `parseTelemetryMessage()` | Adapt your Node.js field names/envelope and normalize units |
| `js/dummyTelemetry.js` → `createDummyTelemetry()` | Change dummy motion and sample data |
| `scripts/dummy-socket-server.mjs` | Runnable Node.js WebSocket test server |
| `js/simulation.js` → `setSource()` / `receiveSocketFrame()` | Source ownership and application state |
| `src/TelemetrySource.jsx` | Source selector, URL, connection actions, format example |

## Verification

```sh
npm test
npm run build
```

With the Vite development server running:

```powershell
$env:TEST_URL = 'http://localhost:5174' # use the URL Vite printed
npm run test:socket
npm run test:browser
```

The socket browser test starts its own Node.js servers on free localhost ports. It verifies actual received data moving the Three.js hierarchy, dummy mode, units, limits, invalid messages, stale data, source changes, pause/reconnect behavior, no outbound application commands, bounded history, and mobile/tablet layout. Server timers and sockets are cleaned up after the test.
