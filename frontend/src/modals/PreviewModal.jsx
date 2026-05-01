import React, { useEffect } from 'react';

export default function PreviewModal({ imageUrl, title, onClose }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!imageUrl) return null;

  return (
    <div
      className="modal-backdrop preview-modal"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal" style={{ maxWidth: 960 }}>
        <div className="modal-header">
          <span className="modal-title">{title || 'Frame Preview'}</span>
          <button className="modal-close" onClick={onClose} title="Close (Esc)">✕</button>
        </div>
        <div className="modal-body" style={{ padding: 12 }}>
          <img
            src={imageUrl}
            alt={title || 'frame preview'}
            style={{ width: '100%', borderRadius: 'var(--r)', display: 'block' }}
          />
        </div>
      </div>
    </div>
  );
}
