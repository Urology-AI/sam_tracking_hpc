import React, { useState, useEffect, useCallback } from 'react';
import { apiBrowse } from '../api';
import { useApp } from '../AppContext';

const VIDEO_EXTS = new Set(['.mp4', '.avi', '.mov', '.mkv', '.webm', '.m4v']);

function isVideo(name) {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return false;
  return VIDEO_EXTS.has(name.slice(dot).toLowerCase());
}

/** Backend /browse uses type "video"; some paths may use "file". */
function isVideoEntry(entry) {
  if (entry.type === 'video') return true;
  return entry.type === 'file' && isVideo(entry.name);
}

function fmtSize(mb) {
  if (!mb && mb !== 0) return '';
  if (mb < 1) return `${(mb * 1024).toFixed(0)} KB`;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export default function FileBrowser({ selPath, onSelectFile }) {
  const { toast } = useApp();
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries]         = useState([]);
  const [parent, setParent]           = useState(null);
  const [loading, setLoading]         = useState(false);

  const browse = useCallback(async (path) => {
    setLoading(true);
    try {
      const data = await apiBrowse(path);
      setCurrentPath(data.current || path);
      setParent(data.parent || null);
      setEntries(data.entries || []);
    } catch (e) {
      toast(`Browse error: ${e.message}`, 'err');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    browse('');
  }, []);

  const handleClick = useCallback((entry) => {
    if (entry.type === 'dir') {
      browse(entry.path);
    } else if (isVideoEntry(entry)) {
      onSelectFile(entry.path);
    } else {
      toast('Not a supported video file', 'warn');
    }
  }, [browse, onSelectFile, toast]);

  return (
    <div className="file-browser">
      <div className="browser-path" title={currentPath}>
        {currentPath || '/'}
      </div>

      {loading && (
        <div className="loading-row">
          <span className="spinner" />
          <span>Loading…</span>
        </div>
      )}

      <div className="browser-list">
        {parent !== null && (
          <div
            className="browser-entry"
            onClick={() => browse(parent)}
          >
            <span className="browser-entry-icon">↩</span>
            <span className="browser-entry-name">..</span>
          </div>
        )}

        {entries.map((entry) => {
          const isVid = isVideoEntry(entry);
          const isSelected = isVid && selPath === entry.path;
          return (
            <div
              key={entry.path}
              className={`browser-entry ${isSelected ? 'selected' : ''}`}
              onClick={() => handleClick(entry)}
              title={entry.path}
            >
              <span className="browser-entry-icon">
                {entry.type === 'dir' ? '📁' : isVid ? '🎬' : '📄'}
              </span>
              <span className="browser-entry-name">{entry.name}</span>
              {isVid && (
                <span className="browser-entry-size">{fmtSize(entry.size_mb)}</span>
              )}
            </div>
          );
        })}

        {!loading && entries.length === 0 && (
          <div style={{ padding: '12px 10px', color: 'var(--text-dim)', fontSize: 12 }}>
            Empty directory
          </div>
        )}
      </div>
    </div>
  );
}
