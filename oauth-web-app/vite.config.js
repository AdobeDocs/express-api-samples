import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';
import { startBackend } from './middleware.js';

const BACKEND_PORT = 4001;
const backendTarget = {
  target: `http://127.0.0.1:${BACKEND_PORT}`,
  changeOrigin: true,
  xfwd: true, // forward X-Forwarded-Proto: https so secure session cookies work
};

export default defineConfig({
  root: 'src',
  // Load .env from the project root (next to vite.config.js / middleware.js),
  // not from `root` (which would be ./src). This way both the Node backend
  // (via dotenv) and the Vite client (via import.meta.env) read the same file.
  envDir: '.',
  server: {
    https: true,
    port: 4000,
    proxy: {
      '/login': backendTarget,
      '/callback': backendTarget,
      '/logout': backendTarget,
      '/api': backendTarget,
      '/debug': backendTarget,
    },
  },
  build: {
    outDir: '../dist',
  },
  plugins: [
    mkcert(),
    {
      name: 'oauth-backend',
      configureServer() {
        const server = startBackend(BACKEND_PORT);
        const close = () => server.close();
        process.once('exit', close);
        process.once('SIGINT', () => { close(); process.exit(0); });
        process.once('SIGTERM', () => { close(); process.exit(0); });
      },
    },
  ],
});
