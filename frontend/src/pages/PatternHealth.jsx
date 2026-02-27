import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchPatternHealth, analyzePatternHealth, fetchProviders,
  fetchLatestHealthAnalysis, fetchHealthAnalyses, deleteHealthAnalysis,
  healthAnalysisExportHtmlUrl, healthAnalysisExportDocxUrl,
  authenticatedDownload,
  fetchTeams,
} from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import ConfirmModal from '../components/ConfirmModal'

const HEALTH_SECTIONS = [
  { key: 'overview', label: 'Overview' },
  { key: 'completeness', label: 'Completeness' },
  { key: 'coverage', label: 'Coverage' },
  { key: 'relationships', label: 'Relationships' },
  { key: 'problems', label: 'Problems' },
  { key: 'ai', label: 'AI Deep Analysis' },
]

function getScoreColor(score) {
  if (score >= 80) return 'text-green-400'
  if (score >= 60) return 'text-yellow-400'
  return 'text-red-400'
}

function getScoreBg(score) {
  if (score >= 80) return 'bg-green-500'
  if (score >= 60) return 'bg-yellow-500'
  return 'bg-red-500'
}

function getScoreBand(score) {
  if (score >= 80) return { label: 'Good', color: 'bg-green-500/20 text-green-400 border-green-500/30' }
  if (score >= 60) return { label: 'Fair', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' }
  return { label: 'Needs Work', color: 'bg-red-500/20 text-red-400 border-red-500/30' }
}

const TYPE_BADGE = {
  AB: 'bg-purple-500/10 text-purple-400',
  ABB: 'bg-blue-500/10 text-blue-400',
  SBB: 'bg-green-500/10 text-green-400',
}

export default function PatternHealth() {
  const { user, isAdmin } = useAuth()
  const [healthData, setHealthData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [section, setSection] = useState('overview')

  // Team scope state
  const [teams, setTeams] = useState([])
  // Default: team_member/viewer → own team, admin → 'all'
  const [selectedTeam, setSelectedTeam] = useState(() => {
    if (user?.role === 'admin') return 'all'
    return user?.team_id || 'all'
  })

  // AI analysis state
  const [aiAnalysis, setAiAnalysis] = useState(null)
  const [analyzingHealth, setAnalyzingHealth] = useState(false)
  const [savedAnalysisId, setSavedAnalysisId] = useState(null)
  const [savedAnalysisTime, setSavedAnalysisTime] = useState(null)
  const [providers, setProviders] = useState([])
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [error, setError] = useState('')

  // Analysis history
  const [analyses, setAnalyses] = useState([])
  const [analysesExpanded, setAnalysesExpanded] = useState(false)
  const [confirmAction, setConfirmAction] = useState(null)

  // Incomplete patterns pagination
  const [incompletePage, setIncompletePage] = useState(0)
  const INCOMPLETE_PAGE_SIZE = 10

  // Resolve team_id to pass to API (null = all, string = specific team)
  const effectiveTeamId = selectedTeam === 'all' ? 'all' : selectedTeam || null

  const loadHealthData = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchPatternHealth(effectiveTeamId)
      setHealthData(data)
    } catch (err) {
      setError(`Failed to load health data: ${err.message}`)
    }
    setLoading(false)
  }, [effectiveTeamId])

  // Load teams list on mount
  useEffect(() => {
    fetchTeams().then(t => setTeams(Array.isArray(t) ? t : (t?.teams || []))).catch(() => {})
  }, [])

  useEffect(() => {
    Promise.all([
      loadHealthData(),
      fetchProviders().catch(() => ({ providers: [] })),
      fetchLatestHealthAnalysis().catch(() => null),
      fetchHealthAnalyses(20).catch(() => ({ analyses: [] })),
    ]).then(([_, prov, latestAnalysis, historyData]) => {
      const provList = prov?.providers || []
      setProviders(provList)
      const def = provList.find(p => p.is_default)
      if (def) {
        setProvider(def.name)
        setModel(def.default_model)
      }
      if (latestAnalysis && latestAnalysis.analysis_json) {
        setAiAnalysis(latestAnalysis.analysis_json)
        setSavedAnalysisId(latestAnalysis.id)
        setSavedAnalysisTime(latestAnalysis.created_at || null)
      }
      setAnalyses(historyData?.analyses || [])
    })
  }, [loadHealthData])

  const handleAiAnalysis = async () => {
    setAnalyzingHealth(true)
    setError('')
    try {
      const res = await analyzePatternHealth(provider || null, model || null, effectiveTeamId)
      if (res?.analysis) {
        setAiAnalysis(res.analysis)
        setSavedAnalysisId(res.saved_analysis_id || null)
        setSavedAnalysisTime(new Date().toISOString())
        setSection('ai')
        fetchHealthAnalyses(20).then(r => setAnalyses(r?.analyses || [])).catch(() => {})
      }
    } catch (err) {
      setError(`AI analysis failed: ${err.message}`)
    }
    setAnalyzingHealth(false)
  }

  const handleLoadAnalysis = async (analysis) => {
    try {
      const { fetchHealthAnalysis: fetchFull } = await import('../api/client')
      const full = await fetchFull(analysis.id)
      if (full?.analysis_json) {
        setAiAnalysis(full.analysis_json)
        setSavedAnalysisId(full.id)
        setSavedAnalysisTime(full.created_at || analysis.created_at || null)
        setSection('ai')
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    } catch (err) {
      setError(`Failed to load analysis: ${err.message}`)
    }
  }

  const handleDeleteAnalysis = (id) => {
    setConfirmAction({
      title: 'Delete Analysis',
      message: `Are you sure you want to delete analysis "${id}"?`,
      confirmLabel: 'Delete',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmAction(null)
        try {
          await deleteHealthAnalysis(id)
          setAnalyses(prev => prev.filter(a => a.id !== id))
          if (savedAnalysisId === id) {
            setSavedAnalysisId(null)
            setSavedAnalysisTime(null)
            setAiAnalysis(null)
          }
        } catch (err) {
          setError(`Failed to delete: ${err.message}`)
        }
      },
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading pattern health data...</div>
      </div>
    )
  }

  if (!healthData) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-400">Failed to load health data. Check backend connection.</div>
      </div>
    )
  }

  const { health_score = 0, score_breakdown = {}, counts = {}, distributions = {} } = healthData
  const band = getScoreBand(health_score)
  const totalProblems = (healthData.problems?.orphans?.length || 0) +
    (healthData.problems?.deprecated_referenced?.length || 0) +
    (healthData.problems?.duplicate_names?.length || 0)
  const staleWarning = savedAnalysisId && aiAnalysis && analyses.length > 0 &&
    analyses.find(a => a.id === savedAnalysisId)?.pattern_count !== counts.total

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm">
        <Link to="/" className="text-gray-500 hover:text-gray-300 transition-colors">&larr; Dashboard</Link>
        <span className="text-gray-700">/</span>
        <span className="text-gray-400">Pattern Health</span>
      </div>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            Pattern Health
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Quality, completeness, and coverage of your pattern library
            {selectedTeam !== 'all' && (
              <span className="ml-2 text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded border border-blue-500/30">
                {teams.find(t => t.id === selectedTeam)?.name || 'Team'} scope
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Team Scope Selector */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Scope:</label>
            <select
              value={selectedTeam}
              onChange={e => setSelectedTeam(e.target.value)}
              className="input text-xs py-1.5 px-2 min-w-[160px]"
            >
              <option value="all">🌐 All Patterns</option>
              {teams.map(t => (
                <option key={t.id} value={t.id}>
                  {t.id === user?.team_id ? `⭐ ${t.name} (My Team)` : `🏢 ${t.name}`}
                </option>
              ))}
            </select>
          </div>
          <button onClick={loadHealthData} className="text-xs text-gray-400 hover:text-white transition-colors">
            Refresh
          </button>
          <div className="text-center">
            <div className={`text-3xl font-bold ${getScoreColor(health_score)}`}>
              {Math.round(health_score)}
            </div>
            <span className={`text-xs px-2 py-0.5 rounded border ${band.color}`}>
              {band.label}
            </span>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-300">x</button>
        </div>
      )}

      {/* Score Breakdown Bar */}
      <div className="card">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(score_breakdown).map(([key, value]) => {
            const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
            const numVal = typeof value === 'number' ? value : 0
            return (
              <div key={key}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-400">{label}</span>
                  <span className={`text-xs font-semibold ${getScoreColor(numVal)}`}>{Math.round(numVal)}</span>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${getScoreBg(numVal)}`}
                    style={{ width: `${Math.min(numVal, 100)}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Sub-navigation tabs */}
      <div className="flex gap-1 border-b border-gray-800">
        {HEALTH_SECTIONS.map(s => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={`px-4 py-2 text-sm transition-colors border-b-2 ${
              section === s.key
                ? 'text-blue-400 border-blue-400'
                : 'text-gray-500 border-transparent hover:text-gray-300'
            }`}
          >
            {s.label}
            {s.key === 'problems' && totalProblems > 0 && (
              <span className="ml-1.5 text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded">
                {totalProblems}
              </span>
            )}
            {s.key === 'ai' && aiAnalysis && (
              <span className="ml-1.5 text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">done</span>
            )}
          </button>
        ))}
      </div>

      {/* ======== Overview Section ======== */}
      {section === 'overview' && (
        <div className="space-y-4">
          {/* Counts */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="card text-center">
              <div className="text-3xl font-bold text-blue-400">{counts.total || 0}</div>
              <div className="text-xs text-gray-400 mt-1">Total Patterns</div>
            </div>
            <div className="card text-center">
              <div className="text-3xl font-bold text-purple-400">{counts.ab || 0}</div>
              <div className="text-xs text-gray-400 mt-1">Architecture Blueprints</div>
            </div>
            <div className="card text-center">
              <div className="text-3xl font-bold text-blue-400">{counts.abb || 0}</div>
              <div className="text-xs text-gray-400 mt-1">ABBs</div>
            </div>
            <div className="card text-center">
              <div className="text-3xl font-bold text-green-400">{counts.sbb || 0}</div>
              <div className="text-xs text-gray-400 mt-1">SBBs</div>
            </div>
          </div>

          {/* Quick Health Indicators */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="card">
              <div className="text-xs text-gray-500 mb-1">Completeness</div>
              <div className={`text-lg font-bold ${getScoreColor(healthData.completeness?.avg_score || 0)}`}>
                {Math.round(healthData.completeness?.avg_score || 0)}%
              </div>
              <div className="text-xs text-gray-600">avg field fill rate</div>
            </div>
            <div className="card">
              <div className="text-xs text-gray-500 mb-1">ABB Coverage</div>
              <div className={`text-lg font-bold ${getScoreColor(healthData.abb_coverage?.coverage_pct || 0)}`}>
                {Math.round(healthData.abb_coverage?.coverage_pct || 0)}%
              </div>
              <div className="text-xs text-gray-600">{healthData.abb_coverage?.with_sbbs || 0}/{healthData.abb_coverage?.total_abbs || 0} ABBs have SBBs</div>
            </div>
            <div className="card">
              <div className="text-xs text-gray-500 mb-1">Connectivity</div>
              <div className={`text-lg font-bold ${getScoreColor(counts.total > 0 ? ((counts.total - (healthData.relationships?.unconnected || 0)) / counts.total) * 100 : 0)}`}>
                {counts.total - (healthData.relationships?.unconnected || 0)}/{counts.total}
              </div>
              <div className="text-xs text-gray-600">patterns connected</div>
            </div>
            <div className="card">
              <div className="text-xs text-gray-500 mb-1">Issues</div>
              <div className={`text-lg font-bold ${totalProblems === 0 ? 'text-green-400' : totalProblems < 5 ? 'text-yellow-400' : 'text-red-400'}`}>
                {totalProblems}
              </div>
              <div className="text-xs text-gray-600">orphans, deprecated refs, duplicates</div>
            </div>
          </div>

          {/* Status Distribution */}
          {distributions.status && Object.keys(distributions.status).length > 0 && (
            <div className="card">
              <h3 className="text-sm font-semibold text-gray-400 mb-3">Status Distribution</h3>
              <div className="space-y-2">
                {Object.entries(distributions.status).map(([status, count]) => {
                  const pct = counts.total > 0 ? (count / counts.total) * 100 : 0
                  const color = status === 'Active' ? 'bg-green-500' : status === 'Draft' ? 'bg-yellow-500' : status === 'Deprecated' ? 'bg-red-500' : 'bg-gray-500'
                  return (
                    <div key={status} className="flex items-center gap-3">
                      <span className="text-xs text-gray-400 w-24">{status}</span>
                      <div className="flex-1 bg-gray-800 rounded-full h-2">
                        <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-gray-500 w-16 text-right">{count} ({Math.round(pct)}%)</span>
                    </div>
                  )
                })}
              </div>
              {counts.total > 0 && counts.active === 0 && (
                <p className="text-xs text-yellow-400/70 mt-2">All patterns are in Draft. Promote patterns to Active when they are reviewed and ready.</p>
              )}
            </div>
          )}

          {/* Category Distribution */}
          {distributions.category && Object.keys(distributions.category).length > 0 && (
            <div className="card">
              <h3 className="text-sm font-semibold text-gray-400 mb-3">Category Distribution</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {Object.entries(distributions.category)
                  .sort(([, a], [, b]) => b - a)
                  .map(([cat, count]) => (
                    <div key={cat} className="flex items-center justify-between bg-gray-800/40 rounded px-3 py-2">
                      <span className="text-xs text-gray-300 truncate">{cat || 'Uncategorized'}</span>
                      <span className="text-xs font-mono text-gray-500 ml-2">{count}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ======== Completeness Section ======== */}
      {section === 'completeness' && (
        <div className="space-y-4">
          {healthData.completeness ? (
            <>
              {/* Overall completeness */}
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-400">Field Completeness</h3>
                  <span className={`text-lg font-bold ${getScoreColor(healthData.completeness.avg_score || 0)}`}>
                    {Math.round(healthData.completeness.avg_score || 0)}%
                  </span>
                </div>
                <p className="text-xs text-gray-500 mb-1">
                  Each pattern type has different required fields. AB patterns track architectural properties (intent, problem, solution, structural elements, invariants, contracts).
                  ABB/SBB patterns track functional properties (functionality, interfaces, capabilities, mappings).
                </p>
              </div>

              {/* Per-type completeness — order: AB first (enterprise level), then ABB, then SBB */}
              {['AB', 'ABB', 'SBB'].map(type => {
                const data = healthData.completeness.by_type?.[type]
                if (!data) return null
                const typeLabel = type === 'AB' ? 'Architecture Blueprints' : type === 'ABB' ? 'Architecture Building Blocks' : 'Solution Building Blocks'
                return (
                  <div key={type} className="card">
                    <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${
                        type === 'AB' ? 'bg-purple-400' : type === 'ABB' ? 'bg-blue-400' : 'bg-green-400'
                      }`} />
                      {typeLabel}
                      <span className="text-xs text-gray-500 font-normal">({data.count || 0} patterns)</span>
                    </h3>
                    {data.fields && (
                      <div className="space-y-2">
                        {Object.entries(data.fields)
                          .sort(([, a], [, b]) => a - b)
                          .map(([field, pct]) => (
                            <div key={field} className="flex items-center gap-3">
                              <span className="text-xs text-gray-400 w-44 truncate">{field}</span>
                              <div className="flex-1 bg-gray-800 rounded-full h-2">
                                <div className={`h-2 rounded-full ${getScoreBg(pct)}`} style={{ width: `${Math.max(pct, 1)}%` }} />
                              </div>
                              <span className={`text-xs w-10 text-right font-mono ${getScoreColor(pct)}`}>{Math.round(pct)}%</span>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Incomplete Patterns */}
              {(() => {
                const items = healthData.completeness.incomplete_patterns || []
                if (items.length === 0) return null
                const totalPages = Math.ceil(items.length / INCOMPLETE_PAGE_SIZE)
                const page = Math.min(incompletePage, totalPages - 1)
                const pageItems = items.slice(page * INCOMPLETE_PAGE_SIZE, (page + 1) * INCOMPLETE_PAGE_SIZE)
                return (
                  <div className="card">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-gray-400">
                        Incomplete Patterns
                        <span className="ml-2 text-xs font-normal text-gray-500">({items.length} patterns under 100%)</span>
                      </h3>
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-gray-700">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-800/80">
                          <tr>
                            <th className="text-left py-2 px-3 text-gray-300 text-xs uppercase tracking-wider">Pattern</th>
                            <th className="text-left py-2 px-3 text-gray-300 text-xs uppercase tracking-wider">Type</th>
                            <th className="text-left py-2 px-3 text-gray-300 text-xs uppercase tracking-wider">Completeness</th>
                            <th className="text-left py-2 px-3 text-gray-300 text-xs uppercase tracking-wider">Missing Fields</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                          {pageItems.map((p, i) => (
                            <tr key={i} className="hover:bg-gray-800/40 transition-colors">
                              <td className="py-2 px-3">
                                <a href={`/patterns/${p.id}`} className="text-blue-400 font-mono text-xs hover:underline">{p.id}</a>
                                <span className="text-gray-400 ml-2 text-xs">{p.name}</span>
                              </td>
                              <td className="py-2 px-3">
                                <span className={`text-xs px-1.5 py-0.5 rounded ${TYPE_BADGE[p.type] || ''}`}>{p.type}</span>
                              </td>
                              <td className="py-2 px-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-16 bg-gray-800 rounded-full h-1.5">
                                    <div className={`h-1.5 rounded-full ${getScoreBg(p.score || 0)}`} style={{ width: `${Math.max(p.score || 0, 2)}%` }} />
                                  </div>
                                  <span className={`text-xs font-mono ${getScoreColor(p.score || 0)}`}>{Math.round(p.score || 0)}%</span>
                                </div>
                              </td>
                              <td className="py-2 px-3 text-xs text-gray-500">{(p.missing_fields || []).join(', ')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-800">
                        <span className="text-xs text-gray-500">
                          Showing {page * INCOMPLETE_PAGE_SIZE + 1}-{Math.min((page + 1) * INCOMPLETE_PAGE_SIZE, items.length)} of {items.length}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setIncompletePage(Math.max(0, page - 1))}
                            disabled={page === 0}
                            className={`px-2.5 py-1 rounded text-xs ${page === 0 ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
                          >
                            Prev
                          </button>
                          {Array.from({ length: totalPages }, (_, i) => (
                            <button
                              key={i}
                              onClick={() => setIncompletePage(i)}
                              className={`w-7 h-7 rounded text-xs ${i === page ? 'bg-blue-600/20 text-blue-400 border border-blue-500/50' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
                            >
                              {i + 1}
                            </button>
                          ))}
                          <button
                            onClick={() => setIncompletePage(Math.min(totalPages - 1, page + 1))}
                            disabled={page === totalPages - 1}
                            className={`px-2.5 py-1 rounded text-xs ${page === totalPages - 1 ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}
            </>
          ) : (
            <div className="text-gray-500 text-center py-8">No completeness data available.</div>
          )}
        </div>
      )}

      {/* ======== Coverage Section ======== */}
      {section === 'coverage' && (
        <div className="space-y-4">
          {/* ABB → SBB Implementation Coverage */}
          {healthData.abb_coverage && (
            <>
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">ABB Implementation Coverage</h3>
                    <p className="text-xs text-gray-500 mt-0.5">Which Architecture Building Blocks have Solution Building Blocks implementing them?</p>
                  </div>
                  <div className="text-right">
                    <div className={`text-lg font-bold ${getScoreColor(healthData.abb_coverage.coverage_pct)}`}>
                      {Math.round(healthData.abb_coverage.coverage_pct)}%
                    </div>
                    <div className="text-xs text-gray-500">{healthData.abb_coverage.with_sbbs}/{healthData.abb_coverage.total_abbs} ABBs</div>
                  </div>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-3 mb-3">
                  <div
                    className={`h-3 rounded-full transition-all ${getScoreBg(healthData.abb_coverage.coverage_pct)}`}
                    style={{ width: `${healthData.abb_coverage.coverage_pct}%` }}
                  />
                </div>
              </div>

              {/* ABB detail list */}
              {healthData.abb_coverage.details && healthData.abb_coverage.details.length > 0 && (
                <div className="card">
                  <h3 className="text-sm font-semibold text-gray-400 mb-3">ABB Implementation Details</h3>
                  <div className="space-y-2">
                    {healthData.abb_coverage.details.map((abb, i) => (
                      <div key={i} className="flex items-center gap-3 py-1.5 px-2 rounded bg-gray-800/30">
                        <a href={`/patterns/${abb.id}`} className="text-blue-400 font-mono text-xs hover:underline w-28 shrink-0">{abb.id}</a>
                        <span className="text-gray-300 text-xs flex-1 truncate">{abb.name}</span>
                        <span className="text-xs text-gray-500 shrink-0">{abb.category}</span>
                        {abb.sbb_count > 0 ? (
                          <span className="text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded shrink-0">
                            {abb.sbb_count} SBB{abb.sbb_count !== 1 ? 's' : ''}
                          </span>
                        ) : (
                          <span className="text-xs text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded shrink-0">
                            No SBBs
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* PBC Coverage */}
          {healthData.pbc_stats && healthData.pbc_stats.total > 0 && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-white">PBC Composition</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Packaged Business Capabilities and their ABB compositions</p>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-cyan-400">{healthData.pbc_stats.total}</div>
                  <div className="text-xs text-gray-500">avg {healthData.pbc_stats.avg_abbs_per_pbc} ABBs/PBC</div>
                </div>
              </div>
              {healthData.pbc_stats.empty_pbcs?.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs text-orange-400 mb-1">Empty PBCs (no ABB compositions):</p>
                  <div className="flex flex-wrap gap-1.5">
                    {healthData.pbc_stats.empty_pbcs.map((pbc, i) => (
                      <span key={i} className="text-xs bg-orange-500/10 text-orange-400 px-2 py-0.5 rounded">
                        {pbc.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {healthData.pbc_stats.details && (
                <div className="space-y-1">
                  {healthData.pbc_stats.details.filter(p => p.abb_count > 0).map((pbc, i) => (
                    <div key={i} className="flex items-center gap-3 text-xs py-1">
                      <span className="text-gray-300 flex-1 truncate">{pbc.name}</span>
                      <div className="w-24 bg-gray-800 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full bg-cyan-500" style={{ width: `${Math.min((pbc.abb_count / Math.max(...healthData.pbc_stats.details.map(d => d.abb_count), 1)) * 100, 100)}%` }} />
                      </div>
                      <span className="font-mono text-cyan-400 w-8 text-right">{pbc.abb_count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Technology Stats */}
          {healthData.technology_stats && healthData.technology_stats.total > 0 && (
            <div className="card">
              <h3 className="text-sm font-semibold text-white mb-3">Technology Coverage</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="text-center">
                  <div className="text-xl font-bold text-blue-400">{healthData.technology_stats.total}</div>
                  <div className="text-xs text-gray-500">Total Technologies</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-green-400">{healthData.technology_stats.with_patterns}</div>
                  <div className="text-xs text-gray-500">Used by Patterns</div>
                </div>
                <div className="text-center">
                  <div className={`text-xl font-bold ${healthData.technology_stats.without_patterns > 0 ? 'text-orange-400' : 'text-green-400'}`}>
                    {healthData.technology_stats.without_patterns}
                  </div>
                  <div className="text-xs text-gray-500">Unused Technologies</div>
                </div>
                <div className="text-center">
                  <div className={`text-xl font-bold ${healthData.technology_stats.deprecated > 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {healthData.technology_stats.deprecated}
                  </div>
                  <div className="text-xs text-gray-500">Deprecated</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ======== Relationships Section ======== */}
      {section === 'relationships' && (
        <div className="space-y-4">
          {healthData.relationships ? (
            <>
              {/* Summary stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="card text-center">
                  <div className="text-2xl font-bold text-blue-400">{healthData.relationships.total_relationships || 0}</div>
                  <div className="text-xs text-gray-400 mt-1">Total Relationships</div>
                </div>
                <div className="card text-center">
                  <div className="text-2xl font-bold text-cyan-400">{(healthData.relationships.avg_per_pattern || 0).toFixed(1)}</div>
                  <div className="text-xs text-gray-400 mt-1">Avg per Pattern</div>
                </div>
                <div className="card text-center">
                  <div className={`text-2xl font-bold ${healthData.relationships.unconnected > 0 ? 'text-orange-400' : 'text-green-400'}`}>
                    {healthData.relationships.unconnected || 0}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">Unconnected</div>
                </div>
                <div className="card text-center">
                  <div className="text-2xl font-bold text-purple-400">{healthData.relationships.max_relationships || 0}</div>
                  <div className="text-xs text-gray-400 mt-1">Max Relationships</div>
                </div>
              </div>

              {/* By type */}
              {healthData.relationships.by_type && Object.keys(healthData.relationships.by_type).length > 0 && (
                <div className="card">
                  <h3 className="text-sm font-semibold text-gray-400 mb-3">Relationship Types</h3>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(healthData.relationships.by_type).map(([type, count]) => (
                      <div key={type} className="flex items-center gap-1.5 bg-gray-800/60 rounded px-2.5 py-1.5 text-xs">
                        <span className="text-gray-400">{type}</span>
                        <span className="font-mono font-semibold text-white">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Most connected patterns */}
              {healthData.relationships.most_connected && healthData.relationships.most_connected.length > 0 && (
                <div className="card">
                  <h3 className="text-sm font-semibold text-gray-400 mb-3">Most Connected Patterns</h3>
                  <div className="space-y-1">
                    {healthData.relationships.most_connected.map((p, i) => (
                      <div key={i} className="flex items-center gap-3 text-sm py-1">
                        <span className="text-xs text-gray-600 w-4">{i + 1}</span>
                        <a href={`/patterns/${p.id}`} className="text-blue-400 font-mono text-xs hover:underline w-32">{p.id}</a>
                        <span className="text-gray-400 flex-1 text-xs truncate">{p.name}</span>
                        <span className="font-mono text-white text-xs">{p.count} rels</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-gray-500 text-center py-8">No relationship data available.</div>
          )}
        </div>
      )}

      {/* ======== Problems Section ======== */}
      {section === 'problems' && (
        <div className="space-y-4">
          {/* Orphans */}
          {healthData.problems?.orphans && healthData.problems.orphans.length > 0 ? (
            <div className="card">
              <h3 className="text-sm font-semibold text-orange-400 mb-3 flex items-center gap-2">
                Orphaned Patterns
                <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded">
                  {healthData.problems.orphans.length}
                </span>
              </h3>
              <p className="text-xs text-gray-500 mb-3">Patterns with zero relationships to other patterns.</p>
              <div className="overflow-x-auto rounded-lg border border-gray-700">
                <table className="w-full text-sm">
                  <thead className="bg-gray-800/80">
                    <tr>
                      <th className="text-left py-2 px-3 text-gray-300 text-xs uppercase tracking-wider">Pattern</th>
                      <th className="text-left py-2 px-3 text-gray-300 text-xs uppercase tracking-wider">Type</th>
                      <th className="text-left py-2 px-3 text-gray-300 text-xs uppercase tracking-wider">Status</th>
                      <th className="text-left py-2 px-3 text-gray-300 text-xs uppercase tracking-wider">Category</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {healthData.problems.orphans.map((p, i) => (
                      <tr key={i} className="hover:bg-gray-800/40 transition-colors">
                        <td className="py-2 px-3">
                          <a href={`/patterns/${p.id}`} className="text-blue-400 font-mono text-xs hover:underline">{p.id}</a>
                          <span className="text-gray-400 ml-2 text-xs">{p.name}</span>
                        </td>
                        <td className="py-2 px-3">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${TYPE_BADGE[p.type] || ''}`}>{p.type}</span>
                        </td>
                        <td className="py-2 px-3 text-xs text-gray-400">{p.status}</td>
                        <td className="py-2 px-3 text-xs text-gray-400">{p.category}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="card bg-green-500/5 border border-green-500/20 text-green-400 text-sm py-4 text-center">
              No orphaned patterns — all patterns have at least one relationship.
            </div>
          )}

          {/* Deprecated still referenced */}
          {healthData.problems?.deprecated_referenced && healthData.problems.deprecated_referenced.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-2">
                Deprecated Patterns Still Referenced
                <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded">
                  {healthData.problems.deprecated_referenced.length}
                </span>
              </h3>
              <div className="space-y-1">
                {healthData.problems.deprecated_referenced.map((p, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm py-1">
                    <a href={`/patterns/${p.id}`} className="text-blue-400 font-mono text-xs hover:underline">{p.id}</a>
                    <span className="text-gray-400 text-xs">{p.name}</span>
                    <span className="text-xs text-red-400">referenced by {p.referenced_by} pattern(s)</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Duplicate names */}
          {healthData.problems?.duplicate_names && healthData.problems.duplicate_names.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-semibold text-yellow-400 mb-3 flex items-center gap-2">
                Duplicate Pattern Names
                <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded">
                  {healthData.problems.duplicate_names.length}
                </span>
              </h3>
              <div className="space-y-1">
                {healthData.problems.duplicate_names.map((d, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm py-1">
                    <span className="text-gray-300 text-xs">&quot;{d.name}&quot;</span>
                    <span className="text-xs text-gray-500">x {d.count} patterns</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No problems at all */}
          {totalProblems === 0 && (
            <div className="card bg-green-500/5 border border-green-500/20 text-green-400 text-sm py-8 text-center">
              No problems detected in your pattern library.
            </div>
          )}
        </div>
      )}

      {/* ======== AI Deep Analysis Section ======== */}
      {section === 'ai' && (
        <div className="space-y-4">
          {/* Controls */}
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">AI-Powered Deep Analysis</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Uses LLM to perform 9-area deep analysis: architecture coherence, ABB↔SBB alignment, interfaces, capabilities, vendor risk, content quality, overlap, PBC composition, and maturity roadmap.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">LLM Provider</label>
                <div className="flex gap-2 flex-wrap">
                  {providers.map(p => (
                    <button
                      key={p.name}
                      onClick={() => { setProvider(p.name); setModel(p.default_model) }}
                      className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                        provider === p.name
                          ? 'bg-blue-600/20 border-blue-500/50 text-blue-400'
                          : p.available
                            ? 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'
                            : 'bg-gray-800/50 border-gray-800 text-gray-600 cursor-not-allowed'
                      }`}
                      disabled={!p.available}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Model</label>
                <input
                  type="text"
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  placeholder="Model name"
                  className="input text-sm w-48"
                />
              </div>
            </div>

            <button
              onClick={handleAiAnalysis}
              disabled={analyzingHealth}
              className="btn-primary w-full py-2.5"
            >
              {analyzingHealth ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z"/></svg>
                  Analyzing patterns... (this may take 30-60s)
                </span>
              ) : (
                'Run AI Deep Analysis'
              )}
            </button>
          </div>

          {/* Saved confirmation banner */}
          {savedAnalysisId && aiAnalysis && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-green-400 text-sm">Analysis saved as</span>
                <span className="text-green-300 font-mono text-sm font-medium">{savedAnalysisId}</span>
                {savedAnalysisTime && (
                  <span className="text-gray-500 text-xs ml-1">
                    saved at {new Date(savedAnalysisTime).toLocaleDateString('en-CA')} {new Date(savedAnalysisTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                {staleWarning && (
                  <span className="text-yellow-400 text-xs ml-2">Pattern count changed since analysis</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => authenticatedDownload(healthAnalysisExportHtmlUrl(savedAnalysisId), `health-analysis-${savedAnalysisId}.html`)}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  HTML
                </button>
                <button
                  onClick={() => authenticatedDownload(healthAnalysisExportDocxUrl(savedAnalysisId), `health-analysis-${savedAnalysisId}.docx`)}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  DOCX
                </button>
              </div>
            </div>
          )}

          {/* AI Analysis Results */}
          {aiAnalysis && (
            <div className="space-y-4">
              {/* Executive Summary */}
              {aiAnalysis.executive_summary && (
                <div className="card border-l-4 border-l-blue-500">
                  <h3 className="text-sm font-semibold text-blue-400 mb-2">Executive Summary</h3>
                  <p className="text-gray-300 text-sm whitespace-pre-line">{aiAnalysis.executive_summary}</p>
                </div>
              )}

              {/* Maturity Overview Bar */}
              {aiAnalysis.maturity_roadmap && (
                <div className="card">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-white">Overall Maturity</h3>
                    <span className={`text-xs px-3 py-1 rounded font-bold ${
                      { OPTIMIZING: 'bg-green-500/20 text-green-400', MANAGED: 'bg-green-500/15 text-green-300',
                        DEFINED: 'bg-yellow-500/15 text-yellow-400', DEVELOPING: 'bg-orange-500/15 text-orange-400',
                        INITIAL: 'bg-red-500/15 text-red-400' }[aiAnalysis.maturity_roadmap.overall_maturity] || 'bg-gray-700 text-gray-300'
                    }`}>
                      {aiAnalysis.maturity_roadmap.overall_maturity || 'N/A'}
                    </span>
                  </div>
                  {aiAnalysis.maturity_roadmap.area_maturity && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {Object.entries(aiAnalysis.maturity_roadmap.area_maturity).map(([area, level]) => {
                        const matColor = { OPTIMIZING: 'text-green-400', MANAGED: 'text-green-300', DEFINED: 'text-yellow-400', DEVELOPING: 'text-orange-400', INITIAL: 'text-red-400' }[level] || 'text-gray-400'
                        return (
                          <div key={area} className="bg-gray-800/50 rounded px-2.5 py-1.5 flex items-center justify-between">
                            <span className="text-xs text-gray-400 capitalize">{area.replace(/_/g, ' ')}</span>
                            <span className={`text-xs font-medium ${matColor}`}>{level}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* 9 Analysis Area Cards */}
              {(() => {
                const ANALYSIS_AREAS = [
                  { key: 'architecture_coherence', label: 'Architecture Coherence', icon: '🏗️',
                    ratingField: 'rating', ratingMap: { STRONG: 'g', ADEQUATE: 'y', WEAK: 'r' },
                    sections: [
                      { field: 'findings', label: 'Findings', color: 'text-gray-300' },
                      { field: 'unmapped_ab_elements', label: 'Unmapped AB Elements', color: 'text-orange-400' },
                      { field: 'recommendations', label: 'Recommendations', color: 'text-cyan-400' },
                    ] },
                  { key: 'abb_sbb_alignment', label: 'ABB ↔ SBB Alignment', icon: '🔗',
                    ratingField: 'rating', ratingMap: { STRONG: 'g', ADEQUATE: 'y', WEAK: 'r' },
                    sections: [
                      { field: 'unimplemented_abbs', label: 'Unimplemented ABBs', color: 'text-red-400', type: 'table',
                        columns: ['abb_id', 'abb_name', 'missing_coverage'] },
                      { field: 'misaligned_sbbs', label: 'Misaligned SBBs', color: 'text-orange-400', type: 'table',
                        columns: ['sbb_id', 'sbb_name', 'issue'] },
                      { field: 'recommendations', label: 'Recommendations', color: 'text-cyan-400' },
                    ] },
                  { key: 'interface_consistency', label: 'Interface Consistency', icon: '🔌',
                    ratingField: 'rating', ratingMap: { STRONG: 'g', ADEQUATE: 'y', WEAK: 'r' },
                    sections: [
                      { field: 'mismatches', label: 'Interface Mismatches', color: 'text-orange-400', type: 'table',
                        columns: ['pattern_a', 'pattern_b', 'issue'] },
                      { field: 'undocumented', label: 'Undocumented Interfaces', color: 'text-red-400' },
                      { field: 'recommendations', label: 'Recommendations', color: 'text-cyan-400' },
                    ] },
                  { key: 'business_capability_gaps', label: 'Business Capability Gaps', icon: '📊',
                    ratingField: 'rating', ratingMap: { STRONG: 'g', ADEQUATE: 'y', WEAK: 'r' },
                    sections: [
                      { field: 'uncovered_capabilities', label: 'Uncovered Capabilities', color: 'text-orange-400' },
                      { field: 'overclaimed_capabilities', label: 'Over-Claimed Capabilities', color: 'text-red-400', type: 'table',
                        columns: ['pattern_id', 'capability', 'issue'] },
                      { field: 'recommendations', label: 'Recommendations', color: 'text-cyan-400' },
                    ] },
                  { key: 'vendor_technology_risk', label: 'Vendor & Technology Risk', icon: '⚠️',
                    ratingField: 'rating', ratingMap: { LOW_RISK: 'g', MODERATE_RISK: 'y', HIGH_RISK: 'r' },
                    sections: [
                      { field: 'concentration_risks', label: 'Concentration Risks', color: 'text-orange-400', type: 'table',
                        columns: ['technology', 'dependent_patterns', 'risk'] },
                      { field: 'single_vendor_locks', label: 'Single-Vendor Locks', color: 'text-red-400', type: 'table',
                        columns: ['vendor', 'patterns', 'mitigation'] },
                      { field: 'recommendations', label: 'Recommendations', color: 'text-cyan-400' },
                    ] },
                  { key: 'content_quality', label: 'Content Quality', icon: '📝',
                    ratingField: 'rating', ratingMap: { STRONG: 'g', ADEQUATE: 'y', WEAK: 'r' },
                    sections: [
                      { field: 'exemplary_patterns', label: 'Exemplary Patterns', color: 'text-green-400' },
                      { field: 'weak_patterns', label: 'Weak Patterns', color: 'text-red-400', type: 'table',
                        columns: ['pattern_id', 'issue'] },
                      { field: 'recommendations', label: 'Recommendations', color: 'text-cyan-400' },
                    ] },
                  { key: 'cross_pattern_overlap', label: 'Cross-Pattern Overlap', icon: '🔄',
                    ratingField: 'rating', ratingMap: { CLEAN: 'g', SOME_OVERLAP: 'y', SIGNIFICANT_OVERLAP: 'r' },
                    sections: [
                      { field: 'overlapping_groups', label: 'Overlapping Groups', color: 'text-orange-400', type: 'table',
                        columns: ['patterns', 'overlap_description'] },
                      { field: 'consolidation_suggestions', label: 'Consolidation Suggestions', color: 'text-cyan-400' },
                    ] },
                  { key: 'pbc_composition', label: 'PBC Composition', icon: '📦',
                    ratingField: 'rating', ratingMap: { STRONG: 'g', ADEQUATE: 'y', WEAK: 'r' },
                    sections: [
                      { field: 'issues', label: 'Issues', color: 'text-orange-400', type: 'table',
                        columns: ['pbc', 'issue'] },
                      { field: 'orphaned_patterns', label: 'Orphaned Patterns', color: 'text-red-400' },
                      { field: 'recommendations', label: 'Recommendations', color: 'text-cyan-400' },
                    ] },
                ]
                const ratingColors = { g: 'text-green-400 bg-green-500/10', y: 'text-yellow-400 bg-yellow-500/10', r: 'text-red-400 bg-red-500/10' }

                const renderListOrTable = (sec, data) => {
                  if (!data || (Array.isArray(data) && data.length === 0)) return null
                  if (sec.type === 'table' && Array.isArray(data) && typeof data[0] === 'object') {
                    return (
                      <div className="overflow-x-auto rounded border border-gray-700">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-800/60">
                            <tr>{sec.columns.map(col => (
                              <th key={col} className="text-left py-1.5 px-2 text-gray-400 uppercase tracking-wider font-medium">
                                {col.replace(/_/g, ' ')}
                              </th>
                            ))}</tr>
                          </thead>
                          <tbody className="divide-y divide-gray-800">
                            {data.map((row, ri) => (
                              <tr key={ri} className="hover:bg-gray-800/30">
                                {sec.columns.map(col => (
                                  <td key={col} className="py-1.5 px-2 text-gray-300">
                                    {Array.isArray(row[col]) ? row[col].join(', ') : String(row[col] || '')}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                  }
                  // Simple list
                  const items = Array.isArray(data) ? data : [data]
                  return (
                    <ul className="list-disc list-inside space-y-0.5">
                      {items.map((item, i) => (
                        <li key={i} className="text-xs text-gray-400">{typeof item === 'object' ? JSON.stringify(item) : item}</li>
                      ))}
                    </ul>
                  )
                }

                return (
                  <div className="grid grid-cols-1 gap-3">
                    {ANALYSIS_AREAS.map(area => {
                      const areaData = aiAnalysis[area.key]
                      if (!areaData) return null
                      const ratingValue = areaData[area.ratingField]
                      const rColor = ratingColors[area.ratingMap[ratingValue]] || 'text-gray-400 bg-gray-700/50'
                      return (
                        <div key={area.key} className="card">
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                              <span>{area.icon}</span> {area.label}
                            </h3>
                            <span className={`text-xs px-2 py-0.5 rounded font-medium ${rColor}`}>
                              {ratingValue || 'N/A'}
                            </span>
                          </div>
                          <div className="space-y-3">
                            {area.sections.map(sec => {
                              const secData = areaData[sec.field]
                              if (!secData || (Array.isArray(secData) && secData.length === 0)) return null
                              return (
                                <div key={sec.field}>
                                  <p className={`text-xs font-medium mb-1 ${sec.color}`}>{sec.label}:</p>
                                  {renderListOrTable(sec, secData)}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}

              {/* Prioritized Action Plan */}
              {aiAnalysis.maturity_roadmap?.prioritized_actions?.length > 0 && (
                <div className="card">
                  <h3 className="text-sm font-semibold text-gray-400 mb-3">Prioritized Action Plan</h3>
                  <div className="space-y-2">
                    {aiAnalysis.maturity_roadmap.prioritized_actions.map((act, i) => {
                      const impactColor = act.impact === 'HIGH' ? 'text-red-400 bg-red-500/10' : act.impact === 'MEDIUM' ? 'text-yellow-400 bg-yellow-500/10' : 'text-green-400 bg-green-500/10'
                      const effortColor = act.effort === 'LOW' ? 'text-green-400 bg-green-500/10' : act.effort === 'MEDIUM' ? 'text-yellow-400 bg-yellow-500/10' : 'text-red-400 bg-red-500/10'
                      return (
                        <div key={i} className="flex items-start gap-3 p-3 bg-gray-800/40 rounded-lg">
                          <span className="text-xs bg-blue-600/20 text-blue-400 px-2 py-0.5 rounded font-bold shrink-0">
                            #{act.priority || i + 1}
                          </span>
                          <div className="flex-1">
                            <p className="text-sm text-white font-medium">{act.action}</p>
                            {act.affected_patterns && act.affected_patterns.length > 0 && (
                              <p className="text-xs text-gray-500 mt-0.5">Affects: {act.affected_patterns.join(', ')}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className={`text-xs px-1.5 py-0.5 rounded ${impactColor}`}>
                              Impact: {act.impact}
                            </span>
                            <span className={`text-xs px-1.5 py-0.5 rounded ${effortColor}`}>
                              Effort: {act.effort}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Legacy / backward compat: old format support */}
              {aiAnalysis.overview && !aiAnalysis.executive_summary && (
                <div className="card">
                  <h3 className="text-sm font-semibold text-gray-400 mb-2">Overview</h3>
                  <p className="text-gray-300 text-sm whitespace-pre-line">{aiAnalysis.overview}</p>
                </div>
              )}

              {aiAnalysis.top_recommendations?.length > 0 && !aiAnalysis.maturity_roadmap && (
                <div className="card">
                  <h3 className="text-sm font-semibold text-gray-400 mb-3">Top Recommendations</h3>
                  <div className="space-y-2">
                    {aiAnalysis.top_recommendations.map((rec, i) => {
                      const effortColor = rec.effort === 'LOW' ? 'text-green-400 bg-green-500/10' : rec.effort === 'MEDIUM' ? 'text-yellow-400 bg-yellow-500/10' : 'text-red-400 bg-red-500/10'
                      return (
                        <div key={i} className="flex items-start gap-3 p-3 bg-gray-800/40 rounded-lg">
                          <span className="text-xs bg-blue-600/20 text-blue-400 px-2 py-0.5 rounded font-bold shrink-0">
                            #{rec.priority || i + 1}
                          </span>
                          <div className="flex-1">
                            <p className="text-sm text-white font-medium">{rec.title}</p>
                            <p className="text-xs text-gray-400 mt-0.5">{rec.description}</p>
                          </div>
                          {rec.effort && (
                            <span className={`text-xs px-2 py-0.5 rounded shrink-0 ${effortColor}`}>
                              {rec.effort}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {aiAnalysis.raw_text && !aiAnalysis.executive_summary && (
                <div className="card">
                  <h3 className="text-sm font-semibold text-gray-400 mb-2">Analysis (raw)</h3>
                  <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono bg-gray-900/50 rounded p-3 max-h-96 overflow-y-auto">
                    {aiAnalysis.raw_text}
                  </pre>
                </div>
              )}
            </div>
          )}

          {!aiAnalysis && !analyzingHealth && (
            <div className="text-gray-500 text-center py-8">
              Run an AI analysis to get a 9-area deep assessment: architecture coherence, ABB↔SBB alignment, interface consistency, business capability gaps, vendor risk, content quality, cross-pattern overlap, PBC composition, and maturity roadmap.
            </div>
          )}

          {/* Analysis History */}
          {analyses.length > 0 && (
            <div className="space-y-3">
              <button
                onClick={() => setAnalysesExpanded(!analysesExpanded)}
                className="flex items-center gap-2 text-sm font-semibold text-gray-400 hover:text-white transition-colors"
              >
                <span className={`text-xs transition-transform ${analysesExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
                Previous Analyses
                <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full">
                  {analyses.length}
                </span>
              </button>

              {analysesExpanded && (
                <div className="space-y-2">
                  {analyses.map(a => (
                    <div
                      key={a.id}
                      className={`card hover:bg-gray-800/60 transition-colors ${
                        savedAnalysisId === a.id ? 'ring-1 ring-green-500/30' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-white text-sm font-medium">{a.title || 'Health Analysis'}</span>
                            <span className="text-xs font-mono text-blue-400/60">{a.id}</span>
                            {a.health_score != null && (
                              <span className={`text-xs px-1.5 py-0.5 rounded ${getScoreColor(a.health_score)} bg-gray-800`}>
                                Score: {Math.round(a.health_score)}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                            <span>{a.created_at ? new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                            {a.provider && <span>{a.provider} / {a.model}</span>}
                            {a.pattern_count && <span>{a.pattern_count} patterns</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button
                            onClick={() => handleLoadAnalysis(a)}
                            className="text-xs px-2.5 py-1 rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 transition-colors"
                          >
                            Load
                          </button>
                          <button
                            onClick={() => authenticatedDownload(healthAnalysisExportHtmlUrl(a.id), `health-analysis-${a.id}.html`)}
                            className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-400 hover:text-gray-300 hover:bg-gray-700 transition-colors"
                          >
                            HTML
                          </button>
                          <button
                            onClick={() => authenticatedDownload(healthAnalysisExportDocxUrl(a.id), `health-analysis-${a.id}.docx`)}
                            className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-400 hover:text-gray-300 hover:bg-gray-700 transition-colors"
                          >
                            DOCX
                          </button>
                          <button
                            onClick={() => handleDeleteAnalysis(a.id)}
                            className="text-xs px-2 py-1 rounded text-red-500/50 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            x
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        open={!!confirmAction}
        title={confirmAction?.title || 'Confirm Action'}
        message={confirmAction?.message || 'Are you sure?'}
        confirmLabel={confirmAction?.confirmLabel || 'Confirm'}
        variant={confirmAction?.variant || 'danger'}
        onConfirm={() => confirmAction?.onConfirm?.()}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  )
}
