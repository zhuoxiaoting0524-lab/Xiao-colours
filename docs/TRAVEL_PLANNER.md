# Travel Planner implementation

## Architecture

Travel Planner is implemented inside the existing XiaoColour stack:

- `index.html`, `travel-planner.js`, and `lifestyle-journal.css` provide the responsive UI.
- `worker/travel-api.js` exposes authenticated APIs beneath `/api/me/travel`.
- `migrations/0007_travel_planner.sql` adds user-owned D1 tables without modifying existing tables.
- MapLibre and OpenFreeMap are loaded only when the map tab opens.
- Place verification reuses the authenticated, rate-limited Footprints geocoder.

The manual planner remains fully functional when external map, geocoding, or AI services are unavailable.

## Data model

The additive migration creates tables for trips, days, activities, saved places, travel information, expenses, checklist items, and itinerary versions. Every table contains `user_id`; all API reads and writes include the authenticated user ID. A second account receives `404` for another user's trip IDs.

Date values are stored as date-only ISO strings. They are not converted through the device timezone, avoiding accidental day shifts. Coordinates are only stored after a user-selected geocoder result or explicit user entry.

## Map truthfulness

Markers are shown only for activities with finite coordinates. The line between markers indicates saved itinerary order; it is not a road route or an estimated travel time. External navigation opens a standard Google Maps query for the verified coordinate or saved place text.

## AI status

No server-side AI model is currently configured in XiaoColour. The AI endpoint therefore returns a clear `503 ai_not_configured` response and never overwrites the manual itinerary. Enabling AI later requires a server-only secret, rate and cost limits, a structured response schema, geocoder validation, a diff preview, and explicit user acceptance before saving.

## Migration and rollback

Local verification:

```sh
wrangler d1 migrations apply DB --local
node tests/travel-planner.e2e.mjs http://127.0.0.1:45468
```

Production migration must be run only after an existing D1 backup is confirmed. The migration is additive; rollback consists of deploying the previous Worker version while leaving the new tables intact, preserving user data.

## Reference projects

- TREK: AGPL-3.0. Reviewed for product and architecture ideas only.
- TRIP: MIT. Reviewed for itinerary interaction ideas only.
- ai-trip: MIT. Reviewed for structured planning ideas only.

No source code or copyrighted assets were copied from these projects.
