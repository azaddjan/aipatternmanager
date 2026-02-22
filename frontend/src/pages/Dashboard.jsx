import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { fetchPatterns, fetchHealth, fetchCoverage, fetchCategories } from '../api/client'
import { TypeBadge } from '../components/PatternCard'

export default function Dashboard() {
  const [health, setHealth] = useState(null)
  const [patterns, setPatterns] = useState([])
  const [coverage, setCoverage] = useState(null)
  const [categoryLabels, setCategoryLabels] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetchHealth().catch(() => null),
      fetchPatterns({ limit: 500 }).catch(() => ({ patterns: [], total: 0 })),
      fetchCoverage().catch(() => null),
      fetchCategories().catch(() => ({ categories: [] })),
    ]).then(([h, p, c, cats]) => {
      setHealth(h)
      setPatterns(p.patterns || [])
      setCoverage(c)
      // Build category labels map from dynamic categories
      const labels = {}
      ;(cats.categories || []).forEach(cat => {
        labels[cat.code] = cat.label
      })
      setCategoryLabels(labels)
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
        <StatCard label="Total Patterns" value={patterns.length} color="blue" />
        <StatCard label="AB (Topology)" value={abCount} color="orange" />
        <StatCard label="ABB (Logical)" value={abbCount} color="blue" />
        <StatCard label="SBB (Physical)" value={sbbCount} color="green" />
        <StatCard label="PBCs" value={health?.pbc_count || 0} color="purple" />
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

      {/* Recent Patterns Table */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">All Patterns</h2>
          <Link to="/patterns" className="text-blue-400 text-sm hover:underline">View all &rarr;</Link>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 text-left border-b border-gray-800">
              <th className="pb-2 font-medium">ID</th>
              <th className="pb-2 font-medium">Name</th>
              <th className="pb-2 font-medium">Type</th>
              <th className="pb-2 font-medium">Status</th>
              <th className="pb-2 font-medium">Version</th>
            </tr>
          </thead>
          <tbody>
            {patterns.slice(0, 10).map(p => (
              <tr key={p.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                <td className="py-2">
                  <Link to={`/patterns/${p.id}`} className="text-blue-400 font-mono text-xs hover:underline">
                    {p.id}
                  </Link>
                </td>
                <td className="py-2 text-gray-300">{p.name}</td>
                <td className="py-2"><TypeBadge type={p.type} /></td>
                <td className="py-2">
                  <span className={
                    p.status === 'ACTIVE' ? 'text-green-400' :
                    p.status === 'DEPRECATED' ? 'text-red-400' : 'text-yellow-400'
                  }>{p.status}</span>
                </td>
                <td className="py-2 text-gray-500 font-mono text-xs">{p.version}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatCard({ label, value, color }) {
  const colors = {
    blue: 'border-blue-500/30 text-blue-400',
    orange: 'border-orange-500/30 text-orange-400',
    green: 'border-green-500/30 text-green-400',
    purple: 'border-purple-500/30 text-purple-400',
  }
  return (
    <div className={`card border-l-4 ${colors[color]}`}>
      <p className="text-3xl font-bold">{value}</p>
      <p className="text-sm text-gray-500 mt-1">{label}</p>
    </div>
  )
}
