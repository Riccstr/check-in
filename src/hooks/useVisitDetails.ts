import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useVisitDetails(
  visitId: string | null,
  repId: string,
  customerId: string,
  scheduleDate: string,
  select: string,
): { data: any | null } {
  const [data, setData] = useState<any | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      let result: any = null;
      if (visitId) {
        const res = await supabase.from("visits").select(select).eq("id", visitId).maybeSingle();
        result = res.data;
      }
      if (!result) {
        const res = await supabase
          .from("visits")
          .select(select)
          .eq("rep_id", repId)
          .eq("customer_id", customerId)
          .eq("visit_date", scheduleDate)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        result = res.data;
      }
      if (!cancelled && result) setData(result);
    };
    fetch();
    return () => { cancelled = true; };
  }, [visitId, repId, customerId, scheduleDate, select]);

  return { data };
}
