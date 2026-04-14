# Shared Task Notes

## Current State (2026-04-14)

Three UI polish PRs are open targeting `dev`:

- **PR #4** — `continuous-claude/iteration-1/2026-04-14-bf5b31f8`: Strip markdown in message previews, mobile layout fixes
- **PR #5** — `continuous-claude/iteration-2/2026-04-14-c1e7b4c8`: Sidebar nav polish, resize handle UX, dark mode consistency
- **PR #6** — `continuous-claude/iteration-3/2026-04-14-1f61dd3b`: Accessibility (focus-visible rings), touch targets, visual polish

## Next Steps

- Review and merge the three PRs into `dev`
- After merging, test for conflicts between the three — PR #5 and #6 both touch `src/App.tsx` sidebar nav buttons (may need manual conflict resolution)
- Potential follow-up: PR #6 removes mobile overflow CSS from `index.css` — verify no horizontal scroll regression on mobile devices
- PR #5 changes ChatRoom dark background to `bg-surface-dark` token — ensure this token is defined in the theme; PR #6 does NOT make this change, so there's a divergence to reconcile
