import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import { ToastProvider } from './components/Toast'
import Sidebar from './components/Sidebar'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import PatternList from './pages/PatternList'
import PatternDetail from './pages/PatternDetail'
import PatternEditor from './pages/PatternEditor'
import GraphExplorer from './pages/GraphExplorer'
import TechnologyRegistry from './pages/TechnologyRegistry'
import TechnologyDetail from './pages/TechnologyDetail'
import PBCManager from './pages/PBCManager'
import PBCDetail from './pages/PBCDetail'
import Admin from './pages/Admin'
import PatternDiscovery from './pages/PatternDiscovery'
import PatternAdvisor from './pages/PatternAdvisor'
import ImpactAnalysis from './pages/ImpactAnalysis'
import PatternHealth from './pages/PatternHealth'
import UserManagement from './pages/UserManagement'
import TeamManagement from './pages/TeamManagement'

export default function App() {
  const { user, loading, isAdmin } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">🧩</div>
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Login />
  }

  return (
    <ToastProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/patterns" element={<PatternList />} />
            <Route path="/patterns/:id" element={<PatternDetail />} />
            <Route path="/patterns/:id/edit" element={<PatternEditor />} />
            <Route path="/patterns/new" element={<PatternEditor />} />
            <Route path="/graph" element={<GraphExplorer />} />
            <Route path="/technologies" element={<TechnologyRegistry />} />
            <Route path="/technologies/:id" element={<TechnologyDetail />} />
            <Route path="/pbcs" element={<PBCManager />} />
            <Route path="/pbcs/:id" element={<PBCDetail />} />
            <Route path="/discovery" element={<PatternDiscovery />} />
            <Route path="/advisor" element={<PatternAdvisor />} />
            <Route path="/admin" element={isAdmin ? <Admin /> : <Navigate to="/" />} />
            <Route path="/admin/users" element={isAdmin ? <UserManagement /> : <Navigate to="/" />} />
            <Route path="/admin/teams" element={isAdmin ? <TeamManagement /> : <Navigate to="/" />} />
            <Route path="/health" element={<PatternHealth />} />
            <Route path="/impact" element={<ImpactAnalysis />} />
          </Routes>
        </main>
      </div>
    </ToastProvider>
  )
}
