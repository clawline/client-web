import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

// Use git short commit hash as build identifier so versions map to code
let buildHash: string;
try {
  buildHash = execSync('git rev-parse --short=8 HEAD', { encoding: 'utf-8' }).trim();
} catch {
  buildHash = 'unknown';
}

// Auto-increment patch version: 0.2.<commit count>
let appVersion: string;
try {
  const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));
  const [major, minor] = pkg.version.split('.').map(Number);
  const commitCount = parseInt(execSync('git rev-list --count HEAD', { encoding: 'utf-8' }).trim(), 10);
  appVersion = `${major}.${minor}.${commitCount}`;
} catch {
  appVersion = '0.2.0';
}

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
  return {
    plugins: [react(), tailwindcss(), swBuildHashPlugin()],
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
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
