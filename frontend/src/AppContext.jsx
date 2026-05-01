import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { apiGetProjects } from './api';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [curJob, setCurJob] = useState(null);
  const [curProj, setCurProj] = useState(null);
  const [projects, setProjects] = useState([]);
  const [toastMsg, setToastMsg] = useState(null);
  const toastTimer = useRef(null);

  const loadProjects = useCallback(async () => {
    try {
      const data = await apiGetProjects();
      setProjects(data.projects || []);
    } catch (e) {
      console.error('Failed to load projects:', e);
    }
  }, []);

  const toast = useCallback((message, type = '', duration = 3000) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastMsg({ message, type });
    toastTimer.current = setTimeout(() => setToastMsg(null), duration);
  }, []);

  const value = {
    curJob,
    setCurJob,
    curProj,
    setCurProj,
    projects,
    loadProjects,
    toast,
    toastMsg,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
