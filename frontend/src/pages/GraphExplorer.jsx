import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { fetchFullGraph, fetchTeams } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import GraphView from '../components/GraphView'

const FILTER_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'AB', label: 'AB (Conceptual)' },
  { value: 'ABB', label: 'ABB (Logical)' },
  { value: 'SBB', label: 'SBB (Physical)' },
  { value: 'Technology', label: 'Technologies' },
]

const CATEGORY_OPTIONS = [
  { value: '', label: 'All Categories' },
  { value: 'blueprint', label: 'Architecture Blueprint' },
  { value: 'core', label: 'Core AI/LLM' },
  { value: 'intg', label: 'Integration' },
  { value: 'agt', label: 'Agents' },
  { value: 'kr', label: 'Knowledge & Retrieval' },
  { value: 'xcut', label: 'Cross-Cutting' },
  { value: 'pip', label: 'Platform Integration' },
]

export default function GraphExplorer() {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [typeFilter, setTypeFilter] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [loading, setLoading] = useState(true)

  // Team scope
  const [teams, setTeams] = useState([])
  const [selectedTeam, setSelectedTeam] = useState('all')

  // Load teams on mount
  useEffect(() => {
    fetchTeams().then(t => setTeams(Array.isArray(t) ? t : (t?.teams || []))).catch(() => {})
  }, [])

  // Load graph when team selection changes
  useEffect(() => {
    setLoading(true)
    const teamId = selectedTeam === 'all' ? null : selectedTeam
    fetchFullGraph(teamId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [selectedTeam])

  const filteredData = data ? {
    nodes: data.nodes.filter(n => {
      if (typeFilter) {
        if (typeFilter === 'Technology') return n.node_type === 'Technology'
        return n.type === typeFilter
      }
      if (catFilter) return n.category === catFilter
      return true
    }),
    edges: data.edges.filter(e => {
      const nodeIds = new Set(
        data.nodes
          .filter(n => {
            if (typeFilter) {
              if (typeFilter === 'Technology') return n.node_type === 'Technology'
              return n.type === typeFilter
            }
            if (catFilter) return n.category === catFilter
            return true
          })
          .map(n => n.id)
      )
      return nodeIds.has(e.source) && nodeIds.has(e.target)
    }),
  } : null

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm">
        <Link to="/" className="text-gray-500 hover:text-gray-300 transition-colors">&larr; Dashboard</Link>
        <span className="text-gray-700">/</span>
        <span className="text-gray-400">Graph Explorer</span>
      </div>
      <div>
        <h1 className="text-2xl font-bold text-white">Graph Explorer</h1>
        <p className="text-gray-500 text-sm mt-1">
          Interactive pattern relationship graph. Double-click a node to navigate.
          {selectedTeam !== 'all' && (
            <span className="ml-2 text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded border border-blue-500/30">
              {teams.find(t => t.id === selectedTeam)?.name || 'Team'} scope
            </span>
          )}
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        {/* Team Scope Selector */}
        <select
          value={selectedTeam}
          onChange={e => setSelectedTeam(e.target.value)}
          className="select"
        >
          <option value="all">🌐 All Patterns</option>
          {teams.map(t => (
            <option key={t.id} value={t.id}>
              {t.id === user?.team_id ? `⭐ ${t.name} (My Team)` : `🏢 ${t.name}`}
            </option>
          ))}
        </select>

        <div className="w-px h-6 bg-gray-700" />

        <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setCatFilter('') }} className="select">
          {FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={catFilter} onChange={e => { setCatFilter(e.target.value); setTypeFilter('') }} className="select">
          {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {filteredData && (
          <span className="text-sm text-gray-500 ml-auto">
            {filteredData.nodes.length} nodes &middot; {filteredData.edges.length} edges
          </span>
        )}
      </div>

      {loading ? (
        <div className="text-gray-500 text-center py-24">Loading graph...</div>
      ) : (
        <GraphView
          data={filteredData}
          height="calc(100vh - 220px)"
        />
      )}
    </div>
  )
}
