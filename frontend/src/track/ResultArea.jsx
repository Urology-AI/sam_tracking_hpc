import React from 'react';
import { overlayVideoUrl } from '../api';
import { useApp } from '../AppContext';

export default function ResultArea({ jobId, inferConfig }) {
  const { setCurJob } = useApp();
  const videoSrc = overlayVideoUrl(jobId);

  return (
    <div className="result-area">
      <div className="panel-title">Result — {jobId}</div>

      <video
        className="result-video"
        src={videoSrc}
        controls
        loop
        playsInline
        style={{ maxHeight: 220 }}
      />

      <div className="result-actions">
        <a
          className="btn btn-accent"
          href={videoSrc}
          download={`overlay_${jobId}.mp4`}
          target="_blank"
          rel="noreferrer"
        >
          Download
        </a>
        <button
          className="btn"
          onClick={() => setCurJob(null)}
          title="Clear result"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
