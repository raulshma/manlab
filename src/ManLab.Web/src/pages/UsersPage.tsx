import { useState } from "react";
import { api } from "@/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Pencil, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

export interface UserDto {
  id: string;
  username: string;
  role: string;
  passwordMustChange: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export function UsersPage() {
  const { status } = useAuth();
  const queryClient = useQueryClient();

  // Check if current user is admin
  const isCurrentUserAdmin = status?.role === "Admin";

  const { data: users, isLoading, error } = useQuery<UserDto[]>({
    queryKey: ["users"],
    queryFn: async () => (await api.get<UserDto[]>("/api/users")).data,
    enabled: isCurrentUserAdmin,
  });

  // Create user mutation
  const createUserMutation = useMutation({
    mutationFn: async (data: { username: string; role: string; temporaryPassword: string }) =>
      api.post("/api/users", {
        username: data.username,
        role: data.role,
        tempPassword: data.temporaryPassword,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("User created successfully");
      setCreateDialogOpen(false);
      setNewUsername("");
      setNewRole("user");
      setNewTempPassword("");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to create user");
    },
  });

  // Delete user mutation
  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => api.delete(`/api/users/${userId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("User deleted successfully");
      setUserToDelete(null);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to delete user");
    },
  });

  // Reset password mutation
  const resetPasswordMutation = useMutation({
    mutationFn: async ({ userId, tempPassword }: { userId: string; tempPassword: string }) =>
      api.post(`/api/users/${userId}/reset-password`, { tempPassword }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("Password reset successfully. User must change password on next login.");
      setResetPasswordDialogOpen(false);
      setNewTempPassword("");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to reset password");
    },
  });

  // Update role mutation
  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) =>
      api.put(`/api/users/${userId}/role`, { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("User role updated successfully");
      setRoleDialogOpen(false);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to update user role");
    },
  });

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [newTempPassword, setNewTempPassword] = useState("");
  const [userToDelete, setUserToDelete] = useState<UserDto | null>(null);
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [userToResetPassword, setUserToResetPassword] = useState<UserDto | null>(null);
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [userToChangeRole, setUserToChangeRole] = useState<UserDto | null>(null);

  if (!isCurrentUserAdmin) {
    return (
      <div className="container mx-auto py-8">
        <Alert variant="destructive">
          <AlertDescription>
            You do not have permission to access this page. Only administrators can manage users.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="container mx-auto py-8 flex items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto py-8">
        <Alert variant="destructive">
          <AlertDescription>
            Failed to load users. {(error as Error).message}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (newUsername.length < 2) {
      toast.error("Username must be at least 2 characters");
      return;
    }
    if (newTempPassword.length < 4) {
      toast.error("Temporary password must be at least 4 characters");
      return;
    }
    createUserMutation.mutate({ username: newUsername, role: newRole, temporaryPassword: newTempPassword });
  };

  const handleResetPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userToResetPassword) return;
    if (newTempPassword.length < 4) {
      toast.error("New temporary password must be at least 4 characters");
      return;
    }
    resetPasswordMutation.mutate({ userId: userToResetPassword.id, tempPassword: newTempPassword });
  };

  const handleUpdateRole = () => {
    if (!userToChangeRole) return;
    updateRoleMutation.mutate({ userId: userToChangeRole.id, role: newRole });
  };

  const openResetPasswordDialog = (user: UserDto) => {
    setUserToResetPassword(user);
    setNewTempPassword("");
    setResetPasswordDialogOpen(true);
  };

  const openRoleDialog = (user: UserDto) => {
    setUserToChangeRole(user);
    setNewRole(user.role);
    setRoleDialogOpen(true);
  };

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Users</h1>
          <p className="text-muted-foreground">Manage user accounts and permissions</p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New User</DialogTitle>
              <DialogDescription>
                Create a new user account. The user will need to change their password on first login.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="new-username">Username</Label>
                <Input
                  id="new-username"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="Enter username"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="new-role">Role</Label>
                <Select value={newRole} onValueChange={(value) => setNewRole(value || "user")}>
                  <SelectTrigger id="new-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="new-temp-password">Temporary Password</Label>
                <Input
                  id="new-temp-password"
                  type="password"
                  value={newTempPassword}
                  onChange={(e) => setNewTempPassword(e.target.value)}
                  placeholder="Enter temporary password (min 4 characters)"
                  required
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createUserMutation.isPending}>
                  {createUserMutation.isPending ? <Spinner className="mr-2 h-4 w-4" /> : null}
                  Create User
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle> Users</CardTitle>
          <CardDescription>
            List of all user accounts in the system
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!users || users.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No users found. Create your first user to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Password Status</TableHead>
                  <TableHead>Last Login</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.username}</TableCell>
                    <TableCell>
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          user.role === "Admin" ? "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"
                        }`}
                      >
                        {user.role}
                      </span>
                    </TableCell>
                    <TableCell>
                      {user.passwordMustChange ? (
                        <span className="text-amber-600 dark:text-amber-400 font-medium text-sm">
                          Must change
                        </span>
                      ) : (
                        <span className="text-green-600 dark:text-green-400 font-medium text-sm">
                          Valid
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Never"}</TableCell>
                    <TableCell>{new Date(user.createdAt).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openRoleDialog(user)}
                          title="Change role"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openResetPasswordDialog(user)}
                          title="Reset password"
                        >
                          Reset Password
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setUserToDelete(user)}
                          title="Delete user"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Reset Password Dialog */}
      <Dialog open={resetPasswordDialogOpen} onOpenChange={setResetPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Reset password for <strong>{userToResetPassword?.username}</strong>. The user will need to change it on next login.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="reset-temp-password">New Temporary Password</Label>
              <Input
                id="reset-temp-password"
                type="password"
                value={newTempPassword}
                onChange={(e) => setNewTempPassword(e.target.value)}
                placeholder="Enter new temporary password"
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setResetPasswordDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={resetPasswordMutation.isPending}>
                {resetPasswordMutation.isPending ? <Spinner className="mr-2 h-4 w-4" /> : null}
                Reset Password
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Change Role Dialog */}
      <Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change User Role</DialogTitle>
            <DialogDescription>
              Change role for <strong>{userToChangeRole?.username}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="user-role">New Role</Label>
              <Select value={newRole} onValueChange={(value) => setNewRole(value || "user")}>
                <SelectTrigger id="user-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateRole} disabled={updateRoleMutation.isPending}>
              {updateRoleMutation.isPending ? <Spinner className="mr-2 h-4 w-4" /> : null}
              Change Role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete User Confirmation */}
      <AlertDialog open={!!userToDelete} onOpenChange={() => setUserToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete user <strong>{userToDelete?.username}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (userToDelete) {
                  deleteUserMutation.mutate(userToDelete.id);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteUserMutation.isPending}
            >
              {deleteUserMutation.isPending ? <Spinner className="mr-2 h-4 w-4" /> : null}
              Delete User
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
