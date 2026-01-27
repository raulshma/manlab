import { useState, type ReactNode, useEffect } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "./AuthContext";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { User, Lock, ArrowRight, Shield, Sparkles, CheckCircle2, AlertCircle, Cpu, Loader2 } from "lucide-react";

export function AuthGate({ children }: { children: ReactNode }) {
  const { status, loading, login, setup } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [skipSetup, setSkipSetup] = useState(() =>
    localStorage.getItem("manlab:skip_auth_setup") === "true"
  );

  // Check if password change is required and redirect
  useEffect(() => {
    if (status?.isAuthenticated && status.passwordMustChange) {
      navigate("/change-password");
    }
  }, [status, navigate]);

  if (loading) {
    return (
      <div className="flex h-svh items-center justify-center bg-background overflow-hidden relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,var(--tw-gradient-stops))] from-primary/20 via-background to-background opacity-50" />
        <div className="relative z-10 flex flex-col items-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 rounded-full blur-xl bg-primary/30 animate-pulse" />
            <Cpu className="h-12 w-12 text-primary animate-[spin_3s_linear_infinite]" />
          </div>
          <p className="text-muted-foreground font-mono text-sm animate-pulse">
            INITIALIZING SYSTEM...
          </p>
        </div>
      </div>
    );
  }

  if (!status) {
    return <>{children}</>;
  }

  const needsSetup = status.needsSetup;
  const canSetup = status.clientIsLocal;
  const shouldOfferSetup = !status.authEnabled && needsSetup && canSetup && !skipSetup;
  const mustSetup = status.authEnabled && needsSetup;
  const mustLogin = status.authEnabled && !needsSetup && !status.isAuthenticated;

  if (status.isAuthenticated && !status.passwordMustChange) {
    return <>{children}</>;
  }

  if (!mustSetup && !mustLogin && !shouldOfferSetup) {
    return <>{children}</>;
  }

  const isSetupMode = mustSetup || shouldOfferSetup;
  const allowSkip = shouldOfferSetup && !status.authEnabled;

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (isSetupMode) {
        if (!username || username.length < 2) {
          setError("Username must be at least 2 characters.");
          return;
        }
        if (!password || password.length < 4) {
          setError("Password must be at least 4 characters.");
          return;
        }
        if (password !== confirmPassword) {
          setError("Passwords do not match.");
          return;
        }
        await setup(username, password);
      } else {
        if (!username || !password) {
          setError("Username and password are required.");
          return;
        }
        await login(username, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
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
        {/* Brand Header */}
        <div className="mb-8 text-center relative group">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="inline-flex items-center justify-center p-3 rounded-2xl bg-linear-to-br from-background to-muted border border-border/50 shadow-lg mb-4 relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <Cpu className="h-8 w-8 text-primary relative z-10" />
          </motion.div>
          <motion.h1 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-linear-to-r from-foreground to-foreground/70"
          >
            ManLab<span className="text-primary">.web</span>
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-sm text-muted-foreground mt-2 font-medium"
          >
            Advanced Network Management Interface
          </motion.p>
        </div>

        <Card className="border-border/50 bg-card/60 backdrop-blur-xl shadow-2xl relative overflow-hidden">
          {/* Top accent line */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-linear-to-r from-transparent via-primary to-transparent opacity-50" />
          
          <CardHeader className="space-y-1 pb-2">
            <motion.div
              key={isSetupMode ? "setup" : "login"}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex items-center gap-2"
            >
              {isSetupMode ? <Shield className="h-5 w-5 text-primary" /> : <Lock className="h-5 w-5 text-primary" />}
              <h2 className="text-xl font-semibold tracking-tight">
                {isSetupMode ? "Initialize System Admin" : "System Access"}
              </h2>
            </motion.div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {isSetupMode
                ? (status.authEnabled
                  ? "Define root credentials to secure the environment."
                  : "Establish secure access protocols. (Optional)")
                : "Enter credentials to decrypt interface access."}
            </p>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            {isSetupMode && !canSetup && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
              >
                <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="ml-2 font-medium">
                    Security protocol restricts setup to local connections only.
                  </AlertDescription>
                </Alert>
              </motion.div>
            )}

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
              <div className="space-y-4">
                <div className="space-y-2 group">
                  <Label htmlFor="username" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground group-focus-within:text-primary transition-colors">
                    Username
                  </Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                    <Input
                      id="username"
                      type="text"
                      autoComplete="username"
                      placeholder="Enter identifier..."
                      className="pl-10 bg-background/50 border-input/50 focus:border-primary/50 focus:bg-background/80 transition-all duration-300"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      disabled={isSetupMode && !canSetup}
                    />
                  </div>
                </div>

                <div className="space-y-2 group">
                  <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground group-focus-within:text-primary transition-colors">
                    Password
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                    <Input
                      id="password"
                      type="password"
                      autoComplete={isSetupMode ? "new-password" : "current-password"}
                      placeholder={isSetupMode ? "Set secure phrase..." : "Enter secure phrase..."}
                      className="pl-10 bg-background/50 border-input/50 focus:border-primary/50 focus:bg-background/80 transition-all duration-300"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={isSetupMode && !canSetup}
                    />
                  </div>
                </div>

                <AnimatePresence>
                  {isSetupMode && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="space-y-2 group overflow-hidden"
                    >
                      <Label htmlFor="confirm-password" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground group-focus-within:text-primary transition-colors">
                        Confirm Password
                      </Label>
                      <div className="relative">
                        <CheckCircle2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                        <Input
                          id="confirm-password"
                          type="password"
                          autoComplete="new-password"
                          placeholder="Repeat secure phrase..."
                          className="pl-10 bg-background/50 border-input/50 focus:border-primary/50 focus:bg-background/80 transition-all duration-300"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          disabled={!canSetup}
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="pt-2">
                <Button
                  type="submit"
                  className="w-full relative overflow-hidden group h-11"
                  disabled={submitting || (isSetupMode && !canSetup)}
                  size="lg"
                >
                  <div className="absolute inset-0 w-full h-full bg-linear-to-r from-primary/0 via-white/20 to-primary/0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out" />
                  <span className="relative flex items-center gap-2">
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        {isSetupMode ? <Sparkles className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
                        {isSetupMode ? "Create Admin Credentials" : "Authenticate Session"}
                      </>
                    )}
                  </span>
                </Button>
              </div>
            </form>

            {allowSkip && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1 }}
              >
                <Button
                  variant="ghost"
                  className="w-full text-xs text-muted-foreground hover:text-foreground mt-2"
                  onClick={() => {
                    localStorage.setItem("manlab:skip_auth_setup", "true");
                    setSkipSetup(true);
                  }}
                >
                  Skip configuration (Development Mode)
                </Button>
              </motion.div>
            )}
          </CardContent>
        </Card>
        
        {/* Footer info */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="mt-8 text-center"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-muted/50 backdrop-blur-sm border border-border/50">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">System Online • v1.0.4</span>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
