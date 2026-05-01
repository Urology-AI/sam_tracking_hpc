import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/** Where the FastAPI server is reachable from the machine running Vite (not from the browser). */
const defaultApiTarget = 'http://127.0.0.1:8892';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Shell must export VAR for children, or use VAR=value npm run dev on one line.
  // .env.development sets SAM2_DEV_API without needing export.
  const target =
    process.env.SAM2_DEV_API?.trim() ||
    env.SAM2_DEV_API?.trim() ||
    defaultApiTarget;

  const proxy = {
    '/health': target,
    '/browse': target,
    '/video': target,
    '/clip': target,
    '/track': target,
    '/track_brush': target,
    '/track_result': target,
    '/projects': target,
    '/save_pairs': target,
    '/tracks_for_video': target,
  };

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy,
    },
  };
});
