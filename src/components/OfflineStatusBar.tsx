import { useState, useEffect, useCallback } from "react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { getPendingVisits } from "@/lib/offlineDb";
import { syncPendingVisits } from "@/lib/syncEngine";
import { Wifi, WifiOff, RefreshCw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

export default function OfflineStatusBar() {
  const isOnline = useOnlineStatus();
  const { role } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshCounts = useCallback(async () => {
    const pending = await getPendingVisits();
    setPendingCount(pending.filter((v) => v.sync_status === "pending").length);
    setErrorCount(pending.filter((v) => v.sync_status === "error").length);
  }, []);

  useEffect(() => {
    refreshCounts();
    const interval = setInterval(refreshCounts, 5000);
    return () => clearInterval(interval);
  }, [refreshCounts]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncPendingVisits();
      if (result.synced > 0) toast.success(`${result.synced} visit(s) synced`);
      if (result.errors > 0) toast.error(`${result.errors} visit(s) failed to sync`);
      await refreshCounts();
    } finally {
      setSyncing(false);
    }
  };

  // Only show for reps when there's something to show
  if (role === "admin" && pendingCount === 0 && errorCount === 0 && isOnline) return null;

  const totalUnsent = pendingCount + errorCount;

  return (
    <div className="flex items-center gap-2 text-xs flex-wrap">
      {/* Online/Offline badge */}
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${
        isOnline 
          ? "bg-secondary text-secondary-foreground" 
          : "bg-destructive/10 text-destructive"
      }`}>
        {isOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
        {isOnline ? "Online" : "Offline"}
      </span>

      {/* Pending count */}
      {totalUnsent > 0 && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 text-accent font-medium">
          {errorCount > 0 && <AlertCircle className="h-3 w-3 text-destructive" />}
          {totalUnsent} unsynced
        </span>
      )}

      {/* Sync button */}
      {totalUnsent > 0 && isOnline && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={handleSync}
          disabled={syncing}
        >
          <RefreshCw className={`h-3 w-3 mr-1 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing..." : "Sync Now"}
        </Button>
      )}
    </div>
  );
}
