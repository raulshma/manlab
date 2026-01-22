/**
 * Geolocation Database Manager Component
 * Provides full CRUD management for IP geolocation databases.
 * Features: source selection, download with progress, update, delete.
 */

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Database,
  Download,
  RefreshCcw,
  Trash2,
  CheckCircle2,
  XCircle,
  HardDrive,
  Calendar,
  Globe,
  Info,
} from "lucide-react";
import {
  type GeoDatabaseStatus,
  type GeoDatabaseSource,
  getGeolocationStatus,
  getGeolocationSources,
  downloadGeolocationDatabaseFromSource,
  updateGeolocationDatabase,
  deleteGeolocationDatabase,
} from "@/api/networkApi";
import { announce } from "@/lib/accessibility";

// Format bytes to human-readable size
function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

// Format date to readable string
function formatDate(dateString: string | null): string {
  if (!dateString) return "Unknown";
  try {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateString;
  }
}

export function GeolocationDbManager() {
  const [status, setStatus] = useState<GeoDatabaseStatus | null>(null);
  const [sources, setSources] = useState<GeoDatabaseSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Fetch status and sources
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [statusData, sourcesData] = await Promise.all([
        getGeolocationStatus(),
        getGeolocationSources(),
      ]);
      setStatus(statusData);
      setSources(sourcesData);
      
      // Set default selected source
      if (statusData.activeSourceId) {
        setSelectedSourceId(statusData.activeSourceId);
      } else if (sourcesData.length > 0) {
        setSelectedSourceId(sourcesData[0].id);
      }
    } catch (err) {
      console.error("Failed to fetch geolocation data:", err);
      setError("Failed to load geolocation database information");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle download
  const handleDownload = useCallback(async () => {
    if (!selectedSourceId) return;
    
    try {
      setDownloading(true);
      setDownloadProgress(10); // Start with some progress
      setError(null);
      
      // Simulate progress since the API doesn't stream progress
      const progressInterval = setInterval(() => {
        setDownloadProgress((prev) => Math.min(prev + 5, 90));
      }, 500);

      const result = await downloadGeolocationDatabaseFromSource(selectedSourceId);
      
      clearInterval(progressInterval);
      setDownloadProgress(100);
      
      if (result.success) {
        announce("Geolocation database downloaded successfully");
        await fetchData();
      } else {
        setError("Download failed");
      }
    } catch (err) {
      console.error("Download failed:", err);
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
      setDownloadProgress(0);
    }
  }, [selectedSourceId, fetchData]);

  // Handle update
  const handleUpdate = useCallback(async () => {
    try {
      setUpdating(true);
      setError(null);
      
      const result = await updateGeolocationDatabase();
      
      if (result.success) {
        announce("Geolocation database updated successfully");
        await fetchData();
      } else {
        setError("Update failed");
      }
    } catch (err) {
      console.error("Update failed:", err);
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setUpdating(false);
    }
  }, [fetchData]);

  // Handle delete
  const handleDelete = useCallback(async () => {
    try {
      setDeleting(true);
      setError(null);
      
      const result = await deleteGeolocationDatabase();
      
      if (result.success) {
        announce("Geolocation database deleted");
        await fetchData();
      } else {
        setError("Delete failed");
      }
    } catch (err) {
      console.error("Delete failed:", err);
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }, [fetchData]);

  // Get selected source info
  const selectedSource = sources.find((s) => s.id === selectedSourceId);
  const activeSource = sources.find((s) => s.id === status?.activeSourceId);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <RefreshCcw className="h-8 w-8 mx-auto mb-2 animate-spin" />
          <p>Loading geolocation database info...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              IP Geolocation Database
            </CardTitle>
            <CardDescription className="mt-1">
              Manage the IP geolocation database used for location lookups
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={fetchData}
            disabled={loading || downloading}
            title="Refresh status"
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current Status */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">Status</span>
              {status?.isAvailable ? (
                <Badge variant="default" className="gap-1 bg-green-600">
                  <CheckCircle2 className="h-3 w-3" />
                  Available
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1">
                  <XCircle className="h-3 w-3" />
                  Not Installed
                </Badge>
              )}
            </div>
            
            {status?.isAvailable && (
              <>
                <div className="flex items-center gap-2 text-sm">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Source:</span>
                  <span className="font-medium">{activeSource?.name || status.activeSourceId}</span>
                </div>
                
                {status.metadata?.buildDate && (
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Build Date:</span>
                    <span className="font-medium">{status.metadata.buildDate}</span>
                  </div>
                )}

                <div className="flex items-center gap-2 text-sm">
                  <HardDrive className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">File Size:</span>
                  <span className="font-medium">{formatBytes(status.fileSizeBytes)}</span>
                </div>

                {status.lastUpdated && (
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Downloaded:</span>
                    <span className="font-medium">{formatDate(status.lastUpdated)}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Source Selector */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-muted-foreground">
              Database Source
            </label>
            <Select
              value={selectedSourceId}
              onValueChange={(v) => setSelectedSourceId(v ?? "")}
              disabled={downloading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a database source" />
              </SelectTrigger>
              <SelectContent>
                {sources.map((source) => (
                  <SelectItem key={source.id} value={source.id}>
                    <div className="flex flex-col items-start">
                      <span>{source.name}</span>
                      <span className="text-xs text-muted-foreground">
                        ~{formatBytes(source.estimatedSizeBytes)}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedSource && (
              <div className="rounded-lg bg-muted/50 p-3 space-y-1.5">
                <p className="text-xs text-muted-foreground">{selectedSource.description}</p>
                <div className="flex items-center gap-1 text-xs">
                  <Info className="h-3 w-3" />
                  <span className="text-muted-foreground">{selectedSource.license}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Download Progress */}
        {downloading && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Downloading database...</span>
              <span className="font-medium">{downloadProgress}%</span>
            </div>
            <Progress value={downloadProgress} className="h-2" />
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-2">
          {!status?.isAvailable ? (
            <Button
              onClick={handleDownload}
              disabled={downloading || !selectedSourceId}
              className="gap-2"
            >
              {downloading ? (
                <>
                  <RefreshCcw className="h-4 w-4 animate-spin" />
                  Downloading...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Download Database
                </>
              )}
            </Button>
          ) : (
            <>
              <Button
                onClick={handleUpdate}
                disabled={updating || downloading}
                variant="outline"
                className="gap-2"
              >
                {updating ? (
                  <>
                    <RefreshCcw className="h-4 w-4 animate-spin" />
                    Updating...
                  </>
                ) : (
                  <>
                    <RefreshCcw className="h-4 w-4" />
                    Update Database
                  </>
                )}
              </Button>

              <Button
                onClick={handleDownload}
                disabled={downloading || !selectedSourceId}
                variant="outline"
                className="gap-2"
              >
                {downloading ? (
                  <>
                    <RefreshCcw className="h-4 w-4 animate-spin" />
                    Downloading...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Change Source
                  </>
                )}
              </Button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    className="gap-2"
                    disabled={deleting}
                  >
                    {deleting ? (
                      <>
                        <RefreshCcw className="h-4 w-4 animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      <>
                        <Trash2 className="h-4 w-4" />
                        Delete Database
                      </>
                    )}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Geolocation Database?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will remove the installed geolocation database. 
                      IP location lookups will not work until you download a new database.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
