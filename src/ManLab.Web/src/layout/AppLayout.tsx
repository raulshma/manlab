import { Outlet, NavLink } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { ConnectionStatus } from "@/components/ConnectionStatus";

function NavButton({
  to,
  children,
}: {
  to: string;
  children: React.ReactNode;
}) {
  return (
    <NavLink to={to} end>
      {({ isActive }) => (
        <Button variant={isActive ? "secondary" : "ghost"} size="sm">
          {children}
        </Button>
      )}
    </NavLink>
  );
}

export function AppLayout() {
  return (
    <div className="min-h-screen">
      <header className="px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Avatar>
              <AvatarFallback>M</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate text-base font-medium">ManLab</div>
              <div className="truncate text-sm text-muted-foreground">
                Device dashboard
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <ConnectionStatus />
            <nav className="flex items-center gap-2">
              <NavButton to="/">Dashboard</NavButton>
              <NavButton to="/nodes">Nodes</NavButton>
              <NavButton to="/settings">Settings</NavButton>
            </nav>
          </div>
        </div>
      </header>

      <div className="px-6">
        <div className="mx-auto max-w-7xl">
          <Separator />
        </div>
      </div>

      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
