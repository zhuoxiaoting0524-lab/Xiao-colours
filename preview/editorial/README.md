# Soft Editorial Minimalism — UI Preview

Interactive **visual-only** preview for XiaoColour’s redesigned Personal Workspace.

- Does **not** modify the live site, auth, D1, or Global Pulse
- Mock data only
- Fonts: Inter + Noto Sans SC
- Tokens: `#F8F8F6` / `#FFFFFF` / `#202321` / `#737A74` / `#AFC6B6` / `#E8EDE8`

## Run

From the repo root:

```bash
npx --yes serve . -l 43129
```

- Interactive: [http://127.0.0.1:43129/preview/editorial/](http://127.0.0.1:43129/preview/editorial/)
- 1440 / 390 frames: [http://127.0.0.1:43129/preview/editorial/frames.html](http://127.0.0.1:43129/preview/editorial/frames.html)

## Footprints schema note (production)

If production shows “Footprints 数据表尚未初始化”, that is a **database migration** issue (`migrations/0005_footprints.sql`), not a visual bug. Do not treat it as a CSS problem; apply the migration in Cloudflare D1 only after explicit confirmation.
