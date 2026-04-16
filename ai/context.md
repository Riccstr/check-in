# Context

## Constraints
- **Roles:** always `user_roles` table — never `profiles` or `auth.users` metadata; all RLS depends on it
- **Auto-generated files:** never edit `src/integrations/supabase/client.ts`, `types.ts`, `supabase/config.toml`
- **IndexedDB:** increment version in `offlineDb.ts` when adding/renaming stores
- **`client_generated_id`:** set UUID v4 client-side before every visit INSERT — deduplication key
- **Camera:** must be triggered by user gesture on iOS — never in `useEffect`
- **Service worker:** Supabase API routes → NetworkOnly always; never cache auth/DB responses
- **Schedule generation:** `auto_generate_daily_schedule` never runs for future dates — guard in both SQL and frontend; do not remove either
- **Week override:** must update both `app_settings` keys — `current_week_order` + back-calculated `week_cycle_start_date`
- **Excel export:** use `xlsx-js-style`, not `xlsx` — incompatible cell styling API
- **Photos:** always `compressImage` → `stampImage` before upload; timestamp burned onto canvas
- **Active visit IDB:** `pending_photos` (key: `scheduleItemId`) + `active_card_state` (key: `"current"`) — cleared only on `visited`/`skipped`
- **Edge functions:** use service role key, do own admin check — do not rely on JWT/RLS inside them

## Visit Statuses
| Status | Physical visit | Orders count |
|--------|---------------|--------------|
| `pending` | — | — |
| `in_progress` | — | — |
| `visited` | ✓ | ✓ |
| `skipped` | ✗ | ✗ |
| `off_route` | ✗ | ✓ |

`off_route`: include in order totals/value; exclude from visit counts and strike rate.

## Instructions for AI
1. Stay scoped to the task. Do not touch code outside the described change.
2. Read only files needed for the task.
3. Ask before loading files not mentioned in the prompt.
4. Do not add comments, types, or error handling to unchanged code.
5. Run `npx tsc --noEmit` after edits before reporting done.
