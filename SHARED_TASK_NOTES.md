# Shared Task Notes

## Open PRs to dev

All three iteration PRs are open and ready for review:

- **#4** `iteration-1` — Strip markdown in message previews, fix mobile/desktop layout
- **#5** `iteration-2` — Polish sidebar nav, resize handle, dark mode consistency
- **#6** `iteration-3` — Accessibility (focus-visible), touch targets, visual polish

## Next Steps

- Review and merge the three PRs above into `dev`
- These PRs may have minor conflicts with each other (both #5 and #6 touch `App.tsx` sidebar nav area) — merge in order (4 → 5 → 6) or resolve conflicts as needed
- After merging, run `npm run build && npm run lint` to verify no regressions
- No test suite exists — manual QA is needed for the UI changes
