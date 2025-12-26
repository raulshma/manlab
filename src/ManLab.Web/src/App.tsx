import './App.css'
import { useState } from 'react'
import { Button } from 'react-aria-components'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { SignalRProvider } from './SignalRContext'
import { NodeGrid } from './components/NodeGrid'
import { ConnectionStatus } from './components/ConnectionStatus'
import { NodeDetailView } from './components/NodeDetailView'
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
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-400">Total Nodes</p>
            <p className="text-3xl font-bold text-white mt-1">{totalNodes}</p>
          </div>
          <div className="w-12 h-12 bg-blue-500/20 rounded-xl flex items-center justify-center">
            <svg className="w-6 h-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
            </svg>
          </div>
        </div>
      </div>

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-400">Online</p>
            <p className="text-3xl font-bold text-emerald-400 mt-1">{onlineNodes}</p>
          </div>
          <div className="w-12 h-12 bg-emerald-500/20 rounded-xl flex items-center justify-center">
            <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>
      </div>

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-400">Offline</p>
            <p className="text-3xl font-bold text-red-400 mt-1">{offlineNodes}</p>
          </div>
          <div className="w-12 h-12 bg-red-500/20 rounded-xl flex items-center justify-center">
            <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>
      </div>
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
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <header className="bg-slate-800/50 border-b border-slate-700 px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center font-bold text-sm">
              M
            </div>
            <h1 className="text-xl font-semibold tracking-tight">ManLab</h1>
          </div>
          <div className="flex items-center gap-4">
            <ConnectionStatus />
            <nav className="flex items-center gap-2">
              <Button className="px-4 py-2 text-sm text-white bg-slate-700/50 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500">
                Dashboard
              </Button>
              <Button className="px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500">
                Nodes
              </Button>
              <Button className="px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500">
                Settings
              </Button>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats Cards */}
        <StatsCards />

        {/* Node Grid Section */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold">Nodes</h2>
            <Button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800">
              Add Node
            </Button>
          </div>
          
          {/* Node Grid */}
          <NodeGrid onSelectNode={onSelectNode} />
        </div>
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
