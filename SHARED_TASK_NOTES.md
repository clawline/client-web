# Shared Task Notes — UI/UX Optimization

## Goal
测试前端使用体验，优化 PC 端、手机端 UI 交互

## What was done (this iteration)

### Fixes applied
1. **Sidebar resize handle** (`App.tsx:652-658`) — Widened interactive area from 4px to 12px (`w-1` → `w-3`), centered with `-mr-1.5`. Thin visible line widens and highlights on hover/active.
2. **Sidebar nav buttons** (`App.tsx:619-653`) — Icon size 15→17px, added `title` tooltips, `aria-label`, `aria-current`, `focus-visible:ring` for keyboard navigation. Replaced raised card inactive style (`bg-white/68 shadow-sm`) with clean transparent hover overlays. Cleaner border-top separator.
3. **Input onBlur scroll reset** (`ChatRoom.tsx:2696`) — `window.scrollTo(0,0)` was firing on every blur, resetting message scroll position on desktop. Now only fires on mobile when `visualViewport` API is present.
4. **Dark mode color banding** (`ChatRoom.tsx:1736,1858,2225`) — Replaced hardcoded `dark:bg-[#11161d]` with `dark:bg-surface-dark` to match the theme variable `#161B22`, eliminating visible color steps between chat area and surrounding surfaces.

## What to tackle next

### High priority
- **Message action buttons discoverability** — On desktop, message hover actions (copy, reply, etc.) use `group-hover/msg:opacity-100` with no transition delay. Consider adding a subtle fade-in or tooltip on first use.
- **Slash command menu keyboard navigation** — No arrow-key navigation in the slash command popup (`ChatRoom.tsx:2227-2277`). Users must click/tap; keyboard-only navigation is impossible.
- **iOS input zoom** — Input has `text-[13px]` but `index.css` overrides to `font-size: 16px !important`. These fight each other in specificity. Needs a clean resolution (either always 16px or use `<meta viewport>` approach).

### Medium priority
- **Sidebar collapse** — No way to minimize/collapse the sidebar on desktop. Consider a toggle or double-click on resize handle to collapse to icon-only width.
- **Scrollbar gutter** — No `scrollbar-gutter: stable` means content shifts when scrollbar appears/disappears during message loading.
- **Animation consistency** — Screen transitions use spring physics (stiffness=300, damping=30), buttons use `whileTap scale:0.9`, opacity transitions use 150ms. No unified motion spec.
- **`prefers-reduced-motion`** — CSS handles it (`index.css:310-317`) but Framer Motion's `AnimatePresence` still runs enter/exit animations. Should check `useReducedMotion()`.

### Low priority / polish
- **Safe area inset doubling** — `BottomNav` uses `env(safe-area-inset-bottom)` directly while `index.css:220-231` applies `.pwa-nav-offset` transform. Could double-apply on notched devices in PWA mode.
- **Empty state on desktop main panel** — "Select an agent to start chatting" could show keyboard shortcuts or recent agent suggestions.
- **Pre-existing unused imports** — `ChatRoom.tsx` has ~10 unused import warnings from `tsc`. Not from our changes but worth cleaning up.
