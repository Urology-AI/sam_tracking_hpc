import React from 'react';
import { useApp } from './AppContext';

export default function Toast() {
  const { toastMsg } = useApp();

  if (!toastMsg) return null;

  return (
    <div className="toast-container">
      <div className={`toast ${toastMsg.type || ''}`}>
        {toastMsg.type === 'ok'   && <span>✓</span>}
        {toastMsg.type === 'err'  && <span>✕</span>}
        {toastMsg.type === 'warn' && <span>⚠</span>}
        <span>{toastMsg.message}</span>
      </div>
    </div>
  );
}
