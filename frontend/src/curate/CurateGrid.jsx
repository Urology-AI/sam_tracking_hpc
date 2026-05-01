import React, { useState, useCallback } from 'react';
import { frameUrl, maskUrl, overlayFrameUrl } from '../api';
import PreviewModal from '../modals/PreviewModal';

const DEFAULT_ALPHA = 0.45;
const DEFAULT_COLOR = '#4facde';

function getImageUrl(jobId, frame, viewMode) {
  if (viewMode === 'frame') return frameUrl(jobId, frame.frame);
  if (viewMode === 'mask')  return maskUrl(jobId, frame.mask);
  // overlay
  if (!frame.has_mask) return frameUrl(jobId, frame.frame);
  return overlayFrameUrl(
    jobId,
    frame.frame,
    frame.mask,
    DEFAULT_ALPHA,
    DEFAULT_COLOR,
    false
  );
}

export default function CurateGrid({
  frames,
  jobId,
  viewMode,
  included,
  excluded,
  onToggle,
}) {
  const [preview, setPreview] = useState(null); // { url, title }

  const handlePreview = useCallback((e, frame) => {
    e.stopPropagation();
    const url   = getImageUrl(jobId, frame, viewMode);
    const title = `Frame ${frame.original_frame_idx}`;
    setPreview({ url, title });
  }, [jobId, viewMode]);

  const closePreview = useCallback(() => setPreview(null), []);

  if (!frames || frames.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">📂</div>
        <div>No frames to display.</div>
      </div>
    );
  }

  return (
    <>
      <div className="curate-grid-wrap">
        <div className="curate-grid">
          {frames.map((frame) => {
            const isIncluded = included.has(frame.idx);
            const isExcluded = excluded.has(frame.idx);
            const statusClass = isExcluded
              ? 'excluded'
              : isIncluded
                ? 'included'
                : '';

            const imgUrl = getImageUrl(jobId, frame, viewMode);

            return (
              <div
                key={frame.idx}
                className={`frame-card ${statusClass}`}
                onClick={() => onToggle(frame.idx)}
                title={`Frame ${frame.original_frame_idx} — click to toggle`}
              >
                <img
                  src={imgUrl}
                  alt={`frame ${frame.original_frame_idx}`}
                  loading="lazy"
                />
                <div className="frame-card-label">
                  <span>#{frame.original_frame_idx}</span>
                  <button
                    className="frame-card-preview"
                    onClick={(e) => handlePreview(e, frame)}
                    title="Preview full size"
                  >
                    ⛶
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {preview && (
        <PreviewModal
          imageUrl={preview.url}
          title={preview.title}
          onClose={closePreview}
        />
      )}
    </>
  );
}
