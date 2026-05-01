import React, { useRef, useEffect, useCallback } from 'react';

function fmt(secs) {
  if (!isFinite(secs) || secs < 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function Scrubber({
  videoRef,
  duration,
  /** When set, saved-track bands use this as the timeline length (e.g. full source) while playhead still uses `duration`. */
  trackRangeDuration,
  currentTime,
  cIn,
  cOut,
  onSetIn,
  onSetOut,
  onSeek,
  savedTrackRanges = [],
  activeJobId = null,
}) {
  const trackRef   = useRef(null);
  const dragState  = useRef(null); // { type: 'play' | 'in' | 'out' }

  const timeToFrac = useCallback((t) => {
    if (!duration) return 0;
    return Math.max(0, Math.min(1, t / duration));
  }, [duration]);

  const fracToTime = useCallback((frac, rect) => {
    const f = (frac - rect.left) / rect.width;
    return Math.max(0, Math.min(duration, f * duration));
  }, [duration]);

  const getTimeFromEvent = useCallback((e) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return fracToTime(e.clientX, rect);
  }, [fracToTime]);

  // Mouse handlers
  const handleTrackMouseDown = useCallback((e) => {
    e.preventDefault();
    const t = getTimeFromEvent(e);
    dragState.current = { type: 'play' };
    onSeek(t);
  }, [getTimeFromEvent, onSeek]);

  const handleInHandleMouseDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragState.current = { type: 'in' };
  }, []);

  const handleOutHandleMouseDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragState.current = { type: 'out' };
  }, []);

  useEffect(() => {
    function onMouseMove(e) {
      if (!dragState.current) return;
      const t = getTimeFromEvent(e);
      if (dragState.current.type === 'play') {
        onSeek(t);
      } else if (dragState.current.type === 'in') {
        onSetIn(Math.min(t, cOut !== null ? cOut - 0.1 : duration));
      } else if (dragState.current.type === 'out') {
        onSetOut(Math.max(t, cIn !== null ? cIn + 0.1 : 0));
      }
    }

    function onMouseUp() {
      dragState.current = null;
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [getTimeFromEvent, onSeek, onSetIn, onSetOut, cIn, cOut, duration]);

  const playFrac = timeToFrac(currentTime);
  const inFrac   = cIn  !== null ? timeToFrac(cIn)  : null;
  const outFrac  = cOut !== null ? timeToFrac(cOut) : null;

  const rangeScale =
    trackRangeDuration != null && trackRangeDuration > 0
      ? trackRangeDuration
      : duration;

  return (
    <div className="scrubber-container">
      <div
        className="scrubber-track"
        ref={trackRef}
        onMouseDown={handleTrackMouseDown}
      >
        {/* Saved tracks from manifest.json (per source video) */}
        {savedTrackRanges.map((seg) => {
          if (seg.start == null || seg.end == null || !rangeScale) return null;
          const a = Math.max(0, Math.min(1, seg.start / rangeScale));
          const b = Math.max(0, Math.min(1, seg.end / rangeScale));
          if (b <= a) return null;
          const isActive = activeJobId && seg.jobId === activeJobId;
          return (
            <div
              key={seg.jobId || `${seg.start}-${seg.end}`}
              className={`scrubber-track-saved ${isActive ? 'scrubber-track-saved-active' : ''}`}
              style={{
                left: `${a * 100}%`,
                width: `${(b - a) * 100}%`,
              }}
              title={`Tracked: ${fmt(seg.start)}–${fmt(seg.end)}${seg.jobId ? ` (${seg.jobId})` : ''}`}
            />
          );
        })}

        {/* In/Out range highlight */}
        {inFrac !== null && outFrac !== null && (
          <div
            className="scrubber-range"
            style={{
              left:  `${inFrac  * 100}%`,
              width: `${(outFrac - inFrac) * 100}%`,
            }}
          />
        )}

        {/* In handle */}
        {inFrac !== null && (
          <div
            className="scrubber-handle"
            style={{ left: `${inFrac * 100}%` }}
            onMouseDown={handleInHandleMouseDown}
            title={`In: ${fmt(cIn)}`}
          />
        )}

        {/* Out handle */}
        {outFrac !== null && (
          <div
            className="scrubber-handle out-handle"
            style={{ left: `${outFrac * 100}%` }}
            onMouseDown={handleOutHandleMouseDown}
            title={`Out: ${fmt(cOut)}`}
          />
        )}

        {/* Playhead */}
        <div
          className="scrubber-playhead"
          style={{ left: `${playFrac * 100}%` }}
        />
      </div>

      <div className="scrubber-time-labels">
        <span>{fmt(0)}</span>
        <span style={{ color: 'var(--accent)' }}>{fmt(currentTime)}</span>
        {inFrac  !== null && <span style={{ color: 'var(--accent)' }}>In {fmt(cIn)}</span>}
        {outFrac !== null && <span style={{ color: 'var(--accent2)' }}>Out {fmt(cOut)}</span>}
        <span>{fmt(duration)}</span>
      </div>
    </div>
  );
}
