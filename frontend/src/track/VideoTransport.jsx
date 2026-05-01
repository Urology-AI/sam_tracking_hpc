import React, { useCallback } from 'react';

function fmt(secs) {
  if (!isFinite(secs) || secs < 0) return '0:00.0';
  const m = Math.floor(secs / 60);
  const s = (secs % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

/** Play / pause / skip + time + capture — under the video, above the scrubber. */
export default function VideoTransport({
  videoRef,
  vReady,
  currentTime,
  duration,
  onCaptureFrame,
}) {
  const play  = useCallback(() => videoRef.current?.play(), [videoRef]);
  const pause = useCallback(() => videoRef.current?.pause(), [videoRef]);
  const skip  = useCallback((delta) => {
    if (videoRef.current) videoRef.current.currentTime += delta;
  }, [videoRef]);

  return (
    <div className="video-transport-bar">
      <div className="playback-controls">
        <button className="btn" onClick={() => skip(-1)} disabled={!vReady} title="–1s">«</button>
        <button className="btn" onClick={() => skip(-0.1)} disabled={!vReady} title="–0.1s">‹</button>
        <button className="btn btn-accent" onClick={play} disabled={!vReady} title="Play">▶</button>
        <button className="btn" onClick={pause} disabled={!vReady} title="Pause">⏸</button>
        <button className="btn" onClick={() => skip(0.1)} disabled={!vReady} title="+0.1s">›</button>
        <button className="btn" onClick={() => skip(1)} disabled={!vReady} title="+1s">»</button>
      </div>
      <div className="video-transport-right">
        <div className="time-display video-transport-time">
          {fmt(currentTime)} / {fmt(duration)}
        </div>
        <button
          type="button"
          className="btn btn-accent video-transport-capture"
          onClick={onCaptureFrame}
          disabled={!vReady}
          title="Capture current frame for annotation (C)"
        >
          Capture frame
        </button>
      </div>
    </div>
  );
}
