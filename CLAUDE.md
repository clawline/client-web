# CLAUDE.md — Clawline Client Web

## Project Overview

Clawline (OpenClaw) is a **React 19 SPA** that serves as a multi-agent chat client. Users pair with one or more backend servers (via WebSocket), each hosting AI agents, and chat with those agents. The app is a PWA with mobile-first design, responsive desktop layout with sidebar + split-view, and dark mode support.

## Tech Stack

- **Framework**: React 19 + TypeScript 5.8
- **Build**: Vite 6 (ESM, `npm run build` → `dist/`)
- **Styling**: Tailwind CSS v4 (via `@tailwindcss/vite` plugin) + custom theme in `src/index.css`
- **Routing**: React Router DOM v7 (BrowserRouter), but screens are managed via a custom `navigate()` wrapper in `App.tsx`
- **Animation**: Motion (Framer Motion) for transitions, swipe-back gestures
- **Auth**: Logto (`@logto/react`) — endpoint at `logto.dr.restry.cn`
- **Markdown**: `react-markdown` + `remark-gfm` + `rehype-raw` + `highlight.js`
- **Icons**: `lucide-react`
- **Storage**: localStorage (connections, settings, agent previews) + Supabase `cl_messages` (message history, single source of truth)
- **Offline outbox**: In-memory Map backed by sessionStorage (`src/services/outbox.ts`)
- **Message cache**: In-memory per-session cache populated on startup from Supabase (`src/stores/messageCache.ts`)
- **Real-time**: WebSocket connections managed in `src/services/clawChannel.ts`

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Dev server on port 4026
npm run build        # Production build (vite build)
npm run lint         # Type-check only (tsc --noEmit) — no eslint
npm run clean        # Remove dist/
```

**There is no test framework configured.** No unit/integration tests exist.

**Linting is type-checking only** — `npm run lint` runs `tsc --noEmit`. There is no ESLint or Prettier config.

## Project Structure

```
├── index.html            # SPA entry point (includes SW + cache purge script)
├── package.json
├── vite.config.ts        # Vite config with path alias, SW build-hash plugin, chunk splitting
├── tsconfig.json         # Target ES2022, bundler resolution, path alias @/* → ./*
├── vercel.json           # Vercel deployment config (SPA rewrites)
├── Dockerfile            # Multi-stage: node build → nginx serve
├── public/
│   ├── manifest.json     # PWA manifest
│   └── sw.js             # Service worker (cache-first with build hash invalidation)
├── src/
│   ├── main.tsx          # Entry — StrictMode, Logto provider, dark mode init
│   ├── App.tsx           # Root component — routing, layout (mobile/desktop), screen management
│   ├── index.css         # Tailwind imports, custom theme (@theme), dark mode vars, hljs theme
│   ├── components/
│   │   ├── chat/         # Chat-specific components (MessageItem, SuggestionBar, HeaderMenu, etc.)
│   │   │   ├── types.ts  # Message, ToolCall, DeliveryStatus, SlashCommand types
│   │   │   ├── index.ts  # Barrel export
│   │   │   └── utils.ts  # Chat utility functions
│   │   ├── ui/           # Reusable primitives (button, card, input, badge) — CVA-based
│   │   ├── MarkdownRenderer.tsx
│   │   ├── BottomNav.tsx
│   │   ├── ErrorBoundary.tsx
│   │   ├── SafeLogtoProvider.tsx
│   │   └── ...
│   ├── screens/          # Top-level screen components
│   │   ├── ChatList.tsx  # Agent/connection list
│   │   ├── ChatRoom.tsx  # Main chat interface (lazy-loaded)
│   │   ├── Dashboard.tsx
│   │   ├── Profile.tsx
│   │   ├── Search.tsx
│   │   ├── Preferences.tsx
│   │   ├── Pairing.tsx   # Server pairing flow
│   │   ├── Onboarding.tsx
│   │   └── Callback.tsx  # Logto OAuth callback
│   ├── services/
│   │   ├── clawChannel.ts      # WebSocket management, agent discovery, message send/receive
│   │   ├── connectionStore.ts  # Server connections CRUD (localStorage-backed)
│   │   ├── outbox.ts           # Offline message queue (in-memory + sessionStorage)
│   │   ├── suggestions.ts      # AI suggestions + Supabase message sync API + syncMessageToLocal
│   │   └── agentInbox.ts       # Inbox state management across agents
│   ├── stores/
│   │   └── messageCache.ts     # In-memory message cache (warm on startup from Supabase)
│   ├── hooks/
│   │   ├── useIOSPWA.ts
│   │   ├── usePWAUpdate.ts
│   │   └── useSwipeBack.ts
│   └── lib/
│       └── utils.ts      # cn() — clsx + tailwind-merge
```

## Architecture & Key Patterns

### Screen Navigation
Navigation uses a custom `Screen` type union (`'chats' | 'chat_room' | 'dashboard' | ...`) in `App.tsx`. The `navigate()` function updates both React state and the URL via React Router. URL ↔ screen sync is bidirectional (browser back/forward supported).

### Desktop vs Mobile Layout
- **Mobile** (< 1024px): Full-screen screens with bottom nav bar, swipe-back gestures
- **Desktop** (>= 1024px): Sidebar (ChatList) + main panel with resizable sidebar
- **Split View** (>= 1440px): Dual ChatRoom panes side-by-side
- Force mobile layout via `?mobile=true` or `?layout=mobile` URL param

### WebSocket / Agent Communication
`clawChannel.ts` manages WebSocket connections to backend servers. Key concepts:
- **Connections**: Stored in `connectionStore.ts`, each has a server URL + token
- **Channels**: One WebSocket per connection, with heartbeat, reconnection (up to 6 attempts), and idle timeout (30 min)
- **Agents**: Discovered per-connection; each has an ID, name, skills, status
- Messages flow: UI → `sendText()`/`sendMedia()` → WS → server → agent → WS → UI callback

### State Management
No Redux/Zustand — state is managed via:
- React `useState`/`useCallback` in `App.tsx` for navigation state
- `localStorage` for connections, settings, dark mode, agent previews
- **Supabase `cl_messages`** as the single source of truth for message history (via Gateway HTTP API)
- **In-memory `messageCache`** populated on startup from Supabase (5h window), kept fresh by WS events
- **In-memory outbox** (sessionStorage-backed) for offline message queue
- Custom events (`openclaw:connections-updated`, `openclaw:inbox-updated`) for cross-component sync

### Styling Conventions
- Tailwind CSS v4 with custom `@theme` variables in `index.css`
- Primary color: `#EF5A23` (orange)
- Dark mode: class-based (`.dark` on `<html>`), toggled via `localStorage('openclaw.darkMode')`
- Font: Plus Jakarta Sans
- UI primitives in `src/components/ui/` use `class-variance-authority` (CVA) for variants
- Always use `cn()` from `src/lib/utils.ts` to merge Tailwind classes

### Path Alias
`@/*` maps to the project root (not `src/`). Example: `@/src/lib/utils` or `@/package.json`.

### Lazy Loading
Heavy screens (`ChatRoom`, `Dashboard`, `Profile`, `Search`, `Preferences`, `Pairing`) are lazy-loaded via `React.lazy()` with a spinner fallback.

### PWA
- Service worker at `public/sw.js` with build-hash cache invalidation
- `usePWAUpdate` hook detects new versions and prompts user
- iOS PWA install prompt via `useIOSPWA` hook

## Code Conventions

- **TypeScript**: Strict-ish (`noEmit`, `isolatedModules`). No explicit ESLint — rely on `tsc` for correctness.
- **Imports**: Use `@/*` path alias for cross-directory imports. Relative imports within the same directory.
- **Components**: Functional components only. No class components.
- **Exports**: Default exports for screen components. Named exports for services, hooks, and utilities.
- **localStorage keys**: Prefixed with `openclaw.` (e.g., `openclaw.darkMode`, `openclaw.connections`, `openclaw.outbox`).
- **Message storage**: Supabase `cl_messages` via Gateway `/api/messages/sync` endpoint. No IndexedDB.
- **Comments**: Bilingual (English and Chinese) in some areas — this is intentional.
- **Formatting**: 2-space indentation, single quotes, trailing commas.
- **HTML sanitization**: All user/markdown content sanitized via `dompurify` before rendering.

## CI/CD & Deployment

- **GitHub Actions** (`.github/workflows/release.yml`): On push to `main`, builds Docker image, pushes to Azure Container Registry (`externalacr.azurecr.io`), and creates a GitHub Release tagged `v{VERSION}-{SHA_SHORT}`
- **Vercel**: SPA deployment (`vercel.json` configured with rewrites)
- **Docker**: Multi-stage build (Node 22 → nginx) available via `Dockerfile`
- **Dev hosts**: `web.dev.dora.restry.cn`, `dev.dora.restry.cn` in Vite allowed hosts
- **Additional docs**: `docs/deploy.md`, `docs/features.md`, `docs/customize.md` for detailed deployment/feature/branding guidance

## Gotchas

- `npm run lint` is **type-checking only** (`tsc --noEmit`), not a linter
- The `@/*` path alias resolves to project root, not `src/`
- No test suite exists — validate changes via `npm run build` and `npm run lint`
- WebSocket gateway default: `wss://gateway.clawlines.net/client`
- Build produces `__APP_VERSION__` and `__BUILD_HASH__` global defines
- The `miniprogram/` directory referenced in README does not exist in this repo (it's a separate WeChat mini-program project)
- `.impeccable.md` at project root contains the design system documentation (brand personality, aesthetic direction)

## Manual Testing with gstack browse

The project has no automated test suite. For integration testing, use the `browse` headless browser tool at `~/.claude/skills/gstack/browse/dist/browse` (aliased as `$B`).

### Critical rules

1. **All steps must be in a single Bash tool call.** The browse server starts fresh on every Bash invocation — session state (cookies, localStorage, WS connections) does NOT persist between calls. Chain everything with `&&`.

2. **`wait --timeout=N` does NOT work.** The `--timeout` flag is silently ignored; the default wait is 15 seconds. Never pass `--timeout`.

3. **Use text selectors over refs for navigation.** `$B click "button:has-text('Inbox')"` is more reliable than `$B click @e19`. Refs shift when page state changes (expand/collapse, loading). Use `$B snapshot -i` + refs only for unique interactive elements where text matching is ambiguous.

4. **`$B snapshot -i > /dev/null` does NOT populate refs.** Piping to `/dev/null` breaks ref storage. Always let snapshot output print (or redirect to a variable) before using `@eN` refs.

5. **No `sleep` between `$B` commands.** Bash `sleep` triggers browse server idle timeout → `[browse] Starting server...` on next call = session lost. Use `$B js "await new Promise(r => setTimeout(r, Nms))"` for in-browser waits, keep under 5 seconds.

### Login flow (Logto)

The app at `localhost:4026` shows a splash screen with "Get Started". Clicking it redirects to `logto.dr.restry.cn`. The Logto page is in Chinese — form fields by HTML name:

```bash
$B goto http://localhost:4026/
$B click "text=Get Started"
$B wait "text=登录你的账号"   # wait for Logto page (default 15s)
$B fill "input[name=identifier]" "USERNAME"
$B fill "input[name=password]" "PASSWORD"
$B click "button[type=submit]"
$B wait "text=Chats"         # wait for OAuth callback → app redirect
```

Test account: `test_all_apps` / `Test@2026`

### Injecting connections (localStorage)

After login, inject connections before navigating so the app auto-connects WS:

```bash
$B js "localStorage.setItem('openclaw.connections', JSON.stringify([{
  id:'conn-fires-t1', name:'Fires (Levis)', displayName:'Fires/Levis',
  serverUrl:'wss://relay.restry.cn/client?channelId=fires&token=1b695364f8d24ebaae61f1d8aa9aed94',
  token:'1b695364f8d24ebaae61f1d8aa9aed94', chatId:'fires', channelId:'fires', senderId:'Levis'
}]))"
$B goto http://localhost:4026/chats
$B wait "text=main"          # WS connected when agents appear
```

### Message architecture (no IndexedDB)

Messages are stored only in Supabase `cl_messages` (via the Gateway relay). The client has NO local message database. On app startup, `messageCache.warmCache()` fetches the last 5 hours of messages per connection in a single HTTP call and caches in memory. When navigating to an agent chat, messages are loaded from this cache (zero HTTP calls). Scrolling up triggers `fetchOlderMessages()` to paginate from Supabase.

### Inbox-specific notes

- Inbox only shows agents that have `lastMessage` OR status `thinking`/`pending_reply`. Agents with no message history are filtered out — "No Agents Yet" is correct when Supabase has no messages.
- After injecting messages, navigate to Inbox via `$B click "button:has-text('Inbox')"` and wait for `$B wait "text=待回复"`.
- System messages filtered from previews: `🐾 ...`, `[Image]`, `[image]`, `📎...`, `*[cancelled]*`, diagnostic dumps (`Model: ... Tokens: ...`).
- **Desktop layout conflict**: On desktop, the sidebar (ChatList) is always visible alongside the Inbox. `button:has-text('main')` will match both the sidebar's "Chat with main" button AND the Inbox agent card. Use `button:has-text('Awaiting Reply')` to uniquely click an Inbox card.
- **Expand card triggers markAsRead immediately**: Clicking a card calls `markAsRead()` via a `setTimeout(0)` in `handleToggle`. The card's status changes from `pending_reply` → `idle` and `unreadCount` drops to 0 instantly — this is intentional ("viewing = read").
- **Send button has no text**: The send button in the expanded reply panel contains only a `<Send>` SVG icon. Use `$B press "Enter"` on the textarea instead of trying to click the button by text.
- **Multi-connection inbox cache injection**: For testing multi-server scenarios without triggering the WS crash, inject pre-built items directly into `openclaw.inbox.cache`:
  ```javascript
  $B js "(()=>{const ts=Date.now();const items=[
    {connectionId:'conn-A', connectionName:'Server A', agentId:'main', agentName:'main',
     agentEmoji:'🤖', status:'pending_reply',
     lastMessage:{text:'Message from A',timestamp:ts-120000,messageId:'m1'}, unreadCount:2},
    {connectionId:'conn-B', connectionName:'Server B', agentId:'nexora-fe', agentName:'nexora-fe',
     agentEmoji:'🎨', status:'pending_reply',
     lastMessage:{text:'Message from B',timestamp:ts-60000,messageId:'m2'}, unreadCount:3},
  ]; localStorage.setItem('openclaw.inbox.cache',JSON.stringify(items)); return 'ok';})()"
  ```
- **Two simultaneous WS connections crash the headless browser**: Injecting 2 connections and navigating to `/chats` with `$B wait "text=main"` consistently crashes the browser context (Playwright closes). Single connections work fine. This may be a Vite HMR interaction in dev mode; test multi-connection stats via inbox cache injection instead.

### Inbox integration test results (verified 2026-04-07)

| Test | Scenario | Result |
|------|----------|--------|
| A | 3 agents from 2 connections (Fires + nexora) — stats bar | `2 待回复 0 思考中 3 在线 6 未读消息` ✅ |
| A | Agent cards sorted by recency, correct connection names | ✅ |
| A | System messages (🐾, [Image]) not shown as last message | ✅ |
| B | Expand card → markAsRead fires immediately | 待回复 2→1, 未读 5→3 ✅ |
| B | Type reply + Enter → message appears in conversation view | ✅ |
| B | Other agents' unread counts unaffected by reply | ✅ |
| C | Real WS: send from Inbox → agent shows "Thinking..." | Stats: `0 待回复 1 思考中` ✅ |
| C | Real WS: agent replies → Inbox updates to "Awaiting Reply" | Stats: `1 待回复 0 思考中` ✅ |
| C | Sidebar also shows "Thinking..." while agent processes | ✅ |
| D | "Suggest Reply" generates contextual suggestion in textarea | ✅ |
