import React, { useState } from 'react';
import { AppProvider } from './AppContext';
import TopBar from './TopBar';
import Toast from './Toast';
import TrackPage from './track/TrackPage';
import CuratePage from './curate/CuratePage';

export default function App() {
  const [page, setPage] = useState('track');

  return (
    <AppProvider>
      <div className="app-root">
        <TopBar page={page} setPage={setPage} />
        <div className="app-body">
          {page === 'track' ? <TrackPage /> : <CuratePage />}
        </div>
        <Toast />
      </div>
    </AppProvider>
  );
}
