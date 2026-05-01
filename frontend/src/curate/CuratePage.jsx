import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useApp } from '../AppContext';
import { apiManifest } from '../api';
import CurateGrid from './CurateGrid';
import CurateSidebar from './CurateSidebar';

const RATE_OPTIONS = [
  { label: 'All',    value: 0 },
  { label: '0.25fps', value: 0.25 },
  { label: '0.5fps',  value: 0.5 },
  { label: '1fps',    value: 1 },
  { label: '2fps',    value: 2 },
  { label: '5fps',    value: 5 },
  { label: '10fps',   value: 10 },
];

export default function CuratePage() {
  const { curJob, toast } = useApp();

  const [manifest, setManifest]       = useState(null);
  const [loadingManifest, setLoadingManifest] = useState(false);
  const [sampleRate, setSampleRate]   = useState(0);
  const [viewMode, setViewMode]       = useState('overlay'); // 'frame' | 'mask' | 'overlay'
  const [customRate, setCustomRate]   = useState('');
  const [included, setIncluded]       = useState(new Set()); // indices into manifest.frames
  const [excluded, setExcluded]       = useState(new Set());

  // Load manifest when job changes
  useEffect(() => {
    if (!curJob) {
      setManifest(null);
      return;
    }
    setLoadingManifest(true);
    apiManifest(curJob)
      .then(data => {
        setManifest(data);
        // By default, include all frames that have a mask
        const inc = new Set(data.frames.filter(f => f.has_mask).map(f => f.idx));
        setIncluded(inc);
        setExcluded(new Set());
      })
      .catch(e => toast(`Manifest error: ${e.message}`, 'err'))
      .finally(() => setLoadingManifest(false));
  }, [curJob, toast]);

  // Apply rate filtering to frames
  const filteredFrames = useMemo(() => {
    if (!manifest) return [];
    const frames = manifest.frames;
    if (!sampleRate) return frames;

    const vidFps   = manifest.vid_fps || 30;
    const interval = vidFps / sampleRate; // frames between samples
    return frames.filter((f, i) => {
      // Sample from the original frame index
      return Math.round(f.original_frame_idx % interval) < 1 || i === 0;
    });
  }, [manifest, sampleRate]);

  const effectiveRate = useMemo(() => {
    if (customRate && parseFloat(customRate) > 0) return parseFloat(customRate);
    return sampleRate;
  }, [sampleRate, customRate]);

  const effectiveFrames = useMemo(() => {
    if (!manifest) return [];
    const frames = manifest.frames;
    if (!effectiveRate) return frames;

    const vidFps   = manifest.vid_fps || 30;
    const interval = vidFps / effectiveRate;
    return frames.filter((f) => {
      return f.original_frame_idx % interval < 1;
    });
  }, [manifest, effectiveRate]);

  // Select / deselect all visible frames
  const handleSelectAll = useCallback(() => {
    setIncluded(new Set(effectiveFrames.map(f => f.idx)));
    setExcluded(new Set());
  }, [effectiveFrames]);

  const handleDeselectAll = useCallback(() => {
    setIncluded(new Set());
  }, []);

  const handleExcludeSelected = useCallback(() => {
    setExcluded(prev => {
      const next = new Set(prev);
      effectiveFrames.forEach(f => {
        if (included.has(f.idx)) next.add(f.idx);
      });
      return next;
    });
    setIncluded(prev => {
      const next = new Set(prev);
      effectiveFrames.forEach(f => next.delete(f.idx));
      return next;
    });
  }, [effectiveFrames, included]);

  const handleRestoreAll = useCallback(() => {
    setExcluded(new Set());
    if (manifest) {
      setIncluded(new Set(manifest.frames.filter(f => f.has_mask).map(f => f.idx)));
    }
  }, [manifest]);

  const toggleFrame = useCallback((idx) => {
    setIncluded(prev => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
        setExcluded(e => { const ne = new Set(e); ne.delete(idx); return ne; });
      }
      return next;
    });
  }, []);

  const shownCount    = effectiveFrames.length;
  const includedCount = [...included].filter(i =>
    effectiveFrames.some(f => f.idx === i)
  ).length;
  const excludedCount = [...excluded].filter(i =>
    effectiveFrames.some(f => f.idx === i)
  ).length;

  return (
    <div className="curate-page">
      <div className="curate-main">
        {/* Toolbar */}
        <div className="curate-toolbar">
          <div className="curate-job-id">
            Job: <span>{curJob || '—'}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="label">Sample rate</span>
            <select
              className="select"
              value={sampleRate}
              onChange={e => {
                setSampleRate(parseFloat(e.target.value));
                setCustomRate('');
              }}
            >
              {RATE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <input
              className="input"
              placeholder="custom fps"
              value={customRate}
              onChange={e => setCustomRate(e.target.value)}
              style={{ width: 80 }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {['frame', 'mask', 'overlay'].map(v => (
              <button
                key={v}
                className={`mode-btn ${viewMode === v ? 'active' : ''}`}
                onClick={() => setViewMode(v)}
              >
                {v}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="btn" onClick={handleSelectAll}>Select all</button>
            <button className="btn" onClick={handleDeselectAll}>Deselect</button>
            <button className="btn btn-danger" onClick={handleExcludeSelected}>
              Exclude selected
            </button>
            <button className="btn btn-warn" onClick={handleRestoreAll}>
              Restore all
            </button>
          </div>
        </div>

        {/* Main grid */}
        {!curJob && (
          <div className="empty-state">
            <div className="empty-state-icon">🎬</div>
            <div>No tracking job selected.</div>
            <div style={{ fontSize: 12 }}>Run SAM2 on the Track page first.</div>
          </div>
        )}

        {curJob && loadingManifest && (
          <div className="loading-row" style={{ justifyContent: 'center', padding: 40 }}>
            <span className="spinner" />
            <span>Loading manifest…</span>
          </div>
        )}

        {curJob && !loadingManifest && manifest && (
          <CurateGrid
            frames={effectiveFrames}
            jobId={curJob}
            viewMode={viewMode}
            included={included}
            excluded={excluded}
            onToggle={toggleFrame}
          />
        )}
      </div>

      <CurateSidebar
        jobId={curJob}
        manifest={manifest}
        included={included}
        excluded={excluded}
        shownCount={shownCount}
        includedCount={includedCount}
        excludedCount={excludedCount}
      />
    </div>
  );
}
