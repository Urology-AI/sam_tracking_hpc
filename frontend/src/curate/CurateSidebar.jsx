import React, { useState, useCallback, useEffect } from 'react';
import { useApp } from '../AppContext';
import { apiSavePairs, apiCreateProject } from '../api';

export default function CurateSidebar({
  jobId,
  manifest,
  included,
  excluded,
  shownCount,
  includedCount,
  excludedCount,
}) {
  const { curProj, setCurProj, projects, loadProjects, toast } = useApp();
  const [prefix, setPrefix]           = useState('');
  const [saving, setSaving]           = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const [creating, setCreating]       = useState(false);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleSave = useCallback(async () => {
    if (!jobId) {
      toast('No active job', 'warn');
      return;
    }
    if (!curProj) {
      toast('Select a project first', 'warn');
      return;
    }
    if (included.size === 0) {
      toast('No frames selected to save', 'warn');
      return;
    }

    setSaving(true);
    try {
      const frameIndices = [...included].sort((a, b) => a - b);
      const result = await apiSavePairs(jobId, curProj, frameIndices, prefix);
      toast(`Saved ${result.saved} pairs to "${curProj}" (total: ${result.total_in_project})`, 'ok');
    } catch (e) {
      toast(`Save failed: ${e.message}`, 'err');
    } finally {
      setSaving(false);
    }
  }, [jobId, curProj, included, prefix, toast]);

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

  return (
    <div className="curate-sidebar">
      {/* Project selector */}
      <div>
        <div className="panel-title">Project</div>
        <select
          className="select"
          style={{ width: '100%', marginBottom: 8 }}
          value={curProj || ''}
          onChange={e => setCurProj(e.target.value || null)}
        >
          <option value="">— select project —</option>
          {projects.map(p => (
            <option key={p.name} value={p.name}>
              {p.name} ({p.n_pairs})
            </option>
          ))}
        </select>

        <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="New project…"
            value={newProjName}
            onChange={e => setNewProjName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreateProject()}
          />
          <button
            className="btn"
            onClick={handleCreateProject}
            disabled={!newProjName.trim() || creating}
          >
            {creating ? <span className="spinner" /> : '+'}
          </button>
        </div>
      </div>

      <div className="divider" />

      {/* Filename prefix */}
      <div>
        <div className="panel-title">Filename Prefix</div>
        <input
          className="input"
          style={{ width: '100%' }}
          placeholder="e.g. case001_"
          value={prefix}
          onChange={e => setPrefix(e.target.value)}
        />
      </div>

      <div className="divider" />

      {/* Counts */}
      <div>
        <div className="panel-title">Stats</div>
        <div className="stats-block">
          <div className="stat-row">
            <span className="stat-label">Total frames</span>
            <span className="stat-val">{manifest?.n_frames ?? '—'}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Shown</span>
            <span className="stat-val">{shownCount}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Included</span>
            <span className="stat-val green">{includedCount}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Excluded</span>
            <span className="stat-val red">{excludedCount}</span>
          </div>
        </div>
      </div>

      <div className="divider" />

      {/* Save buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          className="btn btn-green"
          style={{ width: '100%' }}
          onClick={handleSave}
          disabled={saving || !jobId || !curProj || included.size === 0}
        >
          {saving ? (
            <><span className="spinner" /> Saving…</>
          ) : (
            `Save ${included.size} pairs`
          )}
        </button>

        {!curProj && (
          <div style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center' }}>
            Select a project to enable saving
          </div>
        )}
      </div>
    </div>
  );
}
