# Clawline Desktop

A Tauri 2 wrapper around the Clawline web client. Runs in the background, sends native OS notifications, auto-updates from GitHub Releases.

## Why Tauri (not Electron)

| | Tauri 2 | Electron |
|--|--|--|
| Bundle size | ~10-20 MB | 100-200 MB |
| Memory | 30-80 MB | 200-500 MB |
| WebView | System (WebKit / WebView2 / WebKitGTK) | Bundled Chromium |
| Backend | Rust | Node.js |

## Development

```bash
# Install Rust toolchain (one time)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Tauri CLI (already in package.json)
npm install

# Run desktop app in dev mode (loads http://localhost:4026)
npm run tauri:dev
```

## Building locally

```bash
TAURI_SIGNING_PRIVATE_KEY="$(cat src-tauri/.tauri-updater.key)" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
  npm run tauri:build
```

Outputs:
- macOS: `src-tauri/target/release/bundle/dmg/Clawline_*.dmg`
- Windows: `src-tauri/target/release/bundle/nsis/Clawline_*-setup.exe`
- Linux: `src-tauri/target/release/bundle/appimage/Clawline_*.AppImage`

## Releasing

The `release-desktop.yml` workflow runs on tag push:

```bash
git tag desktop-v0.1.0
git push origin desktop-v0.1.0
```

This builds for macOS (arm64 + x86_64), Windows, and Linux, then creates a draft GitHub Release with all installers + the `latest.json` updater manifest.

### Required GitHub secrets

Set these in repo Settings → Secrets:

- `TAURI_SIGNING_PRIVATE_KEY` — contents of `src-tauri/.tauri-updater.key` (the **private** key, kept locally)
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — empty string if no password

## Unsigned distribution — how users install

We don't have Apple Developer ID or Windows code signing certs. Here's how users get past the OS warnings:

### macOS

The `.dmg` is **ad-hoc signed** (`signingIdentity: "-"` in tauri.conf.json), so it bundles cleanly but isn't notarized.

User experience on first launch:
1. Open the `.dmg`, drag `Clawline.app` to Applications
2. **Right-click** `Clawline.app` → **Open** → click **Open** in the warning dialog (regular double-click won't work — Gatekeeper blocks)
3. After this once, normal launching works

If even right-click is blocked (some macOS versions), run in Terminal:
```bash
xattr -d com.apple.quarantine /Applications/Clawline.app
```

### Windows

NSIS installer is unsigned. SmartScreen will warn:
1. Run the installer
2. SmartScreen says "Microsoft Defender SmartScreen prevented an unrecognized app from starting"
3. Click **"More info"** → **"Run anyway"**

After install, the app launches normally (no warning each time).

### Linux

`.AppImage` runs without any signature ceremony:
```bash
chmod +x Clawline_*.AppImage
./Clawline_*.AppImage
```

## Auto-updater

The app checks `https://github.com/restry/clawline/releases/latest/download/latest.json` on startup. The `tauri-action` workflow generates this manifest automatically when releasing.

The updater payload is signed by our private key (kept off-repo). The public key is embedded in the app, so even on an unsigned installer, **updates can't be tampered with** — they would fail signature verification.

## Architecture notes

- **WebSocket stays in the webview.** Tauri's webview process is persistent (not a browser tab), so `setInterval` doesn't get throttled and WS connections survive backgrounding. No need to move WS to Rust for v1.
- **Window close → hide to tray.** Quit only via tray menu or Cmd+Q.
- **Single instance.** Re-launching focuses the existing window instead of starting a second copy.
- **System notifications.** `services/tauri.ts:notify()` routes to native OS notifications under Tauri, falls back to Web Notification API in browsers — same call site works in both.
