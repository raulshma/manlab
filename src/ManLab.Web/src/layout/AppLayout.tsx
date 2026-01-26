import { Outlet, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Separator } from "@/components/ui/separator";
import { ModeToggle } from "@/components/mode-toggle";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/auth/AuthContext";

export function AppLayout() {
  const location = useLocation();
  const { status, logout } = useAuth();

  // Don't show logout button if auth is disabled or using local bypass
  const isLocalBypass = status?.authMethod === "local-bypass";
  const showLogoutButton = status?.authEnabled && status.isAuthenticated && !isLocalBypass;

  // Reset header state on route change
  useEffect(() => {
    const header = document.getElementById("app-header");
    if (header) {
      header.style.transform = "";
      header.style.opacity = "";
      header.style.pointerEvents = "";
      header.style.marginBottom = "";
    }
  }, [location.pathname]);

  return (
    <SidebarProvider className="max-h-svh h-svh overflow-hidden">
      <AppSidebar />
      <SidebarInset className="max-h-svh h-svh overflow-hidden">
        <header id="app-header" className="flex h-12 shrink-0 items-center gap-2 border-b px-4 transition-all duration-300 ease-in-out group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <div className="ml-auto flex items-center gap-2">
            {showLogoutButton ? (
              <Button variant="ghost" size="sm" onClick={logout}>
                Sign out
              </Button>
            ) : null}
            <ModeToggle />
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0 overflow-y-auto min-h-0">
          <main className="flex flex-1 flex-col py-4 min-h-0">
            <Outlet />
          </main>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
