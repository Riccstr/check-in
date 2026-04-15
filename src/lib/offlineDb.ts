import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "checkin-tracker-offline";
const DB_VERSION = 5;

export interface OfflineVisit {
  client_generated_id: string;
  payload: {
    rep_id: string;
    customer_id: string;
    visit_date: string;
    arrival_time: string;
    leaving_time: string;
    duration_minutes: number;
    notes: string | null;
    client_generated_id: string;
    status?: string;
    order_number?: string | null;
    order_quantity?: number | null;
    order_amount?: number | null;
  };
  created_at_local: string;
  sync_status: "pending" | "synced" | "error";
  last_sync_attempt: string | null;
  error_message: string | null;
  customer_name?: string;
  photo_base64?: string | null;
}

export interface OfflineScheduleItemUpdate {
  schedule_item_id: string;
  rep_id: string;
  schedule_date: string;
  customer_id: string;
  /** When set, the sync engine PATCHes this visits row by id instead of only updating schedule_items. */
  visitId?: string | null;
  payload: {
    arrival_time: string | null;
    leaving_time: string | null;
    duration_minutes: number | null;
    notes: string | null;
    status: string;
    order_number?: string | null;
    order_quantity?: number | null;
    order_amount?: number | null;
  };
  created_at_local: string;
  sync_status: "pending" | "synced" | "error";
  last_sync_attempt: string | null;
  error_message: string | null;
}

export interface CachedCustomer {
  id: string;
  customer_name: string;
  account_number?: string | null;
  area?: string | null;
}

export interface CachedSchedule {
  key: string;
  rep_id: string;
  schedule_date: string;
  schedule_id: string | null;
  data: any;
  cached_at: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("offline_visits_queue")) {
          db.createObjectStore("offline_visits_queue", { keyPath: "client_generated_id" });
        }
        if (!db.objectStoreNames.contains("offline_schedule_item_updates")) {
          db.createObjectStore("offline_schedule_item_updates", { keyPath: "schedule_item_id" });
        }
        if (!db.objectStoreNames.contains("cached_customers")) {
          db.createObjectStore("cached_customers", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("cached_schedules")) {
          db.createObjectStore("cached_schedules", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("cached_user_auth")) {
          db.createObjectStore("cached_user_auth", { keyPath: "user_id" });
        }
        if (!db.objectStoreNames.contains("pending_photos")) {
          db.createObjectStore("pending_photos", { keyPath: "scheduleItemId" });
        }
        if (!db.objectStoreNames.contains("active_card_state")) {
          db.createObjectStore("active_card_state", { keyPath: "key" });
        }
      },
    });
  }
  return dbPromise;
}

// === Offline Visits ===

export async function addOfflineVisit(visit: OfflineVisit): Promise<void> {
  const db = await getDb();
  await db.put("offline_visits_queue", visit);
}

export async function getAllOfflineVisits(): Promise<OfflineVisit[]> {
  const db = await getDb();
  return db.getAll("offline_visits_queue");
}

export async function getPendingVisits(): Promise<OfflineVisit[]> {
  const all = await getAllOfflineVisits();
  return all.filter((v) => v.sync_status === "pending" || v.sync_status === "error");
}

export async function updateVisitSyncStatus(
  clientId: string,
  status: "synced" | "error",
  errorMessage?: string
): Promise<void> {
  const db = await getDb();
  const visit = await db.get("offline_visits_queue", clientId);
  if (visit) {
    visit.sync_status = status;
    visit.last_sync_attempt = new Date().toISOString();
    visit.error_message = errorMessage || null;
    await db.put("offline_visits_queue", visit);
  }
}

export async function removeOfflineVisit(clientId: string): Promise<void> {
  const db = await getDb();
  await db.delete("offline_visits_queue", clientId);
}

export async function removeSyncedVisits(): Promise<number> {
  const all = await getAllOfflineVisits();
  const synced = all.filter((v) => v.sync_status === "synced");
  const db = await getDb();
  const tx = db.transaction("offline_visits_queue", "readwrite");
  for (const v of synced) {
    await tx.store.delete(v.client_generated_id);
  }
  await tx.done;
  return synced.length;
}

// === Offline Schedule Item Updates ===

export async function upsertOfflineScheduleItemUpdate(update: OfflineScheduleItemUpdate): Promise<void> {
  const db = await getDb();
  await db.put("offline_schedule_item_updates", update);
}

export async function getAllOfflineScheduleItemUpdates(): Promise<OfflineScheduleItemUpdate[]> {
  const db = await getDb();
  return db.getAll("offline_schedule_item_updates");
}

export async function getPendingScheduleItemUpdates(): Promise<OfflineScheduleItemUpdate[]> {
  const all = await getAllOfflineScheduleItemUpdates();
  return all.filter((v) => v.sync_status === "pending" || v.sync_status === "error");
}

export async function updateScheduleItemUpdateSyncStatus(
  scheduleItemId: string,
  status: "synced" | "error",
  errorMessage?: string
): Promise<void> {
  const db = await getDb();
  const update = await db.get("offline_schedule_item_updates", scheduleItemId);
  if (update) {
    update.sync_status = status;
    update.last_sync_attempt = new Date().toISOString();
    update.error_message = errorMessage || null;
    await db.put("offline_schedule_item_updates", update);
  }
}

export async function removeSyncedScheduleItemUpdates(): Promise<number> {
  const all = await getAllOfflineScheduleItemUpdates();
  const synced = all.filter((v) => v.sync_status === "synced");
  const db = await getDb();
  const tx = db.transaction("offline_schedule_item_updates", "readwrite");
  for (const v of synced) {
    await tx.store.delete(v.schedule_item_id);
  }
  await tx.done;
  return synced.length;
}

// === Cached Customers ===

export async function setCachedCustomers(customers: CachedCustomer[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("cached_customers", "readwrite");
  await tx.store.clear();
  for (const c of customers) {
    await tx.store.put(c);
  }
  await tx.done;
}

export async function getCachedCustomers(): Promise<CachedCustomer[]> {
  const db = await getDb();
  return db.getAll("cached_customers");
}

// === Cached User Auth ===

export interface CachedUserProfile {
  id: string;
  full_name: string | null;
  created_at: string;
  login_updated_at?: string | null;
  login_updated_by?: string | null;
}

export interface CachedUserAuth {
  user_id: string;
  role: "admin" | "rep" | null;
  rep_id: string | null;
  rep_name: string | null;
  profile: CachedUserProfile | null;
  permissions: string[];
  cached_at: string;
}

export async function setCachedUserAuth(auth: CachedUserAuth): Promise<void> {
  const db = await getDb();
  await db.put("cached_user_auth", auth);
}

export async function getCachedUserAuth(userId: string): Promise<CachedUserAuth | null> {
  const db = await getDb();
  const cached = (await db.get("cached_user_auth", userId)) as CachedUserAuth | null;
  if (!cached) return null;

  return {
    ...cached,
    profile: cached.profile ?? null,
    permissions: Array.isArray(cached.permissions) ? cached.permissions : [],
  };
}

export async function clearCachedUserAuth(userId: string): Promise<void> {
  const db = await getDb();
  await db.delete("cached_user_auth", userId);
}

// === Cached Schedules ===

export async function setCachedSchedule(repId: string, date: string, data: any): Promise<void> {
  const db = await getDb();
  await db.put("cached_schedules", {
    key: `${repId}_${date}`,
    rep_id: repId,
    schedule_date: date,
    schedule_id: data?.id || null,
    data,
    cached_at: new Date().toISOString(),
  });
}

export async function getCachedSchedule(repId: string, date: string): Promise<any | null> {
  const db = await getDb();
  const cached = await db.get("cached_schedules", `${repId}_${date}`);
  return cached?.data || null;
}

export async function updateCachedScheduleItem(
  repId: string,
  date: string,
  itemId: string,
  updates: Record<string, any>
): Promise<void> {
  const db = await getDb();
  const key = `${repId}_${date}`;
  const cached = await db.get("cached_schedules", key);
  if (!cached?.data?.schedule_items || !Array.isArray(cached.data.schedule_items)) return;

  cached.data.schedule_items = cached.data.schedule_items.map((item: any) =>
    item.id === itemId ? { ...item, ...updates } : item
  );
  cached.cached_at = new Date().toISOString();

  await db.put("cached_schedules", cached);
}

// === Pending Photos ===

export async function savePendingPhoto(scheduleItemId: string, base64: string): Promise<void> {
  const db = await getDb();
  await db.put("pending_photos", { scheduleItemId, base64 });
}

export async function getPendingPhoto(scheduleItemId: string): Promise<string | null> {
  const db = await getDb();
  const entry = await db.get("pending_photos", scheduleItemId);
  return entry?.base64 ?? null;
}

export async function clearPendingPhoto(scheduleItemId: string): Promise<void> {
  const db = await getDb();
  await db.delete("pending_photos", scheduleItemId);
}

// === Active Card State ===

export interface ActiveCardState {
  scheduleItemId: string;
  arrivalTime: string;
  notes: string;
  /** Supabase visits.id created at online arrival. Used for PATCH at checkout. */
  visitId?: string | null;
  /** UUID generated at arrival for idempotent upsert. */
  clientGeneratedId?: string | null;
}

export async function saveActiveCard(data: ActiveCardState): Promise<void> {
  const db = await getDb();
  await db.put("active_card_state", { key: "current", ...data });
}

export async function getActiveCard(): Promise<ActiveCardState | null> {
  const db = await getDb();
  const entry = await db.get("active_card_state", "current");
  if (!entry) return null;
  return {
    scheduleItemId: entry.scheduleItemId,
    arrivalTime: entry.arrivalTime,
    notes: entry.notes,
    visitId: entry.visitId ?? null,
    clientGeneratedId: entry.clientGeneratedId ?? null,
  };
}

export async function clearActiveCard(): Promise<void> {
  const db = await getDb();
  await db.delete("active_card_state", "current");
}
