import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../AppContext';
import { apiGetProjects, apiCreateProject } from '../api';

const FPS_OPTIONS = [
  { label: 'All frames', value: 0 },
  { label: '0.25 fps',   value: 0.25 },
  { label: '0.5 fps',    value: 0.5 },
  { label: '1 fps',      value: 1 },
  { label: '2 fps',      value: 2 },
  { label: '5 fps',      value: 5 },
  { label: '10 fps',     value: 10 },
];

export default function InferencePanel({
  inferConfig,
  setInferConfig,
  bbox,
  brushHasContent,
  clipBlob,
  isRunning,
  onRunSam2,
}) {
  const { curProj, setCurProj, projects, loadProjects, toast } = useApp();
  const [newProjName, setNewProjName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleCreateProject = useCallback(async () => {
    const name = newProjName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await apiCreateProject(name);
      await loadProjects();
      setCurProj(name);
      setNewProjName('');
      toast(`Project "${name}" created`, 'ok');
    } catch (e) {
      toast(`Create failed: ${e.message}`, 'err');
    } finally {
      setCreating(false);
    }
  }, [newProjName, loadProjects, setCurProj, toast]);

  const set = useCallback((key, val) => {
    setInferConfig(c => ({ ...c, [key]: val }));
  }, [setInferConfig]);

  const canRun = clipBlob && (bbox !== null || brushHasContent) && !isRunning;

  return (
    <div className="inference-panel">
      {/* Project selector */}
      <div className="project-section">
        <div className="panel-title">Project</div>
        <select
          className="select"
          value={curProj || ''}
          onChange={e => setCurProj(e.target.value || null)}
        >
          <option value="">— select project —</option>
          {projects.map(p => (
            <option key={p.name} value={p.name}>
              {p.name} ({p.n_pairs} pairs)
            </option>
          ))}
        </select>

        <div className="project-create-row">
          <input
            className="input"
            placeholder="New project name…"
            value={newProjName}
            onChange={e => setNewProjName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreateProject()}
          />
          <button
            className="btn btn-accent"
            onClick={handleCreateProject}
            disabled={!newProjName.trim() || creating}
          >
            {creating ? <span className="spinner" /> : '+'}
          </button>
        </div>
      </div>

      <div className="divider" />

      {/* Bounding box display */}
      <div>
        <div className="panel-title">Bounding Box</div>
        <div className="bbox-display">
          {bbox ? (
            <div className="bbox-vals">
              x1:{bbox.x1} y1:{bbox.y1} x2:{bbox.x2} y2:{bbox.y2}
            </div>
          ) : (
            <span>No box drawn</span>
          )}
          {brushHasContent && (
            <div style={{ color: 'var(--green)', marginTop: 4, fontSize: 11 }}>
              Brush mask painted
            </div>
          )}
        </div>
      </div>

      <div className="divider" />

      {/* Inference config */}
      <div>
        <div className="panel-title">Inference Config</div>

        <div className="config-row">
          <span className="label">Sample FPS</span>
          <select
            className="select"
            value={inferConfig.sampleFps}
            onChange={e => set('sampleFps', parseFloat(e.target.value))}
          >
            {FPS_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="config-row" style={{ marginTop: 8 }}>
          <span className="label">Mask Alpha</span>
          <input
            type="range"
            min="0" max="1" step="0.05"
            value={inferConfig.alpha}
            onChange={e => set('alpha', parseFloat(e.target.value))}
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: 12, minWidth: 32, textAlign: 'right' }}>
            {inferConfig.alpha.toFixed(2)}
          </span>
        </div>

        <div className="config-row" style={{ marginTop: 8 }}>
          <span className="label">Mask Color</span>
          <input
            type="color"
            className="color-swatch"
            value={inferConfig.color}
            onChange={e => set('color', e.target.value)}
          />
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            {inferConfig.color}
          </span>
        </div>

        <div className="checkbox-row" style={{ marginTop: 10 }}>
          <input
            type="checkbox"
            id="draw-box-chk"
            checked={inferConfig.drawBox}
            onChange={e => set('drawBox', e.target.checked)}
          />
          <label htmlFor="draw-box-chk" style={{ fontSize: 12, cursor: 'pointer' }}>
            Draw bounding box on output
          </label>
        </div>
      </div>

      <div className="divider" />

      {/* Run button */}
      <button
        className={`btn run-btn ${canRun ? 'btn-green' : ''}`}
        onClick={onRunSam2}
        disabled={!canRun}
      >
        {isRunning ? (
          <>
            <span className="spinner" />
            Running SAM2…
          </>
        ) : (
          'Run SAM2 Tracking'
        )}
      </button>

      {!clipBlob && (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center' }}>
          Extract a clip first
        </div>
      )}
      {clipBlob && !bbox && !brushHasContent && (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center' }}>
          Capture a frame and draw a box or brush mask
        </div>
      )}
    </div>
  );
}
