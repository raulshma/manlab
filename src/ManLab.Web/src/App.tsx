import { Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SignalRProvider } from "./SignalRContext";
import { DownloadProvider } from "./DownloadContext";
import { ThemeProvider } from "./components/theme-provider";
import { AppLayout } from "./layout/AppLayout";
import { DashboardPage } from "./pages/DashboardPage";
import { NodesPage } from "./pages/NodesPage";
import { NodeDetailsPage } from "./pages/NodeDetailsPage";
import { AuditLogsPage } from "./pages/AuditLogsPage";
import { LogViewerPage } from "./pages/LogViewerPage";
import { FileBrowserPage } from "./pages/FileBrowserPage";
import { SettingsPage } from "./pages/SettingsPage";
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
        <Route path="/" element={<DashboardPage />} />
        <Route path="/nodes" element={<NodesPage />} />
        <Route path="/nodes/:id" element={<NodeDetailsPage />} />
        <Route path="/files" element={<FileBrowserPage />} />
        <Route path="/logs" element={<AuditLogsPage />} />
        <Route path="/node-logs" element={<LogViewerPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
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
        <SignalRProvider>
          <DownloadProvider>
            <AppRoutes />
            <Toaster />
          </DownloadProvider>
        </SignalRProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
