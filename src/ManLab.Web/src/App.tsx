import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { SignalRProvider } from './SignalRContext'
import { NodeGrid } from './components/NodeGrid'
import { ConnectionStatus } from './components/ConnectionStatus'
import { NodeDetailView } from './components/NodeDetailView'
import { MachineOnboardingModal } from './components/MachineOnboardingModal'
import { LocalAgentCard } from './components/LocalAgentCard'
import { fetchNodes } from './api'

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      refetchOnWindowFocus: true,
    },
  },
})

/**
 * Stats cards component showing node counts.
 */
function StatsCards() {
  const { data: nodes } = useQuery({
    queryKey: ['nodes'],
    queryFn: fetchNodes,
    staleTime: 10000,
  })

  const totalNodes = nodes?.length ?? 0
  const onlineNodes = nodes?.filter((n) => n.status === 'Online').length ?? 0
  const offlineNodes = nodes?.filter((n) => n.status === 'Offline').length ?? 0

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div className="min-w-0">
            <CardDescription>Total nodes</CardDescription>
            <CardTitle>{totalNodes}</CardTitle>
          </div>
          <Badge variant="outline">Total</Badge>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div className="min-w-0">
            <CardDescription>Online</CardDescription>
            <CardTitle>{onlineNodes}</CardTitle>
          </div>
          <Badge>Online</Badge>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div className="min-w-0">
            <CardDescription>Offline</CardDescription>
            <CardTitle>{offlineNodes}</CardTitle>
          </div>
          <Badge variant="destructive">Offline</Badge>
        </CardHeader>
      </Card>
    </div>
  )
}

interface DashboardViewProps {
  onSelectNode: (nodeId: string) => void;
}

/**
 * Dashboard view component showing the main dashboard.
 */
function DashboardView({ onSelectNode }: DashboardViewProps) {
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
              <div className="truncate text-sm text-muted-foreground">Device dashboard</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <ConnectionStatus />
            <nav className="flex items-center gap-2">
              <Button variant="secondary" size="sm">Dashboard</Button>
              <Button variant="ghost" size="sm">Nodes</Button>
              <Button variant="ghost" size="sm">Settings</Button>
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
        <StatsCards />

        <LocalAgentCard />

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="min-w-0">
              <CardTitle>Nodes</CardTitle>
              <CardDescription>Registered devices and their latest status</CardDescription>
            </div>
            <MachineOnboardingModal
              trigger={<Button>Onboard machine</Button>}
            />
          </CardHeader>
          <CardContent>
            <NodeGrid onSelectNode={onSelectNode} />
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

/**
 * Dashboard content component (wrapped with providers).
 * Manages navigation between dashboard and node detail views.
 */
function DashboardContent() {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  if (selectedNodeId) {
    return (
      <NodeDetailView 
        nodeId={selectedNodeId} 
        onBack={() => setSelectedNodeId(null)} 
      />
    )
  }

  return <DashboardView onSelectNode={setSelectedNodeId} />
}

/**
 * Main App component with providers.
 */
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SignalRProvider>
        <DashboardContent />
      </SignalRProvider>
    </QueryClientProvider>
  )
}

export default App
