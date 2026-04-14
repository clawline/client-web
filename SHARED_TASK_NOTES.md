# Clawline Client Web — 迭代任务备注

## 当前状态

三个 UI 修复分支已创建 PR 到 `dev`：
- PR #4 — strip markdown in previews, fix mobile/desktop layout (`bf5b31f8`)
- PR #5 — sidebar nav polish, resize handle, dark mode consistency (`c1e7b4c8`)
- PR #6 — accessibility focus rings, touch targets, visual polish (`1f61dd3b`)

注意：PR #5 和 #6 都修改了 `src/App.tsx`（sidebar nav 区域），合并时可能有冲突需要解决。

## 下一步

- Review 并合并这三个 PR 到 `dev`
- 处理 PR #5 和 #6 之间可能的 `App.tsx` 合并冲突
- 无测试框架，验证方式为 `npm run build` + `npm run lint`
