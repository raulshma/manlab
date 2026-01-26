import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/api";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";

const TOKEN_KEY = "manlab:auth_token";
const TOKEN_EXP_KEY = "manlab:auth_expires_at";

export interface AuthStatus {
  authEnabled: boolean;
  passwordSet: boolean;
  localBypassEnabled: boolean;
  localBypassCidrs: string | null;
  clientIp: string | null;
  clientIsLocal: boolean;
  isAuthenticated: boolean;
  authMethod: string | null;
}

interface AuthContextValue {
  status: AuthStatus | null;
  loading: boolean;
  token: string | null;
  refreshStatus: () => Promise<void>;
  login: (password: string) => Promise<void>;
  setup: (password: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredToken(): { token: string | null; expiresAt: string | null } {
  const token = localStorage.getItem(TOKEN_KEY);
  const expiresAt = localStorage.getItem(TOKEN_EXP_KEY);
  if (!token || !expiresAt) {
    return { token: null, expiresAt: null };
  }
  const expires = Date.parse(expiresAt);
  if (Number.isNaN(expires) || expires <= Date.now()) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXP_KEY);
    return { token: null, expiresAt: null };
  }
  return { token, expiresAt };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => readStoredToken().token);

  const statusQuery = useQuery({
    queryKey: ["auth-status"],
    queryFn: async () => (await api.get<AuthStatus>("/api/auth/status")).data,
    refetchOnWindowFocus: false,
  });

  const status = statusQuery.data ?? null;
  const loading = statusQuery.isLoading;

  const refreshStatus = useCallback(async () => {
    await statusQuery.refetch();
  }, [statusQuery]);

  const persistToken = useCallback((value: string, expiresAtUtc: string) => {
    localStorage.setItem(TOKEN_KEY, value);
    localStorage.setItem(TOKEN_EXP_KEY, expiresAtUtc);
    setToken(value);
  }, []);

  const clearToken = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXP_KEY);
    setToken(null);
  }, []);

  const login = useCallback(
    async (password: string) => {
      const { data } = await api.post<{ token: string; expiresAtUtc: string }>(
        "/api/auth/login",
        { password }
      );
      persistToken(data.token, data.expiresAtUtc);
      await refreshStatus();
      toast.success("Signed in");
    },
    [persistToken, refreshStatus]
  );

  const setup = useCallback(
    async (password: string) => {
      const { data } = await api.post<{ token: string; expiresAtUtc: string }>(
        "/api/auth/setup",
        { password }
      );
      persistToken(data.token, data.expiresAtUtc);
      await refreshStatus();
      toast.success("Password set and signed in");
    },
    [persistToken, refreshStatus]
  );

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      const { data } = await api.post<{ token: string; expiresAtUtc: string }>(
        "/api/auth/change-password",
        { currentPassword, newPassword }
      );
      persistToken(data.token, data.expiresAtUtc);
      await refreshStatus();
      toast.success("Password updated");
    },
    [persistToken, refreshStatus]
  );

  const logout = useCallback(async () => {
    await api.post("/api/auth/logout");
    clearToken();
    await refreshStatus();
    toast.success("Signed out");
  }, [clearToken, refreshStatus]);

  const value = useMemo(
    () => ({
      status,
      loading,
      token,
      refreshStatus,
      login,
      setup,
      changePassword,
      logout,
    }),
    [status, loading, token, refreshStatus, login, setup, changePassword, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
