> ⚠️ **DEPRECATED** — moved to https://github.com/clawline/platform/tree/main/apps/client-web on 2026-05-06

# OpenClaw Prototype + Mini Program

这个仓库同时包含两部分：

- `src/`: 现有的 Web 原型，基于 Vite + React 19
- `miniprogram/`: 独立的原生微信小程序迁移版本

## Web 原型

前提：

- Node.js 20+

启动方式：

```bash
npm install
npm run dev
```

类型检查：

```bash
npm run lint
```

## 微信小程序

小程序代码完全隔离在 [miniprogram](/Users/leway/Projects/clawline-client-wechat/miniprogram)。

打开方式：

1. 使用微信开发者工具导入项目
2. 项目目录选择 [miniprogram](/Users/leway/Projects/clawline-client-wechat/miniprogram)
3. AppID 使用测试号或你自己的小程序 AppID

资源说明：

- 小程序图标、头像、插画使用本地 SVG
- 如需重新生成资源，可执行：

```bash
node miniprogram/scripts/generate_assets.mjs
```

当前迁移状态与待验证项见 [PARITY_CHECKLIST.md](/Users/leway/Projects/clawline-client-wechat/miniprogram/PARITY_CHECKLIST.md)。
