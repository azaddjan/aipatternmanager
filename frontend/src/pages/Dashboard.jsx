import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { fetchPatterns, fetchHealth, fetchCoverage, fetchCategories, fetchAuditLogs } from '../api/client'
import { TypeBadge } from '../components/PatternCard'

const ACTION_COLORS = {
  CREATE: 'text-green-400',
  UPDATE: 'text-blue-400',
  DELETE: 'text-red-400',
  STATUS_CHANGE: 'text-yellow-400',
}

const TYPE_ICONS = {
  pattern: 'P',
  technology: 'T',
  pbc: 'B',
  category: 'C',
  user: 'U',
  team: 'G',
}

const TYPE_ROUTES = {
  pattern: '/patterns',
  technology: '/technologies',
  pbc: '/pbcs',
}

function timeAgo(isoStr) {
  if (!isoStr) return ''
  const diff = Date.now() - new Date(isoStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(isoStr).toLocaleDateString()
}

export default function Dashboard() {
  const [health, setHealth] = useState(null)
  const [patterns, setPatterns] = useState([])
  const [coverage, setCoverage] = useState(null)
  const [categoryLabels, setCategoryLabels] = useState({})
  const [auditLogs, setAuditLogs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetchHealth().catch(() => null),
      fetchPatterns({ limit: 500 }).catch(() => ({ patterns: [], total: 0 })),
      fetchCoverage().catch(() => null),
      fetchCategories().catch(() => ({ categories: [] })),
      fetchAuditLogs({ limit: 15 }).catch(() => ({ logs: [] })),
    ]).then(([h, p, c, cats, audit]) => {
      setHealth(h)
      setPatterns(p.patterns || [])
      setCoverage(c)
      // Build category labels map from dynamic categories
      const labels = {}
      ;(cats.categories || []).forEach(cat => {
        labels[cat.code] = cat.label
      })
      setCategoryLabels(labels)
      setAuditLogs(audit.logs || [])
      setLoading(false)
    })
  }, [])

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-500">Loading dashboard...</div>
  }

  const abCount  = patterns.filter(p => p.type === 'AB').length
  const abbCount = patterns.filter(p => p.type === 'ABB').length
  const sbbCount = patterns.filter(p => p.type === 'SBB').length

  const categories = {}
  patterns.forEach(p => {
    categories[p.category] = (categories[p.category] || 0) + 1
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">AI Pattern Management System Overview</p>
      </div>

      {/* Status Bar */}
      <div className="flex items-center gap-4 text-sm">
        <div className={`flex items-center gap-1.5 ${health?.status === 'healthy' ? 'text-green-400' : 'text-red-400'}`}>
          <span className="w-2 h-2 rounded-full bg-current" />
          Neo4j {health?.neo4j || 'unknown'}
        </div>
        {health?.llm_providers?.map(p => (
          <div key={p.name} className={`flex items-center gap-1.5 ${p.available ? 'text-green-400' : 'text-gray-600'}`}>
            <span className="w-2 h-2 rounded-full bg-current" />
            {p.name}{p.is_default ? ' (default)' : ''}
          </div>
        ))}
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-5 gap-4">
        <StatCard label="Total Patterns" value={patterns.length} color="blue" to="/patterns" />
        <StatCard label="AB (Conceptual)" value={abCount} color="orange" to="/patterns?type=AB" />
        <StatCard label="ABB (Logical)" value={abbCount} color="blue" to="/patterns?type=ABB" />
        <StatCard label="SBB (Physical)" value={sbbCount} color="green" to="/patterns?type=SBB" />
        <StatCard label="PBCs" value={health?.pbc_count || 0} color="purple" to="/pbcs" />
      </div>

      {/* Coverage + Categories */}
      <div className="grid grid-cols-2 gap-6">
        {/* ABB Coverage Matrix */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">ABB Coverage Matrix</h2>
          {coverage ? (
            <>
              <div className="flex items-center gap-3 mb-4">
                <div className="text-3xl font-bold text-blue-400">{coverage.coverage_pct}%</div>
                <div className="text-sm text-gray-500">
                  {coverage.covered_abbs}/{coverage.total_abbs} ABBs have SBB implementations
                </div>
              </div>
              <div className="space-y-2">
                {coverage.coverage?.map(c => (
                  <div key={c.abb_id} className="flex items-center justify-between text-sm">
                    <Link to={`/patterns/${c.abb_id}`} className="text-blue-400 hover:underline font-mono text-xs">
                      {c.abb_id}
                    </Link>
                    <span className="text-gray-400">{c.abb_name}</span>
                    <span className={`font-mono ${c.sbb_count > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {c.sbb_count} SBB{c.sbb_count !== 1 ? 's' : ''}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-gray-500">Coverage data unavailable</p>
          )}
        </div>

        {/* Category Breakdown */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Patterns by Category</h2>
          <div className="space-y-3">
            {Object.entries(categories).sort((a, b) => b[1] - a[1]).map(([code, count]) => {
              const label = categoryLabels[code] || code
              const pct = patterns.length > 0 ? (count / patterns.length * 100) : 0
              return (
                <div key={code}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-300">{label}</span>
                    <span className="text-gray-500">{count}</span>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-2">
                    <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Recent Activity Feed */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Recent Activity</h2>
          <span className="text-gray-600 text-xs">{auditLogs.length} recent changes</span>
        </div>
        {auditLogs.length === 0 ? (
          <p className="text-gray-500 text-sm py-4 text-center">No activity recorded yet</p>
        ) : (
          <div className="space-y-0">
            {auditLogs.map((log, i) => {
              const route = TYPE_ROUTES[log.entity_type]
              const entityLink = route && log.action !== 'DELETE'
                ? `${route}/${log.entity_id}`
                : null
              return (
                <div key={log.id || i} className="flex items-start gap-3 py-2.5 border-b border-gray-800/50 last:border-0">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5
                    ${log.action === 'CREATE' ? 'bg-green-500/15 text-green-400' :
                      log.action === 'DELETE' ? 'bg-red-500/15 text-red-400' :
                      'bg-blue-500/15 text-blue-400'}`}>
                    {TYPE_ICONS[log.entity_type] || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm">
                      <span className="text-gray-300 font-medium">{log.user_name || 'System'}</span>
                      <span className={`ml-1.5 text-xs font-medium ${ACTION_COLORS[log.action] || 'text-gray-400'}`}>
                        {log.action?.toLowerCase()}d
                      </span>
                      <span className="text-gray-500 mx-1">{log.entity_type}</span>
                      {entityLink ? (
                        <Link to={entityLink} className="text-blue-400 hover:underline font-mono text-xs">
                          {log.entity_id}
                        </Link>
                      ) : (
                        <span className="text-gray-400 font-mono text-xs">{log.entity_id}</span>
                      )}
                    </div>
                    {log.entity_name && (
                      <p className="text-xs text-gray-500 truncate">{log.entity_name}</p>
                    )}
                    {log.details && (
                      <p className="text-xs text-gray-600">{log.details}</p>
                    )}
                  </div>
                  <span className="text-xs text-gray-600 shrink-0 mt-0.5">{timeAgo(log.timestamp)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, color, to }) {
  const colors = {
    blue: 'border-blue-500/30 text-blue-400',
    orange: 'border-orange-500/30 text-orange-400',
    green: 'border-green-500/30 text-green-400',
    purple: 'border-purple-500/30 text-purple-400',
  }
  return (
    <Link to={to} className={`card border-l-4 ${colors[color]} hover:bg-gray-800/80 transition-colors cursor-pointer`}>
      <p className="text-3xl font-bold">{value}</p>
      <p className="text-sm text-gray-500 mt-1">{label}</p>
    </Link>
  )
}
