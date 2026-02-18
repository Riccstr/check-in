import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "checkin-tracker-offline";
const DB_VERSION = 1;

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
  };
  created_at_local: string;
  sync_status: "pending" | "synced" | "error";
  last_sync_attempt: string | null;
  error_message: string | null;
  // For UI display
  customer_name?: string;
}

export interface CachedCustomer {
  id: string;
  customer_name: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("offline_visits_queue")) {
          db.createObjectStore("offline_visits_queue", { keyPath: "client_generated_id" });
        }
        if (!db.objectStoreNames.contains("cached_customers")) {
          db.createObjectStore("cached_customers", { keyPath: "id" });
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
