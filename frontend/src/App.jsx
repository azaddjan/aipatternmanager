import { Routes, Route } from 'react-router-dom'
import Sidebar from './components/Sidebar'
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
import ImpactAnalysis from './pages/ImpactAnalysis'

export default function App() {
  return (
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
          <Route path="/admin" element={<Admin />} />
          <Route path="/impact" element={<ImpactAnalysis />} />
        </Routes>
      </main>
    </div>
  )
}
