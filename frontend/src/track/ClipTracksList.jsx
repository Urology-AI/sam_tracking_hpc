import React from 'react';

function fmt(secs) {
  if (!isFinite(secs) || secs < 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function ClipTracksList({
  duration,
  tracks,
  pendingRange,
  currentJobId,
  onPendingClick,
  onTrackClick,
  hasClipBlob,
}) {
  const showPending = hasClipBlob && pendingRange &&
    isFinite(pendingRange.start) && isFinite(pendingRange.end);

  if (!showPending && (!tracks || tracks.length === 0)) {
    return (
      <div className="clip-tracks-list clip-tracks-empty">
        <div className="clip-tracks-title">Clips & tracks</div>
        <div className="clip-tracks-hint">
          Extract a clip to work here. Finished tracks for this video appear from server manifest JSON.
        </div>
      </div>
    );
  }

  return (
    <div className="clip-tracks-list">
      <div className="clip-tracks-title">Clips & tracks</div>
      <div className="clip-tracks-scroll">
        {showPending && (
          <button
            type="button"
            className="clip-track-row clip-track-row-pending"
            onClick={() => onPendingClick?.()}
          >
            <span className="clip-track-badge">Current</span>
            <span className="clip-track-range">
              {fmt(pendingRange.start)} → {fmt(pendingRange.end)}
            </span>
            <span className="clip-track-meta">clip loaded — run tracking to save</span>
          </button>
        )}
        {(tracks || []).map((t) => {
          const cs = t.clip_start_sec;
          const ce = t.clip_end_sec;
          if (cs == null || ce == null) return null;
          const active = currentJobId && t.job_id === currentJobId;
          return (
            <button
              key={t.job_id}
              type="button"
              className={`clip-track-row ${active ? 'clip-track-row-active' : ''}`}
              onClick={() => onTrackClick?.(cs, ce)}
            >
              <span className="clip-track-badge job">Track</span>
              <span className="clip-track-range">
                {fmt(cs)} → {fmt(ce)}
              </span>
              <span className="clip-track-meta">
                {t.job_id}
                {t.n_frames != null ? ` · ${t.n_frames} fr` : ''}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
