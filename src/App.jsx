import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Simulation } from '../js/simulation.js';
import { DigitalTwinScene } from '../js/scene.js';
import { HandScene } from '../js/handScene.js';
import { JOINTS, deg, PACKET_RATE } from '../js/config.js';
import { Icon } from './icons.jsx';
import { TelemetrySource, StreamConnectionPanel, StreamStatusStrip } from './TelemetrySource.jsx';

const format = (value = 0, digits = 1) => Math.abs(value) < 0.05 ? (0).toFixed(digits) : value.toFixed(digits);

function Status({ children, tone = 'green', pulse = false }) {
  return <span className={`status ${tone}`}><i className={pulse ? 'pulse' : ''} />{children}</span>;
}
function PanelTitle({ icon, children, aside }) {
  return <div className="panel-title"><h2><Icon name={icon} size={16} />{children}</h2>{aside}</div>;
}
function Toggle({ checked, onChange, label, disabled = false }) {
  return <button className={`toggle ${checked ? 'on' : ''}`} role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}><span /></button>;
}
function Slider({ label, value, min, max, onChange, disabled, hint, color = '#ed945e' }) {
  const progress = (value - min) / (max - min) * 100;
  return <div className={`slider-control ${disabled ? 'disabled' : ''}`}>
    <div className="slider-heading"><label htmlFor={`slider-${label}`}>{label}<span>{hint}</span></label><output>{format(value)}<em>°</em></output></div>
    <input id={`slider-${label}`} aria-label={label} type="range" min={min} max={max} step="0.1" value={value} disabled={disabled} onChange={e => onChange(+e.target.value)} style={{ '--progress': `${progress}%`, '--slider-color': color }} />
    <div className="range-labels"><span>{min}°</span><span>{min < 0 ? '0°' : `${(min + max) / 2}°`}</span><span>{max > 0 && min < 0 ? '+' : ''}{max}°</span></div>
  </div>;
}

function GesturePanel({ sim, state }) {
  const handContainer = useRef(null);
  const handPreview = useRef(null);
  const [handError, setHandError] = useState(false)
  const expandHand = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await handPreview.current.requestFullscreen();
    } catch { sim.warn('Fullscreen is unavailable in this browser. Drag and zoom the hand to inspect it.'); }
  };
  useEffect(() => {
    let hand;
    try { hand = new HandScene(handContainer.current, sim); } catch { setHandError(true); }
    return () => hand?.dispose();
  }, [sim]);
  const streaming = state.source !== 'local';
  const locked = state.stopped || state.demoRunning || streaming;
  return <aside className="left-column">
    <section className="panel gesture-panel">
      <PanelTitle icon="hand" aside={<span className="tiny-tag">INPUT</span>}>Gesture controller</PanelTitle>
      <div className="panel-body">
        <div className="segmented mode-switch" role="group" aria-label="Control mode">
          <button className={state.mode === 'gesture' ? 'active' : ''} disabled={locked} onClick={() => sim.setMode('gesture')}><Icon name="hand" size={14} />Auto gesture</button>
          <button className={state.mode === 'manual' ? 'active' : ''} disabled={locked} onClick={() => sim.setMode('manual')}><Icon name="settings" size={14} />Manual servo</button>
        </div>
        {streaming && <p className="stream-control-note">Incoming telemetry drives the arm. Choose Local control to use sliders.</p>}
        <div className={`hand-preview ${state.mode === 'manual' ? 'compact' : ''}`} ref={handPreview}>
          <div className="preview-caption"><span>{streaming ? 'ORIENTATION' : 'MPU6050'}</span><div className="hand-preview-actions"><Status tone={state.hasGesture ? 'green' : 'muted'}>{state.hasGesture ? (streaming ? 'FROM STREAM' : 'ONLINE') : 'NO DATA'}</Status><button className="icon-button" title="Expand gesture hand / exit fullscreen" aria-label="Expand gesture hand" onClick={expandHand}><Icon name="expand" size={15} /></button></div></div>
          <div ref={handContainer} className="hand-canvas" style={{ visibility: state.hasGesture ? 'visible' : 'hidden' }} />
          {!state.hasGesture && <div className="hand-fallback"><Icon name="hand" size={24} /><span>No pitch / roll in stream</span></div>}
          {handError && <div className="hand-fallback"><Icon name="hand" size={55} /><span>Orientation preview unavailable</span></div>}
          <div className="hand-axis"><span className="axis-x">X</span><span className="axis-y">Y</span><span className="axis-z">Z</span></div>
          <div className="hand-caption">{streaming ? 'Received hand orientation' : 'Simulated hand orientation'}<span>Drag to inspect · Scroll to zoom · Double-click to reset</span></div>
        </div>
        {state.mode === 'gesture' ? <div className="gesture-sliders">
          <Slider label="Roll" value={state.gesture.roll} min={-90} max={90} hint="BASE ROTATION" onChange={value => sim.setGesture('roll', value)} disabled={locked} />
          <Slider label="Pitch" value={state.gesture.pitch} min={-60} max={60} hint="ARM ELEVATION" onChange={value => sim.setGesture('pitch', value)} disabled={locked} color="#87b8cb" />
          <div className="input-note"><Icon name="info" size={13} /><span>Roll rotates. Pitch raises the arm.</span></div>
        </div> : <div className="manual-sliders">{Object.entries(JOINTS).map(([key, joint]) => <Slider key={key} label={joint.label} value={state.manual[key]} min={joint.min} max={joint.max} hint={`S${joint.channel + 1}`} color={joint.color} onChange={value => sim.setManual(key, value)} disabled={locked} />)}</div>}
        <div className="sensor-readings development">
          <div className="eyebrow">{streaming ? 'DERIVED ACCELEROMETER' : 'ACCELEROMETER'} <span>g</span></div>
          <div className="sensor-grid">{['ax', 'ay', 'az'].map(key => <div key={key}><span>{key.toUpperCase()}</span><b>{state.hasGesture ? format(state.sensor[key], 2) : '—'}</b></div>)}</div>
        </div>
      </div>
    </section>
    <section className={`panel magnet-panel ${state.magnet ? 'energized' : ''}`}>
      <div className="magnet-main"><span className="magnet-icon"><Icon name="magnet" size={21} /></span><div><h2>Electromagnet</h2><span>{state.captured ? 'Workpiece attached' : state.magnet ? 'Energized · ready to capture' : 'End effector · standby'}</span></div><Toggle checked={state.requestedMagnet} onChange={value => sim.setMagnet(value)} label="Electromagnet" disabled={locked} /></div>
      <div className="magnet-bottom"><Status tone={state.magnet ? 'green' : 'muted'}>{state.magnet ? 'MAGNET ON' : 'MAGNET OFF'}</Status><span>Capture radius <b>0.5 u</b></span></div>
    </section>
  </aside>;
}

function ViewOptions({ sim, state, close }) {
  const labels = { axes: ['axes', 'Show joint axes'], trail: ['trail', 'Show end-effector trail'], workspace: ['target', 'Show workspace'], separate: ['layers', 'Separate digital twin'], grid: ['grid', 'Show engineering grid'], debug: ['code', 'Debug overlay'] };
  return <div className="view-options" role="dialog" aria-label="View options">
    <div className="popover-title">VIEW OPTIONS<button className="icon-button" aria-label="Close view options" onClick={close}><Icon name="close" size={15} /></button></div>
    <label className="render-quality-control"><span>Render quality</span><select aria-label="Render quality" value={state.options.quality} onChange={e => sim.setOption('quality', e.target.value)}><option value="standard">Standard</option><option value="high">High</option><option value="ultra">Ultra</option></select></label>
    {Object.entries(labels).map(([key, [icon, label]]) => <label key={key}><span><Icon name={icon} size={16} />{label}</span><input type="checkbox" checked={state.options[key]} onChange={e => sim.setOption(key, e.target.checked)} /></label>)}
  </div>;
}

function Viewport({ sim, state }) {
  const container = useRef(null);
  const panel = useRef(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let scene;
    try {
      scene = new DigitalTwinScene(container.current, sim);
      // Available in development for end-to-end verification and integration experiments.
      if (import.meta.env.DEV) window.__ARC__ = { sim, scene };
    } catch (err) { setError(err.message); }
    return () => { scene?.dispose(); if (import.meta.env.DEV) delete window.__ARC__; };
  }, [sim]);
  const stale = state.connection.stale;
  const fullscreen = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await panel.current.requestFullscreen(); }
    catch { sim.warn('Fullscreen is unavailable in this browser. Use Presentation mode to enlarge the view.'); }
  };
  return <section className="center-column">
    <div className={`panel scene-panel ${state.stopped ? 'is-stopped' : ''}`} ref={panel}>
      <div className="scene-toolbar"><div className="scene-title"><Icon name="cube" size={17} /><h2>Digital twin</h2><span className="scene-divider" /><span className="subtle">3D WORKSPACE</span></div><div className="scene-tools"><Status tone={state.stopped ? 'red' : stale ? 'amber' : 'green'} pulse={!state.stopped && !stale}>{state.stopped ? (state.source === 'local' ? 'STOPPED' : 'PAUSED') : stale ? 'STALE DATA' : 'LIVE'}</Status><span className="scene-divider" /><button className={`icon-button ${optionsOpen ? 'selected' : ''}`} aria-label="View options" title="View options" onClick={() => setOptionsOpen(!optionsOpen)}><Icon name="settings" size={17} /></button><button className="icon-button" title="Expand viewport" aria-label="Expand viewport" onClick={fullscreen}><Icon name="expand" size={16} /></button></div></div>
      <div className="viewport-wrap">
        <div className="scene-canvas" ref={container} />
        {error && <div className="scene-error"><Icon name="alert" size={30} /><h3>3D view could not start</h3><p>Enable WebGL and hardware acceleration in your browser, then reload.</p><small>{error}</small></div>}
        <div className="scene-watermark"><span className="crosshair">+</span><div>ARM-04<span>4 AXES / SERVO ACTUATED</span></div></div>
        <div className="scene-units"><span>WORLD COORDINATES</span><b>1 u = 100 mm</b></div>
        {['base', 'shoulder', 'elbow', 'wrist'].map((key, i) => <div key={key} className={`joint-label label-${key}`} data-joint-label={key}><i /><span>S{i + 1}<b>{key.toUpperCase()}</b></span></div>)}
        {state.options.separate && <div className="separate-labels"><span>{state.source === 'local' ? 'SIMULATED PHYSICAL ARM' : 'RECEIVED JOINT STATE'}</span><span>DIGITAL TWIN · TELEMETRY</span></div>}
        {state.options.debug && <div className="debug-overlay development"><b>RENDER DIAGNOSTICS</b><span>FPS {Math.round(state.fps)} · Δ {format(state.delta)} ms</span><span>TX interval {format(1000 / PACKET_RATE)} ms</span><span>Draw calls {state.drawCalls}</span><span>TCP {Object.values(state.toolPosition).map(value => format(value, 2)).join(', ')}</span>{Object.entries(state.joints).map(([key, value]) => <span key={key}>{key} {format(value, 3)} rad</span>)}</div>}
        {optionsOpen && <ViewOptions sim={sim} state={state} close={() => setOptionsOpen(false)} />}
        {state.stopped && <div className="stop-overlay"><Icon name={state.source === 'local' ? 'alert' : 'pause'} size={24} /><div><b>{state.source === 'local' ? 'EMERGENCY STOP ENGAGED' : 'MONITORING PAUSED'}</b><span>{state.source === 'local' ? 'Motion frozen. Reset the system to resume.' : 'View frozen. No hardware command was sent.'}</span></div></div>}
        {state.demoRunning && <div className="demo-overlay"><div><span className="demo-running-dot" /><b>{state.demoLabel}</b><span>{Math.round(state.demoProgress * 100)}%</span></div><div className="demo-progress"><i style={{ width: `${state.demoProgress * 100}%` }} /></div></div>}
        <div className="camera-bar"><span className="camera-label"><Icon name="cube" size={13} />VIEW</span>{['front', 'side', 'top', 'isometric'].map(preset => <button key={preset} className={state.camera === preset ? 'active' : ''} onClick={() => sim.setCamera(preset)}>{preset === 'isometric' ? 'Iso' : preset[0].toUpperCase() + preset.slice(1)}</button>)}<span className="camera-separator" /><button className={state.camera === 'follow' ? 'active' : ''} onClick={() => sim.setCamera('follow')} title="Follow end effector"><Icon name="target" size={13} /><span>Follow</span></button><button onClick={() => sim.setCamera('isometric')} title="Reset camera" aria-label="Reset camera"><Icon name="reset" size={13} /></button></div>
        <div className="view-gizmo"><svg viewBox="0 0 64 64"><path d="M30 36V9" stroke="#88a994"/><path d="m30 36 23 13" stroke="#b18476"/><path d="M30 36 8 48" stroke="#84a5be"/><circle cx="30" cy="36" r="3" fill="#8b9497"/><text x="27" y="8" fill="#88a994">Y</text><text x="54" y="56" fill="#b18476">X</text><text x="0" y="55" fill="#84a5be">Z</text></svg></div>
      </div>
      <div className="scene-footer"><span><Icon name="link" size={13} />Physical joint state <Icon name="arrow" size={12} /> Digital twin</span><Status tone={state.stopped ? 'red' : stale ? 'amber' : 'green'}>{state.stopped ? 'HALTED' : stale ? 'STALE DATA' : 'SYNCHRONIZED'}</Status></div>
      <div className="tool-coordinates"><span>TOOL POSITION</span><div><b>X <em>{format(state.toolPosition.x * 100, 1)}</em></b><b>Y <em>{format(state.toolPosition.y * 100, 1)}</em></b><b>Z <em>{format(state.toolPosition.z * 100, 1)}</em></b><small>mm</small></div><span className="orbit-help"><Icon name="mouse" size={12} />Drag to orbit · Scroll to zoom</span></div>
    </div>
    <div className="control-bar"><button className={`button primary ${state.demoRunning ? 'running' : ''}`} onClick={() => state.demoRunning ? sim.stopDemo() : sim.startDemo()} disabled={state.stopped || state.source !== 'local'}><Icon name={state.demoRunning ? 'stop' : 'play'} size={16} />{state.demoRunning ? 'Stop demo' : 'Start demo'}</button><button className="button secondary home-button" onClick={() => sim.home()} disabled={state.stopped || state.source !== 'local'}><Icon name="home" size={16} />Home position</button><div className="control-spacer" /><button className={`button emergency ${state.stopped ? 'reset-system' : ''}`} onClick={() => state.stopped ? sim.resetSystem() : sim.emergencyStop()}><Icon name={state.stopped ? 'reset' : state.source === 'local' ? 'alert' : 'pause'} size={16} />{state.source === 'local' ? (state.stopped ? 'Reset system' : 'Emergency stop') : (state.stopped ? 'Resume monitoring' : 'Pause monitoring')}</button></div>
  </section>;
}

function TelemetryPanel({ sim, state }) {
  const connection = state.connection;
  return <aside className="right-column">
    <section className="panel telemetry-panel"><PanelTitle icon="activity" aside={<span className="tiny-tag live-tag">LIVE DATA</span>}>Joint telemetry</PanelTitle>
      <div className="telemetry-heading"><span>SERVO / JOINT</span><span>POSITION</span></div>
      <div className="joint-readings">{Object.entries(JOINTS).map(([key, joint]) => {
        const angle = deg(state.joints[key]);
        return <div className="joint-reading" key={key} style={{ '--joint-color': joint.color }}><div className="joint-reading-top"><span className="joint-number">S{joint.channel + 1}</span><span className="joint-name">{joint.label}</span><strong data-testid={`angle-${key}`}>{format(angle)}<small>°</small></strong></div><div className="joint-meter"><i style={{ width: `${(angle - joint.min) / (joint.max - joint.min) * 100}%` }} /><span style={{ left: `${(deg(state.targetJoints[key]) - joint.min) / (joint.max - joint.min) * 100}%` }} /></div><div className="joint-limits"><span>{joint.min}°</span><span>{joint.max}°</span></div></div>;
      })}</div>
      <div className="pwm-section development"><div className="section-label"><span><Icon name="chip" size={13} />{state.source === 'local' ? 'PCA9685 · PWM OUTPUT' : 'CALCULATED PWM EQUIVALENT'}</span><span>50 Hz</span></div><div className="pwm-table">{Object.entries(JOINTS).map(([key, joint]) => <div key={key}><span>CH{joint.channel}</span><i style={{ background: joint.color }} /><span>{joint.label}</span><b>{Math.round(state.pwm?.[key] || 1500)} <small>µs</small></b></div>)}</div></div>
      <div className="safe-limits"><Icon name="shield" size={13} /><span>{state.source !== 'local' ? 'Incoming angles checked against display limits' : state.stopped ? 'Safety stop engaged' : 'All joints within safe limits'}</span></div>
    </section>
    {state.source !== 'local' ? <StreamConnectionPanel sim={sim} state={state} /> : <section className="panel wireless-panel"><PanelTitle icon="wifi" aside={<Status tone={connection.status === 'ACTIVE' ? 'green' : connection.status === 'DELAYED' ? 'amber' : 'red'}>{connection.status}</Status>}>ESP-NOW link</PanelTitle>
      <div className={`wireless-link ${connection.status.toLowerCase()} ${state.stopped ? 'halted' : ''}`}><div><Icon name="chip" size={20} /><span>ESP32 TX</span></div><div className="wireless-beam" key={Math.floor(connection.sent / 8)}><i /><i /><i /><Icon name="wifi" size={14} /></div><div><Icon name="chip" size={20} /><span>ESP32 RX</span></div></div>
      <div className="network-stats"><div><span>Latency</span><strong>{format(connection.latency)}<small>ms</small></strong></div><div><span>Packet rate</span><strong>{connection.rate}<small>Hz</small></strong></div><div><span>Packet loss</span><strong>{format(connection.loss)}<small>%</small></strong></div></div>
      <div className="packet-counts"><span>TX <b>{connection.sent.toLocaleString()}</b></span><span>RX <b>{connection.received.toLocaleString()}</b></span><button className="text-button development" onClick={() => sim.setConnection(!connection.connected)}>{connection.connected ? 'Disconnect' : 'Reconnect'}<Icon name="chevron" size={11} /></button></div>
    </section>}
  </aside>;
}

function Sparkline({ history, dataKey, min, max, color }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    canvas.width = rect.width * scale; canvas.height = rect.height * scale;
    const ctx = canvas.getContext('2d'); ctx.scale(scale, scale);
    const w = rect.width, h = rect.height;
    ctx.strokeStyle = '#2b3035'; ctx.lineWidth = 0.7;
    ctx.setLineDash([2, 4]);
    for (let i = 1; i < 3; i++) { ctx.beginPath(); ctx.moveTo(0, h * i / 3); ctx.lineTo(w, h * i / 3); ctx.stroke(); }
    ctx.setLineDash([]);
    if (!history.length) return;
    const points = history.flatMap((point, i) => Number.isFinite(point[dataKey]) ? [[w * (100 - history.length + i) / 99, h - 5 - (point[dataKey] - min) / (max - min) * (h - 10)]] : []);
    if (!points.length) return;
    ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.stroke();
    const gradient = ctx.createLinearGradient(0, 0, 0, h); gradient.addColorStop(0, `${color}25`); gradient.addColorStop(1, `${color}00`);
    ctx.lineTo(points.at(-1)[0], h); ctx.lineTo(points[0][0], h); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
    const [x, y] = points.at(-1); ctx.beginPath(); ctx.arc(x - 1.5, y, 2.3, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  }, [history, dataKey, min, max, color]);
  return <canvas className="sparkline" ref={ref} role="img" aria-label={`${dataKey} angle, last 100 samples`} />;
}

function SignalCharts({ state }) {
  const [frozen, setFrozen] = useState(null);
  const history = frozen || state.history;
  const charts = { pitch: { label: 'Pitch', color: '#dcac80', min: -60, max: 60 }, roll: { label: 'Roll', color: '#85afb9', min: -90, max: 90 }, ...JOINTS };
  return <section className="panel signals-panel development" id="signals"><PanelTitle icon="activity" aside={<div className="chart-tools"><span>100 samples <i /> 10 Hz</span><button className="icon-button" title={frozen ? 'Resume live charts' : 'Pause live charts'} aria-label={frozen ? 'Resume live charts' : 'Pause live charts'} onClick={() => setFrozen(frozen ? null : [...state.history])}><Icon name={frozen ? 'play' : 'pause'} size={13} /></button></div>}>Live signals<span className="heading-detail">JOINT & ORIENTATION HISTORY</span></PanelTitle><div className="charts-grid">{Object.entries(charts).map(([key, chart]) => <div className="chart" key={key}><div><span><i style={{ background: chart.color }} />{chart.label}</span><b>{Number.isFinite(history.at(-1)?.[key]) ? format(history.at(-1)[key]) : '—'}<em>°</em></b></div><Sparkline history={history} dataKey={key} {...chart} /><div className="chart-time"><span>−10s</span><span>{frozen ? 'PAUSED' : 'NOW'}</span></div></div>)}</div></section>;
}

const PIPELINE = [['hand', 'Hand gesture', 'PITCH / ROLL'], ['chip', 'MPU6050', '6-AXIS SENSOR'], ['chip', 'ESP32 TX', 'TRANSMITTER'], ['wifi', 'ESP-NOW', 'WIRELESS LINK'], ['chip', 'ESP32 RX', 'RECEIVER'], ['chip', 'PCA9685', 'PWM DRIVER'], ['settings', '4 servos', 'ACTUATION'], ['arm', 'Physical arm', 'JOINT STATE'], ['cube', 'Digital twin', 'MONITORING']];
function Pipeline({ state }) {
  const active = !state.stopped && !state.connection.stale;
  const nodes = state.source === 'local' ? PIPELINE : [
    ['chip', state.source === 'dummy' ? 'Dummy source' : 'Node.js / ESP32', 'JOINT TELEMETRY'],
    ['wifi', state.source === 'dummy' ? 'JSON stream' : 'WebSocket', 'RECEIVE ONLY'],
    ['code', 'Validate', 'SCHEMA + ORDER'],
    ['shield', 'Joint limits', 'BOUNDED ANGLES'],
    ['activity', 'Joint state', 'RECEIVED DATA'],
    ['cube', 'Digital twin', 'LIVE MONITORING'],
  ];
  return <section className={`panel pipeline-panel ${active ? 'flowing' : ''}`}><PanelTitle icon="layers" aside={<span className="pipeline-note"><Icon name="shield" size={12} />{state.source === 'local' ? 'Deterministic control · No autonomous AI' : 'Incoming data · No hardware commands'}</span>}>System pipeline<span className="heading-detail">{state.source === 'local' ? 'FROM GESTURE TO MOTION' : 'FROM SOCKET TO DIGITAL TWIN'}</span></PanelTitle><div className="pipeline">{nodes.map(([icon, title, subtitle], i) => <React.Fragment key={title}><div className={`pipeline-node ${icon === 'wifi' ? 'wireless-node' : ''} ${i === nodes.length - 1 ? 'twin-node' : ''}`} style={{ '--delay': `${i * 0.13}s` }}><div className="pipeline-node-top"><Icon name={icon} size={19} /><i /></div><b>{title}</b><span>{subtitle}</span></div>{i < nodes.length - 1 && <Icon name="chevron" size={13} className="pipeline-arrow" />}</React.Fragment>)}</div></section>;
}

function Diagnostics({ sim, state, open, setOpen }) {
  const local = state.source === 'local';
  return <section className="panel diagnostics development" id="diagnostics">
    <button className="diagnostics-toggle" onClick={() => setOpen(!open)} aria-expanded={open}><span><Icon name="code" size={16} />Diagnostics & packet inspector<span className="tiny-tag">DEVELOPER</span></span><Icon name="down" size={16} className={open ? 'rotated' : ''} /></button>
    {open && <div className="diagnostics-body">
      <div className="diagnostics-settings">
        <h3>{local ? 'Simulated MPU6050 orientation' : 'Orientation derived from stream'}</h3>
        <div className="formula"><b>Pitch <span>{state.hasGesture ? `${format(state.sensor.pitch)}°` : '—'}</span></b><code>atan2(−Ax, √(Ay² + Az²))</code><b>Roll <span>{state.hasGesture ? `${format(state.sensor.roll)}°` : '—'}</span></b><code>atan2(Ay, Az)</code></div>
        <h3>{local ? 'Gyroscope' : 'Derived angular velocity'} <small>°/s</small></h3>
        <div className="sensor-grid">{['gx', 'gy', 'gz'].map(key => <div key={key}><span>{key.toUpperCase()}</span><b>{state.hasGesture ? format(state.sensor[key], 2) : '—'}</b></div>)}</div>
        {local && <>
          <div className="loss-slider"><label htmlFor="packet-loss">Simulated packet loss <b>{state.connection.configuredLoss}%</b></label><input type="range" id="packet-loss" min="0" max="10" step="0.5" value={state.connection.configuredLoss} onChange={e => { sim.wireless.setPacketLoss(+e.target.value); sim.publish(); }} /><div className="range-labels"><span>0%</span><span>10%</span></div></div>
          <button className="button secondary" disabled={state.stopped || state.demoRunning} onClick={() => { sim.resetObjects(); sim.state.requestedMagnet = false; sim.state.magnet = false; sim.publish(); }}><Icon name="reset" size={14} />Reset target objects</button>
        </>}
      </div>
      <div className="packet-inspector"><div><h3>{local ? 'ESP-NOW' : 'Socket'} packet inspector</h3><span>LAST {state.packets.length} / 15 PACKETS</span></div><pre tabIndex="0">{state.packets.length ? state.packets.map(packet => JSON.stringify(packet, null, 2)).join('\n\n') : '// Waiting for valid telemetry…'}</pre></div>
    </div>}
  </section>;
}

function SystemInfo({ close, state }) {
  const dialog = useRef(null);
  useEffect(() => { dialog.current.showModal(); }, []);
  return <dialog className="system-dialog" ref={dialog} onCancel={close} onClick={e => { if (e.target === dialog.current) close(); }}><div className="modal-top"><span className="brand-symbol"><Icon name="arm" size={26} /></span><button className="icon-button" autoFocus aria-label="Close system info" onClick={close}><Icon name="close" size={20} /></button></div><span className="eyebrow orange-text">ARC LAB / SYSTEM OVERVIEW</span><h2>From gesture to motion.</h2><p>A four-axis robotic arm with real-time digital twin monitoring. Explore local simulation, test JSON streams, or connect your Node.js telemetry server.</p><dl>{[['Input sources', 'Local control · dummy stream · WebSocket'], ['Local wireless', 'ESP-NOW · 32 Hz · 3–15 ms simulated latency'], ['Socket input', 'Standard WebSocket JSON · receive only'], ['Servo driver', 'PCA9685 · 50 Hz PWM equivalent · channels 0–3'], ['Actuation', '4 constrained servo joints'], ['End effector', 'Electromagnet · 0.5 u virtual capture radius'], ['Visualization', 'React + Three.js digital twin'], ['Control type', 'Local simulation or incoming joint telemetry'], ['Autonomous AI', 'No']].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><div className="info-note"><Icon name="info" size={17} /><span>Local and dummy modes generate test data. WebSocket mode displays data from your server and sends no hardware commands. Pausing monitoring does not stop a physical arm.</span></div><div className="keyboard-hints"><span><kbd>Space</kbd> {state.source === 'local' ? 'Emergency stop' : 'Pause monitoring'}</span>{state.source === 'local' && <span><kbd>H</kbd> Home</span>}<span><kbd>R</kbd> Reset camera</span></div><button className="button primary modal-done" onClick={close}>Back to workspace<Icon name="arrow" size={16} /></button></dialog>;
}

export function App() {
  const [sim] = useState(() => new Simulation());
  const state = useSyncExternalStore(sim.subscribe, sim.getSnapshot);
  const [infoOpen, setInfoOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  useEffect(() => {
    const keydown = event => {
      if (['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes(event.target.tagName) || event.target.isContentEditable || document.querySelector('dialog[open]')) return;
      if (event.code === 'Space') { event.preventDefault(); sim.emergencyStop(); }
      if (event.code === 'KeyH') sim.home();
      if (event.code === 'KeyR') sim.setCamera('isometric');
    };
    window.addEventListener('keydown', keydown);
    return () => { window.removeEventListener('keydown', keydown); sim.dispose(); };
  }, [sim]);
  const presentation = () => { sim.state.presentation = !sim.state.presentation; sim.publish(); };
  return <div className={`application ${state.presentation ? 'presentation' : ''} ${state.source !== 'local' ? 'streaming' : ''}`}>
    <header className="topbar"><div className="brand"><span className="brand-symbol"><Icon name="arm" size={24} /></span><span>ARC<span className="brand-light">LAB</span></span><i /><span className="brand-descriptor">ROBOTICS WORKSPACE</span></div><nav aria-label="Main navigation"><button className="active" aria-current="page" onClick={() => { if (state.presentation) presentation(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Digital twin</button><button onClick={() => setInfoOpen(true)}>System overview<Icon name="arrow" size={13} /></button></nav><div className="topbar-right"><Status tone={state.stopped ? 'red' : state.source !== 'local' && state.connection.stale ? 'amber' : 'green'} pulse={!state.stopped && !state.connection.stale}>{state.source === 'local' ? (state.stopped ? 'System halted' : 'Simulation running') : state.stopped ? 'Monitoring paused' : state.connection.stale ? 'Waiting for telemetry' : 'Receiving telemetry'}</Status><span className="local-chip">{state.source === 'local' ? 'LOCAL' : state.source === 'dummy' ? 'DUMMY' : 'SOCKET'}</span><span className="avatar">AR</span></div></header>
    <main className="workspace"><div className="page-heading"><div><div className="breadcrumb">WORKSPACE<Icon name="chevron" size={10} />PROJECT ARM-04</div><h1>4-DOF Robotic Arm <span>Real-Time Digital Twin</span></h1><p>Gesture control<span />ESP-NOW<span />PCA9685<span />Digital twin monitoring</p></div><div className="heading-actions"><button className={`button secondary ${state.presentation ? 'selected' : ''}`} onClick={presentation}><Icon name="screen" size={15} />{state.presentation ? 'Exit presentation' : 'Presentation mode'}</button><button className="button secondary info-button" onClick={() => setInfoOpen(true)}><Icon name="info" size={15} /><span>System info</span></button></div></div>
    <TelemetrySource sim={sim} state={state} />
    {state.source !== 'local' ? <StreamStatusStrip state={state} /> : <div className="system-strip"><div className="system-strip-label"><i /><span>SYSTEM STATUS</span></div>{[['MPU6050', 'ONLINE'], ['ESP32 TX', 'ONLINE'], ['ESP32 RX', 'ONLINE'], ['PCA9685', 'ACTIVE']].map(([label, status]) => <div className="system-chip" key={label}><span>{label}</span><Status tone={state.stopped ? 'red' : label === 'ESP32 RX' && state.connection.stale ? 'amber' : 'green'}>{state.stopped ? 'HALTED' : label === 'ESP32 RX' && state.connection.stale ? 'STALE' : status}</Status></div>)}<div className="system-strip-end"><Icon name="shield" size={13} />Safety limits enabled</div></div>}
    {state.warning && <div className="warning-banner" role="alert"><Icon name="alert" size={16} />{state.warning}<button className="icon-button" aria-label="Dismiss warning" onClick={() => { sim.state.warning = ''; sim.publish(); }}><Icon name="close" size={14} /></button></div>}
    <div className="dashboard-grid"><GesturePanel sim={sim} state={state} /><Viewport sim={sim} state={state} /><TelemetryPanel sim={sim} state={state} /></div>
    <SignalCharts state={state} key={state.source} /><Pipeline state={state} /><Diagnostics sim={sim} state={state} open={diagnosticsOpen} setOpen={setDiagnosticsOpen} />
    <footer className="page-footer"><span><i />{state.notice}</span><span>ARC LAB<span className="footer-divider">/</span>DIGITAL TWIN v1.0<span className="footer-divider">/</span><b>{Math.round(state.fps)} FPS</b></span></footer>
    </main>{infoOpen && <SystemInfo state={state} close={() => setInfoOpen(false)} />}
  </div>;
}
