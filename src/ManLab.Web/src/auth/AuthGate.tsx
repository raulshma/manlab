import { useState, type ReactNode, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "./AuthContext";
import { useNavigate } from "react-router-dom";

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
      <div className="flex h-svh items-center justify-center">
        <Spinner className="h-6 w-6" />
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
    <div className="flex h-svh items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{isSetupMode ? "Create Admin Account" : "Sign in"}</CardTitle>
          <CardDescription>
            {isSetupMode
              ? (status.authEnabled
                ? "Create the initial admin account to secure your ManLab dashboard."
                : "Create an admin account to enable secure access. You can skip this for now.")
              : "Enter your credentials to access the dashboard."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isSetupMode && !canSetup && (
            <Alert variant="destructive">
              <AlertDescription>
                Admin account setup is only available from a local network connection.
              </AlertDescription>
            </Alert>
          )}
          <form onSubmit={handleSubmit}>
            <div className="grid gap-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                autoComplete={isSetupMode ? "username" : "username"}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isSetupMode && !canSetup}
              />
            </div>
            <div className="grid gap-2 mt-4">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={isSetupMode ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isSetupMode && !canSetup}
              />
            </div>
            {isSetupMode && (
              <div className="grid gap-2 mt-4">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={!canSetup}
                />
              </div>
            )}
            {error && (
              <div className="mt-4">
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              </div>
            )}
            <Button
              type="submit"
              className="w-full mt-4"
              disabled={submitting || (isSetupMode && !canSetup)}
            >
              {submitting && <Spinner className="mr-2 h-4 w-4" />}
              {isSetupMode ? "Create Account" : "Sign in"}
            </Button>
          </form>
          {allowSkip && (
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => {
                localStorage.setItem("manlab:skip_auth_setup", "true");
                setSkipSetup(true);
              }}
            >
              Skip for now
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
