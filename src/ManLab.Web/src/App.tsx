import { Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SignalRProvider } from "./SignalRContext";
import { DownloadProvider } from "./DownloadContext";
import { ThemeProvider } from "./components/theme-provider";
import { AppLayout } from "./layout/AppLayout";
import { AuthProvider } from "./auth/AuthContext";
import { AuthGate } from "./auth/AuthGate";
import { DashboardPage } from "./pages/DashboardPage";
import { HomePage } from "./pages/HomePage";
import { NodesPage } from "./pages/NodesPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { NodeDetailsPage } from "./pages/NodeDetailsPage";
import { AuditLogsPage } from "./pages/AuditLogsPage";
import { LogViewerPage } from "./pages/LogViewerPage";
import { FileBrowserPage } from "./pages/FileBrowserPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { NodeUpdatePage } from "./pages/NodeUpdatePage";
import { NetworkScannerPage } from "./pages/NetworkScannerPage";
import { MonitoringPage } from "./pages/MonitoringPage";
import { DockerStudioPage } from "./pages/DockerStudioPage";
import { ProcessesPage } from "./pages/ProcessesPage";
import { UsersPage } from "./pages/UsersPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { Toaster } from "@/components/ui/sonner";

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      refetchOnWindowFocus: true,
    },
  },
});

function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/nodes" element={<NodesPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/nodes/:id" element={<NodeDetailsPage />} />
        <Route path="/nodes/:id/update" element={<NodeUpdatePage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/files" element={<FileBrowserPage />} />
        <Route path="/logs" element={<AuditLogsPage />} />
        <Route path="/node-logs" element={<LogViewerPage />} />
        <Route path="/network" element={<NetworkScannerPage />} />
        <Route path="/monitoring" element={<MonitoringPage />} />
        <Route path="/docker" element={<DockerStudioPage />} />
        <Route path="/processes" element={<ProcessesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
      <Route path="/change-password" element={<ChangePasswordPage />} />
    </Routes>
  );
}

/**
 * Main App component with providers.
 * DownloadProvider is nested inside SignalRProvider to access SignalR connection.
 * Requirements: 3.1, 3.4 - Download context with SignalR integration
 */
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
        <AuthProvider>
          <AuthGate>
            <SignalRProvider>
              <DownloadProvider>
                <AppRoutes />
                <Toaster />
              </DownloadProvider>
            </SignalRProvider>
          </AuthGate>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
