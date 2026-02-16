import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart3 } from "lucide-react";

interface AvgRow {
  customer_name: string;
  avg_duration: number;
  total_visits: number;
  total_minutes: number;
}

export default function Averages() {
  const { repId, role } = useAuth();
  const [data, setData] = useState<AvgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState<"customer_name" | "avg_duration">("customer_name");
  const [preset, setPreset] = useState("all");

  useEffect(() => {
    if (preset === "7") {
      const d = new Date(); d.setDate(d.getDate() - 7);
      setDateFrom(d.toISOString().split("T")[0]); setDateTo(new Date().toISOString().split("T")[0]);
    } else if (preset === "30") {
      const d = new Date(); d.setDate(d.getDate() - 30);
      setDateFrom(d.toISOString().split("T")[0]); setDateTo(new Date().toISOString().split("T")[0]);
    } else if (preset === "all") {
      setDateFrom(""); setDateTo("");
    }
  }, [preset]);

  useEffect(() => {
    const fetch = async () => {
      if (!repId && role !== "admin") return;
      setLoading(true);
      let q = supabase.from("visits").select("customer_id, duration_minutes, visit_date, customers(customer_name)");
      if (role !== "admin") q = q.eq("rep_id", repId!);
      if (dateFrom) q = q.gte("visit_date", dateFrom);
      if (dateTo) q = q.lte("visit_date", dateTo);
      const { data: visits } = await q;
      if (!visits) { setLoading(false); return; }

      const map: Record<string, { name: string; total: number; count: number }> = {};
      for (const v of visits as any[]) {
        const cid = v.customer_id;
        const name = v.customers?.customer_name || "Unknown";
        if (!map[cid]) map[cid] = { name, total: 0, count: 0 };
        map[cid].total += v.duration_minutes;
        map[cid].count += 1;
      }
      const rows: AvgRow[] = Object.values(map).map((m) => ({
        customer_name: m.name,
        avg_duration: Math.round(m.total / m.count),
        total_visits: m.count,
        total_minutes: m.total,
      }));
      rows.sort((a, b) => sortBy === "customer_name" ? a.customer_name.localeCompare(b.customer_name) : b.avg_duration - a.avg_duration);
      setData(rows);
      setLoading(false);
    };
    fetch();
  }, [repId, role, dateFrom, dateTo, sortBy]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-accent" /> Averages</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="space-y-1">
            <Label className="text-xs">Period</Label>
            <Select value={preset} onValueChange={setPreset}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="7">Last 7 Days</SelectItem>
                <SelectItem value="30">Last 30 Days</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {preset === "custom" && (
            <>
              <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" /></div>
              <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" /></div>
            </>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Sort By</Label>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="customer_name">Customer Name</SelectItem>
                <SelectItem value="avg_duration">Avg Duration</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {loading ? (
          <p className="text-muted-foreground text-center py-8">Loading...</p>
        ) : data.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No data found.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Avg Duration (min)</TableHead>
                  <TableHead>Total Visits</TableHead>
                  <TableHead>Total Time (min)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.customer_name}>
                    <TableCell className="font-medium">{r.customer_name}</TableCell>
                    <TableCell>{r.avg_duration}</TableCell>
                    <TableCell>{r.total_visits}</TableCell>
                    <TableCell>{r.total_minutes}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
