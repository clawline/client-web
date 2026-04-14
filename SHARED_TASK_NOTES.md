# Shared Task Notes — UI/UX Optimization

## Goal
Test and optimize PC + mobile UI/UX interactions.

## Completed This Iteration

### 1. Inbox back arrow hidden on desktop (`lg:hidden`)
- File: `src/screens/AgentInbox.tsx`
- The Inbox page had a back arrow that showed on all screen sizes. Dashboard, Search, and Profile don't have one — sidebar nav handles navigation on desktop. Added `lg:hidden` class.

### 2. Profile server card — mobile layout fix
- File: `src/screens/Profile.tsx`
- 4 action buttons (move up/down, edit, delete) each had `min-w-[44px]` = 176px total, squeezing the server name invisible on mobile. Fix: hide sort buttons on mobile (`hidden sm:flex`), reduce edit/delete button sizes on mobile (`min-w-[36px] sm:min-w-[44px]`).

### 3. Message preview markdown stripping
- Files: `src/components/chat/utils.ts`, `src/screens/ChatList.tsx`, `src/screens/AgentInbox.tsx`
- Preview text in chat list and inbox cards showed raw markdown (`**Singapore, SG**`). Added `stripMarkdownForPreview()` utility that strips bold, italic, strikethrough, code, links, headings, and blockquotes. Applied to both ChatList (list + grid views) and AgentInbox.

## Known Issues / Next Iteration Ideas

- **Mixed language in Profile**: "主题：跟随系统" is Chinese but "Push Notifications" / "In-App Notifications" are English — consider unifying
- **AgentInbox has an unused `onNavigateToChat` variable** (TS warning at line ~298) — pre-existing, not introduced by this change
- **ChatList has unused `showSource` and `unread` variables** — pre-existing TS warnings
- **Desktop sidebar nav labels**: hidden below `xl` breakpoint (`hidden xl:inline`) — at common 1024-1280px widths only icons show, which may be unclear for new users
- **Mobile Inbox back arrow**: still visible (by design — consistent with mobile back gesture patterns), but could be argued as redundant since BottomNav is always visible on that page
- **Grid view agent cards on mobile**: consider testing interactions (long-press, drag-to-reorder) for touch UX
- **Dark mode parity**: all changes maintain dark mode support, but a comprehensive light/dark comparison pass would be valuable
