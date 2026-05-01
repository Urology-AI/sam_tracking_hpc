import React, { useState, useEffect } from 'react';

export default function FirstMaskModal({ imageUrl, onApprove, onDiscard }) {
  const [imgStatus, setImgStatus] = useState('loading'); // 'loading' | 'ok' | 'error'

  useEffect(() => {
    setImgStatus('loading');
  }, [imageUrl]);

  function handleKeyDown(e) {
    if (e.key === 'Escape') onDiscard();
    if (e.key === 'Enter')  onApprove();
  }

  return (
    <div
      className="modal-backdrop first-mask-modal"
      onClick={(e) => { if (e.target === e.currentTarget) onDiscard(); }}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="modal" style={{ maxWidth: 720 }}>
        <div className="modal-header">
          <span className="modal-title">Review First Frame Mask</span>
          <button className="modal-close" onClick={onDiscard} title="Discard (Esc)">✕</button>
        </div>

        <div className="modal-body">
          <p style={{ color: 'var(--text-dim)', fontSize: 12, marginBottom: 12 }}>
            Check that SAM2 correctly segmented the object of interest in the first frame.
            Approve to keep the tracking result, or discard to adjust your annotation and retry.
          </p>

          {imgStatus === 'loading' && (
            <div className="loading-row" style={{ justifyContent: 'center', padding: 30 }}>
              <span className="spinner" />
              <span>Loading first frame overlay…</span>
            </div>
          )}

          {imgStatus === 'error' && (
            <div className="first-mask-warning">
              <span>⚠</span>
              <span>
                Could not load first-frame overlay (no mask on frame 0?).
                You can still approve to view the full result.
              </span>
            </div>
          )}

          <img
            className="first-mask-img"
            src={imageUrl}
            alt="First frame mask overlay"
            style={{ display: imgStatus === 'error' ? 'none' : 'block' }}
            onLoad={() => setImgStatus('ok')}
            onError={() => setImgStatus('error')}
          />
        </div>

        <div className="modal-footer">
          <button
            className="btn btn-danger"
            onClick={onDiscard}
            title="Discard result and try again (Esc)"
          >
            Discard — try again
          </button>
          <button
            className="btn btn-green"
            onClick={onApprove}
            title="Approve and save result (Enter)"
          >
            Mask looks good — proceed
          </button>
        </div>
      </div>
    </div>
  );
}
