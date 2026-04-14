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

## Integration Testing with Browser Agent

The project has no automated test suite. For integration testing, use the Clawline Browser Agent (`/browser-agent` skill) which controls Chrome via HTTP Hook API at `http://127.0.0.1:4821`.

**Prerequisite**: Chrome must have the Clawline sidepanel open (agent listens on port 4821).

### Quick start

```bash
# 1. Check agent is ready
curl -s http://127.0.0.1:4821/

# 2. Check available windows
curl -s http://127.0.0.1:4821/sessions

# 3. Send a task (blocking — waits for completion)
curl -s -X POST http://127.0.0.1:4821/hook \
  -H 'Content-Type: application/json' \
  -d '{"task": "Navigate to http://localhost:4026 and describe the page"}'
```

### Multi-step workflow (use conversationId)

```bash
# Step 1: Navigate
RESULT=$(curl -s -X POST http://127.0.0.1:4821/hook \
  -H 'Content-Type: application/json' \
  -d '{"task": "Navigate to http://localhost:4026"}')
CONV_ID=$(echo "$RESULT" | jq -r '.conversationId')

# Step 2: Login (continues same browser context)
curl -s -X POST http://127.0.0.1:4821/hook \
  -H 'Content-Type: application/json' \
  -d "{\"task\": \"Click Get Started, login with username test_all_apps password Test@2026, wait for redirect to Chats page\", \"conversationId\": \"$CONV_ID\"}"

# Step 3: Test a feature
curl -s -X POST http://127.0.0.1:4821/hook \
  -H 'Content-Type: application/json' \
  -d "{\"task\": \"Click on the main agent and send a message saying hello\", \"conversationId\": \"$CONV_ID\"}"
```

Test account: `test_all_apps` / `Test@2026`

### Key differences from headless browse ($B)

- **Real Chrome** — uses user's actual Chrome with extension, not headless Playwright
- **Natural language tasks** — no CSS selectors, the agent figures out how to interact
- **conversationId** preserves context across steps (page state, element references)
- **One task per window** — parallel tasks need separate windows
- **Blocking calls** — HTTP request waits up to 10 minutes for task completion

### Message architecture (no IndexedDB)

Messages are stored only in Supabase `cl_messages` (via the Gateway relay). The client has NO local message database. On app startup, `messageCache.warmCache()` fetches the last 5 hours of messages per connection in a single HTTP call and caches in memory. When navigating to an agent chat, messages are loaded from this cache (zero HTTP calls). Scrolling up triggers `fetchOlderMessages()` to paginate from Supabase.

### Inbox-specific notes

- Inbox only shows agents that have `lastMessage` OR status `thinking`/`pending_reply`. Agents with no message history are filtered out.
- System messages filtered from previews: `🐾 ...`, `[Image]`, `[image]`, `📎...`, `*[cancelled]*`, diagnostic dumps.
- Expand card triggers markAsRead immediately (viewing = read).
- Multi-connection inbox cache injection via `localStorage.setItem('openclaw.inbox.cache', ...)` still works for testing.
