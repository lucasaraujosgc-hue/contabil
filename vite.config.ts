import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
  server: {
    // `npm run dev` (Vite :5173) encaminha as chamadas de API para o Express (:3000).
    proxy: {
      '/api': { target: `http://localhost:${process.env.PORT || 3000}`, changeOrigin: true },
    },
  },
});
