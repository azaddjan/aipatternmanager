import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { fetchPatterns, fetchHealth, fetchCoverage, fetchCategories, fetchAuditLogs, fetchTeams, fetchTeamStats } from '../api/client'
import { TypeBadge } from '../components/PatternCard'
import { SkeletonStatCard, SkeletonText } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'

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

function getCompColor(val) {
  if (val >= 80) return 'text-green-400'
  if (val >= 60) return 'text-yellow-400'
  return 'text-red-400'
}

function getCompBg(val) {
  if (val >= 80) return 'bg-green-500'
  if (val >= 60) return 'bg-yellow-500'
  return 'bg-red-500'
}

export default function Dashboard() {
  const [health, setHealth] = useState(null)
  const [patterns, setPatterns] = useState([])
  const [coverage, setCoverage] = useState(null)
  const [categoryLabels, setCategoryLabels] = useState({})
  const [auditLogs, setAuditLogs] = useState([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditLoading, setAuditLoading] = useState(false)
  const [loading, setLoading] = useState(true)

  // Team stats
  const [teams, setTeams] = useState([])
  const [teamStats, setTeamStats] = useState(null)
  const [selectedTeamId, setSelectedTeamId] = useState(null) // null = All Teams
  const [filterLoading, setFilterLoading] = useState(false)

  useEffect(() => {
    Promise.all([
      fetchHealth().catch(() => null),
      fetchPatterns({ limit: 500 }).catch(() => ({ patterns: [], total: 0 })),
      fetchCoverage().catch(() => null),
      fetchCategories().catch(() => ({ categories: [] })),
      fetchAuditLogs({ limit: 15 }).catch(() => ({ logs: [] })),
      fetchTeams().catch(() => []),
      fetchTeamStats().catch(() => null),
    ]).then(([h, p, c, cats, audit, teamList, tStats]) => {
      setHealth(h)
      setPatterns(p.patterns || [])
      setCoverage(c)
      const labels = {}
      ;(cats.categories || []).forEach(cat => {
        labels[cat.code] = cat.label
      })
      setCategoryLabels(labels)
      setAuditLogs(audit.logs || [])
      setAuditTotal(audit.total || 0)
      setTeams(teamList)
      setTeamStats(tStats)
      setLoading(false)
    })
  }, [])

  const handleTeamFilter = async (teamId) => {
    const id = teamId || null
    setSelectedTeamId(id)
    setFilterLoading(true)
    try {
      const [p, c] = await Promise.all([
        fetchPatterns({ limit: 500, ...(id ? { team_ids: id } : {}) }).catch(() => ({ patterns: [], total: 0 })),
        fetchCoverage(id).catch(() => null),
      ])
      setPatterns(p.patterns || [])
      setCoverage(c)
    } catch {
      // silent fallback
    }
    setFilterLoading(false)
  }

  const loadMoreActivity = () => {
    setAuditLoading(true)
    fetchAuditLogs({ skip: auditLogs.length, limit: 15 })
      .then(res => {
        setAuditLogs(prev => [...prev, ...(res.logs || [])])
        setAuditTotal(res.total || auditTotal)
      })
      .catch(() => {})
      .finally(() => setAuditLoading(false))
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">AI Pattern Management System Overview</p>
        </div>
        <div className="grid grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonStatCard key={i} />)}
        </div>
        <div className="card">
          <SkeletonText lines={6} />
        </div>
      </div>
    )
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
      {/* Header with Team Selector */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">AI Pattern Management System Overview</p>
        </div>
        {teams.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-400">Team:</label>
            <select
              value={selectedTeamId || ''}
              onChange={e => handleTeamFilter(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:border-blue-500 focus:outline-none min-w-[180px]"
              disabled={filterLoading}
            >
              <option value="">All Teams</option>
              {teams.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {filterLoading && (
              <span className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            )}
          </div>
        )}
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

      {/* Active Filter Indicator */}
      {selectedTeamId && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-400">Filtered to:</span>
          <span className="bg-blue-500/15 text-blue-400 px-2.5 py-0.5 rounded-full text-xs font-medium border border-blue-500/30">
            {teams.find(t => t.id === selectedTeamId)?.name || 'Unknown Team'}
          </span>
          <button
            onClick={() => handleTeamFilter('')}
            className="text-gray-500 hover:text-gray-300 text-xs underline"
          >
            Clear filter
          </button>
        </div>
      )}

      {/* Team Portfolio Table */}
      {teamStats && teamStats.teams?.length > 0 && (
        <TeamComparisonTable
          teamStats={teamStats}
          selectedTeamId={selectedTeamId}
          onTeamSelect={(id) => handleTeamFilter(id === selectedTeamId ? '' : id)}
        />
      )}

      {/* Coverage + Categories */}
      <div className="grid grid-cols-2 gap-6">
        {/* ABB Coverage Matrix */}
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">
            ABB Coverage Matrix
            {selectedTeamId && <span className="text-xs text-gray-500 font-normal ml-2">(team-scoped)</span>}
          </h2>
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
          <span className="text-gray-600 text-xs">
            {auditLogs.length}{auditTotal > auditLogs.length ? ` of ${auditTotal}` : ''} changes
          </span>
        </div>
        {auditLogs.length === 0 ? (
          <EmptyState
            icon="📊"
            title="No activity recorded yet"
            description="Activity will appear here as you create and edit patterns"
            actionLabel="Create a Pattern"
            actionLink="/patterns/new"
          />
        ) : (
          <>
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
            {auditTotal > auditLogs.length && (
              <button
                onClick={loadMoreActivity}
                disabled={auditLoading}
                className="w-full mt-3 py-2 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800/50 rounded-lg transition-colors disabled:opacity-40"
              >
                {auditLoading ? 'Loading...' : `Load more (${auditTotal - auditLogs.length} remaining)`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/* ── Team Portfolio Table ── */
function TeamComparisonTable({ teamStats, selectedTeamId, onTeamSelect }) {
  const allRows = [
    ...teamStats.teams.map(t => ({
      id: t.id,
      name: t.name,
      members: t.member_count,
      total: t.patterns.total,
      ab: t.patterns.ab,
      abb: t.patterns.abb,
      sbb: t.patterns.sbb,
      completeness: t.completeness_avg,
      isUnowned: false,
    })),
    ...(teamStats.unowned?.total > 0 ? [{
      id: null,
      name: 'Unowned',
      members: '-',
      total: teamStats.unowned.total,
      ab: teamStats.unowned.ab,
      abb: teamStats.unowned.abb,
      sbb: teamStats.unowned.sbb,
      completeness: null,
      isUnowned: true,
    }] : []),
  ]

  return (
    <div className="card">
      <h2 className="text-lg font-semibold mb-4">Team Portfolio</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 border-b border-gray-800">
              <th className="text-left py-2.5 px-3 font-medium">Team</th>
              <th className="text-right py-2.5 px-3 font-medium">Members</th>
              <th className="text-right py-2.5 px-3 font-medium">Total</th>
              <th className="text-right py-2.5 px-3 font-medium">AB</th>
              <th className="text-right py-2.5 px-3 font-medium">ABB</th>
              <th className="text-right py-2.5 px-3 font-medium">SBB</th>
              <th className="text-right py-2.5 px-3 font-medium">Completeness</th>
            </tr>
          </thead>
          <tbody>
            {allRows.map(row => (
              <tr
                key={row.id || 'unowned'}
                onClick={() => row.id && onTeamSelect(row.id)}
                className={`border-b border-gray-800/50 transition-colors
                  ${row.id ? 'cursor-pointer hover:bg-gray-800/50' : 'text-gray-500 italic'}
                  ${row.id === selectedTeamId ? 'bg-blue-500/10' : ''}`}
              >
                <td className="py-2.5 px-3">
                  <div className="flex items-center gap-2">
                    {row.id === selectedTeamId && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                    )}
                    <span className={`font-medium ${row.isUnowned ? 'text-gray-500' : 'text-gray-200'}`}>
                      {row.name}
                    </span>
                  </div>
                </td>
                <td className="py-2.5 px-3 text-right text-gray-400">{row.members}</td>
                <td className="py-2.5 px-3 text-right font-mono text-gray-200">{row.total}</td>
                <td className="py-2.5 px-3 text-right font-mono text-purple-400">{row.ab}</td>
                <td className="py-2.5 px-3 text-right font-mono text-blue-400">{row.abb}</td>
                <td className="py-2.5 px-3 text-right font-mono text-green-400">{row.sbb}</td>
                <td className="py-2.5 px-3 text-right">
                  {row.completeness != null ? (
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 bg-gray-800 rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full transition-all ${getCompBg(row.completeness)}`}
                          style={{ width: `${Math.min(row.completeness, 100)}%` }}
                        />
                      </div>
                      <span className={`font-mono text-xs ${getCompColor(row.completeness)}`}>
                        {Math.round(row.completeness)}%
                      </span>
                    </div>
                  ) : (
                    <span className="text-gray-600">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ── Stat Card ── */
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
