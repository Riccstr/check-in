# Architecture

**Stack:** React 18 / TypeScript / Vite · Tailwind + shadcn/ui · Supabase (Postgres, Auth, Storage, Realtime, Edge Functions) · IndexedDB (idb) · Vercel

## Auth Chain
```
auth.users → user_roles (role: admin|rep)
           → profiles   (display name, login audit)
           → reps       (rep record) → customer_assignments → customers
```
Role checks: `has_role(uid, role)` SECURITY DEFINER — never metadata.

## Data Flow
```
weekly_templates + schedule_templates + schedule_template_items
    ↓ auto_generate_daily_schedule() — idempotent, today/past only
daily_schedules → schedule_items (pending → in_progress → visited|skipped)
    ↓ checkout
visits (INSERT/UPDATE — order fields, photo_url)
    ↓ if offline
IndexedDB queue → syncEngine on reconnect → Supabase
```

## Key Modules
| Path | Purpose |
|------|---------|
| `src/pages/DailySchedule.tsx` | Rep UI — schedule cards, unscheduled + off-route forms, offline |
| `src/pages/admin/AdminDashboard.tsx` | Live overview — stat strip, rep cards, activity feed |
| `src/pages/admin/AdminExports.tsx` | CSV / Excel / PDF exports |
| `src/pages/admin/AdminVisits.tsx` | All-visits table, edit/delete |
| `src/pages/admin/CustomerDashboard.tsx` | Per-customer metrics, strike rate, order trend |
| `src/lib/offlineDb.ts` | All IndexedDB read/write |
| `src/lib/syncEngine.ts` | Background sync, idempotent via `client_generated_id` |
| `src/lib/offlineBootstrap.ts` | Pre-caches customers/schedules/auth on first login |
| `src/lib/imageCompressor.ts` | `compressImage()`, `stampImage()` |
| `src/hooks/useAuth.tsx` | Auth context — role, repId, permissions, bootstrap state |
| `src/components/AppLayout.tsx` | Layout, auth guard, auto-sync |
| `supabase/functions/manage-rep-user/` | Create/update rep auth accounts |
| `supabase/functions/manage-users/` | Full user lifecycle |

## Offline
- **IDB name/version:** `checkin-tracker-offline` v5 — increment on schema changes
- **Stores:** `offline_visits_queue`, `offline_schedule_item_updates`, `cached_customers`, `cached_schedules`, `cached_user_auth`, `pending_photos`, `active_card_state`
- **Sync triggers:** `online` (1.5s), `visibilitychange` (1s), app load (2s), manual button

## Scheduling
- 4-week rotation: `weekly_templates` (sort_order 1–4), anchored by `week_cycle_start_date` in `app_settings`
- `get_week_order_for_date(date)` → week number 1–4
- Template save deletes future unstarted `daily_schedules` → forces regeneration

## Exports
- CSV: manual string builder
- Excel: `xlsx-js-style` (not `xlsx`)
- PDF: `jsPDF` + `jspdf-autotable`, A4 landscape, logo as base64

## Service Worker
`src/sw-custom.ts`, `vite-plugin-pwa` injectManifest. Supabase API → NetworkOnly. Static assets → CacheFirst. HTML → NetworkFirst.
