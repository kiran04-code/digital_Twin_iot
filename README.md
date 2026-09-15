# ARC Lab — 4-DOF Robotic Arm Digital Twin

A complete React + Three.js digital twin of a wireless gesture-controlled, four-axis robotic arm. Choose local gesture simulation, generated dummy telemetry, or incoming JSON from a real Node.js/ESP32 WebSocket endpoint. Local and in-browser dummy modes require no backend; a Node.js dummy socket server is also included. Fonts and models are bundled locally.

## Run locally

Requires Node.js 20.19+ or 22+.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. `npx vite` also works. React JSX requires Vite's development server or a production build; directly opening `index.html` or serving the unbuilt source with Python will not compile JSX.

```sh
npm run build
npm run preview
```

The generated `dist/` directory can be served by any static web server, including `python -m http.server --directory dist`.

## Explore the simulation

- **Telemetry source:** Local control preserves the original simulation. Dummy stream moves all four joints using generated JSON through the same parser as WebSocket. WebSocket connects to your Node.js or ESP32 server; valid incoming data drives the arm. See [the socket setup guide](docs/SOCKET_TELEMETRY.md).
- **Auto gesture:** roll rotates the base; pitch drives shoulder, elbow, and wrist through independent mappings. The hand carries a virtual MPU6050 board and follows the input orientation.
- **Manual servo:** four independent sliders with enforced safe angular limits.
- **Start demo:** a programmed pick-and-place sequence rotates left, lowers and aligns the arm, energizes the magnet, captures the cube, lifts and transfers it, releases it, and returns home. Pickup depends on geometric proximity; a missed pickup stops the sequence with a warning.
- **Electromagnet:** capture the cube within 0.5 world units. The toggle reflects the command; the status shows the receiver-applied state.
- **Home position:** base 0°, shoulder 90°, elbow 90°, wrist 0°. This holds the exact home pose until another input, mode change, or demo command.
- **Emergency stop / Space:** cancels pending packets, freezes every joint immediately, stops the demo, and de-energizes the magnet. **Reset system** resumes in manual mode, holding the current pose.
- **Camera:** drag to orbit, scroll to zoom, and right-drag to pan. Front, side, top, isometric, tool-follow, reset, and fullscreen controls are available. `H` returns home; `R` resets the camera when focus is outside a form control.
- **View options:** local joint axes and rotation arcs, a 240-point end-effector trail, approximate workspace, engineering grid, separate physical/twin views, and a render debug overlay.
- **Full HD display:** larger desktop controls, readable joint labels, and a spacious arm viewport optimized for 1920 × 1080. In **View options → Render quality**, choose Standard for lighter rendering, High (default) for 2× minimum pixel density, or Ultra for 2.5× minimum density and sharper shadows. Rendering is capped at six million pixels per canvas to limit GPU load. Presentation mode and fullscreen expand the workspace further.
- **Detailed 3D models:** the arm has smooth beveled bearings, recessed fasteners, cooling ribs, serial plates and studio reflections. The gesture glove has rounded fingers, fabric surface detail, protective pads, and a modeled MPU6050 board. Use the expand button in the hand preview for fullscreen inspection; drag to orbit, scroll to zoom, and double-click to reset the camera. Inspecting the hand changes only its camera, preserving incoming telemetry and servo commands.
- **ESP-NOW link:** disconnect and reconnect to observe stale feedback. Commands cannot directly move the digital twin while feedback is disconnected.
- **Diagnostics:** sensor formulas, gyro rates, adjustable 0–10% loss, target-object reset, and the most recent 15 received packets.
- **Live charts:** six angle histories, each capped at 100 samples; pause/resume affects the charts only.
- **Presentation mode:** hides development controls, PWM details, and signal charts while preserving the arm, input, joint values, connectivity, electromagnet, and pipeline.

## 1. File structure

```text
index.html                  HTML entry point
main.jsx                    React application entry point
style.css                   Responsive dashboard and animation styles
styles/hd-dashboard.css     Full HD typography, contrast, spacing and controls
src/
  App.jsx                   React panels, controls, charts, and information modal
  TelemetrySource.jsx       Source selector, WebSocket connection form and status
  icons.jsx                 Shared SVG interface icons
js/
  config.js                 Dimensions, home pose, limits, mapping, unit conversion
  gestureController.js      Virtual accelerometer and gyroscope
  communication.js          ESP-NOW transport and packet validation
  socketTelemetry.js        WebSocket lifecycle, JSON schema, ordering and heartbeat
  dummyTelemetry.js         Shared generated telemetry for browser and Node.js
  simulation.js             Shared state, receiver, smoothing, and safety controls
  roboticArm.js             Mechanical model and four-joint hierarchy
  scene.js                  Renderer, camera, lights, workspace, trace, and labels
  handScene.js              Three.js hand-orientation preview
  renderQuality.js          Shared pixel density and shadow quality settings
  visualDetails.js          Beveled geometry and high-resolution surface markings
  studioLighting.js         Studio reflections and area lights for both 3D views
  electromagnet.js          Workpieces and attachment/release behavior
  demoController.js         Deterministic pick-and-place waypoints
public/favicon.svg          Application icon
tests/
  control.test.js           Safety, mapping, transport, hierarchy, and pickup tests
  socket.test.js            Socket schema, source isolation and lifecycle tests
  browser.mjs               End-to-end interaction and responsive-layout tests
  socket-browser.mjs        Browser tests with actual Node.js WebSocket servers
scripts/
  dummy-socket-server.mjs    Run with npm run socket:demo
docs/
  SOCKET_TELEMETRY.md        Dummy test, Node.js connection and JSON contract
vite.config.js              React and production build configuration
```

Fonts are packaged locally with `@fontsource`. The model is built entirely from geometry; there are no missing asset downloads.

## 2. How the four-joint hierarchy works

```text
robotRoot
└── baseRotationJoint              Y rotation
    └── shoulderJoint              local Z pitch
        └── upperArm
            └── elbowJoint         local Z pitch
                └── forearm
                    └── wristJoint local Z pitch
                        └── endEffector
```

Every child inherits its parent's transform. The upper arm extends along its local +Y axis; the elbow is exactly one upper-arm length away from the shoulder. The wrist sits at the end of the forearm. Joint housings, bearing rings, side plates, fasteners, motor housings, and cables are attached to the appropriate link.

The numerical servo state is always in **radians**. At the model boundary, shoulder, elbow, and wrist have mounting offsets of −90°, −180°, and −90°, respectively. These offsets convert servo readings into the local mechanical frame. The base rotates around world/local Y. `setJointState()` applies these transforms. `forwardKinematics()` provides an analytical tool position for demo setup and tests.

Receiver targets are interpolated using a frame-rate-independent equivalent of `current += (target - current) * 0.08` at 60 FPS. The digital twin receives samples of this measured simulated state rather than reading gesture sliders. In separate mode, the solid arm on the left displays simulated physical state; the blue wireframe on the right displays received telemetry.

## 3. Change gesture mapping

Edit `GESTURE_MAPPING` in `js/config.js`:

| Input | Range | Output |
| --- | --- | --- |
| Roll | −90° → +90° | Base −90° → +90° |
| Pitch | −60° → +60° | Shoulder 35° → 145° |
| Pitch | −60° → +60° | Elbow 145° → 45° |
| Pitch | −60° → +60° | Wrist −45° → +45° |

`mapGestureToJoints()` and `mapRange()` implement these configurable linear mappings. Neutral gesture maps the elbow to **95°**; the explicit home command overrides this to **90°**, as required by the home specification.

## 4. Change safe joint limits and PWM

Edit `JOINTS` in `js/config.js`:

| Servo / PCA9685 channel | Joint | Limits |
| --- | --- | --- |
| S1 / CH0 | Base | −90° to +90° |
| S2 / CH1 | Shoulder | 15° to 165° |
| S3 / CH2 | Elbow | 20° to 160° |
| S4 / CH3 | Wrist | −90° to +90° |

`applyJointLimits()` calls `clampJointAngle()` before accepting any target. Nonfinite angles are rejected. Out-of-range finite requests are clamped and display a warning. Manual slider bounds use the same configuration.

`angleToPulse()` maps 0–180° to 500–2500 µs. For signed base/wrist readings, `jointToPulse()` first maps the configured signed range onto a 0–180° servo command. PWM telemetry reports pulse widths, with a 50 Hz carrier.

These are angular constraints, not a general collision-avoidance solver. Arbitrary manual poses can intersect the work surface. The programmed demo uses tested reachable waypoints.

## 5. Change dimensions

Edit `DIMENSIONS` in `js/config.js`. The model's shoulder height, upper-arm length, forearm length, wrist extension, magnet length, base height, and base radius use this configuration. Shoulder height is measured from the table; keep it above the base when changing proportions. One world unit represents 100 mm in the coordinate readout.

The demo cube and destination markers are placed using forward kinematics. If link lengths change, review `PICK_POSE`, `PLACE_POSE`, and `LIFT` in `js/demoController.js` so the tool remains near the tabletop and within the capture radius. The workspace hemisphere is an approximate maximum reach, not an exact reachable-volume calculation. Decorative base-plate and bearing details are constructed in `RoboticArm.createBase()` and `createJoint()`.

## 6. How ESP-NOW simulation works

`Simulation.startTransport()` samples the hand and sends packets at approximately **32 Hz**, independently of rendering. Browser scheduling can affect the measured rate. `ESPNowSimulator` delivers each packet with `setTimeout()` after a randomly sampled **3–15 ms modeled latency**. The latency display reports this modeled delay, not a physical network measurement.

```js
{
  gestureId: 123,
  pitch: 20,
  roll: -15,
  base: -15,
  shoulder: 108.333,
  elbow: 78.333,
  wrist: 15,
  electromagnet: false,
  timestamp: 1789459200000,
  mode: 'gesture' // or 'manual'
}
```

The receiver validates finite numeric fields, packet identity, command mode, and magnet type, rejects repeated/out-of-order IDs, maps gestures or accepts manual commands, enforces limits, and updates servo targets. The physics state interpolates toward those targets. Received packets publish the measured joint state to `ingestTelemetry()`. React and the Three.js monitoring model consume that shared telemetry state.

The UI displays sent/received counts, measured transmit rate, modeled latency, and loss. Intentional disconnections and canceled in-flight packets are included in total loss. Packet history is capped at 15. After 500 ms without a received packet, the digital twin is marked stale and holds its latest feedback. Emergency stop flushes pending callbacks using a transport generation counter, so old commands cannot resume motion after reset.

The six charts update at 10 Hz with 100 samples each. The 3D view renders with `requestAnimationFrame()` and `THREE.Clock()`, independently from React's approximately 10 Hz telemetry subscription.

## 7. How magnetic pickup works

`Electromagnet` owns the cube, cylinder, and washer. Only the cube is pickable. With the receiver-applied magnet enabled, it compares the tool contact point to the cube center. Within 0.5 units, `arm.endEffector.attach(cube)` attaches it to the moving hierarchy. A small local adjustment seats the cube's top face against the magnet.

De-energizing calls `scene.attach(cube)`, preserving the world-space position and rotation. As requested, the released cube remains at its last position; freefall is not simulated. The demo releases near the table. **Reset target objects** restores the cube to the reachable pickup point. The demo waits for successful capture before advancing to the lift stage.

## 8. Test socket data now; connect your Node.js server later

Use **Dummy stream** to test without running a server. For a complete network test, run this in a second terminal:

```sh
npm run socket:demo
```

Choose **WebSocket**, enter `ws://localhost:8765`, and click **Connect socket**. The included Node.js server emits four joint angles at approximately 32 Hz. Replace the URL with your real Node.js endpoint when available. The endpoint and connection limits default to `SOCKET_CONFIG` in `js/config.js`.

Both streams follow the same path: JSON message → schema/order validation → joint limits → received joint state → smooth Three.js display. Switching sources cancels old timers and sockets, so synthetic packets cannot overwrite real feedback. Invalid messages do not refresh the heartbeat. After 500 ms without a valid frame, the view is marked stale and holds its last displayed pose. Disconnect and reconnect controls are explicit; there is no automatic fallback to dummy data.

Socket mode is receive-only. Gesture/manual controls and the local demo are disabled. **Pause monitoring** freezes the view and closes the stream; **Resume monitoring** reconnects. Neither button sends a physical emergency-stop command. Reported angles remain exact within the configured display limits; only the rendered model is interpolated. PWM values are calculated equivalents, not measured hardware pulses. Missing optional hand orientation displays as unavailable.

See [SOCKET_TELEMETRY.md](docs/SOCKET_TELEMETRY.md) for the full JSON contract, configuration, source lifecycle, and a Node.js publisher example. The user-specific endpoint and message mapping can be plugged in later without changing the arm model.

## Verification

```sh
npm test
npm run build
```

Run the Vite development server, then execute the end-to-end suite:

```sh
# PowerShell: match the URL printed by your Vite server
$env:TEST_URL = 'http://localhost:5173'
npm run test:browser
npm run test:socket
```

The browser suite uses Chrome when installed at the standard Windows path; otherwise it uses Playwright Chromium (`npx playwright install chromium`). `CHROME_PATH` can select another Chromium executable. Screenshots are saved to the ignored `test-results/` directory.

Tests cover independent gesture mapping, angle constraints, PWM conversion, sensor reconstruction, packet validation/delivery/loss, stale telemetry, frame-rate-independent smoothing, emergency stop, scene-graph pivots, magnetic attachment/release, the complete demo, camera/view controls, packet inspector, presentation mode, socket schemas and ordering, switching sources, monitoring pause/resume, actual Node.js WebSocket messages, console errors, and responsive layout. The socket browser suite starts and cleans up its own local test servers.

Three.js references: [Object3D attachment](https://threejs.org/docs/#api/en/core/Object3D.attach), [OrbitControls](https://threejs.org/docs/#examples/en/controls/OrbitControls).
