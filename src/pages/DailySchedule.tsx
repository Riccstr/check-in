import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useUnscheduledVisits } from "@/hooks/useUnscheduledVisits";
import { supabase } from "@/integrations/supabase/client";
import {
  CalendarDays, Clock, Check, Plus, Loader2,
  ChevronLeft, ChevronRight, LogOut,
} from "lucide-react";
import { blobToBase64, compressImage } from "@/lib/imageCompressor";
import { fmtDuration } from "@/lib/timeUtils";

import {
  getCachedCustomers,
  setCachedCustomers,
  setCachedSchedule,
  getCachedSchedule,
  updateCachedScheduleItem,
  getActiveVisit,
  saveActiveVisit,
  clearActiveVisit,
  type ActiveVisit,
} from "@/lib/offlineDb";
import {
  startVisit, checkOut, updateDraft, skip as machineSkip,
  editCompleted,
} from "@/lib/visitMachine";
import { syncVisitEvents } from "@/lib/syncEngine";
import { C, OfflineBanner } from "@/components/schedule/ScheduleHelpers";
import { EodSummaryModal, SummaryStats } from "@/components/schedule/EodSummaryModal";
import { ScheduleCard } from "@/components/schedule/ScheduleCard";
import { UnscheduledVisitRow } from "@/components/schedule/UnscheduledVisitRow";
import { AdHocVisitCard } from "@/components/schedule/AdHocVisitCard";
import { OffRouteOrderCard } from "@/components/schedule/OffRouteOrderCard";
import { toast } from "sonner";

// ─── DailySchedule ────────────────────────────────────────────────────────────

export default function DailySchedule() {
  const { repId, signOut } = useAuth();
  if (!repId) return null;

  const [scheduleDate, setScheduleDate] = useState(new Date().toISOString().split("T")[0]);
  const [schedule,     setSchedule]     = useState<any>(null);
  const [items,        setItems]        = useState<any[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [generating,   setGenerating]   = useState(false);
  const [currentWeekName, setCurrentWeekName] = useState<string>("");
  const [isOnline,     setIsOnline]     = useState(navigator.onLine);

  // ── The single open visit (device-owned truth). null when nothing in progress.
  const [activeVisit, setActiveVisit] = useState<ActiveVisit | null>(null);
  // Which card is mid-transition (check-in/out/skip), by customer_id.
  const [busyCustomerId, setBusyCustomerId] = useState<string | null>(null);

  // end-of-day summary
  const [showSummary,      setShowSummary]      = useState(false);
  const [summaryStats,     setSummaryStats]     = useState<SummaryStats | null>(null);
  const [summaryDismissed, setSummaryDismissed] = useState(false);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);

  // accordion state
  const [expandedActiveId,    setExpandedActiveId]    = useState<string | null>(null);
  const expandedActiveIdRef = useRef<string | null>(null);
  const itemsRef            = useRef<any[]>([]);
  const [openCompletedId,     setOpenCompletedId]     = useState<string | null>(null);
  const [activeTab,           setActiveTab]           = useState<"active" | "done">("active");

  const { unscheduledVisits, setUnscheduledVisits, fetchUnscheduledVisits } = useUnscheduledVisits(repId, scheduleDate, itemsRef, expandedActiveIdRef);

  // in-progress visit recovery banner
  const [recoveryCustomerName, setRecoveryCustomerName] = useState<string | null>(null);
  const [recoveryItemId,       setRecoveryItemId]       = useState<string | null>(null);

  const scheduleDateRef    = useRef(scheduleDate);
  const fetchScheduleRef   = useRef<(force?: boolean) => Promise<void>>(async () => {});
  const lastFetchTimeRef   = useRef<number>(0);

  const [expandedBottomCard, setExpandedBottomCard] = useState<"unscheduled" | "offroute" | null>(null);
  const [adHocCustomers,   setAdHocCustomers]   = useState<any[]>([]);

  const isToday = scheduleDate === new Date().toISOString().split("T")[0];

  // ── active_visit reconciliation ────────────────────────────────────────────
  // Reads the open visit from IDB and re-resolves which of TODAY'S items it
  // belongs to by (customerId, visitDate) — NOT by stored scheduleItemId. This
  // makes an open visit survive a schedule regeneration (new item ids) and is
  // the core "never lose an in-progress visit" guarantee.
  const reconcileActiveVisit = useCallback(async (currentItems: any[]) => {
    try {
      const av = await getActiveVisit();
      if (!av) { setActiveVisit(null); return; }

      // Only applies to the date the visit was started on.
      if (av.visitDate !== scheduleDate) { setActiveVisit(null); return; }

      // Scheduled visit: re-attach to the matching item by customer.
      if (av.kind === "scheduled") {
        const match = currentItems.find(
          (i) => i.customer_id === av.customerId &&
                 i.status !== "visited" && i.status !== "skipped"
        );
        if (match) {
          // Re-link the stored scheduleItemId if regeneration changed it.
          if (match.id !== av.scheduleItemId) {
            const relinked = { ...av, scheduleItemId: match.id };
            setActiveVisit(relinked);
            // persist the corrected link
            await saveActiveVisit(relinked).catch(() => {});
          } else {
            setActiveVisit(av);
          }
          setExpandedActiveId(match.id);
        } else {
          // Customer no longer on today's board — keep the visit, surface as
          // recoverable rather than dropping it.
          setActiveVisit(av);
        }
      } else {
        // Ad-hoc visit: not tied to a schedule item; just hold it.
        setActiveVisit(av);
      }
    } catch {
      setActiveVisit(null);
    }
  }, [scheduleDate]);

  // online/offline listener
  useEffect(() => {
    const onOnline  = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online",  onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, []);

  // derived item lists
  const activeItems    = items.filter((i) => i.status !== "visited" && i.status !== "skipped");
  const completedItems = items.filter((i) => i.status === "visited" || i.status === "skipped");
  const visitedCount = items.filter((i) => i.status === "visited").length;
  const totalCount   = items.length;
  const progress     = totalCount > 0 ? visitedCount / totalCount : 0;

  // auto-expand: in-progress (active visit's stop) first, then first pending
  useEffect(() => {
    if (expandedActiveId) return;
    const activeStop = activeVisit
      ? activeItems.find((i) => i.customer_id === activeVisit.customerId)
      : null;
    const upNextItem = activeItems.find((i) => !i.arrival_time);
    const target = activeStop ?? upNextItem ?? null;
    setExpandedActiveId(target?.id ?? null);
  }, [items, activeVisit]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { expandedActiveIdRef.current = expandedActiveId; }, [expandedActiveId]);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const handleLocalUpdate = useCallback(
    (itemId: string, updates: any) => {
      setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, ...updates } : it)));
      if (repId) {
        updateCachedScheduleItem(repId, scheduleDate, itemId, updates).catch(() => {});
      }
    },
    [repId, scheduleDate]
  );

  const autoGenerateSchedule = useCallback(async () => {
    if (!repId) return null;
    try {
      const { data, error } = await supabase.rpc("auto_generate_daily_schedule", {
        p_rep_id: repId,
        p_schedule_date: scheduleDate,
      });
      if (error) { console.error("Auto-generate error:", error.message); return null; }
      return data as string | null;
    } catch {
      return null;
    }
  }, [repId, scheduleDate]);

  const fetchWeekName = async () => {
    try {
      const { data: weekOrder } = await (supabase.rpc as any)("get_week_order_for_date", { p_date: scheduleDate });
      if (weekOrder) {
        const { data: wk } = await supabase.from("weekly_templates").select("name").eq("sort_order", weekOrder).maybeSingle();
        if (wk) setCurrentWeekName(wk.name);
      }
    } catch { /* offline */ }
  };

  useEffect(() => {
    if (repId) { fetchSchedule(); fetchAdHocCustomers(); fetchWeekName(); }
  }, [repId, scheduleDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // realtime: schedule_items
  useEffect(() => {
    if (!schedule?.id) return;
    const channel = supabase
      .channel(`schedule-items-${schedule.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "schedule_items", filter: `schedule_id=eq.${schedule.id}` }, () => {
        // Never clobber an expanded in-progress card. expandedActiveIdRef guard preserved.
        const expandedItem = expandedActiveIdRef.current
          ? itemsRef.current.find((i: any) => i.id === expandedActiveIdRef.current)
          : null;
        const isInProgress = expandedItem
          ? !!expandedItem.arrival_time && !expandedItem.leaving_time
          : false;
        if (!isInProgress) fetchSchedule(true);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [schedule?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // realtime: daily_schedules
  useEffect(() => {
    if (!repId) return;
    const channel = supabase
      .channel(`daily-schedules-${repId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "daily_schedules", filter: `rep_id=eq.${repId}` }, () => {
        if (!expandedActiveIdRef.current) fetchSchedule();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [repId, scheduleDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const resolveUnknownCustomers = async (loadedItems: any[]) => {
    const unresolved = loadedItems.filter((i) => !i.customers?.customer_name);
    if (!unresolved.length) return;
    const ids = [...new Set(unresolved.map((i: any) => i.customer_id).filter(Boolean))];
    if (!ids.length) return;
    try {
      const { data } = await supabase.from("customers").select("*").in("id", ids);
      if (!data?.length) return;
      const byId = Object.fromEntries(data.map((c: any) => [c.id, c]));
      setItems((prev) => prev.map((i) => (!i.customers?.customer_name && byId[i.customer_id] ? { ...i, customers: byId[i.customer_id] } : i)));
    } catch { /* ignore */ }
  };

  const fetchSchedule = async (force = false) => {
    if (!repId) return;
    const now = Date.now();
    if (!force && now - lastFetchTimeRef.current < 2000) return;
    lastFetchTimeRef.current = now;
    setLoading(true);
    let hasCachedSchedule = false;

    try {
      const cached = await getCachedSchedule(repId, scheduleDate);
      if (cached) {
        hasCachedSchedule = true;
        setSchedule(cached);
        const sorted = (cached.schedule_items || []).sort((a: any, b: any) => a.sort_order - b.sort_order);
        setItems(sorted);
        reconcileActiveVisit(sorted);
        setLoading(false);
      }
    } catch { /* ignore cache read errors */ }

    if (!navigator.onLine) {
      if (!hasCachedSchedule) { setSchedule(null); setItems([]); setLoading(false); }
      return;
    }

    try {
      const { data } = await supabase
        .from("daily_schedules")
        .select("*, schedule_items(*, customers(customer_name, account_number), visits(photo_url, order_number, order_quantity, order_amount, client_generated_id))")
        .eq("rep_id", repId)
        .eq("schedule_date", scheduleDate)
        .maybeSingle();

      if (data) {
        setSchedule(data);
        const sortedItems = (data.schedule_items || []).sort((a: any, b: any) => a.sort_order - b.sort_order);
        setItems(sortedItems);
        fetchUnscheduledVisits();
        resolveUnknownCustomers(sortedItems);
        await setCachedSchedule(repId, scheduleDate, data);
        reconcileActiveVisit(sortedItems);
      } else {
        const todayStr = new Date().toISOString().split("T")[0];
        if (scheduleDate <= todayStr) {
          setGenerating(true);
          const newId = await autoGenerateSchedule();
          setGenerating(false);
          if (newId) {
            const { data: newData } = await supabase
              .from("daily_schedules")
              .select("*, schedule_items(*, customers(customer_name, account_number))")
              .eq("id", newId)
              .maybeSingle();
            setSchedule(newData);
            const sortedNewItems = (newData?.schedule_items || []).sort((a: any, b: any) => a.sort_order - b.sort_order);
            setItems(sortedNewItems);
            fetchUnscheduledVisits();
            resolveUnknownCustomers(sortedNewItems);
            if (newData) await setCachedSchedule(repId, scheduleDate, newData);
            reconcileActiveVisit(sortedNewItems);
          } else {
            setSchedule(null); setItems([]);
          }
        } else {
          setSchedule(null); setItems([]);
        }
      }

      // Week-order self-heal (harmless app_settings correction only — the
      // destructive delete-and-regenerate has been removed from the rep app).
      if (isToday) {
        try {
          const today = new Date().toISOString().split("T")[0];
          const { data: weekOrder } = await supabase.rpc("get_week_order_for_date", { p_date: today });
          const { data: setting } = await supabase.from("app_settings").select("setting_value").eq("setting_key", "current_week_order").maybeSingle();
          const storedOrder = setting ? parseInt(setting.setting_value) || 1 : 1;
          if (weekOrder !== null && weekOrder !== undefined && weekOrder !== storedOrder) {
            await supabase.from("app_settings").upsert({
              setting_key: "current_week_order",
              setting_value: String(weekOrder),
              updated_at: new Date().toISOString(),
            }, { onConflict: "setting_key" });
          }
        } catch { /* ignore */ }
      }
    } catch {
      if (!hasCachedSchedule) { setSchedule(null); setItems([]); }
    } finally {
      setLoading(false);
    }
  };

  fetchScheduleRef.current = fetchSchedule;

  useEffect(() => { fetchUnscheduledVisits(); }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset per-date refs
  useEffect(() => {
    lastFetchTimeRef.current = 0;
    scheduleDateRef.current = scheduleDate;
  }, [scheduleDate]);

  // Resume handler — re-fetch + trigger a sync drain when the app comes back.
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible") {
        fetchScheduleRef.current(true);
        if (navigator.onLine) syncVisitEvents().then((r) => { if (r.synced > 0) fetchScheduleRef.current(true); }).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchAdHocCustomers = async () => {
    if (!repId) return;
    const loadFromCache = async () => {
      try {
        const cached = await getCachedCustomers();
        if (cached.length > 0) {
          setAdHocCustomers(cached.map((c) => ({ id: c.id, customer_name: c.customer_name, account_number: c.account_number, area: c.area, is_active: true })));
        }
      } catch { /* keep state */ }
    };
    await loadFromCache();
    if (!navigator.onLine) return;
    try {
      const { data } = await supabase
        .from("customer_assignments")
        .select("customer_id, customers(id, customer_name, account_number, area, is_active)")
        .eq("rep_id", repId);
      if (data) {
        const active = data.filter((d: any) => d.customers?.is_active).map((d: any) => d.customers);
        setAdHocCustomers(active);
        await setCachedCustomers(active.map((c: any) => ({ id: c.id, customer_name: c.customer_name, account_number: c.account_number || null, area: c.area || null })));
      }
    } catch { /* keep cache */ }
  };

  // ═══ Machine callbacks passed to ScheduleCard ═══════════════════════════════

  const handleCheckIn = useCallback(async (item: any) => {
    setBusyCustomerId(item.customer_id);
    try {
      const res = await startVisit({
        kind: "scheduled",
        repId: repId!,
        customerId: item.customer_id,
        customerName: item.customers?.customer_name ?? null,
        visitDate: scheduleDate,
        scheduleItemId: item.id,
      });
      if (!res.ok) {
        toast.error(`You have an open visit at ${res.openCustomerName ?? "another customer"}. Please check out first.`);
        return;
      }
      setActiveVisit(res.active);
      // reflect arrival on the item locally so the admin-facing schedule_items
      // arrival is mirrored once the 'arrived' event syncs; local UI updates now.
      handleLocalUpdate(item.id, { arrival_time: res.active.arrivalTime });
      setExpandedActiveId(item.id);
      if (navigator.onLine) syncVisitEvents().catch(() => {});
    } finally {
      setBusyCustomerId(null);
    }
  }, [repId, scheduleDate, handleLocalUpdate]);

  const handleCheckOut = useCallback(async (item: any) => {
    setBusyCustomerId(item.customer_id);
    try {
      const res = await checkOut();
      if (!res.ok) {
        if (res.reason === "zero_duration") {
          toast.error("You just checked in. Add your photo and details, then check out.");
        } else {
          toast.error("No active visit to check out.");
        }
        return;
      }
      setActiveVisit(null);
      handleLocalUpdate(item.id, { status: "visited", leaving_time: "pending" });
      if (navigator.onLine) {
        const r = await syncVisitEvents();
        if (r.synced > 0) fetchSchedule(true);
      } else {
        toast.success("Saved offline. Will sync when online.");
        fetchSchedule(true);
      }
    } finally {
      setBusyCustomerId(null);
    }
  }, [handleLocalUpdate]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCapturePhoto = useCallback(async (blob: Blob) => {
    try {
      const compressed = await compressImage(blob);
      const b64 = await blobToBase64(compressed);
      const next = await updateDraft({ photoBase64: b64 });
      if (next) setActiveVisit(next);
    } catch {
      toast.error("Failed to process photo");
    }
  }, []);

  const handleUpdateDraft = useCallback(async (fields: { notes?: string; orderNumber?: string; orderQty?: string; orderAmount?: string }) => {
    const next = await updateDraft(fields);
    if (next) setActiveVisit(next);
  }, []);

  const handleSkip = useCallback(async (item: any, reason: string) => {
    setBusyCustomerId(item.customer_id);
    try {
      await machineSkip({
        repId: repId!,
        customerId: item.customer_id,
        visitDate: scheduleDate,
        scheduleItemId: item.id,
        reason,
      });
      // If the skipped stop was the active one, clear it.
      if (activeVisit?.customerId === item.customer_id) setActiveVisit(null);
      handleLocalUpdate(item.id, { status: "skipped", notes: reason });
      if (navigator.onLine) {
        const r = await syncVisitEvents();
        if (r.synced > 0) fetchSchedule(true);
      } else {
        toast.success("Saved offline. Will sync when online.");
        fetchSchedule(true);
      }
    } finally {
      setBusyCustomerId(null);
    }
  }, [repId, scheduleDate, activeVisit, handleLocalUpdate]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEditCompleted = useCallback(async (args: {
    clientId: string; arrivalTime: string | null; leavingTime: string | null;
    orderNumber: string; orderQty: string; orderAmount: string; notes: string | null;
    item: any;
  }) => {
    await editCompleted({
      clientId: args.clientId,
      repId: repId!,
      customerId: args.item.customer_id,
      visitDate: scheduleDate,
      arrivalTime: args.arrivalTime,
      leavingTime: args.leavingTime,
      orderNumber: args.orderNumber,
      orderQty: args.orderQty,
      orderAmount: args.orderAmount,
      notes: args.notes,
    });
    if (navigator.onLine) {
      const r = await syncVisitEvents();
      if (r.synced > 0) fetchSchedule(true);
    } else {
      fetchSchedule(true);
    }
  }, [repId, scheduleDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── recovery banner: open visit whose stop is on today's board ──
  useEffect(() => {
    if (!isToday || !activeVisit) { setRecoveryCustomerName(null); setRecoveryItemId(null); return; }
    const stop = items.find((i) => i.customer_id === activeVisit.customerId && i.status !== "visited" && i.status !== "skipped");
    if (stop) {
      setRecoveryCustomerName(activeVisit.customerName);
      setRecoveryItemId(stop.id);
    } else {
      setRecoveryCustomerName(null);
      setRecoveryItemId(null);
    }
  }, [items, isToday, activeVisit]);

  // ─── end-of-day summary ─────────────────────────────────────────────────────
  const allDone = items.length > 0 && items.every((i) => i.status === "visited" || i.status === "skipped");
  const dismissedKey = repId && scheduleDate ? `summary_dismissed_${repId}_${scheduleDate}` : null;

  useEffect(() => {
    setSummaryDismissed(dismissedKey ? localStorage.getItem(dismissedKey) === "1" : false);
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 7);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      Object.keys(localStorage).forEach((key) => {
        if (!key.startsWith("summary_dismissed_")) return;
        const datePart = key.split("_").pop();
        if (datePart && datePart < cutoffStr) localStorage.removeItem(key);
      });
    } catch { /* ignore */ }
  }, [dismissedKey]);

  const openSummary = useCallback(async () => {
    const visitedItems = items.filter((i) => i.status === "visited");
    const skippedItems = items.filter((i) => i.status === "skipped");
    const v = visitedItems.map((i: any) => Array.isArray(i.visits) ? i.visits[0] : i.visits).filter(Boolean);
    const offRouteVisits = unscheduledVisits.filter((uv: any) => uv.status === "off_route");
    const orders = v.filter((v: any) => v?.order_number != null && v?.order_number !== "").length
      + offRouteVisits.filter((uv: any) => uv.order_number != null && uv.order_number !== "").length;
    const totalOrderValue = v.reduce((sum: number, v: any) => sum + (Number(v?.order_amount) || 0), 0)
      + offRouteVisits.reduce((sum: number, uv: any) => sum + (Number(uv?.order_amount) || 0), 0);
    const durationsWithValue = visitedItems.filter((i) => i.duration_minutes > 0);
    const avgDuration = durationsWithValue.length > 0
      ? Math.round(durationsWithValue.reduce((s, i) => s + i.duration_minutes, 0) / durationsWithValue.length) : 0;
    setSummaryStats({
      total: items.length, visited: visitedItems.length, skipped: skippedItems.length,
      orders, totalOrderValue, avgDuration,
    });
    setShowSummary(true);
  }, [items, unscheduledVisits]);

  const closeSummary = useCallback(() => {
    if (dismissedKey) localStorage.setItem(dismissedKey, "1");
    setSummaryDismissed(true);
    setShowSummary(false);
  }, [dismissedKey]);

  const handleViewSummary = useCallback(async () => {
    setIsLoadingSummary(true);
    await openSummary();
    setIsLoadingSummary(false);
  }, [openSummary]);

  useEffect(() => {
    if (!allDone || !isToday || summaryDismissed || items.length === 0) return;
    openSummary();
  }, [allDone]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── date navigation ────────────────────────────────────────────────────────
  const changeDay = (delta: number) => {
    const [year, month, day] = scheduleDate.split("-").map(Number);
    const d = new Date(year, month - 1, day);
    d.setDate(d.getDate() + delta);
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    setScheduleDate(`${yy}-${mm}-${dd}`);
    setExpandedActiveId(null);
    setOpenCompletedId(null);
    setActiveTab("active");
  };

  const displayDate = new Date(scheduleDate + "T00:00:00");
  const dateLabel = isToday ? "Today" : displayDate.toLocaleDateString("en-GB", { day: "numeric", month: "long" });

  // helper: is this card the active stop?
  const activeStopCustomerId = activeVisit?.customerId ?? null;

  // ─── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="schedule-screen" style={{ background: C.bg, height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {!isOnline && <OfflineBanner />}

      {/* header */}
      <div
        style={{
          background: `radial-gradient(120% 80% at 50% 0%, ${C.greenMid} 0%, ${C.green} 38%, ${C.greenDeep} 100%)`,
          paddingTop: "calc(4px + env(safe-area-inset-top, 0px))",
          paddingBottom: "12px", paddingLeft: "16px", paddingRight: "16px",
          display: "flex", flexDirection: "column", gap: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <img src="/logo.png" alt="Check-In" style={{ width: 28, height: 28, borderRadius: 6 }} />
            <span style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 15, color: "#fff", letterSpacing: "-0.2px" }}>Check-In</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 999, background: "rgba(255,255,255,0.14)", fontSize: 11.5, fontWeight: 600, color: "#fff" }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: isOnline ? "#7DDDA5" : "#E65100", boxShadow: isOnline ? "0 0 0 3px rgba(125,221,165,0.25)" : "none" }} />
              {isOnline ? "Online" : "Offline"}
            </div>
            <button
              type="button"
              onClick={() => { if (window.confirm("Are you sure you want to sign out?")) signOut(); }}
              title="Sign out"
              style={{ width: 32, height: 32, borderRadius: 10, background: "rgba(255,255,255,0.14)", border: "none", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button type="button" onClick={() => changeDay(-1)} style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(255,255,255,0.14)", color: "#fff", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <ChevronLeft size={18} />
          </button>
          <div style={{ textAlign: "center" }}>
            <p style={{ fontSize: 10.5, color: "rgba(255,255,255,0.5)", margin: 0, marginBottom: 4, textTransform: "uppercase", fontWeight: 500, letterSpacing: "0.5px" }}>
              {displayDate.toLocaleDateString("en-GB", { weekday: "long" }).toUpperCase()}
              {currentWeekName ? ` · ${currentWeekName}` : ""}
            </p>
            <p style={{ fontFamily: "Syne, sans-serif", fontSize: 26, fontWeight: 700, color: "#fff", margin: 0, lineHeight: 1.2 }}>{dateLabel}</p>
          </div>
          <button type="button" onClick={() => changeDay(1)} style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(255,255,255,0.14)", color: "#fff", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <ChevronRight size={18} />
          </button>
        </div>

        {!loading && !generating && items.length > 0 && (
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 0 }}>
            <div style={{ textAlign: "center", paddingRight: 8 }}>
              <p style={{ fontFamily: "Syne, sans-serif", fontSize: 36, fontWeight: 700, color: "#fff", margin: 0, lineHeight: 1, letterSpacing: "-0.8px" }}>{visitedCount}</p>
              <p style={{ fontSize: 9, color: "rgba(255,255,255,0.7)", margin: 0, marginTop: 3, textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>Done</p>
            </div>
            <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 300, fontSize: 18, color: "rgba(255,255,255,0.25)", lineHeight: 1, paddingBottom: 16 }}>/</div>
            <div style={{ textAlign: "center", paddingLeft: 8, paddingRight: 8, paddingTop: 4 }}>
              <p style={{ fontFamily: "Syne, sans-serif", fontSize: 22, fontWeight: 700, color: "rgba(255,255,255,0.55)", margin: 0, lineHeight: 1, letterSpacing: "-0.6px" }}>{activeItems.length}</p>
              <p style={{ fontSize: 9.5, color: "rgba(255,255,255,0.55)", margin: 0, marginTop: 3, textTransform: "uppercase", letterSpacing: "1.3px", fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>Remaining</p>
            </div>
            <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 300, fontSize: 18, color: "rgba(255,255,255,0.25)", lineHeight: 1, paddingBottom: 16 }}>/</div>
            <div style={{ textAlign: "center", paddingLeft: 8 }}>
              <p style={{ fontFamily: "Syne, sans-serif", fontSize: 28, fontWeight: 700, color: "rgba(255,255,255,0.7)", margin: 0, lineHeight: 1, letterSpacing: "-0.8px" }}>{totalCount}</p>
              <p style={{ fontSize: 9.5, color: "rgba(255,255,255,0.7)", margin: 0, marginTop: 3, textTransform: "uppercase", letterSpacing: "1.3px", fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>Total</p>
            </div>
          </div>
        )}

        {items.length > 0 && (
          <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.14)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progress * 100}%`, background: `linear-gradient(90deg, ${C.sun} 0%, #fff 100%)`, transition: "width 500ms cubic-bezier(0.22, 0.61, 0.36, 1)", borderRadius: 999 }} />
          </div>
        )}
      </div>

      {/* tab bar */}
      {!loading && !generating && schedule && (
        <div style={{ padding: "4px", display: "flex", gap: 0, borderRadius: 999, background: "#E2D9C6", margin: "8px 16px", width: "calc(100% - 32px)" }}>
          {(["active", "done"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1, padding: "8px 12px", borderRadius: 999, fontSize: 13, fontWeight: 700, fontFamily: "Syne, sans-serif", border: "none", cursor: "pointer",
                background: activeTab === tab ? "#fff" : "transparent",
                color: activeTab === tab ? C.ink : C.inkSoft,
                transition: "all 200ms ease",
                boxShadow: activeTab === tab ? "0 2px 8px rgba(23, 23, 21, 0.12)" : "none",
              }}
            >
              {tab === "active" ? (
                <>Active{activeItems.length > 0 && <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.5, marginLeft: 4 }}>{activeItems.length}</span>}</>
              ) : (
                <>Done{!loading && completedItems.length + unscheduledVisits.length > 0 && <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.5, marginLeft: 4 }}>{completedItems.length + unscheduledVisits.length}</span>}</>
              )}
            </button>
          ))}
        </div>
      )}

      {/* recovery banner */}
      {recoveryItemId && !loading && activeTab === "active" && (
        <button
          type="button"
          onClick={() => {
            setExpandedActiveId(recoveryItemId);
            setActiveTab("active");
            setTimeout(() => { document.getElementById(`card-${recoveryItemId}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }, 100);
          }}
          className="mx-4 mt-2 w-[calc(100%-2rem)] flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium font-syne text-left"
          style={{ background: "#FFF8E1", border: "1px solid #F59E0B", color: "#78350F" }}
        >
          <ChevronRight size={16} className="shrink-0" style={{ color: "#F59E0B" }} />
          <span>You have an active visit at <strong>{recoveryCustomerName}</strong> — tap to resume</span>
        </button>
      )}

      {/* main scrollable area */}
      <div className="scrollbar-hidden px-4 pb-6 pt-3 space-y-2" style={{ overscrollBehaviorY: "contain", WebkitOverflowScrolling: "touch", overflowY: "auto", flex: 1, minHeight: 0 }}>
        {loading || generating ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3" style={{ color: C.inkMute }}>
            <Loader2 className="animate-spin" size={28} />
            <p className="text-sm">{generating ? "Generating schedule…" : "Loading…"}</p>
          </div>
        ) : !schedule ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2" style={{ color: C.inkMute }}>
            <CalendarDays size={40} style={{ opacity: 0.3 }} />
            <p className="text-sm">{scheduleDate > new Date().toISOString().split("T")[0] ? "Schedule not yet available" : "No schedule for this date"}</p>
          </div>
        ) : activeTab === "active" ? (
          <>
            {activeItems.length === 0 ? (
              allDone ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3" style={{ color: C.inkMute }}>
                  <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: C.greenSoft, border: `2px solid ${C.greenMid}` }}>
                    <Check size={26} style={{ color: C.green }} strokeWidth={2.5} />
                  </div>
                  <div className="text-center space-y-1">
                    <p className="text-sm font-bold font-syne" style={{ color: C.ink }}>Day complete</p>
                    <p className="text-xs" style={{ color: C.inkMute }}>All visits accounted for</p>
                  </div>
                  <button type="button" onClick={handleViewSummary} disabled={isLoadingSummary} className={`text-xs font-medium px-4 py-2 rounded-xl mt-1${isLoadingSummary ? " btn-shimmer" : ""}`} style={isLoadingSummary ? undefined : { color: C.green, border: `1px solid ${C.border}`, background: C.surface }}>
                    View {isToday ? "today's" : "day's"} summary
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 gap-2" style={{ color: C.inkMute }}>
                  <Check size={40} style={{ color: C.greenMid, opacity: 0.7 }} />
                  <p className="text-sm font-semibold font-syne">All visits done!</p>
                </div>
              )
            ) : (
              activeItems.map((item, i) => (
                <ScheduleCard
                  key={item.id}
                  item={item}
                  repId={repId!}
                  scheduleDate={scheduleDate}
                  activeVisit={activeVisit}
                  isActiveStop={activeStopCustomerId === item.customer_id}
                  busy={busyCustomerId === item.customer_id}
                  onCheckIn={() => handleCheckIn(item)}
                  onCheckOut={() => handleCheckOut(item)}
                  onCapturePhoto={handleCapturePhoto}
                  onClearPhoto={() => handleUpdateDraft({})}
                  onUpdateDraft={handleUpdateDraft}
                  onSkip={(reason) => handleSkip(item, reason)}
                  onEditCompleted={(a) => handleEditCompleted({ ...a, item })}
                  isExpanded={expandedActiveId === item.id}
                  onToggle={() => setExpandedActiveId((prev) => (prev === item.id ? null : item.id))}
                  index={i}
                />
              ))
            )}
          </>
        ) : (
          completedItems.length === 0 && unscheduledVisits.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2" style={{ color: C.inkMute }}>
              <p className="text-sm">No completed visits yet</p>
            </div>
          ) : (
            <>
              {(completedItems.length > 0 || unscheduledVisits.length > 0) && (
                <div style={{ padding: "12px 16px", borderRadius: 12, background: C.surface, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-around", gap: 16 }}>
                  <div style={{ flex: 1, textAlign: "center", borderRight: `1px solid ${C.border}` }}>
                    <p style={{ fontSize: 11, color: C.inkMute, textTransform: "uppercase", fontWeight: 500, margin: 0, marginBottom: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                      <Clock size={14} />Avg per stop
                    </p>
                    <p style={{ fontSize: 16, fontFamily: "Syne, sans-serif", fontWeight: 600, color: C.ink, margin: 0 }}>
                      {visitedCount > 0 ? fmtDuration(Math.round(items.filter(i => i.status === "visited").reduce((sum, i) => sum + (i.duration_minutes || 0), 0) / visitedCount)) : "—"}
                    </p>
                  </div>
                  <div style={{ flex: 1, textAlign: "center", borderRight: `1px solid ${C.border}` }}>
                    <p style={{ fontSize: 11, color: C.inkMute, textTransform: "uppercase", fontWeight: 500, margin: 0, marginBottom: 6 }}>Visited</p>
                    <p style={{ fontSize: 16, fontFamily: "Syne, sans-serif", fontWeight: 600, color: C.ink, margin: 0 }}>{visitedCount}</p>
                  </div>
                  <div style={{ flex: 1, textAlign: "center" }}>
                    <p style={{ fontSize: 11, color: C.inkMute, textTransform: "uppercase", fontWeight: 500, margin: 0, marginBottom: 6 }}>Skipped</p>
                    <p style={{ fontSize: 16, fontFamily: "Syne, sans-serif", fontWeight: 600, color: completedItems.filter(i => i.status === "skipped").length > 0 ? C.danger : C.inkMute, margin: 0 }}>
                      {completedItems.filter(i => i.status === "skipped").length}
                    </p>
                  </div>
                </div>
              )}
              {completedItems.map((item, i) => (
                <ScheduleCard
                  key={item.id}
                  item={item}
                  repId={repId!}
                  scheduleDate={scheduleDate}
                  activeVisit={activeVisit}
                  isActiveStop={false}
                  busy={busyCustomerId === item.customer_id}
                  onCheckIn={() => handleCheckIn(item)}
                  onCheckOut={() => handleCheckOut(item)}
                  onCapturePhoto={handleCapturePhoto}
                  onClearPhoto={() => handleUpdateDraft({})}
                  onUpdateDraft={handleUpdateDraft}
                  onSkip={(reason) => handleSkip(item, reason)}
                  onEditCompleted={(a) => handleEditCompleted({ ...a, item })}
                  isExpanded={openCompletedId === item.id}
                  onToggle={() => setOpenCompletedId((prev) => (prev === item.id ? null : item.id))}
                  index={i}
                />
              ))}
              {unscheduledVisits.map((visit) => (
                <UnscheduledVisitRow
                  key={visit.id}
                  visit={visit}
                  isExpanded={openCompletedId === visit.id}
                  onToggle={() => setOpenCompletedId((prev) => (prev === visit.id ? null : visit.id))}
                  onOrderUpdated={fetchUnscheduledVisits}
                />
              ))}
            </>
          )
        )}

        {showSummary && summaryStats && <EodSummaryModal stats={summaryStats} onClose={closeSummary} />}

        {/* bottom action cards */}
        {schedule && (
          <div style={{ padding: expandedBottomCard === null ? "8px 16px" : "8px 0" }}>
            {expandedBottomCard === null && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <button type="button" onClick={() => setExpandedBottomCard("unscheduled")} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 16px", borderRadius: 16, fontSize: 14, fontWeight: 500, border: `1.5px dashed ${C.border}`, background: "transparent", color: C.inkMute, cursor: "pointer" }}>
                  <Plus size={16} /><span>Unscheduled</span>
                </button>
                <button type="button" onClick={() => setExpandedBottomCard("offroute")} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 16px", borderRadius: 16, fontSize: 14, fontWeight: 500, border: `1.5px dashed ${C.border}`, background: "transparent", color: C.inkMute, cursor: "pointer" }}>
                  <Plus size={16} /><span>Off-Route Order</span>
                </button>
              </div>
            )}

            {expandedBottomCard === "unscheduled" && (
              <AdHocVisitCard
                repId={repId!}
                scheduleDate={scheduleDate}
                adHocCustomers={adHocCustomers}
                activeVisit={activeVisit}
                setActiveVisit={setActiveVisit}
                onComplete={(syntheticVisit) => {
                  if (syntheticVisit) setUnscheduledVisits((prev) => [syntheticVisit, ...prev]);
                  setActiveTab("done");
                  setExpandedBottomCard(null);
                  fetchSchedule(true);
                }}
                onCancel={() => setExpandedBottomCard(null)}
              />
            )}

            {expandedBottomCard === "offroute" && (
              <OffRouteOrderCard
                repId={repId!}
                scheduleDate={scheduleDate}
                adHocCustomers={adHocCustomers}
                onComplete={(syntheticVisit) => {
                  if (syntheticVisit) setUnscheduledVisits((prev) => [syntheticVisit, ...prev]);
                  setActiveTab("done");
                  setExpandedBottomCard(null);
                  fetchUnscheduledVisits();
                }}
                onRefresh={fetchUnscheduledVisits}
                onCancel={() => setExpandedBottomCard(null)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}