# Connect the existing arm to ESP32 USB telemetry

The existing React dashboard, Three.js arm hierarchy, pivots, camera and local controls are reused. The existing Node.js entry point is `server/index.mjs`; `server/bridge.mjs` already owns the WebSocket server on port 8080. There is no Express server, HTTP API or CORS configuration to replace. This update extends that bridge and its serial service without adding another server. It never writes hardware commands. These are commanded positions, not measured physical joint feedback.

## Install and configure

Use Node.js 20.19+ or 22+. From this project directory:

```powershell
npm.cmd install
Copy-Item .env.example .env
npm.cmd run serial:ports
```

In PowerShell, `npm.cmd` avoids execution-policy restrictions on `npm.ps1`. In other shells, `npm` works normally.

Connect the **receiver**, using a USB data cable. `serial:ports` lists paths, manufacturer, vendor/product IDs and possible ESP32 matches. Compare the list before and after plugging it in, or check Windows Device Manager → Ports (COM & LPT). ESP32 boards commonly identify through Espressif, Silicon Labs CP210x or WCH CH340/CH910 USB adapters; these identifiers are hints, not proof of a board's identity.

If there is exactly one candidate, blank `ESP32_SERIAL_PORT` selects it automatically. If there are multiple candidates, no board is guessed; choose explicitly in `.env`:

```dotenv
ESP32_SERIAL_PORT=COM7
ESP32_BAUD_RATE=115200
ESP32_RECONNECT_DELAY_MS=2000
ESP32_DATA_TIMEOUT_MS=1000
DIGITAL_TWIN_MOCK_MODE=false
WS_PORT=8080
```

Use the actual port, not necessarily COM7. On Linux/macOS use the listed path (for example `/dev/ttyUSB0` or `/dev/cu.usbserial-...`). Close Arduino Serial Monitor or other applications holding the port. Missing, busy and unplugged ports are retried every `ESP32_RECONNECT_DELAY_MS` (default 2000). Automatic selection rescans on each retry. Manual selection retries the configured path.

The old names `SERIAL_PORT`, `SERIAL_BAUD_RATE`, `SERIAL_RECONNECT_MS`, `STALE_AFTER_MS` and `MOCK_MODE` remain supported as aliases. The corresponding new name takes precedence if both are present. Existing `.env` files should also update any explicit `JOINT_LIMITS` to the firmware ranges below.

## Receiver serial contract

No receiver or sender firmware is present in this repository. **Firmware has not been modified.** Leave the sender, ESP-NOW packet handling, channel mapping, safety constraints and PCA9685 writes intact.

In the receiver's existing `setup()`, ensure serial is initialized at the same rate as `.env`; reuse any existing initialization:

```cpp
Serial.begin(115200);
```

Your receiver already emits the following format. No receiver edit is needed if that output is present. For a receiver lacking this output, the insertion location is **immediately after the existing block that applies all four final, safety-limited `currentAngle[]` values to the PCA9685**, in the receiver's servo-update path:

```cpp
Serial.printf(
  "{\"base\":%.2f,\"shoulder\":%.2f,\"elbow\":%.2f,\"wrist\":%.2f}\n",
  currentAngle[0],
  currentAngle[1],
  currentAngle[2],
  currentAngle[3]
);
```

The indices above assume the receiver already uses Base, Shoulder, Elbow, Wrist in that order; verify against the existing channel mapping without changing that mapping. Emit only after all four commands are finalized, not once per individual servo write. If servo updates run in a time-sensitive ESP-NOW callback, capture the completed four-angle snapshot there and emit it from the receiver's loop/task rather than adding blocking serial output to that callback. An exact source line cannot be identified until the receiver firmware is available.

The expected output is one JSON object per line approximately every 20 ms (50 Hz) while valid glove packets are arriving. Startup/debug logs and invalid lines are ignored and do not refresh freshness. The receiver holds its last command after roughly 500 ms without ESP-NOW packets. The bridge marks joint telemetry stale after `ESP32_DATA_TIMEOUT_MS` (default 1000 ms), independently of whether USB is still open. The frontend uses the same advertised timeout; local/dummy streams retain their existing 500 ms timeout.

**Glove freshness limitation:** the four-angle JSON has no ESP-NOW packet age or connection flag. If the receiver continuously reprints a held pose even after losing the glove, the backend cannot distinguish those lines from valid repeated commands for a stationary glove. To make joint-update freshness reflect ESP-NOW freshness, the receiver must emit these records only while valid ESP-NOW packets are arriving, or expose explicit packet-age metadata in a future firmware/protocol change. Do not treat USB connectivity or unchanged angle values as evidence that the glove is active or inactive. No sender or receiver firmware has been changed here.

## Calibrate raw servo angles to the existing model

The receiver emits servo degrees; the existing model uses these control coordinates:

| Joint | Raw limits by default | Model degrees | Existing Three.js rotation |
| --- | --- | --- | --- |
| Base | 45–135 | servo − 90 | Y = model degrees |
| Shoulder | 40–140 | servo | Z = model degrees − 90 |
| Elbow | 45–135 | servo | Z = model degrees − 180 |
| Wrist | 45–135 | servo − 90 | Z = model degrees − 90 |

For `{ "base":90, "shoulder":110, "elbow":75, "wrist":120 }`, model coordinates are `{ "base":0, "shoulder":110, "elbow":75, "wrist":30 }`. Existing axes, neutral offsets and parent-child rotations remain unchanged. Only the visual pose is interpolated (roughly 70 ms time constant); target values remain exact. The camera and model stay mounted.

`JOINT_LIMITS` in `.env` configures raw servo limits. Match the receiver's existing limits. `JOINT_MAPPING` configures each joint's `{ "scale":1, "offset":0 }`; model degrees = raw degrees × scale + offset. Use scale `-1` with a suitable offset for a reversed installation. Defaults for base and wrist assume a centered 90° servo corresponds to the existing model's 0° control value. Actual mounting orientation requires checking on your arm.

Out-of-range, missing, nonnumeric and non-finite angles are rejected as a whole frame. Mapped values outside the existing model's limits are also rejected, rather than silently clamped. If the receiver has a wider physical travel range, explicitly review both calibration and model limits in `js/config.js`; widening raw limits alone will not bypass model validation. Legacy local/dummy telemetry retains its existing behavior.

## Start backend and frontend

Terminal 1:

```powershell
npm.cmd run server
```

Terminal 2:

```powershell
npm.cmd run dev
```

Open Vite's printed URL, choose **WebSocket** in the existing Telemetry source panel, and click **Connect socket** with `ws://localhost:8080`. Local control remains the default to preserve the existing demo. When hardware monitoring is selected, local sliders/demo cannot drive the twin. The frontend retries an unexpectedly closed socket every two seconds; manual disconnect, pause or source switching cancels retries.

The bridge binds to `127.0.0.1` by default. If changing `WS_PORT`, update `VITE_TELEMETRY_URL` and restart Vite, or edit the existing Server URL input. An HTTPS frontend requires a `wss://` endpoint through a TLS proxy.

The indicator reports **CONNECTED** only with recent valid ESP32 joint telemetry, **WAITING** when USB is open but recent valid data is absent, and **DISCONNECTED** when USB or the backend is unavailable. The existing status strip separately shows WEBSOCKET, USB RECEIVER and TELEMETRY states. USB is UNKNOWN when the socket is closed because the browser cannot observe the backend's hardware connection then. WebSocket CONNECTED alone does not mean the ESP32 is connected. Last pose is retained when data becomes stale. New clients receive the last valid commanded pose with its original timestamp, explicit `stale` flag and timeout, even if the device has disconnected; replay does not make old data live.

## Development mock mode

In `.env`, set both:

```dotenv
NODE_ENV=development
DIGITAL_TWIN_MOCK_MODE=true
```

Restart the backend. It emits bounded four-joint motion at 50 Hz through the same WebSocket schema, with `source: "mock"`. The existing UI displays **SIMULATED**. This mode does not open serial ports. It is disabled by default and refuses to start outside `NODE_ENV=development`. Restore `DIGITAL_TWIN_MOCK_MODE=false` and restart before testing hardware. The existing in-browser Dummy stream and `socket:demo` remain available separately; the legacy demo server still uses port 8765.

## Protocol

Live USB frames are broadcast as:

```json
{
  "type": "joint_update",
  "timestamp": 1793161800000,
  "seq": 1,
  "source": "esp32",
  "connectionStatus": "connected",
  "usbConnected": true,
  "stale": false,
  "dataTimeoutMs": 1000,
  "lastJointUpdateAt": 1793161800000,
  "angles": { "base":90, "shoulder":110, "elbow":75, "wrist":120 },
  "modelAngles": { "base":0, "shoulder":110, "elbow":75, "wrist":30 }
}
```

The timestamp is an illustrative Unix millisecond value; the backend stamps actual receipt time. `angles` preserves the receiver command. `modelAngles` holds calibrated existing-model degrees. New connections receive `snapshot:true` on the latest pose, the current `connectionStatus`, and a `stale` flag calculated at connection time. Separate status messages use `{ "type":"connection_status", "timestamp":..., "source":"esp32", "status":"waiting", "usbConnected":true, "stale":true, "dataTimeoutMs":1000, "lastJointUpdateAt":..., "port":"COM7", "detail":"..." }`. Mock packets set `usbConnected:null`. Invalid serial traffic never refreshes the valid-data heartbeat. Partial serial lines are bounded to 4 KB; slow WebSocket clients are disconnected rather than building an unbounded pose backlog.

## Verification

```powershell
npm.cmd test
npm.cmd run build
```

With Vite running at port 5174 (or set PowerShell `$env:TEST_URL="http://localhost:5173"` to its actual URL):

```powershell
npm.cmd run test:socket
npm.cmd run test:browser
```

The browser tests require Chrome or an installed Playwright Chromium; set `CHROME_PATH` to use another Chrome installation. Automated tests use serialport's mock binding and real WebSocket connections to cover partial/invalid JSON, invalid limits, missing/busy ports, ambiguity, USB disconnect/reconnect, stale data, rapid updates, multiple clients, latest-state replay, mock gating and source labels. Frontend tests also check reconnect cancellation and existing Three.js rotations. These tests do not verify physical hardware.

For hardware acceptance:

1. Start in real mode, connect the receiver and confirm the selected COM port and baud rate.
2. Move one joint at a time using the glove. Compare the receiver's commanded angle, UI pose and each joint's direction/neutral position; adjust `.env` calibration as needed.
3. Open a second browser tab; confirm both twins follow the same commands and the second receives the current pose immediately.
4. Unplug USB. Confirm DISCONNECTED and a held pose. Reconnect; confirm recovery without restarting Node.
5. Stop valid telemetry while leaving USB open. Confirm WAITING/stale and a held pose. Malformed lines must not restore LIVE.
   Switch off the glove too: if valid joint lines stop, telemetry becomes stale after the configured timeout while USB remains connected. If the receiver continues repeating commands, this check needs the receiver freshness behavior described above.
6. Restart the backend while the frontend remains open. Confirm it reconnects. Check camera position remains unchanged throughout joint updates.

## File inventory

New files: `server/index.mjs` (CLI/startup), `server/config.mjs` (validated environment configuration), `server/serial-service.mjs` (USB detection/framing/reconnect), `server/bridge.mjs` (WebSocket broadcasting and development mock), `js/hardwareTelemetry.js` (raw validation/calibration), `.env.example`, `tests/bridge.test.mjs`, and this guide.

Modified files: `package.json`/`package-lock.json` (runtime dependencies and commands), `.gitignore` (local environment files), `js/config.js` (bridge URL/reconnect delay), `js/socketTelemetry.js` (hardware/status protocol and reconnect), `js/simulation.js` (saved stale pose replay), `src/TelemetrySource.jsx` (existing status panel), `src/App.jsx` (commanded-position label), `tests/socket-browser.mjs` (hardware browser coverage), `README.md` and `docs/SOCKET_TELEMETRY.md` (setup links). The arm model and receiver/sender firmware have not been edited.
