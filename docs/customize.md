# 定制指南

本文档介绍 OpenClaw Client Web 的配置和定制方式，包括连接配置、主题样式、PWA 设置等。

## 连接配置

### 快速连接 URL

支持两种格式的连接 URL：

#### 1. WebSocket 直连 URL

```
ws://host:18080/ws?chatId=xxx&token=xxx&senderId=xxx
wss://secure.example.com/ws?chatId=xxx&token=xxx
```

URL 参数：
| 参数 | 说明 | 必填 |
|------|------|------|
| `chatId` / `channelId` | 会话/频道 ID | 可选 |
| `token` | 认证 Token | 可选 |
| `senderId` | 发送者 ID | 可选 |
| `name` | 连接显示名称 | 可选 |

#### 2. openclaw:// 自定义协议

```
openclaw://connect?serverUrl=ws://...&token=xxx&chatId=xxx&displayName=xxx
```

参数：
| 参数 | 说明 |
|------|------|
| `serverUrl` | WebSocket 服务器地址 (必填) |
| `token` | 认证 Token |
| `chatId` | 会话 ID |
| `senderId` | 发送者 ID |
| `displayName` | 显示名称 |
| `channelName` | 频道名称 |

### 手动配置

在「Profile → Servers」中手动添加服务器连接：

- **Connection Name**: 连接名称 (如 "My Dev Server")
- **Display Name**: 用户显示名称 (如 "Alex Developer")
- **WS URL**: WebSocket 地址 (如 `ws://localhost:18080/ws`)
- **Auth Token**: 认证令牌 (可选)
- **Chat ID**: 会话 ID (Token 认证模式)
- **Sender ID**: 发送者 ID (Token 认证模式)

### 连接存储

连接配置保存在 `localStorage`，键名：`openclaw.connections`。

支持多服务器连接，最多同时保持 **3 个活跃 WebSocket 连接**。

## 两种连接模式

### 1. 直连 WebSocket 模式

客户端直接连接到目标 WebSocket 服务器：

```
[Client Web] ←→ [WebSocket Server]
```

适用场景：
- 自托管 OpenClaw 服务
- 内网/局域网部署
- 直接访问 Channel 或 Gateway

### 2. Relay 中继模式

通过 Relay 服务器中转连接：

```
[Client Web] ←→ [Relay Server] ←→ [Backend Agent]
```

默认 Relay 地址：`wss://gateway.clawlines.net/client`

适用场景：
- 多租户环境
- 需要统一入口
- 跨网络访问

## 主题/样式定制

### 深色模式

支持明暗主题切换：
- 用户可通过「Profile → Dark Mode」手动切换
- 自动跟随系统偏好 (`prefers-color-scheme`)

### CSS 变量

主题色通过 CSS 变量定义，可在 `src/index.css` 中修改：

```css
/* 浅色主题 */
:root {
  --bg-surface: #F8FAFB;
  --bg-card: #FFFFFF;
  --text-primary: #2D3436;
  --border-color: #EDF2F0;
  --primary: #67B88B;      /* 主色调 */
}

/* 深色主题 */
.dark {
  --bg-surface: #1a1b2e;
  --bg-card: #232437;
  --text-primary: #e2e8f0;
  --border-color: #2d3748;
  --primary: #67B88B;
}
```

### Tailwind 主题配置

在 `tailwind.config.ts` / CSS `@theme` 块中定义设计令牌：

```css
@theme {
  --font-sans: "Plus Jakarta Sans", system-ui, sans-serif;
  --color-primary: #67B88B;
  --color-info: #5B8DEF;
  --color-accent: #8B5CF6;
  --color-surface-dark: #1a1b2e;
}
```

### 自定义品牌

1. 修改 `public/manifest.json` 中的 `name`、`short_name`、`icons`
2. 替换 `public/favicon.ico` 和 `public/icons/*`
3. 调整 CSS 变量中的 `--primary` 色值

## PWA 配置

### Manifest

PWA 配置位于 `public/manifest.json`：

```json
{
  "name": "OpenClaw",
  "short_name": "OpenClaw",
  "description": "OpenClaw Agent Client",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#1a1b2e",
  "theme_color": "#67B88B",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### Service Worker

项目使用 Vite PWA 插件自动生成 Service Worker，支持：
- 离线缓存
- 后台更新检测
- 安装提示 (iOS)

### 安装

- **iOS Safari**: 分享 → 添加到主屏幕
- **Android Chrome**: 菜单 → 添加到主屏幕
- **Desktop Chrome**: 地址栏安装图标

## 嵌入到其他页面

### iframe 嵌入

支持通过 iframe 嵌入第三方页面：

```html
<iframe 
  src="https://openclaw.example.com" 
  allow="clipboard-write; microphone; camera"
  style="width: 100%; height: 600px; border: none;">
</iframe>
```

注意事项：
- 需要服务端配置 `X-Frame-Options` 或 `Content-Security-Policy` 允许嵌入
- 某些功能 (如剪贴板、摄像头) 需要在 `allow` 属性中声明

### 微前端集成

可将构建产物集成到微前端架构：
1. 构建 `npm run build` 获得 `dist/` 产物
2. 将 `dist/assets/*` 部署到子应用路径
3. 通过 qiankun、wujie 等框架挂载

## 国际化

当前界面语言为英文，可扩展多语言支持：
- 使用 `react-i18next` 或类似方案
- 界面文案集中管理
- 待开发完整 i18n 支持