import React, { useCallback } from 'react';

function fmt(secs) {
  if (!isFinite(secs) || secs < 0) return '0:00.0';
  const m = Math.floor(secs / 60);
  const s = (secs % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

export function ClipRangeSidebar({
  videoRef,
  vReady,
  cIn,
  cOut,
  setCIn,
  setCOut,
  onExtractClip,
  clipBlob,
}) {
  const setIn = useCallback(() => {
    if (videoRef.current) setCIn(videoRef.current.currentTime);
  }, [videoRef, setCIn]);

  const setOut = useCallback(() => {
    if (videoRef.current) setCOut(videoRef.current.currentTime);
  }, [videoRef, setCOut]);

  const canExtract = vReady && (cIn !== null || cOut !== null);

  return (
    <div className="playback-panel playback-panel-sidebar playback-panel-clip">
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
    </div>
  );
}

export default function PlaybackPanel(props) {
  return <ClipRangeSidebar {...props} />;
}
