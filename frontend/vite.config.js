import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/health': 'http://localhost:8892',
      '/browse': 'http://localhost:8892',
      '/video': 'http://localhost:8892',
      '/clip': 'http://localhost:8892',
      '/track': 'http://localhost:8892',
      '/track_brush': 'http://localhost:8892',
      '/track_result': 'http://localhost:8892',
      '/projects': 'http://localhost:8892',
      '/save_pairs': 'http://localhost:8892',
    },
  },
});
