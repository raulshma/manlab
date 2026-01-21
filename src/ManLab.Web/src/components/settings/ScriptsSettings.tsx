/**
 * ScriptsSettings - Script library management for the Settings page.
 * Provides CRUD operations for scripts that can be executed on nodes.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmationModal } from "@/components/ConfirmationModal";
import {
  fetchScripts,
  fetchScript,
  createScript,
  updateScript,
  deleteScript,
} from "@/api";
import type { ScriptSummary, ScriptShell } from "@/types";
import {
  Plus,
  Terminal,
  Edit2,
  Trash2,
  AlertCircle,
  FileCode,
} from "lucide-react";
import { toast } from "sonner";

export function ScriptsSettings() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [shell, setShell] = useState<ScriptShell>("Bash");
  const [content, setContent] = useState("");

  // Fetch scripts list
  const {
    data: scripts,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["scripts"],
    queryFn: fetchScripts,
  });

  // Create script mutation
  const createMutation = useMutation({
    mutationFn: () =>
      createScript({
        name: name.trim(),
        description: description.trim() || null,
        shell,
        content,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scripts"] });
      toast.success("Script created successfully");
      closeDialog();
    },
    onError: (err) => {
      toast.error("Failed to create script: " + (err as Error).message);
    },
  });

  // Update script mutation
  const updateMutation = useMutation({
    mutationFn: () => {
      if (!editingScriptId) throw new Error("No script to update");
      return updateScript(editingScriptId, {
        name: name.trim(),
        description: description.trim() || null,
        shell,
        content,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scripts"] });
      toast.success("Script updated successfully");
      closeDialog();
    },
    onError: (err) => {
      toast.error("Failed to update script: " + (err as Error).message);
    },
  });

  // Delete script mutation
  const deleteMutation = useMutation({
    mutationFn: (scriptId: string) => deleteScript(scriptId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scripts"] });
      toast.success("Script deleted successfully");
    },
    onError: (err) => {
      toast.error("Failed to delete script: " + (err as Error).message);
    },
  });

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingScriptId(null);
    setName("");
    setDescription("");
    setShell("Bash");
    setContent("");
  };

  const openCreateDialog = () => {
    setEditingScriptId(null);
    setName("");
    setDescription("");
    setShell("Bash");
    setContent("");
    setDialogOpen(true);
  };

  const openEditDialog = async (script: ScriptSummary) => {
    try {
      // Fetch full script with content
      const fullScript = await fetchScript(script.id);
      setEditingScriptId(fullScript.id);
      setName(fullScript.name);
      setDescription(fullScript.description || "");
      setShell(fullScript.shell);
      setContent(fullScript.content);
      setDialogOpen(true);
    } catch (err) {
      toast.error("Failed to load script: " + (err as Error).message);
    }
  };

  const handleSubmit = () => {
    if (editingScriptId) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const isFormValid = name.trim().length > 0 && content.trim().length > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Script Library</CardTitle>
            <CardDescription>
              Manage scripts that can be executed on your nodes via the Script
              Runner.
            </CardDescription>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreateDialog}>
                <Plus className="h-4 w-4 mr-2" />
                Add Script
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editingScriptId ? "Edit Script" : "Create Script"}
                </DialogTitle>
                <DialogDescription>
                  {editingScriptId
                    ? "Modify the script details and content."
                    : "Create a new script that can be executed on nodes."}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="script-name">Name</Label>
                    <Input
                      id="script-name"
                      placeholder="e.g., Cleanup Temp Files"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="script-shell">Shell</Label>
                    <Select
                      value={shell}
                      onValueChange={(v) => setShell(v as ScriptShell)}
                    >
                      <SelectTrigger id="script-shell">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Bash">Bash</SelectItem>
                        <SelectItem value="PowerShell">PowerShell</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="script-description">
                    Description (optional)
                  </Label>
                  <Input
                    id="script-description"
                    placeholder="Brief description of what this script does"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="script-content">Script Content</Label>
                  <Textarea
                    id="script-content"
                    placeholder={
                      shell === "Bash"
                        ? "#!/bin/bash\necho 'Hello, World!'"
                        : "Write-Host 'Hello, World!'"
                    }
                    className="font-mono text-sm min-h-50"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeDialog}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={!isFormValid || isSubmitting}
                >
                  {isSubmitting && <Spinner className="h-4 w-4 mr-2" />}
                  {editingScriptId ? "Save Changes" : "Create Script"}
                </Button>
              </DialogFooter>
              {(createMutation.isError || updateMutation.isError) && (
                <Alert variant="destructive" className="mt-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {(createMutation.error || updateMutation.error) instanceof
                    Error
                      ? (createMutation.error || updateMutation.error)?.message
                      : "An error occurred"}
                  </AlertDescription>
                </Alert>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Spinner className="h-6 w-6" />
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Failed to load scripts: {(error as Error).message}
            </AlertDescription>
          </Alert>
        ) : !scripts || scripts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <FileCode className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No scripts yet.</p>
            <p className="text-sm">
              Click "Add Script" to create your first script.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {scripts.map((script) => (
              <div
                key={script.id}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Terminal className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {script.name}
                      <Badge variant="outline" className="text-xs">
                        {script.shell}
                      </Badge>
                      {script.isReadOnly && (
                        <Badge variant="secondary" className="text-xs">
                          Read-only
                        </Badge>
                      )}
                    </div>
                    {script.description && (
                      <div className="text-sm text-muted-foreground">
                        {script.description}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openEditDialog(script)}
                    disabled={script.isReadOnly}
                    title={script.isReadOnly ? "This script is read-only" : "Edit script"}
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <ConfirmationModal
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={script.isReadOnly}
                        title={script.isReadOnly ? "This script is read-only" : "Delete script"}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    }
                    title="Delete Script"
                    message={`Are you sure you want to delete "${script.name}"? This action cannot be undone.`}
                    confirmText="Delete"
                    isDestructive
                    isLoading={deleteMutation.isPending}
                    onConfirm={async () => {
                      await deleteMutation.mutateAsync(script.id);
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
