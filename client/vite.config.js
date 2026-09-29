import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.API_URL || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true, // if 5173 is busy, another copy is running: stop it instead of silently using 5174
    host: true, // lets phones on the same Wi-Fi open the app for the live demo
    proxy: {
      '/api': API,
      '/socket.io': { target: API, ws: true },
    },
  },
});
