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

发布桌面新版本的完整流程（**不要跳步**）：

### 1. Bump 版本号（3 处必须一致）

```bash
# 假设要发 0.2.0
NEW_VERSION=0.2.0

# a) src-tauri/tauri.conf.json  →  "version": "0.2.0"
# b) src-tauri/Cargo.toml       →  version = "0.2.0"
# c) Cargo.lock 同步
cd src-tauri && cargo update -p clawline --offline && cd ..
```

> ⚠️ 不 bump 版本号 → 打包出来还是旧版本号 → updater 比对 `latest.json` 时永远认为"已是最新"，热更新失效。

### 2. Commit & push 到 dev

```bash
git add src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(desktop): bump version to ${NEW_VERSION}"
git push origin dev
```

### 3. 打 tag 触发 CI（**tag 名必须 `desktop-v` 前缀**）

```bash
git tag desktop-v${NEW_VERSION}
git push origin desktop-v${NEW_VERSION}
```

`release-desktop.yml` 只匹配 `desktop-v*`。写错前缀（比如 `desktop-0.2.0` 没 `v`）CI 不会跑，会留下一个空 tag 污染 `releases/latest`，导致所有用户的 updater 拉到 404。

CI 会跑约 8-10 分钟，4 个 matrix 并行：macOS arm64 / macOS x64 / Linux / Windows。产物：
- `Clawline_*.dmg` (mac)、`*-setup.exe` (Win)、`*.AppImage` (Linux)
- `latest.json` —— updater 用的签名 manifest

### 4. **手动 publish draft release（最关键的一步）**

CI 配置了 `releaseDraft: true`，跑完只产生 **draft**。draft release **不会**被 `releases/latest/download/latest.json` 解析到，所以：

- 用户的桌面 app **不会收到热更新提示**
- 新装用户从 release 页拿不到包

必须去 https://github.com/clawline/client-web/releases 找到刚生成的 draft → 编辑 → 点 **"Publish release"**（确认勾上 "Set as the latest release"）。

### 5. 验证

```bash
curl -sL https://github.com/clawline/client-web/releases/latest/download/latest.json | jq .version
# 应该输出 "0.2.0"
```

打开一个旧版桌面 app，应该能弹出更新提示。

### 删除错发的 release / tag

如果不小心发了空 release 或 tag 名写错：

```bash
gh release delete <tag> -R clawline/client-web --cleanup-tag --yes
# 如果 release 已经被删但 tag 还在：
git push origin :refs/tags/<tag>
```

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

The app checks `https://github.com/clawline/client-web/releases/latest/download/latest.json` on startup. The `tauri-action` workflow generates this manifest automatically when releasing.

The updater payload is signed by our private key (kept off-repo). The public key is embedded in the app, so even on an unsigned installer, **updates can't be tampered with** — they would fail signature verification.

## Architecture notes

- **WebSocket stays in the webview.** Tauri's webview process is persistent (not a browser tab), so `setInterval` doesn't get throttled and WS connections survive backgrounding. No need to move WS to Rust for v1.
- **Window close → hide to tray.** Quit only via tray menu or Cmd+Q.
- **Single instance.** Re-launching focuses the existing window instead of starting a second copy.
- **System notifications.** `services/tauri.ts:notify()` routes to native OS notifications under Tauri, falls back to Web Notification API in browsers — same call site works in both.
