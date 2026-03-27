import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';

// Single build hash shared across sw.js, index.html, and JS define
const buildHash = createHash('md5').update(Date.now().toString()).digest('hex').slice(0, 8);

// Plugin to inject build hash into sw.js and index.html so browsers detect new versions
function swBuildHashPlugin() {
  return {
    name: 'sw-build-hash',
    writeBundle() {
      // Replace in sw.js
      const swPath = path.resolve(__dirname, 'dist/sw.js');
      try {
        let sw = readFileSync(swPath, 'utf-8');
        sw = sw.replace('%%BUILD_HASH%%', buildHash);
        writeFileSync(swPath, sw);
      } catch { /* sw.js not in dist yet */ }
      // Replace in index.html (cache purge script)
      const htmlPath = path.resolve(__dirname, 'dist/index.html');
      try {
        let html = readFileSync(htmlPath, 'utf-8');
        html = html.replace('%%BUILD_HASH%%', buildHash);
        writeFileSync(htmlPath, html);
      } catch { /* index.html not in dist yet */ }
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));
  return {
    plugins: [react(), tailwindcss(), swBuildHashPlugin()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __BUILD_HASH__: JSON.stringify(buildHash),
    },
    
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      allowedHosts: [
      'web.dev.dora.restry.cn','dev.dora.restry.cn'],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'motion': ['motion/react'],
            'markdown': ['react-markdown'],
            'highlight': ['highlight.js/lib/core'],
          },
        },
      },
    },
  };
});
