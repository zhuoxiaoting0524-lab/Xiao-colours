# XiaoColour Personal Space — Phase 2

## Scope

- The approved Home, Little Notes, My Days and Footprints visual design is integrated into the existing site.
- Welcome and Global Pulse remain public.
- Little Notes, My Days and Footprints use the existing shared login session.
- Footprints remains the approved MapLibre/OpenFreeMap interaction prototype. Persistent places are intentionally deferred to phase 3.
- Legacy Journal, Gallery and Collections source, APIs and D1 tables are retained.

## New local data

Migration `0004_notes_days.sql` only adds:

- `personal_notes`
- `day_tasks`
- `important_dates`

Every row contains `user_id`; every private query is scoped with both the record id and the authenticated session user id. The browser cannot choose a different owner.

## Local preview

1. Install the locked dependencies.
2. Apply D1 migrations locally: `pnpm db:local`.
3. Start the Worker locally: `pnpm dev`.
4. Open the local Worker URL and sign in with an invited test account.

## Production safety gate

No remote D1 migration or production deployment was performed in phase 2 development. Before production release:

1. Export or otherwise back up the production D1 database.
2. Review the additive migration and confirm that only the three new tables and their indexes are created.
3. Apply migrations remotely only after explicit owner approval.
4. Deploy the Worker and static assets.
5. Run the two-account isolation acceptance test against production test accounts.

## Verification

`tests/personal-space-v2.e2e.mjs` covers two invited users, note isolation, task isolation, important-date isolation, CSRF-protected mutations, recurring task generation, logout/re-login persistence and unauthenticated API denial.
