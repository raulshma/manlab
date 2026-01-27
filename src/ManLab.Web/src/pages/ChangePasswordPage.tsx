import { useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, Key, ShieldCheck, CheckCircle2, AlertCircle, RefreshCw, LogOut, ArrowLeft, Loader2 } from "lucide-react";

export function ChangePasswordPage() {
  const { status, logout, changePassword } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Determine if we should skip current password validation
  const isPasswordMustChange = status?.passwordMustChange === true;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (newPassword.length < 4) {
        setError("New password must be at least 4 characters.");
        return;
      }
      if (newPassword !== confirmPassword) {
        setError("New passwords do not match.");
        return;
      }

      // Send empty string for current password if it's a forced password change
      await changePassword(isPasswordMustChange ? "" : currentPassword, newPassword);
      toast.success("Password changed successfully. You can now access the dashboard.");
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    toast.info("Logged out. Please log in with your new password.");
  };

  return (
    <div className="flex min-h-svh items-center justify-center bg-background relative overflow-hidden selection:bg-primary/30">
        {/* Background Ambience */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary/10 blur-[120px] mix-blend-screen animate-[pulse_4s_ease-in-out_infinite]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-blue-500/10 blur-[120px] mix-blend-screen animate-[pulse_4s_ease-in-out_infinite] delay-1000" />
        <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center mask-[linear-gradient(180deg,white,rgba(255,255,255,0))]" />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative z-10 w-full max-w-md px-4"
      >
        <Card className="border-border/50 bg-card/60 backdrop-blur-xl shadow-2xl relative overflow-hidden">
            {/* Top accent line */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-linear-to-r from-transparent via-primary to-transparent opacity-50" />
          
          <CardHeader className="space-y-1 pb-6 text-center">
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-linear-to-br from-primary/20 to-primary/5 shadow-inner border border-primary/20"
            >
              <ShieldCheck className="h-7 w-7 text-primary" />
            </motion.div>
            <h2 className="text-xl font-semibold tracking-tight">
               {isPasswordMustChange ? "Security Update Required" : "Update Credentials"}
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-[90%] mx-auto">
              {status?.passwordMustChange
                ? "A mandatory security update requires you to set a new password before proceeding."
                : "Enhance your account security by updating your access credentials periodically."}
            </p>
          </CardHeader>
          
          <CardContent className="space-y-4 pt-0">
             <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, height: 0 }}
                  animate={{ opacity: 1, scale: 1, height: "auto" }}
                  exit={{ opacity: 0, scale: 0.95, height: 0 }}
                  className="overflow-hidden"
                >
                  <Alert variant="destructive" className="bg-red-500/10 border-red-500/20 text-red-500">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="ml-2 font-semibold text-xs uppercase tracking-wide">
                      {error}
                    </AlertDescription>
                  </Alert>
                </motion.div>
              )}
            </AnimatePresence>

            <form onSubmit={handleSubmit} className="space-y-4">
              {!isPasswordMustChange && (
                 <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="space-y-2 group"
                 >
                  <Label htmlFor="current-password" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground group-focus-within:text-primary transition-colors">
                    Current Password
                  </Label>
                  <div className="relative">
                    <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                    <Input
                      id="current-password"
                      type="password"
                      autoComplete="current-password"
                      placeholder="Verify identity..."
                      className="pl-10 bg-background/50 border-input/50 focus:border-primary/50 focus:bg-background/80 transition-all duration-300"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      required
                    />
                  </div>
                </motion.div>
              )}
              
                <div className="space-y-2 group">
                  <Label htmlFor="new-password" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground group-focus-within:text-primary transition-colors">
                    New Password
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                    <Input
                      id="new-password"
                      type="password"
                      autoComplete="new-password"
                      value={newPassword}
                      placeholder="Enter new secure phrase..."
                      className="pl-10 bg-background/50 border-input/50 focus:border-primary/50 focus:bg-background/80 transition-all duration-300"
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2 group">
                  <Label htmlFor="confirm-password" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground group-focus-within:text-primary transition-colors">
                    Confirm Password
                  </Label>
                  <div className="relative">
                    <CheckCircle2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                    <Input
                      id="confirm-password"
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      placeholder="Repeat new secure phrase..."
                      className="pl-10 bg-background/50 border-input/50 focus:border-primary/50 focus:bg-background/80 transition-all duration-300"
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                    />
                  </div>
                </div>

              <div className="pt-2">
                <Button
                  type="submit"
                  className="w-full relative overflow-hidden group h-11"
                  disabled={submitting}
                  size="lg"
                >
                  <div className="absolute inset-0 w-full h-full bg-linear-to-r from-primary/0 via-white/20 to-primary/0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out" />
                  <span className="relative flex items-center gap-2">
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Updating Protocols...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4" />
                        Update Credentials
                      </>
                    )}
                  </span>
                </Button>
              </div>
            </form>

            <div className="flex items-center justify-center gap-4 pt-4 mt-2">
             {!status?.passwordMustChange && (
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-foreground" onClick={handleLogout}>
                   <LogOut className="h-3 w-3 mr-1.5" />
                   Sign Out
                </Button>
             )}
              {!isPasswordMustChange && (
                   <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => navigate("/")}>
                   <ArrowLeft className="h-3 w-3 mr-1.5" />
                   Return to Dashboard
                </Button>
              )}
            </div>
            
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
