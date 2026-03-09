# Check-In Tracker - Project Memory

## Overview
A PWA (Progressive Web App) for sales reps to log customer visits. Built with React + TypeScript + Vite, using Supabase as backend and shadcn/ui for components.

## Tech Stack
- **Frontend**: React 18, TypeScript, Vite, TailwindCSS, shadcn/ui (Radix UI)
- **Backend**: Supabase (Postgres + Auth + Storage + Realtime)
- **Offline**: IndexedDB via `idb` library
- **State**: TanStack React Query + local useState
- **Routing**: React Router v6
- **Forms**: react-hook-form + zod
- **PWA**: vite-plugin-pwa (service worker)
- **Package manager**: bun (bun.lock present)

## User Roles
- **admin**: Redirected to `/admin/visits` on login. Has full access to all admin pages.
- **rep**: Redirected to `/schedule` on login. Can log visits and view their own schedule/history.

## Key Pages
- `/schedule` — Daily schedule for a rep. Auto-generates from template via `auto_generate_daily_schedule` RPC. Has realtime updates via Supabase channels.
- `/log-visit` — Standalone form to log a visit (customer, date, arrival/leaving time, photo, notes).
- `/my-visits` — Rep's visit history.
- `/admin/*` — Admin pages: customers, reps, assignments, schedules, visits, reports, users, account.

## Database Tables (Supabase)
- `customers` — customer_name, account_number, area, is_active
- `customer_assignments` — rep_id → customer_id
- `reps` — rep_name, user_id
- `user_roles` — user_id, role ("admin" | "rep")
- `profiles` — id, full_name, created_at, login_updated_at
- `daily_schedules` — rep_id, schedule_date
- `schedule_items` — schedule_id, customer_id, sort_order, status, arrival_time, leaving_time, duration_minutes, notes, visit_id
- `visits` — rep_id, customer_id, visit_date, arrival_time, leaving_time, duration_minutes, notes, photo_url, client_generated_id, status
- `weekly_templates` — name, sort_order
- `app_settings` — setting_key, setting_value

## Offline Architecture (src/lib/)
- **offlineDb.ts**: IndexedDB wrapper (DB: `checkin-tracker-offline`, version 4)
  - Stores: `offline_visits_queue`, `offline_schedule_item_updates`, `cached_customers`, `cached_schedules`, `cached_user_auth`
- **syncEngine.ts**: Syncs pending visits and schedule item updates to Supabase when back online
  - Idempotent: checks `client_generated_id` and duplicate times before inserting
  - Uploads offline photos (stored as base64) on sync
  - Auto-syncs on: `online` event, `visibilitychange`, app load
- **offlineBootstrap.ts**: Pre-loads data for offline use
- **imageCompressor.ts**: Compresses photos before upload/storage

## Auth (src/hooks/useAuth.tsx)
- Uses Supabase auth with `onAuthStateChange`
- Caches role/rep info in IndexedDB for offline access
- Roles: "admin" | "rep" | null
- Has safety timeout (8s) to avoid stuck loading states
- `refreshAuthContext()` re-fetches from server and refreshes offline bootstrap

## Important Patterns
- **Optimistic updates**: Schedule items update locally first, then sync to server
- **Offline-first**: All mutations fall back to IndexedDB queue if network fails
- **Photo handling**: Compressed via canvas, stored as base64 offline, uploaded to `visit-photos` storage bucket
- **Route persistence**: Last route saved to localStorage, restored on app open (except `/auth`)
- **Visit status**: "pending" | "visited" | "skipped"
- **Schedule item status**: same as visit status + "in progress" (derived: has arrival but no leaving time)

## Key File Paths
- Entry: `src/main.tsx`, `src/App.tsx`
- Auth hook: `src/hooks/useAuth.tsx`
- Offline DB: `src/lib/offlineDb.ts`
- Sync engine: `src/lib/syncEngine.ts`
- Supabase types: `src/integrations/supabase/types.ts`
- Service worker: `src/sw-custom.ts`
- Layout: `src/components/AppLayout.tsx`
