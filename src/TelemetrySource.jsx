import React from 'react';
import { Icon } from './icons.jsx';

const example = {
  type: 'telemetry', seq: 1, units: 'degrees',
  joints: { base: 20, shoulder: 90, elbow: 100, wrist: -10 },
  electromagnet: false,
};

export function TelemetrySource({ sim, state }) {
  const connection = state.connection;
  const open = connection.phase === 'OPEN';
  const connecting = connection.phase === 'CONNECTING';
  const busy = open || connecting;
  return <section className={`panel telemetry-source source-${state.source}`} aria-label="Telemetry source settings">
    <div className="source-heading">
      <h2><Icon name="link" size={17} />Telemetry source</h2>
      <div className="source-modes segmented" role="radiogroup" aria-label="Telemetry source">
        {[['local', 'settings', 'Local control'], ['dummy', 'activity', 'Dummy stream'], ['websocket', 'wifi', 'WebSocket']].map(([value, icon, label]) =>
          <button key={value} type="button" role="radio" aria-checked={state.source === value} className={state.source === value ? 'active' : ''} disabled={state.stopped} onClick={() => sim.setSource(value)}><Icon name={icon} size={13} />{label}</button>
        )}
      </div>
      <span className={`source-badge ${state.source === 'local' || (!connection.stale && !state.stopped) ? 'ready' : ''}`}>
        <i />{state.stopped ? 'PAUSED' : state.source === 'local' ? 'LOCAL SIMULATION' : connection.status}
      </span>
    </div>
    {state.source === 'local' && <div className="source-description"><Icon name="hand" size={14} /><p>Use gesture sliders, manual servos, or the pick-and-place demo. Switch to a stream to drive the arm with incoming data.</p></div>}
    {state.source === 'dummy' && <div className="source-description dummy-description">
      <div><p>Test all four joints with generated JSON telemetry.</p><span>32 Hz · shared socket parser · no hardware required</span></div>
      <button className="button secondary" disabled={state.stopped} onClick={() => open ? sim.disconnectStream() : sim.startDummyStream()}><Icon name={open ? 'pause' : 'play'} size={14} />{open ? 'Stop dummy stream' : 'Start dummy stream'}</button>
    </div>}
    {state.source === 'websocket' && <div className="socket-settings">
      <form className="socket-form" onSubmit={event => { event.preventDefault(); if (busy) sim.disconnectStream(); else sim.connectSocket(); }}>
        <label htmlFor="socket-url">Server URL</label>
        <input id="socket-url" aria-label="WebSocket URL" value={state.socketUrl} spellCheck="false" autoComplete="off" disabled={busy || state.stopped} onChange={event => sim.setSocketUrl(event.target.value)} />
        <button className="button primary" disabled={state.stopped} type="submit"><Icon name={busy ? 'stop' : 'link'} size={14} />{connecting ? 'Cancel connection' : open ? 'Disconnect socket' : 'Connect socket'}</button>
      </form>
      <div className="socket-help"><span>Incoming telemetry controls the view. This connection does not send hardware commands.</span><span>Test server: <code>npm run socket:demo</code></span></div>
    </div>}
    {state.source !== 'local' && <div className="source-protocol">
      <details><summary><Icon name="code" size={12} />Expected JSON format</summary><div><p>Send all four joint angles. Units default to degrees; radians are also supported. A flat object with base, shoulder, elbow and wrist also works. Optional pitch and roll use degrees.</p><pre>{JSON.stringify(example, null, 2)}</pre><small>Use standard WebSocket JSON from your Node.js server. Socket.IO requires its own adapter.</small></div></details>
      <span>{connection.received} valid frames · {connection.rejected} rejected</span>
    </div>}
    {state.source !== 'local' && connection.error && <div className="socket-error" role="alert"><Icon name="alert" size={14} />{connection.error}</div>}
  </section>;
}

export function StreamConnectionPanel({ sim, state }) {
  const connection = state.connection;
  const available = connection.phase === 'OPEN' || connection.phase === 'CONNECTING';
  const tone = connection.status === 'ACTIVE' ? 'green' : connection.status === 'DELAYED' || connection.status === 'CONNECTING' ? 'amber' : 'red';
  return <section className="panel wireless-panel">
    <div className="panel-title"><h2><Icon name="wifi" size={16} />{state.source === 'dummy' ? 'Dummy telemetry' : 'Socket telemetry'}</h2><span className={`status ${tone}`}><i />{connection.status}</span></div>
    <div className={`wireless-link ${connection.status.toLowerCase()} ${connection.stale || state.stopped ? 'halted' : ''}`}><div><Icon name="chip" size={20} /><span>{state.source === 'dummy' ? 'TEST SOURCE' : 'SOCKET SERVER'}</span></div><div className="wireless-beam"><i /><i /><i /><Icon name="arrow" size={14} /></div><div><Icon name="cube" size={20} /><span>DIGITAL TWIN</span></div></div>
    <div className="network-stats"><div><span>Received rate</span><strong>{connection.rate}<small>Hz</small></strong></div><div><span>Last valid frame</span><strong>{connection.age === null ? '—' : connection.age >= 1000 ? (connection.age / 1000).toFixed(1) : Math.round(connection.age)}<small>{connection.age !== null && (connection.age >= 1000 ? 's' : 'ms')}</small></strong></div><div><span>Rejected</span><strong>{connection.rejected}</strong></div></div>
    <div className="packet-counts"><span>RX <b>{connection.received.toLocaleString()}</b></span><span>RECEIVE ONLY</span><button className="text-button" disabled={state.stopped} onClick={() => sim.setConnection(!available)}>{available ? 'Disconnect' : 'Reconnect'}<Icon name="chevron" size={11} /></button></div>
  </section>;
}

export function StreamStatusStrip({ state }) {
  const connection = state.connection;
  const chips = [
    ['SOURCE', state.source === 'dummy' ? 'GENERATED' : 'WEBSOCKET', 'muted'],
    ['CONNECTION', connection.phase === 'OPEN' ? 'OPEN' : connection.phase, connection.connected ? 'green' : 'amber'],
    ['TELEMETRY', state.stopped ? 'PAUSED' : connection.stale ? 'STALE' : 'LIVE', state.stopped || connection.stale ? 'amber' : 'green'],
    ['CONTROL', 'MONITORING', 'muted'],
  ];
  return <div className="system-strip"><div className="system-strip-label"><i /><span>STREAM STATUS</span></div>{chips.map(([label, value, tone]) => <div className="system-chip" key={label}><span>{label}</span><span className={`status ${tone}`}><i />{value}</span></div>)}<div className="system-strip-end"><Icon name="shield" size={13} />Incoming angles validated</div></div>;
}
