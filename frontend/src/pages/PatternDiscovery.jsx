import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  fetchInventory, discoverPatterns, fetchProviders,
  fetchLatestDiscoveryAnalysis, fetchDiscoveryAnalyses,
  fetchDiscoveryAnalysis, deleteDiscoveryAnalysis,
} from '../api/client'
import ConfirmModal from '../components/ConfirmModal'
import { useToast } from '../components/Toast'
import { SkeletonStatCard } from '../components/Skeleton'

const PRIORITY_COLORS = {
  HIGH: 'bg-red-500/20 text-red-400',
  MEDIUM: 'bg-yellow-500/20 text-yellow-400',
  LOW: 'bg-green-500/20 text-green-400',
}

const TYPE_COLORS = {
  ABB: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  SBB: 'bg-green-500/20 text-green-400 border-green-500/30',
  AB: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
}

const CAT_LABELS = {
  core: 'Core AI/LLM',
  intg: 'Integration',
  agt: 'Agents',
  kr: 'Knowledge & Retrieval',
  xcut: 'Cross-Cutting',
  pip: 'Platform Integration',
  blueprint: 'Architecture Blueprint',
}

export default function PatternDiscovery() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [inventory, setInventory] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [discovering, setDiscovering] = useState(false)
  const [error, setError] = useState('')
  const [focus, setFocus] = useState('')
  const [providers, setProviders] = useState([])
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [discoveryMeta, setDiscoveryMeta] = useState(null)

  // History state
  const [savedAnalysisId, setSavedAnalysisId] = useState(null)
  const [savedAnalysisTime, setSavedAnalysisTime] = useState(null)
  const [analyses, setAnalyses] = useState([])
  const [analysesExpanded, setAnalysesExpanded] = useState(false)
  const [confirmAction, setConfirmAction] = useState(null)

  // Load inventory, providers, and latest analysis on mount
  useEffect(() => {
    Promise.all([
      fetchInventory().catch(() => null),
      fetchProviders().catch(() => ({ providers: [] })),
      fetchLatestDiscoveryAnalysis().catch(() => null),
      fetchDiscoveryAnalyses(20).catch(() => ({ analyses: [] })),
    ]).then(([inv, prov, latestAnalysis, historyData]) => {
      setInventory(inv)
      const provList = prov?.providers || []
      setProviders(provList)
      const def = provList.find(p => p.is_default)
      if (def) {
        setProvider(def.name)
        setModel(def.default_model)
      }
      // Load latest discovery results
      if (latestAnalysis && latestAnalysis.suggestions_json) {
        const sug = Array.isArray(latestAnalysis.suggestions_json) ? latestAnalysis.suggestions_json : []
        setSuggestions(sug)
        setSavedAnalysisId(latestAnalysis.id)
        setSavedAnalysisTime(latestAnalysis.created_at || null)
        setDiscoveryMeta({
          provider: latestAnalysis.provider,
          model: latestAnalysis.model,
        })
        if (latestAnalysis.focus_area) setFocus(latestAnalysis.focus_area)
      }
      setAnalyses(historyData?.analyses || [])
      setLoading(false)
    })
  }, [])

  const handleDiscover = async () => {
    setDiscovering(true)
    setError('')
    setSuggestions([])
    setDiscoveryMeta(null)
    try {
      const result = await discoverPatterns(
        provider || null,
        model || null,
        focus || null,
      )
      const discoveredSuggestions = result.suggestions || []
      setSuggestions(discoveredSuggestions)
      setDiscoveryMeta({
        provider: result.provider,
        model: result.model,
        summary: result.inventory_summary,
      })
      setSavedAnalysisId(result.saved_analysis_id || null)
      setSavedAnalysisTime(new Date().toISOString())
      // Refresh history list
      fetchDiscoveryAnalyses(20).then(r => setAnalyses(r?.analyses || [])).catch(() => {})
      toast.success(`Discovery complete — ${discoveredSuggestions.length} suggestions found`)
    } catch (err) {
      setError(err.message)
    }
    setDiscovering(false)
  }

  const handleLoadAnalysis = async (analysis) => {
    try {
      const full = await fetchDiscoveryAnalysis(analysis.id)
      if (full?.suggestions_json) {
        const sug = Array.isArray(full.suggestions_json) ? full.suggestions_json : []
        setSuggestions(sug)
        setSavedAnalysisId(full.id)
        setSavedAnalysisTime(full.created_at || analysis.created_at || null)
        setDiscoveryMeta({
          provider: full.provider,
          model: full.model,
        })
        if (full.focus_area) setFocus(full.focus_area)
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    } catch (err) {
      setError(`Failed to load analysis: ${err.message}`)
    }
  }

  const handleDeleteAnalysis = (id) => {
    setConfirmAction({
      title: 'Delete Discovery',
      message: `Are you sure you want to delete discovery "${id}"?`,
      confirmLabel: 'Delete',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmAction(null)
        try {
          await deleteDiscoveryAnalysis(id)
          setAnalyses(prev => prev.filter(a => a.id !== id))
          if (savedAnalysisId === id) {
            setSavedAnalysisId(null)
            setSavedAnalysisTime(null)
            setSuggestions([])
            setDiscoveryMeta(null)
          }
          toast.success('Discovery deleted')
        } catch (err) {
          setError(`Failed to delete: ${err.message}`)
        }
      },
    })
  }

  const handleCreatePattern = (suggestion) => {
    // Navigate to the pattern editor with pre-filled data
    const params = new URLSearchParams({
      prefill_type: suggestion.type,
      prefill_name: suggestion.name,
      prefill_category: suggestion.category,
      prefill_description: suggestion.description,
      prefill_technologies: (suggestion.technologies || []).join(','),
      prefill_implements: suggestion.implements_abb || '',
    })
    navigate(`/patterns/new?${params.toString()}`)
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="page-title">Pattern Discovery</h1>
          <p className="page-subtitle">AI-powered analysis of your technology inventory to suggest new architecture patterns</p>
        </div>
        <div className="grid grid-cols-4 gap-4">
          <SkeletonStatCard />
          <SkeletonStatCard />
          <SkeletonStatCard />
          <SkeletonStatCard />
        </div>
      </div>
    )
  }

  const summary = inventory?.summary || {}

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm">
        <Link to="/" className="text-gray-500 hover:text-gray-300 transition-colors">&larr; Dashboard</Link>
        <span className="text-gray-700">/</span>
        <span className="text-gray-400">Pattern Discovery</span>
      </div>
      {/* Header */}
      <div>
        <h1 className="page-title">Pattern Discovery</h1>
        <p className="page-subtitle">
          AI-powered analysis of your technology inventory to suggest new architecture patterns
        </p>
      </div>

      {/* Inventory Overview Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="card border-l-4 border-blue-500">
          <p className="text-xs text-gray-500">Total Technologies</p>
          <p className="text-2xl font-bold text-white">{summary.total_technologies || 0}</p>
        </div>
        <div className="card border-l-4 border-green-500">
          <p className="text-xs text-gray-500">Total ABBs</p>
          <p className="text-2xl font-bold text-white">{summary.total_abbs || 0}</p>
        </div>
        <div className="card border-l-4 border-orange-500">
          <p className="text-xs text-gray-500">Uncovered Technologies</p>
          <p className="text-2xl font-bold text-orange-400">{summary.unused_tech_count || 0}</p>
          <p className="text-xs text-gray-600 mt-1">No SBB patterns</p>
        </div>
        <div className="card border-l-4 border-red-500">
          <p className="text-xs text-gray-500">ABBs Without SBBs</p>
          <p className="text-2xl font-bold text-red-400">{summary.uncovered_abb_count || 0}</p>
          <p className="text-xs text-gray-600 mt-1">Missing implementations</p>
        </div>
      </div>

      {/* Gap Analysis */}
      <div className="grid grid-cols-2 gap-4">
        {/* Uncovered Technologies */}
        {inventory?.unused_technologies?.length > 0 && (
          <div className="card">
            <h2 className="text-sm font-semibold text-orange-400 mb-3">
              Technologies Without SBB Coverage
            </h2>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {inventory.unused_technologies.map(t => (
                <div key={t.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="text-blue-400 font-mono text-xs">{t.id}</span>
                    <span className="text-gray-300 ml-2">{t.name}</span>
                  </div>
                  <span className="text-xs text-gray-500">{t.vendor}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Uncovered ABBs */}
        {inventory?.uncovered_abbs?.length > 0 && (
          <div className="card">
            <h2 className="text-sm font-semibold text-red-400 mb-3">
              ABBs Without SBB Implementations
            </h2>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {inventory.uncovered_abbs.map(a => (
                <div key={a.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="text-blue-400 font-mono text-xs">{a.id}</span>
                    <span className="text-gray-300 ml-2">{a.name}</span>
                  </div>
                  <span className="text-xs text-gray-500">{CAT_LABELS[a.category] || a.category}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Technology Combinations */}
      {inventory?.tech_combinations?.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-400 mb-3">
            Technology Combinations in Use
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {inventory.tech_combinations.slice(0, 8).map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-sm bg-gray-800/50 rounded-lg px-3 py-2">
                <span className="text-cyan-400 font-mono text-xs">{c.tech1}</span>
                <span className="text-gray-600">+</span>
                <span className="text-cyan-400 font-mono text-xs">{c.tech2}</span>
                <span className="text-gray-500 ml-auto text-xs">in {c.combo_count} SBB(s)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Discovery Controls */}
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-gray-400">AI Pattern Discovery</h2>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Focus Area (optional)</label>
            <input
              type="text"
              value={focus}
              onChange={e => setFocus(e.target.value)}
              placeholder="e.g. knowledge retrieval, vector stores, agents..."
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">LLM Provider</label>
            <div className="flex gap-2">
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
                  {p.is_default && <span className="text-gray-500 ml-1">(default)</span>}
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
              className="input w-full"
            />
          </div>
        </div>

        <button
          onClick={handleDiscover}
          disabled={discovering}
          className="btn-primary w-full py-3 text-base"
        >
          {discovering ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-spin text-lg">&#9696;</span>
              Analyzing inventory & discovering patterns...
            </span>
          ) : (
            'Discover New Patterns'
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Saved banner */}
      {savedAnalysisId && suggestions.length > 0 && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 text-sm">
            <span className="text-green-400">Discovery saved as</span>
            <span className="text-green-300 font-mono text-sm font-medium">{savedAnalysisId}</span>
            {savedAnalysisTime && (
              <span className="text-green-500/60 text-xs">
                saved at {new Date(savedAnalysisTime).toLocaleDateString('en-CA')}{' '}
                {new Date(savedAnalysisTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">
              Suggested Patterns ({suggestions.length})
            </h2>
            {discoveryMeta && (
              <span className="text-xs text-gray-500">
                Generated by {discoveryMeta.provider} / {discoveryMeta.model}
              </span>
            )}
          </div>

          {suggestions.map((s, i) => (
            <div key={i} className="card hover:bg-gray-800/60 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-mono px-2.5 py-1 rounded border ${
                    TYPE_COLORS[s.type] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'
                  }`}>
                    {s.type}
                  </span>
                  <h3 className="text-white font-semibold">{s.name}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    PRIORITY_COLORS[s.priority] || PRIORITY_COLORS.MEDIUM
                  }`}>
                    {s.priority}
                  </span>
                </div>
                <button
                  onClick={() => handleCreatePattern(s)}
                  className="btn-primary text-sm px-4"
                >
                  Create Pattern
                </button>
              </div>

              <p className="text-gray-300 text-sm mb-3">{s.description}</p>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-xs text-gray-500 block mb-1">Category</span>
                  <span className="text-gray-300">{CAT_LABELS[s.category] || s.category}</span>
                </div>
                {s.implements_abb && (
                  <div>
                    <span className="text-xs text-gray-500 block mb-1">Implements ABB</span>
                    <span className="text-blue-400 font-mono text-xs">{s.implements_abb}</span>
                  </div>
                )}
              </div>

              {s.technologies?.length > 0 && (
                <div className="mt-3">
                  <span className="text-xs text-gray-500 block mb-1">Technologies</span>
                  <div className="flex gap-2 flex-wrap">
                    {s.technologies.map(t => (
                      <span key={t} className="text-xs bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded font-mono">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-3 bg-gray-800/50 rounded-lg p-3">
                <span className="text-xs text-gray-500 block mb-1">Rationale</span>
                <p className="text-gray-400 text-sm">{s.rationale}</p>
              </div>

              {s.synergies && (
                <div className="mt-2">
                  <span className="text-xs text-gray-500 block mb-1">Synergies</span>
                  <p className="text-gray-400 text-sm">{s.synergies}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty state after discovery with no results */}
      {discoveryMeta && suggestions.length === 0 && !error && (
        <div className="text-gray-500 text-center py-8">
          No new patterns suggested. Your pattern library appears comprehensive!
        </div>
      )}

      {/* Discovery History */}
      {analyses.length > 0 && (
        <div className="space-y-3">
          <button
            onClick={() => setAnalysesExpanded(!analysesExpanded)}
            className="flex items-center gap-2 text-sm font-semibold text-gray-400 hover:text-white transition-colors"
          >
            <span className={`text-xs transition-transform ${analysesExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
            Previous Discoveries
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
                        <span className="text-white text-sm font-medium">{a.title || 'Pattern Discovery'}</span>
                        <span className="text-xs font-mono text-blue-400/60">{a.id}</span>
                        {a.suggestion_count != null && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-cyan-400">
                            {a.suggestion_count} suggestions
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                        <span>{a.created_at ? new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                        {a.provider && <span>{a.provider} / {a.model}</span>}
                        {a.focus_area && <span>Focus: {a.focus_area}</span>}
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
