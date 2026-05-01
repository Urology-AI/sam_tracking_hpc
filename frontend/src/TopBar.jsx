import React, { useEffect, useState } from 'react';
import { apiHealth } from './api';
import { useApp } from './AppContext';

export default function TopBar({ page, setPage }) {
  const { curJob } = useApp();
  const [health, setHealth] = useState(null);

  useEffect(() => {
    apiHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const serverOk = health && health.status === 'ok';

  return (
    <header className="topbar">
      <div className="topbar-logo">
        SAM<span>2</span>
      </div>

      <nav className="topbar-nav">
        <button
          className={page === 'track' ? 'active' : ''}
          onClick={() => setPage('track')}
        >
          Track
        </button>
        <button
          className={page === 'curate' ? 'active' : ''}
          onClick={() => setPage('curate')}
        >
          Curate
        </button>
      </nav>

      <div className="topbar-status">
        <div className={`status-dot ${health === null ? '' : serverOk ? 'ok' : 'err'}`} />
        {health === null && <span>Connecting…</span>}
        {health !== null && !serverOk && <span>Server error</span>}
        {serverOk && (
          <>
            <span>{health.device || 'cpu'}</span>
            {health.sam2_loaded && <span style={{ color: 'var(--green)' }}>SAM2 loaded</span>}
          </>
        )}
        {curJob && (
          <span style={{ color: 'var(--accent)', marginLeft: 8 }}>
            job: {curJob.slice(0, 8)}…
          </span>
        )}
      </div>
    </header>
  );
}
