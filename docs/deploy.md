# 部署指南

本文档介绍 OpenClaw Client Web 的部署方式，包括开发环境、生产构建和静态部署方案。

## 环境要求

- **Node.js**: v18+ (推荐 v22+)
- **包管理器**: npm / pnpm / yarn
- **浏览器**: 现代浏览器 (Chrome 90+, Firefox 90+, Safari 14+, Edge 90+)

## 开发模式

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

开发服务器默认运行在 `http://localhost:5173`，支持热更新 (HMR)。

## 生产构建

```bash
# 构建生产版本
npm run build

# 构建产物位于 dist/ 目录
# - dist/index.html        # 入口 HTML
# - dist/assets/*.js       # JavaScript bundle
# - dist/assets/*.css      # CSS 样式
# - dist/*.png/svg/ico     # 静态资源

# 本地预览构建产物
npm run preview
```

构建配置位于 `vite.config.ts`，使用 Vite 进行打包。

## 静态部署方式

`dist/` 目录为纯静态文件，可通过任意静态文件服务器托管。

### 1. PM2 Serve

适合 Node.js 环境，简单快速：

```bash
# 全局安装 pm2
npm install -g pm2

# 启动静态服务 (端口 3000)
pm2 serve dist 3000 --name openclaw-web

# 常用命令
pm2 list
pm2 logs openclaw-web
pm2 restart openclaw-web
pm2 stop openclaw-web
pm2 delete openclaw-web
```

### 2. Caddy

适合现代 HTTPS 自动证书环境：

```caddyfile
# Caddyfile
openclaw.example.com {
    root * /path/to/dist
    file_server
    
    # SPA 路由回退
    try_files {path} /index.html
}
```

```bash
caddy run --config Caddyfile
```

### 3. Nginx

适合传统服务器环境：

```nginx
server {
    listen 80;
    server_name openclaw.example.com;
    
    root /path/to/dist;
    index index.html;
    
    # SPA 路由回退
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    # 静态资源缓存
    location ~* \.(js|css|png|svg|ico|woff2?)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
    
    # gzip 压缩
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
}
```

### 4. Docker

适合容器化部署：

```dockerfile
# Dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

```nginx
# nginx.conf
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

```bash
# 构建镜像
docker build -t openclaw-web .

# 运行容器
docker run -d -p 80:80 --name openclaw-web openclaw-web
```

## 环境变量 / 构建时配置

当前项目使用 Vite 构建，环境变量以 `VITE_` 前缀：

```bash
# .env.production
VITE_LOGTO_ENDPOINT=https://auth.example.com
VITE_LOGTO_APP_ID=xxx
```

在代码中通过 `import.meta.env.VITE_*` 访问。

**注意**：WebSocket 连接地址在运行时通过 UI 配置，不依赖构建时环境变量。

## 构建优化建议

1. **启用 gzip/brotli 压缩** - 可显著减少传输体积
2. **配置 CDN** - 加速静态资源分发
3. **启用 HTTP/2** - 多路复用提升加载速度
4. **设置缓存头** - 对带 hash 的静态资源设置长期缓存

## 注意事项

- SPA 应用需要服务端配置回退路由 (`/* → /index.html`)
- PWA 需要 HTTPS 环境
- WebSocket 连接需要服务端支持 (WSS 推荐用于生产环境)