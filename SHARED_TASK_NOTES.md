# UI/UX Optimization Task Notes

## Goal
Test and optimize PC + mobile UI interactions.

## Completed (this iteration)
- Fixed button default variant hover color (was green `#5aa77d`, now uses `primary-deep`)
- Removed 3 sets of duplicated CSS rules in `index.css`
- Increased send/mic button touch targets from 32px to 36px (`h-9 w-9`)
- Increased quick command button padding for better tappability
- Improved unread badge readability (larger size + font in both BottomNav and sidebar)
- Added `focus-visible` ring states to: Button primitive, sidebar nav, bottom nav, chat input
- Fixed empty split-pane placeholder text contrast (35% -> 50% opacity)

## Remaining work for next iterations

### HIGH priority
- **Message action hover buttons need aria-labels**: `MessageItem.tsx:256-269` — some buttons (edit, delete) missing `title` attributes
- **Color-only status indicators**: `ChatRoom.tsx:2714` — connection status dot uses only color (green/amber), no text for colorblind users; the text label IS nearby but the dot alone could be confusing
- **Tablet breakpoint gap**: No optimization between mobile (full-screen) and desktop (1024px). Consider adding tablet-specific layout at 768px
- **File upload has no progress indicator**: `ChatRoom.tsx:1303-1350` — large files silently upload/fail

### MEDIUM priority
- **Emoji reaction picker can go off-screen**: `MessageItem.tsx:233` — positioned `absolute bottom-full right-0`, no viewport boundary detection
- **Desktop message hover action buttons are 28px**: Fine for desktop mouse, but on touch laptops (Surface, iPad w/ keyboard) they're small. Consider `w-8 h-8` for the desktop hover actions
- **ChatList grid mode has no hover state**: `ChatList.tsx:157` — grid cards lack hover feedback
- **Desktop sidebar resize handle invisible on touch**: `App.tsx:656` — `hover:bg-primary/20` only, no touch affordance

### LOW priority
- **Copy toast is brief**: Consider increasing duration or showing toast near the copied message
- **Pre-existing unused imports in ChatRoom.tsx**: ~10 unused imports flagged by TypeScript (SmilePlus, Wifi, CornerDownLeft, Trash2, Copy, cn, ActionCard, MarkdownRenderer, etc.) — these were moved to MessageItem but imports remain
- **z-index values scattered**: Could consolidate into CSS custom properties for maintainability
