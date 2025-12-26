import './App.css'
import { Button } from 'react-aria-components'

function App() {
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
          <nav className="flex items-center gap-4">
            <Button className="px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500">
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
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Total Nodes</p>
                <p className="text-3xl font-bold text-white mt-1">0</p>
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
                <p className="text-3xl font-bold text-emerald-400 mt-1">0</p>
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
                <p className="text-3xl font-bold text-red-400 mt-1">0</p>
              </div>
              <div className="w-12 h-12 bg-red-500/20 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Node Grid Section */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold">Nodes</h2>
            <Button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800">
              Add Node
            </Button>
          </div>
          
          {/* Empty state */}
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-slate-700/50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
              </svg>
            </div>
            <h3 className="text-slate-300 font-medium mb-1">No nodes connected</h3>
            <p className="text-slate-500 text-sm">Add your first node to start monitoring</p>
          </div>
        </div>
      </main>
    </div>
  )
}

export default App
