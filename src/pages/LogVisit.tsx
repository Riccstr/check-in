import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { MapPin, Clock } from "lucide-react";

export default function LogVisit() {
  const { repId } = useAuth();
  const [customers, setCustomers] = useState<{ id: string; customer_name: string }[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [visitDate, setVisitDate] = useState(new Date().toISOString().split("T")[0]);
  const [arrivalTime, setArrivalTime] = useState("");
  const [leavingTime, setLeavingTime] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!repId) return;
    supabase
      .from("customer_assignments")
      .select("customer_id, customers(id, customer_name, is_active)")
      .eq("rep_id", repId)
      .then(({ data }) => {
        if (data) {
          const active = data
            .filter((d: any) => d.customers?.is_active)
            .map((d: any) => ({ id: d.customers.id, customer_name: d.customers.customer_name }));
          setCustomers(active);
        }
      });
  }, [repId]);

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
    const { error } = await supabase.from("visits").insert({
      rep_id: repId,
      customer_id: customerId,
      visit_date: visitDate,
      arrival_time: arrivalTime,
      leaving_time: leavingTime,
      duration_minutes: duration,
      notes: notes || null,
    });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Visit logged!");
      setCustomerId("");
      setArrivalTime("");
      setLeavingTime("");
      setNotes("");
    }
    setSubmitting(false);
  };

  return (
    <div className="max-w-lg mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-accent" />
            Log a Visit
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Customer *</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.customer_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any notes about this visit..." rows={3} />
            </div>

            <Button type="submit" className="w-full" disabled={submitting || !customerId || !arrivalTime || !leavingTime || duration <= 0}>
              {submitting ? "Saving..." : "Log Visit"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
