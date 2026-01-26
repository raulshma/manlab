import { useState, type ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "./AuthContext";

export function AuthGate({ children }: { children: ReactNode }) {
  const { status, loading, login, setup } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [skipSetup, setSkipSetup] = useState(() =>
    localStorage.getItem("manlab:skip_auth_setup") === "true"
  );

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

  const needsSetup = !status.passwordSet;
  const canSetup = status.clientIsLocal;
  const shouldOfferSetup = !status.authEnabled && needsSetup && canSetup && !skipSetup;
  const mustSetup = status.authEnabled && needsSetup;
  const mustLogin = status.authEnabled && !needsSetup && !status.isAuthenticated;

  if (status.isAuthenticated) {
    return <>{children}</>;
  }

  if (!mustSetup && !mustLogin && !shouldOfferSetup) {
    return <>{children}</>;
  }

  const isSetupMode = mustSetup || shouldOfferSetup;
  const allowSkip = shouldOfferSetup && !status.authEnabled;

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);

    try {
      if (isSetupMode) {
        if (!password || password.length < 4) {
          setError("Password must be at least 4 characters.");
          return;
        }
        if (password !== confirmPassword) {
          setError("Passwords do not match.");
          return;
        }
        await setup(password);
      } else {
        await login(password);
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
          <CardTitle>{isSetupMode ? "Set Admin Password" : "Sign in"}</CardTitle>
          <CardDescription>
            {isSetupMode
              ? (status.authEnabled
                ? "Create the initial admin password to secure your ManLab dashboard."
                : "Set an admin password to enable secure access. You can skip this for now.")
              : "Enter your admin password to access the dashboard."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isSetupMode && !canSetup && (
            <Alert variant="destructive">
              <AlertDescription>
                Admin password setup is only available from a local network connection.
              </AlertDescription>
            </Alert>
          )}
          <div className="grid gap-2">
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
            <div className="grid gap-2">
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
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button className="w-full" onClick={handleSubmit} disabled={submitting || (isSetupMode && !canSetup)}>
            {submitting && <Spinner className="mr-2 h-4 w-4" />}
            {isSetupMode ? "Set Password" : "Sign in"}
          </Button>
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
