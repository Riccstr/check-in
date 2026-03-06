# Check-In Tracker

A **field sales representative check-in tracking application** built for companies that manage sales reps visiting customer stores on scheduled routes. The app follows an **offline-first architecture** — reps can check in, take photos, add notes, and skip visits even without internet, and everything syncs automatically when connectivity is restored.

**Live URL:** https://check-in-tracker.lovable.app

---

## Table of Contents

1. [Overview](#overview)
2. [Technology Stack](#technology-stack)
3. [User Roles & Access Control](#user-roles--access-control)
4. [Authentication System](#authentication-system)
5. [Database Schema](#database-schema)
6. [Application Features](#application-features)
   - [Representative Features](#representative-features)
   - [Administrator Features](#administrator-features)
7. [Offline-First Architecture](#offline-first-architecture)
8. [Scheduling System & Week Rotation](#scheduling-system--week-rotation)
9. [Visit Logging Workflow](#visit-logging-workflow)
10. [Photo Capture & Storage](#photo-capture--storage)
11. [Edge Functions (Backend Logic)](#edge-functions-backend-logic)
12. [File Storage](#file-storage)
13. [Realtime Subscriptions](#realtime-subscriptions)
14. [UI & Navigation Structure](#ui--navigation-structure)
15. [Design System & Theming](#design-system--theming)
16. [PWA Support](#pwa-support)
17. [Project Structure](#project-structure)
18. [Key Libraries & Dependencies](#key-libraries--dependencies)
19. [Development Setup](#development-setup)

---

## Overview

Check-In Tracker enables companies to:
- Define **weekly visit schedules** for sales reps using a rotating template system
- Track **real-time check-ins and check-outs** at customer locations
- Capture **store photos** during visits
- View **visit history, duration averages, and reports**
- Export visit data as **CSV or formatted Excel reports**
- Operate **fully offline** with automatic background sync

The system has two user roles: **Admin** (full management) and **Rep** (field operations).

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite |
| UI Components | shadcn/ui (Radix primitives) |
| Styling | Tailwind CSS with HSL design tokens |
| State Management | React Context (Auth), TanStack React Query |
| Routing | React Router v6 |
| Backend | Lovable Cloud (Supabase) |
| Database | PostgreSQL (via Supabase) |
| Auth | Supabase Auth (email/password) |
| File Storage | Supabase Storage (`visit-photos` bucket) |
| Backend Functions | Supabase Edge Functions (Deno) |
| Offline Storage | IndexedDB (via `idb` library) |
| PWA | vite-plugin-pwa |
| Excel Export | SheetJS (`xlsx`) |

---

## User Roles & Access Control

Roles are stored in a dedicated `user_roles` table (never on the `profiles` or `auth.users` table) to prevent privilege escalation.

### Role: Admin
- Full CRUD on all tables (customers, reps, assignments, schedules, visits, users)
- Can create/delete user accounts, change roles, reset passwords, update emails
- Can export data (CSV, Excel)
- Can permanently delete customers (with manual cascade)
- **Cannot** log visits — admins are management-only
- Navigation: Customers, Reps, Assignments, Schedules, Visits, Reports, Users, Account

### Role: Rep
- View their assigned daily schedule
- Log check-ins/check-outs with arrival/departure times
- Take optional store photos during check-in
- Add notes to visits
- Skip visits with mandatory reason
- Log unscheduled (ad-hoc) visits
- View their own visit history
- Navigation: Schedule, My Visits

### Role Checking
A `has_role()` PostgreSQL function (SECURITY DEFINER) is used in all RLS policies to prevent recursive checks:
```sql
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
```

### RLS Policy Pattern
Every table has Row-Level Security enabled. The general pattern is:
- **Admins:** Full access via `has_role(auth.uid(), 'admin')`
- **Reps:** Read/write only their own data, verified through joins to the `reps` table where `reps.user_id = auth.uid()`

---

## Authentication System

### Login Flow
- **Admin-managed accounts only** — there is no public self-registration
- Auth page (`/auth`) is a simple email + password sign-in form
- The first user created automatically becomes an admin (via `auto_assign_role` trigger)
- Subsequent users created through the admin UI or the auto-assign trigger get the `rep` role

### Auth Context (`src/hooks/useAuth.tsx`)
The `AuthProvider` wraps the entire app and provides:
- `user`, `session` — Supabase auth state
- `role` — `"admin"` | `"rep"` | `null`
- `repId`, `repName` — The rep's record ID and display name (for reps)
- `profile` — User profile data (full_name, login audit fields)
- `permissions` — Simple permission array (`["admin:all"]` or `["rep:schedule", "rep:visits"]`)
- `roleState` — State machine: `"loading"` → `"ready"` | `"unassigned"` | `"offline_bootstrap_required"` | `"resolving"`
- `loading` — Boolean for initial auth resolution

### Auth Resolution Strategy
1. Listen to `onAuthStateChange` for session events
2. Immediately try to load cached auth context from IndexedDB
3. If cached role exists, apply it immediately (instant UI)
4. In parallel, fetch fresh role/profile from server
5. If server succeeds, update state and re-cache
6. If offline with no cache, show "offline bootstrap required" screen
7. Safety timeout of 8 seconds prevents infinite loading states

### Credential Management
Admin-initiated email/password changes bypass email confirmation flows (using `email_confirm: true` in the admin API). The `profiles` table tracks `login_updated_at` and `login_updated_by` for audit purposes.

---

## Database Schema

### Tables

#### `customers`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| customer_name | text | Required |
| account_number | text | Unique, optional |
| area | text | Geographic grouping |
| is_active | boolean | Soft delete |
| created_at | timestamptz | |

#### `reps`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| rep_name | text | Required |
| surname | text | |
| email | text | |
| cell_no | text | |
| user_id | uuid | Links to auth.users |
| is_active | boolean | Soft delete |
| created_at | timestamptz | |

#### `customer_assignments`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| rep_id | uuid (FK → reps) | |
| customer_id | uuid (FK → customers) | |
| assigned_at | timestamptz | |

Links customers to reps. A customer can be assigned to one rep.

#### `weekly_templates`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| name | text | e.g., "Week 1a", "Week 2b" |
| sort_order | integer | Determines rotation position |
| is_active | boolean | |
| created_at | timestamptz | |

Defines the rotation weeks (e.g., 4-week cycle: Week 1a → Week 2a → Week 1b → Week 2b).

#### `schedule_templates`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| rep_id | uuid (FK → reps) | |
| day_of_week | integer | 1=Monday ... 5=Friday |
| weekly_template_id | uuid (FK → weekly_templates) | |
| is_active | boolean | |
| created_at | timestamptz | |

Per-rep, per-day, per-week template defining which customers to visit.

#### `schedule_template_items`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| template_id | uuid (FK → schedule_templates) | |
| customer_id | uuid (FK → customers) | |
| sort_order | integer | Visit sequence |

Ordered list of customers within a template.

#### `daily_schedules`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| rep_id | uuid (FK → reps) | |
| schedule_date | date | |
| created_at | timestamptz | |

Auto-generated from templates when a rep views a date.

#### `schedule_items`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| schedule_id | uuid (FK → daily_schedules) | |
| customer_id | uuid (FK → customers) | |
| sort_order | integer | |
| status | text | `"pending"`, `"visited"`, `"skipped"` |
| arrival_time | time | |
| leaving_time | time | |
| duration_minutes | integer | Calculated |
| notes | text | |
| visit_id | uuid (FK → visits) | Links to the visit record |

#### `visits`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| rep_id | uuid (FK → reps) | |
| customer_id | uuid (FK → customers) | |
| visit_date | date | Defaults to current date |
| arrival_time | time | |
| leaving_time | time | |
| duration_minutes | integer | |
| notes | text | |
| status | text | `"visited"` or `"skipped"` |
| photo_url | text | Public URL from storage |
| latitude | double precision | Reserved (GPS, currently unused) |
| longitude | double precision | Reserved (GPS, currently unused) |
| location_address | text | Reserved (reverse geocode, currently unused) |
| client_generated_id | uuid | For offline deduplication |
| created_at | timestamptz | |

#### `user_roles`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| user_id | uuid (FK → auth.users) | |
| role | app_role enum | `"admin"` or `"rep"` |

Unique constraint on (user_id, role).

#### `profiles`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | Same as auth.users.id |
| full_name | text | |
| login_updated_at | timestamptz | Audit: when admin changed credentials |
| login_updated_by | uuid | Audit: which admin changed credentials |
| created_at | timestamptz | |

#### `app_settings`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| setting_key | text | e.g., `"current_week_order"`, `"week_cycle_start_date"` |
| setting_value | text | |
| updated_at | timestamptz | |
| updated_by | uuid | |

### Database Functions

| Function | Purpose |
|----------|---------|
| `has_role(_user_id, _role)` | SECURITY DEFINER check for RLS policies |
| `auto_generate_daily_schedule(p_rep_id, p_schedule_date)` | Creates a daily schedule from the matching template |
| `get_week_order_for_date(p_date)` | Computes which rotation week a date falls in |
| `get_my_rep_id()` | Returns the calling user's rep ID |
| `handle_new_user()` | Trigger: creates a profile row on auth.users insert |
| `auto_assign_role()` | Trigger: assigns admin to first user, rep to subsequent |

### Enum Types
```sql
CREATE TYPE public.app_role AS ENUM ('admin', 'rep');
```

---

## Application Features

### Representative Features

#### Daily Schedule Page (`/schedule`)
- **Default landing page** for reps
- Date picker to navigate between days
- Shows current rotation week name (e.g., "Week 1a")
- **Two tabs:** "Schedule" (pending items) and "Completed" (visited/skipped) with count badges
- Auto-generates daily schedule from templates via `auto_generate_daily_schedule()` RPC
- Each schedule item shows:
  - Customer name with account number
  - Status badge (Pending / In Progress / Visited / Skipped)
  - Arrival and leaving time inputs with "Now" quick-fill buttons
  - Optional store photo capture (appears after arrival is recorded)
  - Notes textarea
  - "Skip" button (requires notes) and "Mark Visited" button
- **Realtime:** Listens for `schedule_items` and `daily_schedules` changes via Supabase Realtime channels
- **Ad-hoc visits:** "Log Unscheduled Visit" section at bottom for visits to customers not on the day's schedule

#### Log a Visit Page (`/log-visit`)
- Manual visit logging form for ad-hoc visits
- Customer dropdown (from assigned customers)
- Date, arrival time, leaving time inputs with "Arrived Now" / "Left Now" buttons
- Duration auto-calculated and displayed
- Optional store photo capture
- Notes textarea
- Submit button shows "Save Offline" when offline

#### My Visits Page (`/my-visits`)
- Filterable visit history table
- Filters: date range, customer
- Columns: Date, Customer, Account #, Arrival, Leaving, Duration, Photo (thumbnail), Notes, Status (sync status)
- Offline visits shown with "Pending" / "Error" badges
- "Sync Now" button appears when there are pending offline visits and the device is online
- Edit dialog for synced visits (date, arrival, leaving, notes)
- Delete functionality for synced visits
- Photo lightbox: click thumbnail to see full-size image with customer name and date

### Administrator Features

#### Customers Page (`/admin/customers`)
- Full CRUD for customer records
- Fields: Name (required), Account Number (unique, real-time validation), Area, Assigned Rep
- Sortable columns: Name, Area, Rep
- Filter popover: by Rep, Area, Active/Inactive status
- Search bar across name, area, and rep
- Active/Inactive toggle (soft delete)
- **Permanent delete** with cascade: removes schedule_template_items, schedule_items, visits, customer_assignments, then the customer
- Account number uniqueness checked in real-time with 300ms debounce

#### Reps Page (`/admin/reps`)
- List of all reps with Name, Surname, Status
- Add new rep (name + surname only)
- Edit rep details (name, surname, email, password)
- **Set Login** button (KeyRound icon): creates an auth user and links to the rep record, only shown for reps without a `user_id`
- Active/Inactive toggle
- Updates use the `manage-rep-user` edge function

#### Assignments Page (`/admin/assignments`)
- Assign customers to reps via dual dropdown
- View all current assignments in a table
- Filter by rep and area
- Remove individual assignments

#### Schedules Page (`/admin/schedules`)
- **Three sections:**
  1. **Week Rotation Settings:** View/reorder/rename weekly templates, set current active week
  2. **Weekly Templates (per rep):** Define which customers a rep visits on each weekday for each rotation week
     - Searchable/filterable customer selector with checkboxes
     - Drag-to-reorder visit sequence (sort order)
     - Saving a template auto-deletes future unstarted daily schedules to trigger regeneration
  3. **Daily Schedules:** View generated daily schedules with status indicators

#### Visits Page (`/admin/visits`)
- All visits across all reps
- Filters: Rep, Customer, Date From, Date To
- Columns: Date, Rep, Customer, Account #, Arrival, Leaving, Duration, Photo (40x40 thumbnail), Notes
- Skipped visits highlighted with red background and badge
- Photo lightbox: shows full image with Rep name, Customer name, Date
- Edit dialog (date, arrival, leaving, notes)
- Delete with visit_id cleanup in schedule_items

#### Reports/Exports Page (`/admin/reports`)
- Three export options:
  1. **Visits CSV:** Raw visit data export
  2. **Averages CSV:** Aggregated duration averages per rep-customer pair
  3. **Excel Report:** Formatted spreadsheet with:
     - Title row and rep/date header
     - Styled column headers (dark blue background, white text)
     - Alternating row colors
     - Skipped visits highlighted in red
     - Total productive time calculation
     - Requires selecting a specific rep and start date

#### Users Page (`/admin/users`)
- Comprehensive user account management
- View: Email, Name, Role (badge), Linked Rep, Created date, Last Sign In
- Login audit trail: "Login changed [date] by [admin name]"
- Actions per user (with tooltips):
  - 📧 Change email (bypasses confirmation)
  - 🛡️ Change role (admin ↔ rep)
  - 🔑 Reset password (bypasses confirmation)
  - 🗑️ Delete user (unlinks from rep record)
- **Add User** button: Create with email, password, first name, surname, role
- Self-deletion protection (admin cannot delete their own account)

#### Account Page (`/admin/account`)
- Update own email (requires inbox confirmation)
- Change own password

---

## Offline-First Architecture

The app is designed to **never block the user** with offline screens. All actions complete immediately via optimistic UI updates and queue for background sync.

### IndexedDB Schema (`src/lib/offlineDb.ts`)

Database name: `checkin-tracker-offline`, version 4

| Store | Key | Purpose |
|-------|-----|---------|
| `offline_visits_queue` | `client_generated_id` | Queued visit records awaiting sync |
| `offline_schedule_item_updates` | `schedule_item_id` | Queued schedule item updates |
| `cached_customers` | `id` | Cached customer list for offline dropdowns |
| `cached_schedules` | `key` (repId_date) | Cached daily schedules |
| `cached_user_auth` | `user_id` | Cached role, repId, permissions |

### Offline Visit Record Structure
```typescript
interface OfflineVisit {
  client_generated_id: string;      // UUID for deduplication
  payload: {                         // Mirrors the visits table insert
    rep_id, customer_id, visit_date,
    arrival_time, leaving_time, duration_minutes,
    notes, client_generated_id, status?
  };
  created_at_local: string;
  sync_status: "pending" | "synced" | "error";
  last_sync_attempt: string | null;
  error_message: string | null;
  customer_name?: string;            // For display while offline
  photo_base64?: string | null;      // Compressed JPEG as data URL
}
```

### Sync Engine (`src/lib/syncEngine.ts`)

**Trigger points:**
- `online` event (1.5s delay)
- `visibilitychange` to "visible" when online (1s delay)
- App load when online (2s delay)
- Manual "Sync Now" button

**Visit sync flow:**
1. Get all pending/error visits from IndexedDB
2. Sort by `created_at_local` (chronological order)
3. For each visit:
   - Check idempotency: query `visits` by `client_generated_id`
   - Check duplicate: query by rep_id + customer_id + date + times
   - If neither exists, insert the visit
   - On success: link to schedule item, upload queued photo
   - Mark as synced or error in IndexedDB
4. Remove all synced records from IndexedDB
5. Also sync pending schedule item updates

**Duplicate prevention:** The `client_generated_id` field ensures visits are never duplicated even if the sync runs multiple times.

### Offline Bootstrap (`src/lib/offlineBootstrap.ts`)
On first online login, the app pre-caches:
- Assigned customers list
- Daily schedules for a window of -2 to +7 days

This enables full offline operation after a single online session.

### Optimistic UI Updates
Schedule item changes (arrival, leaving, notes, status) are applied to local state immediately, then persisted to IndexedDB cached schedules, and finally synced to the server. The UI never waits for server confirmation.

### Route Persistence
The current route is saved to `localStorage` so that if the app is backgrounded and restored (common on mobile), the user returns to the same screen instead of the home page.

---

## Scheduling System & Week Rotation

### Rotation Logic
The system uses a configurable N-week rotation (default 4 weeks):
- Weekly templates have a `sort_order` (1, 2, 3, 4)
- A reference start date is stored in `app_settings` (`week_cycle_start_date`)
- The `get_week_order_for_date()` function computes which week any given date falls in:
  ```
  weeks_elapsed = floor((target_date - start_date) / 7)
  week_index = ((weeks_elapsed % total_weeks) + total_weeks) % total_weeks + 1
  ```

### Schedule Generation Flow
1. Rep opens schedule page for a date
2. App checks if `daily_schedules` record exists for that rep + date
3. If not, calls `auto_generate_daily_schedule()` RPC
4. RPC determines the day of week and rotation week
5. Finds matching template and copies items to a new daily schedule
6. Rep sees the generated schedule immediately

### Template Save → Regeneration
When an admin saves a template:
1. Template items are replaced
2. Future daily schedules for that rep/day that have no started items (no arrivals, no visited/skipped) are deleted
3. Next time the rep opens that date, the schedule auto-regenerates from the updated template
4. Supabase Realtime pushes the change to any connected rep

---

## Visit Logging Workflow

### Scheduled Visit Flow (DailySchedule page)
1. **Arrive:** Rep taps "Now" next to arrival time → records current time
2. **Photo (optional):** Camera button appears after arrival → take photo or select from gallery
3. **Leave:** Rep taps "Now" next to leaving time → records current time, status becomes "visited", item moves to "Completed" tab
4. **Duration:** Auto-calculated as `leaving - arrival` in minutes. Zero-minute visits are allowed.

### Skip Flow
1. Rep writes a reason in the notes field (mandatory)
2. Taps "Skip" button
3. Status becomes "skipped", a visit record is created with 00:00 times and 0 duration

### Ad-hoc Visit Flow
1. Rep expands "Log Unscheduled Visit" section
2. Selects customer, enters times, optional notes
3. Creates a visit record not linked to any schedule item

### Offline Visit Flow
1. All the above flows work identically offline
2. Visit data is saved to IndexedDB with `sync_status: "pending"`
3. Schedule item updates are also queued separately
4. On reconnection, the sync engine processes the queue

---

## Photo Capture & Storage

### Capture
- File input with `accept="image/*"` and `capture="environment"` (opens rear camera on mobile)
- Photos are **compressed** client-side using canvas: max 1200px dimension, 70% JPEG quality (`src/lib/imageCompressor.ts`)

### Online Upload
1. Visit is inserted into the database
2. Photo blob is uploaded to `visit-photos` storage bucket at path `{rep_id}/{visit_id}.jpg`
3. Public URL is retrieved and stored in `visits.photo_url`

### Offline Storage
1. Compressed photo is converted to Base64 data URL
2. Stored in IndexedDB alongside the visit record (`photo_base64` field)
3. On sync: Base64 is converted back to Blob, uploaded to storage, and `photo_url` is updated

### Display
- **40x40px thumbnails** in visit tables (admin and rep views)
- **Lightbox modal** on click: full-size image with customer name, rep name (admin), and date
- Lazy loading on thumbnails for performance

### Storage Bucket
- Bucket name: `visit-photos`
- Public: Yes (photos accessible via public URL)
- RLS policies allow reps to upload to their own path and read all photos

---

## Edge Functions (Backend Logic)

### `manage-rep-user`
**Purpose:** Create or update auth user accounts linked to rep records.

**Actions:**
- `create`: Creates an auth user, links to rep via `user_id`, sets email on rep record
- `update`: Updates rep details and optionally updates auth user email/password

**Security:** Verifies caller is admin via `user_roles` check using service role key.

### `manage-users`
**Purpose:** Full user lifecycle management for the admin Users page.

**Actions:**
- `list`: Returns all users enriched with roles, linked reps, profiles, and login audit data
- `create_user`: Creates auth user with role assignment (bypasses email confirmation)
- `update_role`: Changes a user's role (admin ↔ rep)
- `update_email`: Changes email (bypasses confirmation, records audit)
- `reset_password`: Sets new password (bypasses confirmation, records audit)
- `delete_user`: Unlinks from rep, removes role, deletes auth user (self-deletion blocked)

**Security:** Both functions verify admin role using service role key and reject non-admin callers with 403.

**Config:** Both are set to `verify_jwt = false` in `supabase/config.toml` because they handle their own auth verification internally.

---

## File Storage

| Bucket | Public | Purpose |
|--------|--------|---------|
| `visit-photos` | Yes | Store photos taken during rep check-ins |

Upload path pattern: `{rep_id}/{visit_id}.jpg`

---

## Realtime Subscriptions

The app uses Supabase Realtime PostgreSQL changes for live updates:

| Channel | Table | Filter | Purpose |
|---------|-------|--------|---------|
| `schedule-items-{id}` | `schedule_items` | `schedule_id=eq.{id}` | Refresh when admin edits items |
| `daily-schedules-{repId}` | `daily_schedules` | `rep_id=eq.{repId}` | Refresh when schedule is created/deleted |

Both channels listen for all events (`*`: INSERT, UPDATE, DELETE).

---

## UI & Navigation Structure

### Layout (`src/components/AppLayout.tsx`)
- Sticky header with logo, navigation links, offline status indicator, role badge, sign out button
- Desktop: horizontal nav bar
- Mobile: hamburger menu with slide-down nav
- Main content area: max-width 7xl, padded

### Routing

| Path | Component | Access |
|------|-----------|--------|
| `/auth` | Auth (login) | Public |
| `/` | Index (redirect) | Redirects admin → `/admin/visits`, rep → `/schedule` |
| `/schedule` | DailySchedule | Rep |
| `/log-visit` | LogVisit | Rep |
| `/my-visits` | MyVisits | Rep |
| `/admin/customers` | AdminCustomers | Admin |
| `/admin/reps` | AdminReps | Admin |
| `/admin/assignments` | AdminAssignments | Admin |
| `/admin/schedules` | AdminSchedules | Admin |
| `/admin/visits` | AdminVisits | Admin |
| `/admin/reports` | AdminExports | Admin |
| `/admin/users` | AdminUsers | Admin |
| `/admin/account` | AdminAccount | Admin |
| `*` | NotFound | All |

### Global Error Handling
- Unhandled promise rejections are caught globally
- Offline-related errors (load failed, fetch failed, network error) are silently suppressed
- Other errors show a toast notification

### Offline Status Bar (`src/components/OfflineStatusBar.tsx`)
- Shows a visual indicator when the device is offline
- Uses `useOnlineStatus` hook monitoring `navigator.onLine` and `online`/`offline` events

---

## Design System & Theming

### Color Palette (HSL)
The app uses a **green + blue professional theme**:

| Token | Light Mode | Purpose |
|-------|-----------|---------|
| `--primary` | `138 65% 38%` (Forest Green) | Primary actions, active nav |
| `--accent` | `210 75% 40%` (Blue) | Secondary actions, icons |
| `--background` | `140 15% 97%` (Light sage) | Page background |
| `--foreground` | `215 50% 12%` (Dark navy) | Text |
| `--destructive` | `0 72% 51%` (Red) | Errors, delete actions |
| `--success` | `138 65% 38%` (Green) | Success states |
| `--warning` | `38 92% 50%` (Orange) | Warning states |

Dark mode is defined but the app primarily operates in light mode.

### Typography
- Font: Inter, system-ui, -apple-system, sans-serif
- Nav links use custom utility classes: `.nav-link`, `.nav-link-active`, `.nav-link-inactive`

### Component Library
All UI components are from **shadcn/ui** built on Radix primitives:
- Card, Dialog, AlertDialog, Sheet, Popover
- Table, Tabs, Badge, Button
- Input, Textarea, Select, Checkbox, Label
- Toast (both Radix and Sonner implementations)

---

## PWA Support

The app is configured as a Progressive Web App via `vite-plugin-pwa`:
- Service worker for asset caching
- App icons: `pwa-192x192.png`, `pwa-512x512.png`
- Custom service worker logic in `src/sw-custom.ts`
- Installable on mobile home screens

---

## Project Structure

```
src/
├── assets/              # Static assets (logo)
├── components/
│   ├── ui/              # shadcn/ui components (50+ components)
│   ├── AppLayout.tsx     # Main layout with nav, auth guard, auto-sync
│   ├── NavLink.tsx       # Navigation link component
│   └── OfflineStatusBar.tsx  # Offline indicator
├── hooks/
│   ├── useAuth.tsx       # Auth context provider & consumer
│   ├── useOnlineStatus.ts # Online/offline state hook
│   ├── use-mobile.tsx    # Mobile breakpoint detection
│   └── use-toast.ts      # Toast hook
├── integrations/
│   └── supabase/
│       ├── client.ts     # Supabase client (auto-generated, DO NOT EDIT)
│       └── types.ts      # Database types (auto-generated, DO NOT EDIT)
├── lib/
│   ├── imageCompressor.ts  # JPEG compression + base64 conversion
│   ├── offlineBootstrap.ts # Pre-cache data on first online login
│   ├── offlineDb.ts        # IndexedDB operations (visits, schedules, auth cache)
│   ├── syncEngine.ts       # Background sync for offline visits/updates
│   └── utils.ts            # Tailwind merge utility
├── pages/
│   ├── Auth.tsx           # Login page
│   ├── DailySchedule.tsx  # Rep: daily schedule with check-in flow
│   ├── Index.tsx          # Role-based redirect
│   ├── LogVisit.tsx       # Rep: manual visit logging
│   ├── MyVisits.tsx       # Rep: visit history
│   ├── NotFound.tsx       # 404 page
│   └── admin/
│       ├── AdminAccount.tsx      # Admin: change own email/password
│       ├── AdminAssignments.tsx   # Admin: customer-rep assignments
│       ├── AdminCustomers.tsx     # Admin: customer CRUD
│       ├── AdminExports.tsx       # Admin: CSV/Excel exports
│       ├── AdminReps.tsx          # Admin: rep management
│       ├── AdminSchedules.tsx     # Admin: schedule templates & daily schedules
│       ├── AdminUsers.tsx         # Admin: user account management
│       └── AdminVisits.tsx        # Admin: all visits view
├── App.tsx               # Root component, routing, providers
├── App.css               # Minimal global styles
├── index.css             # Tailwind + design tokens
├── main.tsx              # Entry point
└── vite-env.d.ts         # Vite type declarations

supabase/
├── config.toml           # Edge function config (auto-managed)
├── functions/
│   ├── manage-rep-user/index.ts   # Rep user account management
│   └── manage-users/index.ts      # Full user lifecycle management
└── migrations/           # Database migrations (auto-managed, DO NOT EDIT)

public/
├── favicon.ico
├── logo.png
├── pwa-192x192.png
├── pwa-512x512.png
├── placeholder.svg
└── robots.txt
```

---

## Key Libraries & Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@supabase/supabase-js` | ^2.95.3 | Database, auth, storage, edge functions |
| `@tanstack/react-query` | ^5.83.0 | Server state management |
| `react-router-dom` | ^6.30.1 | Client-side routing |
| `idb` | ^8.0.3 | IndexedDB wrapper for offline storage |
| `uuid` | ^13.0.0 | Client-generated IDs for deduplication |
| `xlsx` | ^0.18.5 | Excel file generation |
| `date-fns` | ^3.6.0 | Date formatting |
| `sonner` | ^1.7.4 | Toast notifications |
| `lucide-react` | ^0.462.0 | Icons |
| `vite-plugin-pwa` | ^1.2.0 | PWA support |
| `recharts` | ^2.15.4 | Charts (available, used for averages) |
| `zod` | ^3.25.76 | Schema validation |
| `react-hook-form` | ^7.61.1 | Form management |

---

## Development Setup

```bash
# Clone the repository
git clone <YOUR_GIT_URL>
cd <YOUR_PROJECT_NAME>

# Install dependencies
npm install

# Start development server
npm run dev
```

The app connects to the Lovable Cloud backend automatically via environment variables configured in `.env` (auto-managed, never edit manually):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`

### Running Tests
```bash
npm test
```

Tests use Vitest with the configuration in `vitest.config.ts`.

---

## Important Notes for Rebuilding

1. **Never store roles on `profiles` or `auth.users`** — always use the separate `user_roles` table
2. **Never edit auto-generated files:** `src/integrations/supabase/client.ts`, `types.ts`, `.env`, `supabase/config.toml`
3. **Edge functions deploy automatically** — no manual deployment needed
4. **The first user must be created through the app** — it auto-assigns admin role
5. **IndexedDB version must be incremented** if you add new object stores
6. **RLS policies use RESTRICTIVE mode** (`Permissive: No`) — all policies must explicitly allow access
7. **Photos are always compressed** before storage (max 1200px, 70% JPEG quality)
8. **The sync engine is idempotent** — running it multiple times never creates duplicates thanks to `client_generated_id`
9. **Schedule template saves cascade** — saving a template deletes future unstarted daily schedules to force regeneration
10. **Email confirmation is bypassed** for admin-created accounts (`email_confirm: true` in edge functions)
