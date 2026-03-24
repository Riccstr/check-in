import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Clock, X, ClipboardList } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { addOfflineVisit, setCachedCustomers, getCachedCustomers } from "@/lib/offlineDb";
import { compressImage, stampImage, blobToBase64 } from "@/lib/imageCompressor";
import { CameraCapture } from "@/components/CameraCapture";

export default function LogVisit() {
  const { repId } = useAuth();
  const isOnline = useOnlineStatus();
  const [customers, setCustomers] = useState<{ id: string; customer_name: string }[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [visitDate, setVisitDate] = useState(new Date().toISOString().split("T")[0]);
  const [arrivalTime, setArrivalTime] = useState("");
  const [leavingTime, setLeavingTime] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Photo state
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);

  const handleCameraCapture = async (blob: Blob) => {
    try {
      const compressed = await compressImage(blob);
      const now = new Date();
      const label = now.toLocaleString("en-US", {
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      });
      const stamped = await stampImage(compressed, label);
      setPhotoBlob(stamped);
      setPhotoPreview(URL.createObjectURL(stamped));
    } catch {
      toast.error("Failed to process photo");
    }
  };

  const clearPhoto = () => {
    setPhotoBlob(null);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
  };

  useEffect(() => {
    if (!repId) return;

    const loadCustomers = async () => {
      if (isOnline) {
        try {
          const { data } = await supabase
            .from("customer_assignments")
            .select("customer_id, customers(id, customer_name, account_number, area, is_active)")
            .eq("rep_id", repId);
          if (data) {
            const active = data
              .filter((d: any) => d.customers?.is_active)
              .map((d: any) => ({ id: d.customers.id, customer_name: d.customers.customer_name }));
            setCustomers(active);
            await setCachedCustomers(data
              .filter((d: any) => d.customers?.is_active)
              .map((d: any) => ({
                id: d.customers.id,
                customer_name: d.customers.customer_name,
                account_number: d.customers.account_number || null,
                area: d.customers.area || null,
              })));
          }
        } catch {
          await loadFromCache();
        }
      } else {
        await loadFromCache();
      }
    };

    const loadFromCache = async () => {
      const cached = await getCachedCustomers();
      if (cached.length > 0) {
        setCustomers(cached.map((c) => ({ id: c.id, customer_name: c.customer_name })));
      }
    };

    loadCustomers();
  }, [repId, isOnline]);

  const nowTime = () => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  };

  const calcDuration = (arr: string, lv: string) => {
    if (!arr || !lv) return 0;
    const [ah, am] = arr.split(":").map(Number);
    const [lh, lm] = lv.split(":").map(Number);
    return (lh * 60 + lm) - (ah * 60 + am);
  };

  const duration = calcDuration(arrivalTime, leavingTime);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repId || !customerId) return;
    if (duration <= 0) {
      toast.error("Leaving time must be after arrival time");
      return;
    }
    setSubmitting(true);

    const clientId = uuidv4();
    const visitPayload: any = {
      rep_id: repId,
      customer_id: customerId,
      visit_date: visitDate,
      arrival_time: arrivalTime,
      leaving_time: leavingTime,
      duration_minutes: duration,
      notes: notes || null,
      client_generated_id: clientId,
    };

    try {
      const { data: insertedVisit, error } = await supabase.from("visits").insert(visitPayload).select("id").maybeSingle();
      if (error) {
        const msg = error.message?.toLowerCase() || "";
        if (msg.includes("fetch") || msg.includes("network") || msg.includes("failed") || msg.includes("load") || !isOnline) {
          await saveOffline(clientId, visitPayload);
        } else {
          toast.error(error.message);
        }
      } else {
        // Upload photo online
        if (insertedVisit?.id && photoBlob) {
          try {
            const path = `${repId}/${insertedVisit.id}.jpg`;
            const { error: upErr } = await supabase.storage.from("visit-photos").upload(path, photoBlob, { contentType: "image/jpeg", upsert: true });
            if (!upErr) {
              const { data: urlData } = supabase.storage.from("visit-photos").getPublicUrl(path);
              if (urlData?.publicUrl) {
                await supabase.from("visits").update({ photo_url: urlData.publicUrl } as any).eq("id", insertedVisit.id);
              }
            }
          } catch { /* non-blocking */ }
        }
        toast.success("Visit logged!");
        resetForm();
      }
    } catch (err: any) {
      try {
        await saveOffline(clientId, visitPayload);
      } catch (idbErr: any) {
        toast.error("Failed to save visit. Please try again.");
      }
    }

    setSubmitting(false);
  };

  const saveOffline = async (clientId: string, payload: any) => {
    const customerName = customers.find((c) => c.id === payload.customer_id)?.customer_name;
    let photoB64: string | null = null;
    if (photoBlob) {
      photoB64 = await blobToBase64(photoBlob);
    }
    await addOfflineVisit({
      client_generated_id: clientId,
      payload,
      created_at_local: new Date().toISOString(),
      sync_status: "pending",
      last_sync_attempt: null,
      error_message: null,
      customer_name: customerName,
      photo_base64: photoB64,
    });
    toast.success("Saved offline. Will sync when online.");
    resetForm();
  };

  const resetForm = () => {
    setCustomerId("");
    setArrivalTime("");
    setLeavingTime("");
    setNotes("");
    clearPhoto();
  };

  return (
    <div className="max-w-lg mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-accent" />
            Log a Visit
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Customer *</Label>
              <SearchableSelect
                value={customerId}
                onValueChange={setCustomerId}
                options={customers.map((c) => ({ value: c.id, label: c.customer_name }))}
                placeholder="Select customer"
                searchPlaceholder="Search customers..."
                className="w-full"
              />
            </div>

            <div className="space-y-2">
              <Label>Visit Date</Label>
              <Input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Arrival Time *</Label>
              <div className="flex gap-2">
                <Input type="time" value={arrivalTime} onChange={(e) => setArrivalTime(e.target.value)} className="flex-1" required />
                <Button type="button" variant="outline" size="sm" className="shrink-0 border-accent text-accent hover:bg-accent hover:text-accent-foreground" onClick={() => setArrivalTime(nowTime())}>
                  <Clock className="h-4 w-4 mr-1" /> Arrived Now
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Leaving Time *</Label>
              <div className="flex gap-2">
                <Input type="time" value={leavingTime} onChange={(e) => setLeavingTime(e.target.value)} className="flex-1" required />
                <Button type="button" variant="outline" size="sm" className="shrink-0 border-accent text-accent hover:bg-accent hover:text-accent-foreground" onClick={() => setLeavingTime(nowTime())}>
                  <Clock className="h-4 w-4 mr-1" /> Left Now
                </Button>
              </div>
            </div>

            {arrivalTime && leavingTime && (
              <div className={`text-sm font-medium px-3 py-2 rounded-md ${duration > 0 ? "bg-secondary text-foreground" : "bg-destructive/10 text-destructive"}`}>
                Duration: {duration > 0 ? `${duration} minutes` : "Invalid (leaving must be after arrival)"}
              </div>
            )}

            {/* Photo capture */}
            <div className="space-y-2">
              <Label>Store Photo (optional)</Label>
              {photoPreview ? (
                <div className="relative inline-block">
                  <img src={photoPreview} alt="Store photo" className="h-24 w-24 object-cover rounded border border-border" />
                  <button
                    type="button"
                    onClick={clearPhoto}
                    className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <CameraCapture onCapture={handleCameraCapture} />
              )}
            </div>

            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any notes about this visit..." rows={3} />
            </div>

            <Button type="submit" className="w-full" disabled={submitting || !customerId || !arrivalTime || !leavingTime || duration <= 0}>
              {submitting ? "Saving…" : isOnline ? "Log Visit" : "Save Offline"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
