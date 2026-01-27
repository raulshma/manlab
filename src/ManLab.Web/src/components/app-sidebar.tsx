import * as React from "react"
import { Home, Server, Settings, Activity, FileText, Folder, BarChart3, Network, Radar, Boxes, Users } from "lucide-react"
import { NavLink, useLocation } from "react-router-dom"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { ConnectionStatus } from "@/components/ConnectionStatus"
import { useAuth } from "@/auth/AuthContext"
import { hasAnyNetworkToolAccess } from "@/lib/network-tool-permissions"

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const location = useLocation()
  const { hasPermission } = useAuth()
  const canViewNodes = hasPermission("devices.view")
  const canViewMonitoring = hasPermission("monitoring.view")
  const canViewFiles = hasPermission("filebrowser.view")
  const canViewNetwork = hasAnyNetworkToolAccess(hasPermission)
  const canViewLogs = hasPermission("logs.view") || hasPermission("audit.view") || hasPermission("syslog.view") || hasPermission("logviewer.use")
  const canManageUsers = hasPermission("users.manage")
  const canManageSettings = hasPermission("settings.manage")

  const handleDisabledNav = (allowed: boolean) => (event: React.MouseEvent) => {
    if (!allowed) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<NavLink to="/" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Activity className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">ManLab</span>
                <span className="truncate text-xs">Device Manager</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton render={<NavLink to="/" />} isActive={location.pathname === "/" || location.pathname === ""}>
                  <Home />
                  <span>Dashboard</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<NavLink to="/nodes" />}
                  isActive={location.pathname.startsWith("/nodes")}
                  aria-disabled={!canViewNodes}
                  onClick={handleDisabledNav(canViewNodes)}
                >
                  <Server />
                  <span>Nodes</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<NavLink to="/analytics" />}
                  isActive={location.pathname.startsWith("/analytics")}
                  aria-disabled={!canViewMonitoring}
                  onClick={handleDisabledNav(canViewMonitoring)}
                >
                  <BarChart3 />
                  <span>Analytics</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<NavLink to="/files" />}
                  isActive={location.pathname.startsWith("/files")}
                  aria-disabled={!canViewFiles}
                  onClick={handleDisabledNav(canViewFiles)}
                >
                  <Folder />
                  <span>Files</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton render={<NavLink to="/docker" />} isActive={location.pathname.startsWith("/docker")}>
                  <Boxes />
                  <span>Docker Studio</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<NavLink to="/network" />}
                  isActive={location.pathname.startsWith("/network")}
                  aria-disabled={!canViewNetwork}
                  onClick={handleDisabledNav(canViewNetwork)}
                >
                  <Network />
                  <span>Network Tools</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<NavLink to="/monitoring" />}
                  isActive={location.pathname.startsWith("/monitoring")}
                  aria-disabled={!canViewMonitoring}
                  onClick={handleDisabledNav(canViewMonitoring)}
                >
                  <Radar />
                  <span>Monitoring</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<NavLink to="/logs" />}
                  isActive={location.pathname.startsWith("/logs")}
                  aria-disabled={!canViewLogs}
                  onClick={handleDisabledNav(canViewLogs)}
                >
                  <FileText />
                  <span>Logs</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<NavLink to="/users" />}
                  isActive={location.pathname.startsWith("/users")}
                  aria-disabled={!canManageUsers}
                  onClick={handleDisabledNav(canManageUsers)}
                >
                  <Users />
                  <span>Users</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<NavLink to="/settings" />}
                  isActive={location.pathname.startsWith("/settings")}
                  aria-disabled={!canManageSettings}
                  onClick={handleDisabledNav(canManageSettings)}
                >
                  <Settings />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="p-2">
            <ConnectionStatus />
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
