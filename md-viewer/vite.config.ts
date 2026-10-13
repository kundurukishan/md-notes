import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset paths so the built app loads from file:// inside Electron.
  base: './',
  plugins: [react()],
  // 5174 so MD Notes (5173) and MD Viewer can run side by side.
  server: { port: 5174, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
