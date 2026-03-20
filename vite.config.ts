import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';

// Plugin to inject build hash into sw.js so browsers detect new versions
function swBuildHashPlugin() {
  return {
    name: 'sw-build-hash',
    writeBundle() {
      const swPath = path.resolve(__dirname, 'dist/sw.js');
      try {
        let sw = readFileSync(swPath, 'utf-8');
        const hash = createHash('md5').update(Date.now().toString()).digest('hex').slice(0, 8);
        sw = sw.replace('%%BUILD_HASH%%', hash);
        writeFileSync(swPath, sw);
      } catch { /* sw.js not in dist yet */ }
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), swBuildHashPlugin()],
    
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
