import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Check, SkipForward, X, Pencil, Clock, Camera, FileText, Lock, MapPin, ChevronDown } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { compressImage, blobToBase64 } from "@/lib/imageCompressor";
import { CameraCapture } from "@/components/CameraCapture";
import {
  upsertOfflineScheduleItemUpdate,
  savePendingPhoto,
  getPendingPhoto,
  clearPendingPhoto,
  saveActiveCard,
  getActiveCard,
  clearActiveCard,
} from "@/lib/offlineDb";
import {
  C,
  isOfflineError,
  saveVisitOffline,
  nowTime,
  calcDuration,
  resetMobileZoom,
  Expand,
} from "./ScheduleHelpers";
import { RippleButton } from "./Animations";

// ─── ScheduleCard ─────────────────────────────────────────────────────────────

export function ScheduleCard({
  item,
  repId,
  scheduleDate,
  onRefresh,
  onLocalUpdate,
  isExpanded,
  onToggle,
  index,
  allItems,
}: {
  item: any;
  repId: string;
  scheduleDate: string;
  onRefresh: () => void;
  onLocalUpdate: (itemId: string, updates: any) => void;
  isExpanded: boolean;
  onToggle: () => void;
  index: number;
  allItems: any[];
}) {
  const [localNotes, setLocalNotes]           = useState(item.notes || "");
  const [localArrival, setLocalArrival]       = useState(item.arrival_time || "");
  const [localLeaving, setLocalLeaving]       = useState(item.leaving_time || "");
  const [localOrderNumber, setLocalOrderNumber] = useState("");
  const [localOrderQty, setLocalOrderQty]       = useState("");
  const [localOrderAmount, setLocalOrderAmount] = useState("");
  const [actionInProgress, setActionInProgress] = useState(false);

  const [editingDone, setEditingDone]         = useState(false);
  const [doneOrderNumber, setDoneOrderNumber] = useState("");
  const [doneOrderQty, setDoneOrderQty]       = useState("");
  const [doneOrderAmount, setDoneOrderAmount] = useState("");

  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoBlob, setPhotoBlob]       = useState<Blob | null>(null);
  const [showNotes, setShowNotes]       = useState(false);

  // Tracks the Supabase visits.id created at online arrival so checkout can PATCH it.
  const [activeVisitId, setActiveVisitId] = useState<string | null>(null);
  // Stable UUID for the current visit session — used as conflict key in the arrival upsert.
  const clientGenIdRef = useRef<string | null>(null);
  // Guard: blocks checkout from firing for 600ms after camera capture completes.
  // Prevents Android ghost-click propagation from the camera overlay to the checkout button.
  const cameraCooldownRef = useRef(false);
  // Guard: blocks markArrived from being called a second time while the first call is still
  // running. Uses a ref (not state) so it is set synchronously before any awaits.
  const arrivingRef = useRef(false);
  const [arriving, setArriving] = useState(false);

  // Skip flow state — tracks whether skip composer is open and the note being entered
  const [skipMode, setSkipMode] = useState(false);
  const [skipNote, setSkipNote] = useState("");

  useEffect(() => { setLocalNotes(item.notes || "");     }, [item.notes]);
  useEffect(() => { setLocalArrival(item.arrival_time || ""); }, [item.arrival_time]);
  useEffect(() => { setLocalLeaving(item.leaving_time || ""); }, [item.leaving_time]);

  // Restore captured photo from IndexedDB on mount (survives app background/resume)
  useEffect(() => {
    if (!item.arrival_time || item.leaving_time) return;
    getPendingPhoto(item.id).then((base64) => {
      if (!base64) return;
      try {
        const raw = base64.includes(",") ? base64.split(",")[1] : base64;
        const byteStr = atob(raw);
        const arr = new Uint8Array(byteStr.length);
        for (let i = 0; i < byteStr.length; i++) arr[i] = byteStr.charCodeAt(i);
        const blob = new Blob([arr], { type: "image/jpeg" });
        setPhotoBlob(blob);
        setPhotoPreview(URL.createObjectURL(blob));
      } catch { /* corrupt base64 — ignore */ }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore unsaved notes from IndexedDB on mount (runs after the item.notes sync above)
  useEffect(() => {
    if (!item.arrival_time || item.leaving_time) return;
    getActiveCard().then((card) => {
      if (card?.scheduleItemId === item.id && card.notes) {
        setLocalNotes(card.notes);
      }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!item.arrival_time || item.leaving_time) return;
    (async () => {
      try {
        const card = await getActiveCard();
        if (!card || card.scheduleItemId !== item.id) return;
        if (card.visitId && !activeVisitId) {
          setActiveVisitId(card.visitId);
        }
        if (card.clientGeneratedId && !clientGenIdRef.current) {
          clientGenIdRef.current = card.clientGeneratedId;
        }
        if (card.orderNumber && !localOrderNumber) {
          setLocalOrderNumber(card.orderNumber);
        }
        if (card.orderQty && !localOrderQty) {
          setLocalOrderQty(card.orderQty);
        }
        if (card.orderAmount && !localOrderAmount) {
          setLocalOrderAmount(card.orderAmount);
        }
      } catch { /* IDB unavailable — do nothing */ }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Silent pre-fill from IndexedDB when this card is expanded.
  // Runs whenever isExpanded flips to true. Only fills fields that the server
  // hasn't populated yet — never overwrites a value that came from the server.
  // Also restores activeVisitId / clientGeneratedId so the PATCH path is used at checkout.
  useEffect(() => {
    if (!isExpanded) return;
    (async () => {
      try {
        const card = await getActiveCard();
        if (!card || card.scheduleItemId !== item.id) return;
        if (!item.arrival_time && card.arrivalTime) {
          setLocalArrival(card.arrivalTime);
        }
        if (!item.notes && card.notes) {
          setLocalNotes(card.notes);
        }
        if (card.visitId && !activeVisitId) {
          setActiveVisitId(card.visitId);
        }
        if (card.clientGeneratedId && !clientGenIdRef.current) {
          clientGenIdRef.current = card.clientGeneratedId;
        }
        if (card.orderNumber && !localOrderNumber) {
          setLocalOrderNumber(card.orderNumber);
        }
        if (card.orderQty && !localOrderQty) {
          setLocalOrderQty(card.orderQty);
        }
        if (card.orderAmount && !localOrderAmount) {
          setLocalOrderAmount(card.orderAmount);
        }
      } catch {
        // IDB unavailable — do nothing silently
      }
    })();
  }, [isExpanded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Part C — on reconnect, restore activeVisitId from IDB so that checkout uses
  // the PATCH path rather than inserting a duplicate visit row.
  useEffect(() => {
    if (!isExpanded) return;
    const onOnline = async () => {
      if (activeVisitId) return; // already restored
      try {
        const card = await getActiveCard();
        if (card?.scheduleItemId === item.id) {
          if (card.visitId) setActiveVisitId(card.visitId);
          if (card.clientGeneratedId && !clientGenIdRef.current) {
            clientGenIdRef.current = card.clientGeneratedId;
          }
        }
      } catch { /* IDB unavailable — do nothing */ }
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [isExpanded, activeVisitId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-persist notes to IndexedDB while a visit is in-progress.
  // Merges with any visitId / clientGeneratedId already in the stored record so
  // that the notes sync doesn't accidentally clobber the PATCH routing fields.
  useEffect(() => {
    if (!item.arrival_time || item.leaving_time) return;
    saveActiveCard({
      scheduleItemId: item.id,
      arrivalTime: item.arrival_time,
      notes: localNotes,
      visitId: activeVisitId,
      clientGeneratedId: clientGenIdRef.current,
      orderNumber: localOrderNumber || null,
      orderQty: localOrderQty || null,
      orderAmount: localOrderAmount || null,
    }).catch(() => {});
  }, [localNotes, localOrderNumber, localOrderQty, localOrderAmount]); // eslint-disable-line react-hooks/exhaustive-deps

  const queueScheduleItemUpdate = async (newItem: any) => {
    // Resolve visitId: prefer component state, fall back to IDB for the
    // offline-at-arrival → offline-at-checkout case.
    let queueVisitId: string | null = activeVisitId;
    if (!queueVisitId) {
      try {
        const card = await getActiveCard();
        if (card?.scheduleItemId === item.id && card.visitId) queueVisitId = card.visitId;
      } catch { /* IDB unavailable */ }
    }

    await upsertOfflineScheduleItemUpdate({
      schedule_item_id: item.id,
      rep_id: repId,
      schedule_date: scheduleDate,
      customer_id: item.customer_id,
      visitId: queueVisitId,
      payload: {
        arrival_time: newItem.arrival_time || null,
        leaving_time: newItem.leaving_time || null,
        duration_minutes: newItem.duration_minutes ?? null,
        notes: newItem.notes || null,
        status: newItem.status || "pending",
        order_number: newItem.order_number ?? undefined,
        order_quantity: newItem.order_quantity ?? undefined,
        order_amount: newItem.order_amount ?? undefined,
      },
      created_at_local: new Date().toISOString(),
      sync_status: "pending",
      last_sync_attempt: null,
      error_message: null,
    });
  };

  const handleCameraCapture = async (blob: Blob) => {
    try {
      cameraCooldownRef.current = true;
      setTimeout(() => { cameraCooldownRef.current = false; }, 200);
      const compressed = await compressImage(blob);
      setPhotoBlob(compressed);
      setPhotoPreview(URL.createObjectURL(compressed));
      // Persist immediately so a background/resume cycle cannot lose the photo
      blobToBase64(compressed).then((b64) => savePendingPhoto(item.id, b64, null, null)).catch(() => {});
    } catch {
      toast.error("Failed to process photo");
    }
  };

  const clearPhoto = () => {
    setPhotoBlob(null);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
    clearPendingPhoto(item.id).catch(() => {});
  };

  const uploadPhotoOnline = async (visitId: string, clientGeneratedId: string | null = null): Promise<string | null> => {
    let blobToUpload = photoBlob;

    // If photoBlob was lost (app backgrounded), try to restore from pending_photos IDB
    if (!blobToUpload) {
      try {
        const b64 = await getPendingPhoto(item.id);
        if (b64) {
          const raw = b64.includes(",") ? b64.split(",")[1] : b64;
          const byteStr = atob(raw);
          const arr = new Uint8Array(byteStr.length);
          for (let i = 0; i < byteStr.length; i++) arr[i] = byteStr.charCodeAt(i);
          blobToUpload = new Blob([arr], { type: "image/jpeg" });
        }
      } catch { /* IDB unavailable — proceed without photo */ }
    }

    if (!blobToUpload) return null;

    const queuePhoto = async () => {
      try {
        const b64 = await blobToBase64(blobToUpload!);
        await savePendingPhoto(item.id, b64, visitId, clientGeneratedId);
        toast.warning("Photo saved for upload — will retry when connection improves");
      } catch { /* IDB write failure must not block checkout */ }
    };
    try {
      const path = `${repId}/${visitId}.jpg`;
      const { error } = await supabase.storage
        .from("visit-photos")
        .upload(path, blobToUpload, { contentType: "image/jpeg", upsert: true });
      if (error) {
        console.warn("[Photo] Upload failed:", error.message);
        await queuePhoto();
        return null;
      }
      const { data: urlData } = supabase.storage.from("visit-photos").getPublicUrl(path);
      return urlData?.publicUrl || null;
    } catch {
      await queuePhoto();
      return null;
    }
  };

  const updateItem = async (
    updates: Partial<{ arrival_time: string; leaving_time: string; notes: string; status: string; duration_minutes: number; order_number: string | null; order_quantity: number | null; order_amount: number | null }>
  ) => {
    if (actionInProgress) return;
    setActionInProgress(true);

    const newItem = { ...item, ...updates };
    if (newItem.arrival_time && newItem.leaving_time) {
      newItem.duration_minutes = calcDuration(newItem.arrival_time, newItem.leaving_time);
    }

    onLocalUpdate(item.id, {
      arrival_time: newItem.arrival_time || null,
      leaving_time: newItem.leaving_time || null,
      duration_minutes: newItem.duration_minutes || null,
      notes: newItem.notes || null,
      status: newItem.status,
    });

    try {
      if (!navigator.onLine) {
        await queueScheduleItemUpdate(newItem);
        // Skip offline visit INSERT when the visit was already created at arrival
        if (!activeVisitId) await handleOfflineVisitSave(newItem);
        return;
      }

      const { error } = await supabase
        .from("schedule_items")
        .update({
          arrival_time: newItem.arrival_time || null,
          leaving_time: newItem.leaving_time || null,
          duration_minutes: newItem.duration_minutes || null,
          notes: newItem.notes || null,
          status: newItem.status,
        })
        .eq("id", item.id);

      if (error) {
        if (isOfflineError(error)) {
          await queueScheduleItemUpdate(newItem);
          if (!activeVisitId) await handleOfflineVisitSave(newItem);
          return;
        }
        toast.error(error.message);
        return;
      }

      if (
        newItem.status === "visited" &&
        newItem.arrival_time &&
        newItem.leaving_time &&
        newItem.duration_minutes >= 0
      ) {
        const checkoutData: any = {
          arrival_time: newItem.arrival_time,
          leaving_time: newItem.leaving_time,
          duration_minutes: newItem.duration_minutes,
          notes: newItem.notes || null,
          order_number: newItem.order_number ?? null,
          order_quantity: newItem.order_quantity ?? null,
          order_amount: newItem.order_amount ?? null,
          status: "visited",
        };

        // ── Resolve the visit id to PATCH (state → IDB → fall through to legacy) ──
        let patchVisitId: string | null = activeVisitId;
        if (!patchVisitId) {
          try {
            const card = await getActiveCard();
            if (card?.scheduleItemId === item.id && card.visitId) {
              patchVisitId = card.visitId;
              setActiveVisitId(card.visitId); // sync state for future calls
              if (card.clientGeneratedId && !clientGenIdRef.current) {
                clientGenIdRef.current = card.clientGeneratedId;
              }
            }
          } catch { /* IDB unavailable */ }
        }

        // Also fall back to client_generated_id upsert if patchVisitId is
        // still null but clientGenIdRef.current exists — this handles the
        // case where arrival upsert succeeded but visitId was never stored
        if (!patchVisitId && clientGenIdRef.current) {
          try {
            const { data } = await supabase
              .from("visits")
              .select("id")
              .eq("client_generated_id", clientGenIdRef.current)
              .maybeSingle();
            if (data?.id) {
              patchVisitId = data.id;
              setActiveVisitId(data.id);
            }
          } catch { /* DB unavailable */ }
        }

        if (patchVisitId) {
          // ── PATCH path: visit was already inserted at arrival ──
          const photoUrl = await uploadPhotoOnline(patchVisitId, clientGenIdRef.current);
          const { error: patchErr } = await supabase.from("visits").update({
            ...checkoutData,
            ...(photoUrl ? { photo_url: photoUrl } : {}),
          } as any).eq("id", patchVisitId);

          if (patchErr) {
            if (isOfflineError(patchErr)) {
              await queueScheduleItemUpdate(newItem);
              // Visit already exists — do NOT queue a duplicate INSERT
              toast.success("Saved offline. Will sync when online.");
              return;
            }
            console.error("[Schedule] visit patch error:", patchErr.code, patchErr.message, patchErr.details, patchErr.hint);
          } else {
            await supabase.from("schedule_items").update({ visit_id: patchVisitId }).eq("id", item.id);
            setActiveVisitId(null);
          }
        } else if (item.visit_id) {
          // ── Legacy update: visit_id already linked on schedule_item ──
          const { error: updateErr } = await supabase.from("visits").update(checkoutData).eq("id", item.visit_id);
          if (updateErr) console.error("[Schedule] visit update error:", updateErr.code, updateErr.message, updateErr.details, updateErr.hint);
          const photoUrl = await uploadPhotoOnline(item.visit_id, null);
          if (photoUrl)
            await supabase.from("visits").update({ photo_url: photoUrl } as any).eq("id", item.visit_id);
        } else {
          // ── Insert path: no prior visit row exists ──
          // Guard: check if a visited row already exists for this visit
          const { data: existing } = await supabase
            .from("visits")
            .select("id")
            .eq("rep_id", repId)
            .eq("customer_id", item.customer_id)
            .eq("visit_date", scheduleDate)
            .eq("arrival_time", newItem.arrival_time)
            .maybeSingle();

          if (existing?.id) {
            // Row already exists — PATCH it instead of inserting a duplicate
            await supabase.from("visits").update(checkoutData).eq("id", existing.id);
            await supabase.from("schedule_items").update({ visit_id: existing.id }).eq("id", item.id);
            const photoUrl = await uploadPhotoOnline(existing.id, clientGenIdRef.current);
            if (photoUrl)
              await supabase.from("visits").update({ photo_url: photoUrl } as any).eq("id", existing.id);
            return;
          }

          // No existing row — safe to insert
          const insertPayload = { rep_id: repId, customer_id: item.customer_id, visit_date: scheduleDate, ...checkoutData };
          const { data: visit, error: insertErr } = await supabase
            .from("visits")
            .insert(insertPayload as any)
            .select("id")
            .single();
          if (visit) {
            await supabase.from("schedule_items").update({ visit_id: visit.id }).eq("id", item.id);
            const photoUrl = await uploadPhotoOnline(visit.id, clientGenIdRef.current);
            if (photoUrl)
              await supabase.from("visits").update({ photo_url: photoUrl } as any).eq("id", visit.id);
          }
        }
      }
      // Only refresh the full schedule when the visit status changes to visited/skipped
      // For intermediate edits (arrival, notes, etc.), the local update is sufficient
      if (newItem.status === "visited" || newItem.status === "skipped") {
        onRefresh();
      }
    } catch (err: any) {
      console.warn("[Schedule] Network error on update:", err?.message);
      // Clear active card state even on network error to prevent stuck guard
      getActiveCard().then((card) => {
        if (card?.scheduleItemId === item.id) {
          clearActiveCard().catch(() => {});
        }
      }).catch(() => {});
      await queueScheduleItemUpdate(newItem);
      if (!activeVisitId) await handleOfflineVisitSave(newItem);
    } finally {
      setActionInProgress(false);
      if (newItem.status === "visited" || newItem.status === "skipped") {
        clearPendingPhoto(item.id).catch(() => {});
        // Only clear active_card_state when the visit is fully completed —
        // never clear it on intermediate updates (arrival, notes, etc.)
        // because markArrived saves state there after this finally runs.
        getActiveCard().then((card) => {
          if (card?.scheduleItemId === item.id) {
            clearActiveCard().catch(() => {});
          }
        }).catch(() => {});
      }
    }
  };

  const handleOfflineVisitSave = async (newItem: any) => {
    if (newItem.arrival_time && newItem.leaving_time && newItem.duration_minutes >= 0) {
      try {
        let photoB64: string | null = null;
        if (photoBlob) photoB64 = await blobToBase64(photoBlob);
        await saveVisitOffline(
          repId, item.customer_id, scheduleDate,
          newItem.arrival_time, newItem.leaving_time,
          newItem.duration_minutes, newItem.notes || null,
          item.customers?.customer_name, undefined, photoB64,
          newItem.order_number ?? null, newItem.order_quantity ?? null, newItem.order_amount ?? null,
        );
        toast.success("Saved offline. Will sync when online.");
      } catch (idbErr) {
        console.error("[Schedule] IndexedDB save failed:", idbErr);
        toast.error("Failed to save visit. Please try again.");
      }
    }
  };

  const saveDoneOrder = async () => {
    if (actionInProgress) return;
    setActionInProgress(true);
    try {
      let visitId = item.visit_id;
      if (!visitId) {
        const { data } = await supabase
          .from("visits")
          .select("id")
          .eq("rep_id", repId)
          .eq("customer_id", item.customer_id)
          .eq("visit_date", scheduleDate)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        visitId = data?.id;
      }
      if (!visitId) {
        toast.error("Visit record not found");
        setActionInProgress(false);
        return;
      }
      const { error } = await supabase.from("visits").update({
        order_number: doneOrderNumber || null,
        order_quantity: doneOrderQty !== "" ? Number(doneOrderQty) : null,
        order_amount: doneOrderAmount !== "" ? Number(doneOrderAmount) : null,
      } as any).eq("id", visitId);
      if (error) {
        toast.error(error.message);
      } else {
        toast.success("Order updated");
        setEditingDone(false);
        onRefresh();
      }
    } catch {
      toast.error("Failed to update");
    } finally {
      setActionInProgress(false);
    }
  };

  const commitNotes   = () => { if (localNotes   !== (item.notes        || "")) updateItem({ notes:        localNotes   }); };
  const commitArrival = () => { if (localArrival !== (item.arrival_time || "")) updateItem({ arrival_time: localArrival }); };
  const commitLeaving = () => { if (localLeaving !== (item.leaving_time || "")) updateItem({ leaving_time: localLeaving }); };

  const reportSyncError = async (context: Record<string, any>) => {
    try {
      await (supabase as any).from("sync_errors").insert({
        rep_id: repId,
        error_type: "ghost_active_card",
        message: "Active card state found in IDB for a visit not present in today's schedule. Cleared automatically.",
        context,
      });
    } catch { /* non-critical — never block the rep */ }
  };

  const markArrived = async () => {
    if (arrivingRef.current) return;
    arrivingRef.current = true;
    setArriving(true);
    // Guard: block if another visit is already open
    const alreadyOpen = allItems.find(
      (i: any) => i.arrival_time && !i.leaving_time && i.id !== item.id
    );
    if (alreadyOpen) {
      toast.error(`You have an open visit at ${alreadyOpen.customers?.customer_name ?? "another customer"}. Please check out first.`);
      return;
    }

    // Guard: check IDB active card for a different item
    try {
      const card = await getActiveCard();
      if (card?.scheduleItemId && card.scheduleItemId !== item.id) {
        const openCardItem = allItems.find((i: any) => i.id === card.scheduleItemId);
        const isStale = !openCardItem
          || openCardItem.status === "visited"
          || openCardItem.status === "skipped"
          || !!openCardItem.leaving_time;

        if (isStale) {
          clearActiveCard().catch(() => {});
          if (!openCardItem) {
            // Ghost card — item no longer exists in today's schedule (multi-device drift)
            reportSyncError({
              stale_schedule_item_id: card.scheduleItemId,
              current_item_id: item.id,
              schedule_date: scheduleDate,
              cleared_at: new Date().toISOString(),
            });
            toast.info("Cleared a stale visit from another device.");
          }
          // do NOT return — allow markArrived to proceed
        } else {
          const customerName = openCardItem?.customers?.customer_name ?? "another customer";
          toast.error(`You have an open visit at ${customerName}. Please check out first.`);
          return;
        }
      }
    } catch { /* IDB unavailable — skip check */ }

    const t = nowTime();
    setLocalArrival(t);
    // Always update schedule_items arrival_time (handles online/offline paths internally)
    // Must be awaited so the finally block in updateItem completes before we
    // call saveActiveCard below — prevents a race that was clearing active_card_state.
    await updateItem({ arrival_time: t });

    if (navigator.onLine) {
      try {
        // Generate a stable client-side id for idempotent upsert — persists across retries
        if (!clientGenIdRef.current) clientGenIdRef.current = uuidv4();
        const cgid = clientGenIdRef.current;

        const { data, error } = await supabase
          .from("visits")
          .insert({
            rep_id: repId,
            customer_id: item.customer_id,
            visit_date: scheduleDate,
            arrival_time: t,
            status: "in_progress",
            client_generated_id: cgid,
          } as any)
          .select("id")
          .single();

        if (!error && data?.id) {
          setActiveVisitId(data.id);

          // Upload photo if the rep had already captured one before tapping the clock
          if (photoBlob) {
            const photoUrl = await uploadPhotoOnline(data.id, cgid);
            if (photoUrl)
              await supabase.from("visits").update({ photo_url: photoUrl } as any).eq("id", data.id);
          }

          // Persist visitId in IDB so a background/resume cycle can restore it
          saveActiveCard({
            scheduleItemId: item.id,
            arrivalTime: t,
            notes: localNotes,
            visitId: data.id,
            clientGeneratedId: cgid,
          }).catch(() => {});
        } else {
          // Upsert failed (network or schema) — treat as offline, keep cgid for later
          saveActiveCard({
            scheduleItemId: item.id,
            arrivalTime: t,
            notes: localNotes,
            clientGeneratedId: cgid,
          }).catch(() => {});
        }
      } catch {
        // Network exception — fall through to offline path
        if (!clientGenIdRef.current) clientGenIdRef.current = uuidv4();
        saveActiveCard({
          scheduleItemId: item.id,
          arrivalTime: t,
          notes: localNotes,
          clientGeneratedId: clientGenIdRef.current,
        }).catch(() => {});
      }
    } else {
      // Offline path — store cgid so the sync engine can do an idempotent INSERT later
      if (!clientGenIdRef.current) clientGenIdRef.current = uuidv4();
      saveActiveCard({
        scheduleItemId: item.id,
        arrivalTime: t,
        notes: localNotes,
        clientGeneratedId: clientGenIdRef.current,
      }).catch(() => {});
    }
    arrivingRef.current = false;
    setArriving(false);
  };
  const markLeft    = () => { if (cameraCooldownRef.current) return; const t = nowTime(); setLocalLeaving(t); updateItem({ leaving_time: t, status: "visited", notes: localNotes, order_number: localOrderNumber || null, order_quantity: localOrderQty !== "" ? Number(localOrderQty) : null, order_amount: localOrderAmount !== "" ? Number(localOrderAmount) : null }); };

  const skipItem = async (note: string = skipNote) => {
    if (actionInProgress) return;
    if (!note.trim()) { toast.error("Please provide a reason before skipping"); return; }
    setActionInProgress(true);
    const skippedUpdates = { arrival_time: null, leaving_time: null, duration_minutes: 0, notes: note, status: "skipped" };
    onLocalUpdate(item.id, skippedUpdates);
    try {
      if (!navigator.onLine) {
        await queueScheduleItemUpdate(skippedUpdates);
        await saveVisitOffline(repId, item.customer_id, scheduleDate, "00:00", "00:00", 0, note, item.customers?.customer_name, "skipped");
        toast.success("Saved offline. Will sync when online.");
        return;
      }
      const { error } = await supabase.from("schedule_items").update({ status: "skipped", notes: note }).eq("id", item.id);
      if (error) {
        if (isOfflineError(error)) {
          await queueScheduleItemUpdate(skippedUpdates);
          await saveVisitOffline(repId, item.customer_id, scheduleDate, "00:00", "00:00", 0, note, item.customers?.customer_name, "skipped");
          toast.success("Saved offline. Will sync when online.");
          return;
        }
        toast.error(error.message); return;
      }
      await supabase.from("visits").insert({ rep_id: repId, customer_id: item.customer_id, visit_date: scheduleDate, arrival_time: "00:00", leaving_time: "00:00", duration_minutes: 0, notes: note, status: "skipped" } as any);
      onRefresh();
    } catch (err: any) {
      console.warn("[Schedule] Network error on skip:", err?.message);
      try {
        await queueScheduleItemUpdate(skippedUpdates);
        await saveVisitOffline(repId, item.customer_id, scheduleDate, "00:00", "00:00", 0, note, item.customers?.customer_name, "skipped");
        toast.success("Saved offline. Will sync when online.");
      } catch (idbErr) {
        console.error("[Schedule] IndexedDB save failed:", idbErr);
        toast.error("Failed to save. Please try again.");
      }
    } finally {
      setActionInProgress(false);
      setSkipMode(false);
      setSkipNote("");
      // Clear active card state in case rep arrived then chose to skip
      getActiveCard().then((card) => {
        if (card?.scheduleItemId === item.id) {
          clearActiveCard().catch(() => {});
        }
      }).catch(() => {});
    }
  };

  const markVisited = () => updateItem({ status: "visited", arrival_time: localArrival, leaving_time: localLeaving, notes: localNotes, order_number: localOrderNumber || null, order_quantity: localOrderQty !== "" ? Number(localOrderQty) : null, order_amount: localOrderAmount !== "" ? Number(localOrderAmount) : null });

  const isInProgress = item.status === "pending" && item.arrival_time && !item.leaving_time;
  const customerName = item.customers?.customer_name ?? "Unknown";
  const accountNum   = item.customers?.account_number;

  // ── collapsed row ──
  const collapsedRow = (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-4 px-5 py-4 text-left"
      style={{ background: "transparent", position: "relative" }}
    >
      {/* 42×42 avatar with number/icon */}
      <div
        className="shrink-0 rounded-[14px] flex items-center justify-center font-syne font-bold text-lg"
        style={{
          width: 42,
          height: 42,
          background: item.status === "visited" ? C.green :
                      item.status === "skipped" ? C.dangerSoft :
                      isInProgress ? C.greenDeep : C.cream,
          color: item.status === "visited" ? "#fff" :
                 item.status === "skipped" ? C.danger :
                 isInProgress ? C.sun : C.inkSoft,
          boxShadow: isInProgress ? `0 6px 14px -4px ${C.greenDeep}66` : "none",
        }}
      >
        {item.status === "visited" ? <Check size={18} /> :
         item.status === "skipped" ? <X size={16} /> :
         index + 1}
      </div>

      {/* name and details */}
      <div className="flex-1 min-w-0">
        <p className="font-syne font-600 text-base" style={{ color: C.ink, letterSpacing: "-0.2px", lineHeight: 1.1 }}>{customerName}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span
            className="inline-flex items-center gap-1 text-[11px] font-semibold"
            style={{
              color: item.status === "visited" ? C.green :
                     item.status === "skipped" ? C.danger :
                     isInProgress ? C.sun : C.inkSoft,
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            <span style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: item.status === "visited" ? C.green :
                          item.status === "skipped" ? C.danger :
                          isInProgress ? C.sun : C.inkSoft,
              display: "inline-block",
              flexShrink: 0,
            }} />
            {item.status === "visited" ? "Visited" :
             item.status === "skipped" ? "Skipped" :
             isInProgress ? "In Progress" : item.status}
          </span>
          <span className="text-[11px]" style={{ color: C.inkMute, fontFamily: "'DM Sans', sans-serif" }}>· {accountNum || "—"}</span>
          {item.status === "visited" && item.duration_minutes > 0 && (
            <span className="text-[11px] font-semibold inline-flex items-center gap-1" style={{ color: C.inkSoft, fontFamily: "'DM Sans', sans-serif" }}>
              · <Clock size={11} /> {item.duration_minutes}m
            </span>
          )}
          {item.status === "visited" && (() => {
            const v = Array.isArray(item.visits) ? item.visits[0] : item.visits;
            if (!v?.order_amount) return null;
            return <span className="text-[11px]" style={{ color: C.inkMute, fontFamily: "'DM Sans', sans-serif" }}>· R {parseFloat(String(v.order_amount)).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
          })()}
        </div>
      </div>

      {/* expand chevron */}
      <span style={{ color: C.inkMute, transform: isExpanded ? "rotate(180deg)" : "rotate(0)", transition: "transform 320ms cubic-bezier(0.22,0.61,0.36,1)" }}>
        <ChevronDown size={18} />
      </span>
    </button>
  );

  return (
    <div
      id={`card-${item.id}`}
      className="rounded-[22px] overflow-hidden"
      style={{
        background: isInProgress ? `linear-gradient(180deg, ${C.surface} 0%, ${C.surfaceAlt} 100%)` : C.surface,
        border: `${isInProgress && isExpanded ? 1.5 : 1}px solid ${isInProgress && isExpanded ? C.green : C.border}`,
        boxShadow: isInProgress
          ? `0 14px 30px -14px rgba(27,82,56,0.32), 0 1px 0 rgba(255,255,255,0.6) inset`
          : "0 1px 0 rgba(255,255,255,0.7) inset, 0 1px 2px rgba(23,23,21,0.04)",
        transition: "border-color 280ms ease, box-shadow 280ms ease",
        position: "relative",
      }}
    >
      {collapsedRow}

      <Expand open={isExpanded}>
        <div style={{ height: 1, background: `linear-gradient(90deg, transparent, ${C.border}, transparent)`, margin: "0" }} />

      <div className="px-[18px] pb-5" style={{ paddingTop: "14px" }}>
        {/* visited state */}
        {item.status === "visited" && (
          <>
            {/* 4-chip row: Arrived / Photo / Order / Left */}
            <div style={{ background: C.cream, borderRadius: 14, padding: "6px", display: "flex", gap: 4, marginBottom: 10 }}>
              {[
                { label: "ARRIVED", value: item.arrival_time ? item.arrival_time.slice(0, 5) : null },
                { label: "PHOTO", value: (Array.isArray(item.visits) ? item.visits[0]?.photo_url : item.visits?.photo_url) ? "✓" : null },
                { label: "ORDER", value: (Array.isArray(item.visits) ? item.visits[0]?.order_number : item.visits?.order_number) ? "✓" : null },
                { label: "LEFT", value: item.leaving_time ? item.leaving_time.slice(0, 5) : null },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  style={{
                    flex: 1,
                    background: value ? C.surface : C.cream,
                    borderRadius: 999,
                    padding: "12px 4px",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: C.inkMute, fontFamily: "'DM Sans', sans-serif" }}>
                    {label}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: value ? C.ink : C.inkMute, fontFamily: "'Syne', sans-serif", marginTop: 3, opacity: value ? 1 : 0.3 }}>
                    {value ?? "—"}
                  </div>
                </div>
              ))}
            </div>

            {/* Time at stop & Order cards (2-col grid) */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
              <div
                style={{
                  background: C.surfaceAlt,
                  borderRadius: 16,
                  padding: "12px 14px",
                  position: "relative",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 10.5, color: C.inkMute, letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 700, fontFamily: "'DM Sans', sans-serif", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Clock size={13} />Time at stop
                  </div>
                  <Lock size={11} color={C.inkMute} />
                </div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, color: C.ink, fontWeight: 700, letterSpacing: "-0.4px", marginTop: 4, lineHeight: 1 }}>
                  {item.duration_minutes > 0 ? (item.duration_minutes < 60 ? `${item.duration_minutes}m` : `${Math.floor(item.duration_minutes / 60)}h ${item.duration_minutes % 60}m`) : "—"}
                </div>
                {item.arrival_time && item.leaving_time && (
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11.5, color: C.inkSoft, marginTop: 4 }}>
                    {item.arrival_time.slice(0, 5)} → {item.leaving_time.slice(0, 5)}
                  </div>
                )}
              </div>

              {(() => {
                const v = Array.isArray(item.visits) ? item.visits[0] : item.visits;
                if (!v?.order_number && v?.order_amount == null) return null;
                return (
                  <div style={{ background: C.surfaceAlt, borderRadius: 16, padding: "12px 14px" }}>
                    <div style={{ fontSize: 10.5, color: C.inkMute, letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 700, fontFamily: "'DM Sans', sans-serif" }}>
                      Order {v.order_number}
                    </div>
                    <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, color: C.ink, fontWeight: 700, letterSpacing: "-0.4px", marginTop: 4, lineHeight: 1 }}>
                      R {parseFloat(String(v.order_amount || 0)).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11.5, color: C.inkSoft, marginTop: 4 }}>
                      {v.order_quantity} units
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Edit Order button or form */}
            {!editingDone && (
              <button
                type="button"
                onClick={async () => {
                  let visitId = item.visit_id;
                  let visitData: any = null;
                  if (visitId) {
                    const res = await supabase.from("visits").select("order_number, order_quantity, order_amount").eq("id", visitId).maybeSingle();
                    visitData = res.data;
                  }
                  if (!visitData) {
                    const res = await (supabase.from("visits").select("order_number, order_quantity, order_amount")
                      .eq("rep_id", repId).eq("customer_id", item.customer_id).eq("visit_date", scheduleDate)
                      .order("created_at", { ascending: false }).limit(1).maybeSingle() as any);
                    visitData = res.data;
                  }
                  setDoneOrderNumber(visitData?.order_number || "");
                  setDoneOrderQty(visitData?.order_quantity != null ? String(visitData.order_quantity) : "");
                  setDoneOrderAmount(visitData?.order_amount != null ? String(visitData.order_amount) : "");
                  setEditingDone(true);
                }}
                style={{
                  width: "100%",
                  height: 38,
                  borderRadius: 12,
                  border: `1px solid ${C.border}`,
                  background: C.surface,
                  color: C.inkSoft,
                  cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                  fontWeight: 600,
                  fontSize: 12.5,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                <Pencil size={13} /> Edit order details
              </button>
            )}

            {editingDone && (
              <div style={{ background: C.cream, borderRadius: 16, padding: 12, marginBottom: 10, border: `1px solid ${C.border}` }}>
                <Expand open={editingDone}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontSize: 10.5, color: C.inkMute, letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 700, fontFamily: "'DM Sans', sans-serif" }}>
                      Edit order
                    </div>
                    <div style={{ fontSize: 10, color: C.inkMute, fontFamily: "'DM Sans', sans-serif", display: "inline-flex", alignItems: "center", gap: 3 }}>
                      <Lock size={10} /> Times &amp; locked
                    </div>
                  </div>
                <div style={{ display: "grid", gridTemplateColumns: "1.3fr 0.6fr 1fr", gap: 8, marginBottom: 10 }}>
                  {/* PadInput-style inputs */}
                  <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
                    <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>№</div>
                    <input
                      type="text"
                      value={doneOrderNumber}
                      onChange={(e) => setDoneOrderNumber(e.target.value)}
                      onBlur={resetMobileZoom}
                      placeholder="PO-0000"
                      inputMode="numeric"
                      style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }}
                    />
                  </label>
                  <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
                    <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>Qty</div>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={doneOrderQty}
                      onChange={(e) => setDoneOrderQty(e.target.value)}
                      onBlur={resetMobileZoom}
                      placeholder="0"
                      inputMode="numeric"
                      style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }}
                    />
                  </label>
                  <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
                    <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>Value</div>
                    <input
                      type="text"
                      min="0"
                      step="0.01"
                      value={doneOrderAmount}
                      onChange={(e) => setDoneOrderAmount(e.target.value)}
                      onBlur={resetMobileZoom}
                      placeholder="R 0,00"
                      inputMode="decimal"
                      style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }}
                    />
                  </label>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setEditingDone(false)}
                    style={{
                      height: 40,
                      borderRadius: 12,
                      border: "none",
                      cursor: "pointer",
                      background: "transparent",
                      color: C.inkSoft,
                      fontFamily: "'DM Sans', sans-serif",
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={saveDoneOrder}
                    disabled={actionInProgress}
                    style={{
                      height: 40,
                      borderRadius: 12,
                      border: "none",
                      cursor: "pointer",
                      background: `linear-gradient(180deg, ${C.greenMid} 0%, ${C.green} 100%)`,
                      color: "#fff",
                      fontFamily: "'Syne', sans-serif",
                      fontWeight: 700,
                      fontSize: 13,
                      letterSpacing: 0.2,
                      boxShadow: `0 8px 16px -8px ${C.green}aa, 0 1px 0 rgba(255,255,255,0.2) inset`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    <Check size={14} /> Save changes
                  </button>
                </div>
                </Expand>
              </div>
            )}
          </>
        )}

        {/* skipped state */}
        {item.status === "skipped" && item.notes && (
          <div style={{ background: C.dangerSoft, borderRadius: 16, padding: 14, marginBottom: 6, border: `1px solid ${C.danger}22` }}>
            <div style={{ fontSize: 10.5, color: C.danger, letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 700, fontFamily: "'DM Sans', sans-serif", marginBottom: 4 }}>
              Skip reason
            </div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: C.ink, lineHeight: 1.45 }}>
              {item.notes}
            </div>
          </div>
        )}

        {/* pending / active state */}
        {item.status === "pending" && !skipMode && (
          <>
            {/* Stepper pills */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px", background: C.cream, borderRadius: 999, marginBottom: 14 }}>
              <div style={{ flex: 1, textAlign: "center", padding: "7px 4px", borderRadius: 999, background: localArrival ? C.surface : "transparent", boxShadow: localArrival ? "0 2px 6px rgba(23,23,21,0.06)" : "none" }}>
                <div style={{ fontSize: 9.5, color: C.inkMute, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif", fontWeight: 700 }}>Arrived</div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, color: localArrival ? C.greenInk : C.inkMute, marginTop: 1, fontWeight: 600 }}>
                  {localArrival ? localArrival.slice(0, 5) : "—"}
                </div>
              </div>
              <div style={{ flex: 1, textAlign: "center", padding: "7px 4px", borderRadius: 999, background: photoBlob ? C.surface : "transparent", boxShadow: photoBlob ? "0 2px 6px rgba(23,23,21,0.06)" : "none" }}>
                <div style={{ fontSize: 9.5, color: C.inkMute, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif", fontWeight: 700 }}>Photo</div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, color: photoBlob ? C.greenInk : C.inkMute, marginTop: 1, fontWeight: 600 }}>
                  {photoBlob ? "✓" : "—"}
                </div>
              </div>
              <div style={{ flex: 1, textAlign: "center", padding: "7px 4px", borderRadius: 999, background: "transparent" }}>
                <div style={{ fontSize: 9.5, color: C.inkMute, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif", fontWeight: 700 }}>Order</div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, color: C.inkMute, marginTop: 1, fontWeight: 600 }}>
                  —
                </div>
              </div>
              <div style={{ flex: 1, textAlign: "center", padding: "7px 4px", borderRadius: 999, background: "transparent" }}>
                <div style={{ fontSize: 9.5, color: C.inkMute, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif", fontWeight: 700 }}>Left</div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, color: C.inkMute, marginTop: 1, fontWeight: 600 }}>
                  —
                </div>
              </div>
            </div>

            {!isInProgress ? (
              /* Pending state — show arrive button */
              <>
                <RippleButton
                  onClick={markArrived}
                  disabled={arriving}
                  style={{
                    width: "100%",
                    height: 56,
                    borderRadius: 18,
                    border: "none",
                    cursor: arriving ? "not-allowed" : "pointer",
                    background: arriving
                      ? `linear-gradient(180deg, ${C.inkSoft} 0%, ${C.inkSoft} 100%)`
                      : `linear-gradient(180deg, ${C.greenMid} 0%, ${C.green} 100%)`,
                    color: "#fff",
                    fontFamily: "'Syne', sans-serif",
                    fontWeight: 700,
                    fontSize: 16,
                    letterSpacing: 0.2,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    boxShadow: arriving ? "none" : `0 12px 24px -10px ${C.green}88`,
                    marginBottom: 6,
                    opacity: arriving ? 0.7 : 1,
                    transition: "background 200ms, opacity 200ms",
                  }}
                >
                  <MapPin size={18} /> {arriving ? "Checking in…" : "Tap to check in"}
                </RippleButton>
                <button
                  type="button"
                  onClick={() => { setSkipMode(true); setSkipNote(""); }}
                  style={{
                    width: "100%",
                    height: 40,
                    borderRadius: 12,
                    border: "none",
                    cursor: "pointer",
                    background: "transparent",
                    color: C.inkSoft,
                    fontFamily: "'DM Sans', sans-serif",
                    fontWeight: 600,
                    fontSize: 13,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                  }}
                >
                  <SkipForward size={14} /> Mark as skipped
                </button>
              </>
            ) : (
              /* Active state — show order, photo, checkout */
              <Expand open={isInProgress}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                  <CameraCapture
                    onCapture={handleCameraCapture}
                    buttonStyle={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      height: 44,
                      borderRadius: 14,
                      cursor: "pointer",
                      background: photoBlob ? C.greenInk : C.cream,
                      color: photoBlob ? "#fff" : C.inkSoft,
                      border: "none",
                      fontFamily: "'DM Sans', sans-serif",
                      fontWeight: 600,
                      fontSize: 13,
                      width: "100%",
                    }}
                    buttonLabel={<><Camera size={15} /> {photoBlob ? "Photo ready" : "Take photo"}</>}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNotes((v) => !v)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      height: 44,
                      borderRadius: 14,
                      cursor: "pointer",
                      background: C.cream,
                      color: C.inkSoft,
                      border: "none",
                      fontFamily: "'DM Sans', sans-serif",
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    <FileText size={15} /> Add note
                  </button>
                </div>

                {showNotes && (
                  <div style={{ marginBottom: 12 }}>
                    <textarea
                      value={localNotes}
                      onChange={(e) => setLocalNotes(e.target.value)}
                      onBlur={resetMobileZoom}
                      placeholder="Add a note…"
                      rows={3}
                      style={{
                        width: "100%",
                        resize: "none",
                        border: `1px solid ${C.border}`,
                        borderRadius: 12,
                        outline: "none",
                        background: C.surface,
                        fontFamily: "'DM Sans', sans-serif",
                        fontSize: 13.5,
                        color: C.ink,
                        lineHeight: 1.45,
                        padding: "10px 12px",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                )}

                <div style={{ background: C.cream, borderRadius: 16, padding: 12, marginBottom: 14 }}>
                  <div style={{ fontSize: 10.5, color: C.inkMute, letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 600, fontFamily: "'DM Sans', sans-serif", marginBottom: 8 }}>
                    Order
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1.3fr 0.6fr 1fr", gap: 8 }}>
                    <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
                      <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>№</div>
                      <input type="text" value={localOrderNumber} onChange={(e) => setLocalOrderNumber(e.target.value)} onBlur={resetMobileZoom} placeholder="PO-0000" inputMode="numeric" style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }} />
                    </label>
                    <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
                      <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>Qty</div>
                      <input type="number" min="0" step="1" value={localOrderQty} onChange={(e) => setLocalOrderQty(e.target.value)} onBlur={resetMobileZoom} placeholder="0" inputMode="numeric" style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }} />
                    </label>
                    <label style={{ background: C.surface, borderRadius: 12, padding: "6px 10px", boxShadow: `inset 0 0 0 1px ${C.border}`, display: "block", cursor: "text" }}>
                      <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>Value</div>
                      <input type="text" min="0" step="0.01" value={localOrderAmount} onChange={(e) => setLocalOrderAmount(e.target.value)} onBlur={resetMobileZoom} placeholder="R 0,00" inputMode="decimal" style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, padding: 0, marginTop: 1 }} />
                    </label>
                  </div>
                </div>

                <RippleButton
                  onClick={markLeft}
                  style={{
                    width: "100%",
                    height: 60,
                    borderRadius: 18,
                    border: "none",
                    cursor: "pointer",
                    background: `linear-gradient(180deg, ${C.greenMid} 0%, ${C.green} 100%)`,
                    color: "#fff",
                    fontFamily: "'Syne', sans-serif",
                    fontWeight: 700,
                    fontSize: 17,
                    letterSpacing: 0.3,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    boxShadow: `0 12px 28px -10px ${C.green}aa, 0 1px 0 rgba(255,255,255,0.2) inset, 0 -1px 0 ${C.greenDeep}88 inset`,
                    marginBottom: 6,
                  }}
                >
                  <Check size={20} /> Tap to check out
                </RippleButton>
                <button
                  type="button"
                  onClick={() => { setSkipMode(true); setSkipNote(""); }}
                  style={{
                    width: "100%",
                    height: 40,
                    borderRadius: 12,
                    border: "none",
                    cursor: "pointer",
                    background: "transparent",
                    color: C.inkSoft,
                    fontFamily: "'DM Sans', sans-serif",
                    fontWeight: 600,
                    fontSize: 13,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                  }}
                >
                  <SkipForward size={14} /> Mark as skipped
                </button>
              </Expand>
            )}
          </>
        )}

        {/* Skip composer — shows when skipMode = true */}
        {item.status === "pending" && skipMode && (
          <div style={{ background: `linear-gradient(180deg, ${C.dangerSoft} 0%, #FBEFE9 100%)`, borderRadius: 18, padding: 14, border: `1px solid ${C.danger}33` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: 10, background: C.danger, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <SkipForward size={14} />
                </div>
                <div>
                  <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: C.ink, letterSpacing: "-0.1px" }}>Skip this stop</div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: C.inkSoft }}>A note is required.</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setSkipMode(false); setSkipNote(""); }}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.6)",
                  border: "none",
                  color: C.inkSoft,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X size={14} />
              </button>
            </div>

            <div style={{ background: "#fff", borderRadius: 14, padding: 12, border: `1px solid ${C.danger}22`, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)", marginBottom: 12 }}>
              <textarea
                value={skipNote}
                onChange={(e) => setSkipNote(e.target.value.slice(0, 240))}
                placeholder="Why are you skipping this stop?"
                rows={3}
                style={{
                  width: "100%",
                  resize: "none",
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 13.5,
                  color: C.ink,
                  lineHeight: 1.45,
                }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                <div style={{ fontSize: 10.5, color: C.inkMute, fontFamily: "'DM Sans', sans-serif", letterSpacing: 0.8, textTransform: "uppercase", fontWeight: 600 }}>
                  {skipNote.trim().length >= 3 ? "Looks good" : "Required"}
                </div>
                <div style={{ fontSize: 11, color: C.inkMute, fontFamily: "'DM Sans', sans-serif" }}>
                  {skipNote.length}/240
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => skipItem(skipNote)}
              disabled={skipNote.trim().length < 3 || actionInProgress}
              style={{
                width: "100%",
                height: 52,
                borderRadius: 16,
                border: "none",
                cursor: skipNote.trim().length >= 3 ? "pointer" : "not-allowed",
                marginTop: 0,
                background: skipNote.trim().length >= 3 ? `linear-gradient(180deg, #C46A57 0%, ${C.danger} 100%)` : "rgba(184,90,74,0.25)",
                color: "#fff",
                fontFamily: "'Syne', sans-serif",
                fontWeight: 700,
                fontSize: 15,
                letterSpacing: 0.2,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                boxShadow: skipNote.trim().length >= 3 ? `0 10px 22px -10px ${C.danger}aa, 0 1px 0 rgba(255,255,255,0.15) inset` : "none",
                opacity: skipNote.trim().length >= 3 ? 1 : 0.85,
                transition: "background 200ms, box-shadow 200ms",
              }}
            >
              <SkipForward size={16} /> Confirm skip
            </button>
          </div>
        )}
        </div>
      </Expand>
    </div>
  );
}
