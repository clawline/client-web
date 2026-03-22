# 功能说明

本文档介绍 OpenClaw Client Web 的核心功能和特性。

## 支持的消息类型

### 文本消息

- 纯文本消息发送和接收
- 支持 Markdown 渲染 (代码高亮、列表、链接等)
- 消息编辑 (`message.edit`)
- 消息删除 (`message.delete`)
- 消息回复 (带 `parentId` 的引用回复)

### 文件消息

- 文件上传 (通过 HTTP POST `/api/media/upload`)
- 支持 PDF、Word、Excel 等文档格式
- 发送时包含 `mediaUrl`、`mimeType` 等元数据

### 图片消息

- 图片上传和预览
- 支持 PNG、JPG、GIF、WebP 格式
- 消息类型标记为 `image`

### 音频/语音消息

- 音频文件上传
- 支持常见音频格式
- 消息类型标记为 `voice` 或 `audio`

### 消息反应 (Reactions)

- 对消息添加 Emoji 反应
- 支持移除已添加的反应
- 实时同步反应状态

## 流式输出

### 实现机制

AI 回复支持流式输出：
- 通过 WebSocket 接收分片的 `message.stream` 数据包
- 消息记录中 `isStreaming: true` 标识进行中的流式消息
- 流式完成后更新为完整消息

### 流式状态处理

```typescript
// 消息记录结构
type MessageRecord = {
  id: string;
  sender: 'user' | 'ai';
  text: string;           // 累积的文本内容
  isStreaming?: boolean;  // 是否正在流式输出
  // ...
}
```

### 打字指示器 (Typing Indicator)

- 实时显示 Agent 正在输入的状态
- WebSocket `typing` 事件通知
- 5 秒自动过期机制

## 消息历史和断线续传

### 本地存储

消息历史使用 **IndexedDB** 持久化存储：
- 数据库名：`clawline-messages`
- 存储对象：`messages`
- 支持大容量本地存储

### 索引结构

```
by-agent          → [connectionId, agentId]
by-agent-timestamp → [connectionId, agentId, timestamp]
by-timestamp      → timestamp
by-text           → text (全文搜索)
by-scope          → [connectionId, scopeId]
by-scope-timestamp → [connectionId, scopeId, timestamp]
```

### 消息加载

- 默认加载最近 **200 条** 消息
- 支持按 Agent、连接、时间范围筛选
- 支持全文搜索

### 断线续传

- WebSocket 断开后自动重连 (最多 6 次尝试)
- 重连成功后同步历史消息
- 连接状态监听：`disconnected → connecting → connected → reconnecting`

### 从 LocalStorage 迁移

首次启动时自动迁移旧版 LocalStorage 消息到 IndexedDB。

## 移动端适配

### 响应式布局

- **移动端** (< 1024px)：单屏堆叠导航 + 底部 Tab Bar
- **桌面端** (≥ 1024px)：侧边栏 + 主内容区分屏布局
- **超宽屏** (≥ 1440px)：支持分屏模式，同时显示两个聊天窗口

### PWA 特性

- 独立安装到主屏幕
- 全屏运行 (standalone 模式)
- iOS 安全区域适配 (`env(safe-area-inset-*)`)
- iOS 安装引导提示

### 手势交互

- iOS 风格的滑动返回手势 (`useSwipeBack`)
- 触控优化的按钮尺寸和间距
- 禁用下拉刷新防止误操作

### 性能优化

- 组件懒加载 (`React.lazy`)
- 虚拟化长列表 (大对话场景)
- 动画性能优化 (`motion/react` + `will-change`)

## 多服务器连接

### 连接池管理

- 支持配置多个服务器连接
- 同时保持最多 **3 个活跃 WebSocket 连接**
- 空闲连接 **5 分钟** 自动断开

### 连接切换

- Profile 页面管理连接列表
- 点击切换活跃服务器
- 支持编辑、删除、排序

## Agent 管理

### Agent 列表

- 自动获取服务端 Agent 列表 (`agent.list.get`)
- 显示 Agent 头像、名称、模型、状态
- 支持选择默认 Agent

### Agent 上下文

- 查看 Agent 的上下文文件 (`agent.context.get`)
- 显示 SOUL.md、USER.md、TOOLS.md 等配置

### 会话管理

- 按 Agent 分组显示会话
- 支持多会话切换
- 会话列表请求 (`conversation.list.get`)

## 仪表盘 (Dashboard)

### 实时状态

- 服务器连接状态
- Relay 模式和健康检查
- 在线 Agent 数量
- 连接统计 (Chat 数、Socket 数)

### 今日统计

- 发送/接收消息计数
- 活跃 Agent 列表
- 最近活动时间线

### 系统信息

- 服务端 Node.js 版本
- 平台信息
- 内存使用
- 运行时长

## 搜索功能

- 全局消息搜索
- 按 Agent、连接、时间筛选
- 支持命令过滤 (`/` 开头的命令)

## 认证系统

集成 **Logto** OAuth 认证：
- 登录/注销流程
- 用户信息显示 (头像、名称)
- Token 自动刷新

## 通知

### 推送通知

- 支持 Web Push API
- 用户可开启/关闭
- 需要用户授权

### 应用内通知

- 可独立开关
- 适用于 PWA 场景

## 无障碍支持

- 语义化 HTML 结构
- 键盘导航支持
- `prefers-reduced-motion` 动画减弱
- 高对比度文本