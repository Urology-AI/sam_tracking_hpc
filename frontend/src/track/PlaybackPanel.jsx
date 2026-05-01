import React, { useCallback } from 'react';

function fmt(secs) {
  if (!isFinite(secs) || secs < 0) return '0:00.0';
  const m = Math.floor(secs / 60);
  const s = (secs % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

export default function PlaybackPanel({
  videoRef,
  vReady,
  currentTime,
  duration,
  cIn,
  cOut,
  setCIn,
  setCOut,
  onExtractClip,
  onCaptureFrame,
  clipBlob,
}) {
  const play  = useCallback(() => videoRef.current?.play(), [videoRef]);
  const pause = useCallback(() => videoRef.current?.pause(), [videoRef]);
  const skip  = useCallback((delta) => {
    if (videoRef.current) videoRef.current.currentTime += delta;
  }, [videoRef]);

  const setIn  = useCallback(() => {
    if (videoRef.current) setCIn(videoRef.current.currentTime);
  }, [videoRef, setCIn]);

  const setOut = useCallback(() => {
    if (videoRef.current) setCOut(videoRef.current.currentTime);
  }, [videoRef, setCOut]);

  const canExtract = vReady && (cIn !== null || cOut !== null);

  return (
    <div className="playback-panel">
      {/* Transport controls */}
      <div className="playback-controls">
        <button className="btn" onClick={() => skip(-1)} disabled={!vReady} title="–1s">«</button>
        <button className="btn" onClick={() => skip(-0.1)} disabled={!vReady} title="–0.1s">‹</button>
        <button className="btn btn-accent" onClick={play}  disabled={!vReady} title="Play">▶</button>
        <button className="btn" onClick={pause} disabled={!vReady} title="Pause">⏸</button>
        <button className="btn" onClick={() => skip(0.1)} disabled={!vReady} title="+0.1s">›</button>
        <button className="btn" onClick={() => skip(1)}   disabled={!vReady} title="+1s">»</button>
      </div>

      <div className="time-display">
        {fmt(currentTime)} / {fmt(duration)}
      </div>

      <div className="divider" />

      {/* In/Out range */}
      <div className="panel-title">Clip Range</div>
      <div className="range-row">
        <button className="btn" onClick={setIn} disabled={!vReady} title="Set In point (I)">
          Set In
        </button>
        <span className="range-val">{cIn !== null ? fmt(cIn) : '—'}</span>
      </div>
      <div className="range-row">
        <button className="btn" onClick={setOut} disabled={!vReady} title="Set Out point (O)">
          Set Out
        </button>
        <span className="range-val">{cOut !== null ? fmt(cOut) : '—'}</span>
      </div>

      <div className="range-row">
        <button
          className="btn btn-accent"
          style={{ flex: 1 }}
          onClick={onExtractClip}
          disabled={!canExtract}
          title="Extract clip between In and Out points"
        >
          Extract Clip
        </button>
        {cIn !== null && (
          <button className="btn" onClick={() => setCIn(null)} title="Clear In">✕</button>
        )}
        {cOut !== null && (
          <button className="btn" onClick={() => setCOut(null)} title="Clear Out">✕</button>
        )}
      </div>

      {clipBlob && (
        <div style={{ fontSize: 11, color: 'var(--green)' }}>
          ✓ Clip loaded ({(clipBlob.size / 1024 / 1024).toFixed(2)} MB)
        </div>
      )}

      <div className="divider" />

      {/* Frame capture */}
      <div className="panel-title">Frame</div>
      <button
        className="btn btn-accent"
        style={{ width: '100%' }}
        onClick={onCaptureFrame}
        disabled={!vReady}
        title="Capture current frame for annotation (C)"
      >
        Capture Frame
      </button>
    </div>
  );
}
