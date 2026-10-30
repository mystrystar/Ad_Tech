import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'PORT');
  return {
    root: 'web',
    plugins: [react()],
    server: {
      port: 5173,
      host: '127.0.0.1',
      proxy: { '/api': `http://127.0.0.1:${env.PORT || 3001}` },
    },
    build: { outDir: '../dist', emptyOutDir: true },
  };
});
