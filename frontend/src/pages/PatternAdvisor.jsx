import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  analyzePattern, clarifyProblem, fetchEmbeddingStatus, fetchProviders, fetchCategories,
  fetchAdvisorReports, fetchAdvisorReport, updateAdvisorReport,
  deleteAdvisorReport, deleteAllAdvisorReports, cleanupAdvisorReports,
  advisorReportExportHtmlUrl, advisorReportExportDocxUrl,
  authenticatedDownload,
} from '../api/client'
import MarkdownContent from '../components/MarkdownContent'

const CONFIDENCE_COLORS = {
  HIGH: 'bg-green-500/20 text-green-400 border-green-500/30',
  MEDIUM: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  LOW: 'bg-red-500/20 text-red-400 border-red-500/30',
}

const PRIORITY_COLORS = {
  HIGH: 'bg-red-500/20 text-red-400',
  MEDIUM: 'bg-yellow-500/20 text-yellow-400',
  LOW: 'bg-green-500/20 text-green-400',
}

const PROGRESS_STEPS = [
  'Generating problem embedding',
  'Vector search across knowledge graph',
  'Expanding graph context via relationships',
  'AI analyzing patterns against your problem',
  'Structuring recommendations',
]

export default function PatternAdvisor() {
  // --- Form state ---
  const [problem, setProblem] = useState('')
  const [categoryFocus, setCategoryFocus] = useState('')
  const [techPrefs, setTechPrefs] = useState('')
  const [includeGaps, setIncludeGaps] = useState(true)
  const [providers, setProviders] = useState([])
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [categories, setCategories] = useState([])

  // --- Embedding state ---
  const [embeddingStatus, setEmbeddingStatus] = useState(null)

  // --- Analysis state ---
  const [analyzing, setAnalyzing] = useState(false)
  const [progressStep, setProgressStep] = useState(0)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [resultTab, setResultTab] = useState('overview')

  // --- Report history state ---
  const [reports, setReports] = useState([])
  const [savedReportId, setSavedReportId] = useState(null)
  const [editingTitle, setEditingTitle] = useState(null)
  const [editTitleValue, setEditTitleValue] = useState('')
  const [reportsLoading, setReportsLoading] = useState(false)

  // --- Clarification state ---
  const [clarifying, setClarifying] = useState(false)
  const [clarificationQuestions, setClarificationQuestions] = useState(null)
  const [clarificationAnswers, setClarificationAnswers] = useState({})

  // Load providers, categories, embedding status, and reports on mount
  useEffect(() => {
    Promise.all([
      fetchProviders().catch(() => ({ providers: [] })),
      fetchCategories().catch(() => []),
      fetchEmbeddingStatus().catch(() => null),
      fetchAdvisorReports(50).catch(() => ({ reports: [] })),
    ]).then(([prov, cats, embStatus, rpts]) => {
      const provList = prov?.providers || []
      setProviders(provList)
      const def = provList.find(p => p.is_default)
      if (def) {
        setProvider(def.name)
        setModel(def.default_model)
      }
      setCategories(cats?.categories || [])
      setEmbeddingStatus(embStatus)
      setReports(rpts?.reports || [])
    })
  }, [])

  // Animated progress during analysis
  useEffect(() => {
    if (!analyzing) return
    setProgressStep(0)
    const timings = [800, 2000, 3500, 5500]
    const timers = timings.map((ms, i) =>
      setTimeout(() => setProgressStep(i + 1), ms)
    )
    return () => timers.forEach(clearTimeout)
  }, [analyzing])


  const handleAnalyze = async () => {
    if (problem.trim().length < 10) {
      setError('Please describe your problem in at least 10 characters.')
      return
    }
    setError('')
    setResult(null)
    setResultTab('overview')
    setSavedReportId(null)

    // If we already have clarification answers, skip to full analysis
    if (clarificationQuestions && Object.keys(clarificationAnswers).length > 0) {
      await runFullAnalysis(clarificationAnswers)
      return
    }

    // Step 1: Pre-flight clarification check
    setClarifying(true)
    try {
      const clarifyData = {
        problem: problem.trim(),
        category_focus: categoryFocus || null,
        technology_preferences: techPrefs ? techPrefs.split(',').map(t => t.trim()).filter(Boolean) : [],
        provider: provider || null,
        model: model || null,
      }
      const clarifyRes = await clarifyProblem(clarifyData)

      if (clarifyRes.needs_clarification && clarifyRes.questions?.length > 0) {
        // Show clarification questions
        setClarificationQuestions(clarifyRes.questions)
        setClarificationAnswers({})
        setClarifying(false)
        return
      }
    } catch (err) {
      // If clarification fails, proceed to analysis anyway (graceful degradation)
      console.warn('Clarification check failed, proceeding to analysis:', err.message)
    }
    setClarifying(false)

    // Step 2: No clarification needed — proceed directly
    await runFullAnalysis(null)
  }

  const runFullAnalysis = async (clarifications) => {
    setAnalyzing(true)
    setClarificationQuestions(null)
    setClarificationAnswers({})
    try {
      const data = {
        problem: problem.trim(),
        category_focus: categoryFocus || null,
        technology_preferences: techPrefs ? techPrefs.split(',').map(t => t.trim()).filter(Boolean) : [],
        include_gap_analysis: includeGaps,
        provider: provider || null,
        model: model || null,
        clarifications: clarifications,
      }
      const res = await analyzePattern(data)
      setResult(res)
      setProgressStep(4)
      if (res.saved_report_id) {
        setSavedReportId(res.saved_report_id)
      }
      fetchAdvisorReports(50).then(r => setReports(r?.reports || [])).catch(() => {})
    } catch (err) {
      setError(err.message)
    }
    setAnalyzing(false)
  }

  const handleSkipClarification = () => {
    setClarificationQuestions(null)
    setClarificationAnswers({})
    runFullAnalysis(null)
  }

  const handleSubmitClarifications = () => {
    const answered = Object.values(clarificationAnswers).filter(v => v.trim()).length
    if (answered === 0) {
      setError('Please answer at least one question before continuing.')
      return
    }
    setError('')
    runFullAnalysis(clarificationAnswers)
  }

  // --- Report handlers ---

  const loadReports = () => {
    setReportsLoading(true)
    fetchAdvisorReports(50)
      .then(r => setReports(r?.reports || []))
      .catch(() => {})
      .finally(() => setReportsLoading(false))
  }

  const handleLoadReport = async (id) => {
    try {
      const report = await fetchAdvisorReport(id)
      if (report?.result_json) {
        setResult(report.result_json)
        setProblem(report.problem || '')
        setCategoryFocus(report.category_focus || '')
        setTechPrefs(
          Array.isArray(report.technology_preferences)
            ? report.technology_preferences.join(', ')
            : ''
        )
        setSavedReportId(report.id)
        setResultTab('overview')
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    } catch (err) {
      setError(`Failed to load report: ${err.message}`)
    }
  }

  const handleToggleStar = async (id) => {
    const rpt = reports.find(r => r.id === id)
    if (!rpt) return
    const newStarred = !rpt.starred
    // Optimistic update
    setReports(prev =>
      prev.map(r => r.id === id ? { ...r, starred: newStarred } : r)
        .sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0) || b.created_at?.localeCompare(a.created_at))
    )
    try {
      await updateAdvisorReport(id, { starred: newStarred })
    } catch {
      // Revert on failure
      setReports(prev =>
        prev.map(r => r.id === id ? { ...r, starred: !newStarred } : r)
      )
    }
  }

  const handleRenameReport = async (id) => {
    if (!editTitleValue.trim()) {
      setEditingTitle(null)
      return
    }
    try {
      await updateAdvisorReport(id, { title: editTitleValue.trim() })
      setReports(prev =>
        prev.map(r => r.id === id ? { ...r, title: editTitleValue.trim() } : r)
      )
    } catch {
      // ignore
    }
    setEditingTitle(null)
  }

  const handleDeleteReport = async (id) => {
    if (!confirm(`Delete report ${id}?`)) return
    try {
      await deleteAdvisorReport(id)
      setReports(prev => prev.filter(r => r.id !== id))
      if (savedReportId === id) setSavedReportId(null)
    } catch (err) {
      setError(`Failed to delete: ${err.message}`)
    }
  }

  const handleDeleteAll = async () => {
    if (!confirm('Delete all non-starred reports? Starred reports will be kept.')) return
    try {
      await deleteAllAdvisorReports()
      loadReports()
    } catch (err) {
      setError(`Failed to delete all: ${err.message}`)
    }
  }

  const handleCleanup = async () => {
    try {
      const res = await cleanupAdvisorReports()
      loadReports()
      const msg = `Cleanup complete: ${(res.deleted_by_count || 0) + (res.deleted_by_age || 0)} reports removed, ${res.total_remaining || 0} remaining`
      alert(msg)
    } catch (err) {
      setError(`Cleanup failed: ${err.message}`)
    }
  }

  const analysis = result?.analysis || {}
  const vectorMatches = result?.vector_matches || {}
  const graphStats = result?.graph_stats || {}

  // Compute embedding summary
  const embTotal = embeddingStatus?.status
    ? Object.values(embeddingStatus.status).reduce((acc, s) => ({
        total: acc.total + (s.total || 0),
        embedded: acc.embedded + (s.embedded || 0),
      }), { total: 0, embedded: 0 })
    : null

  const RESULT_TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'patterns', label: 'Recommended Patterns' },
    { id: 'comparisons', label: 'SBB Comparisons' },
    { id: 'architecture', label: 'Architecture' },
    { id: 'gaps', label: 'Platform Gaps' },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <span className="text-2xl">🧠</span> Pattern Advisor
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Describe your architecture problem and get AI-powered recommendations using GraphRAG
          </p>
        </div>
        {/* Embedding Status */}
        {embTotal && (
          <span className={`text-xs px-2 py-1 rounded ${
            embTotal.embedded === embTotal.total && embTotal.total > 0
              ? 'bg-green-500/20 text-green-400'
              : embTotal.embedded > 0
                ? 'bg-yellow-500/20 text-yellow-400'
                : 'bg-gray-700 text-gray-400'
          }`}>
            {embTotal.embedded === embTotal.total && embTotal.total > 0
              ? `✓ ${embTotal.total} nodes embedded`
              : `${embTotal.embedded}/${embTotal.total} nodes embedded`}
          </span>
        )}
      </div>

      {/* Input Section */}
      <div className="card space-y-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Describe Your Architecture Problem</label>
          <textarea
            value={problem}
            onChange={e => setProblem(e.target.value)}
            placeholder="Example: I need to build a RAG system that can search through internal company documents, support multiple document formats, provide accurate citations, and scale to millions of documents. The system should integrate with our existing Azure infrastructure and support real-time updates when documents change..."
            className="input w-full font-mono text-sm resize-y"
            rows={5}
          />
          <p className="text-xs text-gray-600 mt-1">{problem.length}/5000 characters</p>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Category Focus (optional)</label>
            <select
              value={categoryFocus}
              onChange={e => setCategoryFocus(e.target.value)}
              className="select w-full"
            >
              <option value="">All categories</option>
              {categories.map(c => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Technology Preferences (optional)</label>
            <input
              type="text"
              value={techPrefs}
              onChange={e => setTechPrefs(e.target.value)}
              placeholder="e.g. Azure, OpenAI, PostgreSQL"
              className="input w-full"
            />
          </div>
          <div>
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

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={includeGaps}
              onChange={e => setIncludeGaps(e.target.checked)}
              className="rounded border-gray-600 bg-gray-800"
            />
            Include platform gap analysis
          </label>
        </div>

        <button
          onClick={handleAnalyze}
          disabled={analyzing || clarifying || problem.trim().length < 10}
          className="btn-primary w-full py-3 text-base"
        >
          {clarifying ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-spin text-lg">&#9696;</span>
              Checking...
            </span>
          ) : analyzing ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-spin text-lg">&#9696;</span>
              Analyzing...
            </span>
          ) : (
            '🧠 Analyze Problem'
          )}
        </button>
      </div>

      {/* Progress Steps */}
      {analyzing && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">GraphRAG Pipeline</h3>
          <div className="space-y-2">
            {PROGRESS_STEPS.map((step, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span className={`w-5 h-5 flex items-center justify-center rounded-full text-xs ${
                  i < progressStep
                    ? 'bg-green-500/20 text-green-400'
                    : i === progressStep
                      ? 'bg-blue-500/20 text-blue-400 animate-pulse'
                      : 'bg-gray-800 text-gray-600'
                }`}>
                  {i < progressStep ? '✓' : i === progressStep ? '⟳' : '○'}
                </span>
                <span className={i <= progressStep ? 'text-gray-300' : 'text-gray-600'}>
                  {step}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Clarification Loading */}
      {clarifying && (
        <div className="card flex items-center gap-3 text-sm text-gray-400">
          <span className="animate-spin text-lg">&#9696;</span>
          Evaluating your problem description...
        </div>
      )}

      {/* Clarification Questions */}
      {clarificationQuestions && !analyzing && (
        <div className="card border border-blue-500/30 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-blue-400 flex items-center gap-2">
              <span className="text-lg">❓</span>
              A few questions to improve your analysis
            </h3>
            <button
              onClick={handleSkipClarification}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              Skip and analyze anyway →
            </button>
          </div>

          <div className="space-y-4">
            {clarificationQuestions.map(q => (
              <div key={q.id} className="space-y-2">
                <label className="block text-sm text-white font-medium">
                  {q.question}
                </label>
                {q.context && (
                  <p className="text-xs text-gray-500">{q.context}</p>
                )}
                {/* Suggested option buttons */}
                {q.suggested_options?.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {q.suggested_options.map(opt => (
                      <button
                        key={opt}
                        onClick={() => setClarificationAnswers(prev => ({
                          ...prev,
                          [q.id]: opt
                        }))}
                        className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                          clarificationAnswers[q.id] === opt
                            ? 'bg-blue-600/20 border-blue-500/50 text-blue-400'
                            : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}
                {/* Free-text input */}
                <input
                  type="text"
                  value={clarificationAnswers[q.id] || ''}
                  onChange={e => setClarificationAnswers(prev => ({
                    ...prev,
                    [q.id]: e.target.value
                  }))}
                  placeholder="Type your answer or select an option above..."
                  className="input w-full text-sm"
                />
              </div>
            ))}
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleSubmitClarifications}
              className="btn-primary flex-1 py-2.5"
            >
              Continue Analysis →
            </button>
            <button
              onClick={handleSkipClarification}
              className="px-4 py-2.5 rounded-lg bg-gray-800 text-gray-400 hover:text-gray-300 hover:bg-gray-700 transition-colors text-sm"
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Save Confirmation Banner */}
      {savedReportId && result && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-green-400 text-sm">&#10003; Report saved as</span>
            <span className="text-green-300 font-mono text-sm font-medium">{savedReportId}</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => authenticatedDownload(advisorReportExportHtmlUrl(savedReportId), `advisor-report-${savedReportId}.html`)}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              &#x2913; HTML
            </button>
            <button
              onClick={() => authenticatedDownload(advisorReportExportDocxUrl(savedReportId), `advisor-report-${savedReportId}.docx`)}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              &#x2913; DOCX
            </button>
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Result Header */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Analysis Results</h2>
            <div className="flex items-center gap-3">
              {analysis.confidence && (
                <span className={`text-xs px-2.5 py-1 rounded border font-medium ${
                  CONFIDENCE_COLORS[analysis.confidence] || CONFIDENCE_COLORS.MEDIUM
                }`}>
                  {analysis.confidence} confidence
                </span>
              )}
              {result.provider && (
                <span className="text-xs text-gray-500">
                  {result.provider} / {result.model}
                </span>
              )}
              {graphStats.vector_matches_used != null && (
                <span className="text-xs text-gray-600">
                  {graphStats.vector_matches_used} vector matches &middot; {graphStats.catalog_patterns} patterns in catalog
                </span>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-gray-800">
            {RESULT_TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setResultTab(t.id)}
                className={`px-4 py-2 text-sm transition-colors border-b-2 ${
                  resultTab === t.id
                    ? 'text-blue-400 border-blue-400'
                    : 'text-gray-500 border-transparent hover:text-gray-300'
                }`}
              >
                {t.label}
                {t.id === 'gaps' && analysis.platform_gaps?.length > 0 && (
                  <span className="ml-1.5 text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded">
                    {analysis.platform_gaps.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          {resultTab === 'overview' && <OverviewTab analysis={analysis} vectorMatches={vectorMatches} />}
          {resultTab === 'patterns' && <PatternsTab analysis={analysis} />}
          {resultTab === 'comparisons' && <ComparisonsTab analysis={analysis} />}
          {resultTab === 'architecture' && <ArchitectureTab analysis={analysis} />}
          {resultTab === 'gaps' && <GapsTab analysis={analysis} />}
        </div>
      )}

      {/* Report History */}
      {reports.length > 0 && (
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              Report History
              <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full">
                {reports.length}
              </span>
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCleanup}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                title="Apply retention policy cleanup"
              >
                Cleanup
              </button>
              <button
                onClick={handleDeleteAll}
                className="text-xs text-red-500/70 hover:text-red-400 transition-colors"
              >
                Delete All
              </button>
            </div>
          </div>

          {/* Report Rows */}
          <div className="space-y-2">
            {reports.map(rpt => (
              <div
                key={rpt.id}
                className={`card hover:bg-gray-800/60 transition-colors ${
                  savedReportId === rpt.id ? 'ring-1 ring-green-500/30' : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Star Toggle */}
                  <button
                    onClick={() => handleToggleStar(rpt.id)}
                    className={`mt-0.5 text-lg transition-colors ${
                      rpt.starred
                        ? 'text-yellow-400 hover:text-yellow-300'
                        : 'text-gray-700 hover:text-gray-500'
                    }`}
                    title={rpt.starred ? 'Unstar report' : 'Star report'}
                  >
                    {rpt.starred ? '\u2605' : '\u2606'}
                  </button>

                  {/* Main Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Title - editable */}
                      {editingTitle === rpt.id ? (
                        <input
                          type="text"
                          value={editTitleValue}
                          onChange={e => setEditTitleValue(e.target.value)}
                          onBlur={() => handleRenameReport(rpt.id)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleRenameReport(rpt.id)
                            if (e.key === 'Escape') setEditingTitle(null)
                          }}
                          autoFocus
                          className="input text-sm py-0.5 px-1.5 max-w-xs"
                        />
                      ) : (
                        <span
                          className="text-white text-sm font-medium truncate cursor-pointer hover:text-blue-300"
                          onClick={() => {
                            setEditingTitle(rpt.id)
                            setEditTitleValue(rpt.title || '')
                          }}
                          title="Click to rename"
                        >
                          {rpt.title || rpt.problem?.slice(0, 80) || 'Untitled'}
                        </span>
                      )}

                      {/* Report ID */}
                      <span className="text-xs font-mono text-blue-400/60">{rpt.id}</span>

                      {/* Confidence Badge */}
                      {rpt.confidence && (
                        <span className={`text-xs px-1.5 py-0.5 rounded border ${
                          CONFIDENCE_COLORS[rpt.confidence] || CONFIDENCE_COLORS.MEDIUM
                        }`}>
                          {rpt.confidence}
                        </span>
                      )}
                    </div>

                    {/* Meta row */}
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      <span>{rpt.created_at ? new Date(rpt.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                      {rpt.provider && (
                        <span>{rpt.provider} / {rpt.model}</span>
                      )}
                      {rpt.category_focus && (
                        <span className="bg-gray-800 px-1.5 py-0.5 rounded">{rpt.category_focus}</span>
                      )}
                    </div>

                    {/* Problem excerpt if different from title */}
                    {rpt.title && rpt.problem && rpt.title !== rpt.problem?.slice(0, 80) && (
                      <p className="text-xs text-gray-600 mt-1 truncate">{rpt.problem}</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => handleLoadReport(rpt.id)}
                      className="text-xs px-2.5 py-1 rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 transition-colors"
                      title="Load this report"
                    >
                      Load
                    </button>
                    <button
                      onClick={() => authenticatedDownload(advisorReportExportHtmlUrl(rpt.id), `advisor-report-${rpt.id}.html`)}
                      className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-400 hover:text-gray-300 hover:bg-gray-700 transition-colors"
                      title="Download HTML"
                    >
                      HTML
                    </button>
                    <button
                      onClick={() => authenticatedDownload(advisorReportExportDocxUrl(rpt.id), `advisor-report-${rpt.id}.docx`)}
                      className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-400 hover:text-gray-300 hover:bg-gray-700 transition-colors"
                      title="Download DOCX"
                    >
                      DOCX
                    </button>
                    <button
                      onClick={() => handleDeleteReport(rpt.id)}
                      className="text-xs px-2 py-1 rounded text-red-500/50 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Delete report"
                    >
                      &#x2715;
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}


/* ========== OVERVIEW TAB ========== */

function OverviewTab({ analysis, vectorMatches }) {
  return (
    <div className="space-y-4">
      {/* Summary */}
      {analysis.summary && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">Summary</h3>
          <MarkdownContent content={analysis.summary} />
        </div>
      )}

      {/* Vector Match Scores */}
      {vectorMatches?.patterns?.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">
            Semantic Similarity Matches
            <span className="font-normal text-gray-600 ml-2">via vector search</span>
          </h3>
          <div className="space-y-2">
            {vectorMatches.patterns.slice(0, 8).map((m, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <div className="w-24 bg-gray-800 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full"
                    style={{ width: `${Math.round((m.score || 0) * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-gray-500 w-12 text-right">
                  {((m.score || 0) * 100).toFixed(0)}%
                </span>
                <Link
                  to={`/patterns/${m.id}`}
                  className="text-blue-400 font-mono text-xs hover:underline"
                >
                  {m.id}
                </Link>
                <span className="text-gray-400">{m.name}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  m.type === 'ABB' ? 'bg-blue-500/10 text-blue-400'
                    : m.type === 'SBB' ? 'bg-green-500/10 text-green-400'
                    : 'bg-orange-500/10 text-orange-400'
                }`}>{m.type}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reasoning */}
      {analysis.reasoning && (
        <details className="card group">
          <summary className="text-sm font-semibold text-gray-400 cursor-pointer hover:text-gray-300 flex items-center gap-2">
            <span className="text-xs group-open:rotate-90 transition-transform">▶</span>
            Reasoning Process
          </summary>
          <div className="mt-3">
            <MarkdownContent content={analysis.reasoning} />
          </div>
        </details>
      )}
    </div>
  )
}


/* ========== RECOMMENDED PATTERNS TAB ========== */

function PatternsTab({ analysis }) {
  const pbcs = analysis.recommended_pbcs || []
  const abbs = analysis.recommended_abbs || []
  const sbbs = analysis.recommended_sbbs || []

  if (pbcs.length === 0 && abbs.length === 0 && sbbs.length === 0) {
    return (
      <div className="text-gray-500 text-center py-8">
        No specific pattern recommendations in this analysis.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* PBCs */}
      {pbcs.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-purple-400 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-purple-400" />
            Packaged Business Capabilities ({pbcs.length})
          </h3>
          <div className="space-y-2">
            {pbcs.map((pbc, i) => (
              <div key={i} className="card border-l-4 border-purple-500/40 hover:bg-gray-800/60 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Link
                      to={`/pbcs/${pbc.id}`}
                      className="text-purple-400 font-mono text-xs hover:underline"
                    >
                      {pbc.id}
                    </Link>
                    <span className="text-white font-medium">{pbc.name}</span>
                    {pbc.confidence && (
                      <span className={`text-xs px-2 py-0.5 rounded border ${
                        CONFIDENCE_COLORS[pbc.confidence] || CONFIDENCE_COLORS.MEDIUM
                      }`}>{pbc.confidence}</span>
                    )}
                  </div>
                </div>
                {pbc.relevance && (
                  <p className="text-gray-400 text-sm mt-2">{pbc.relevance}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ABBs */}
      {abbs.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-blue-400 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-400" />
            Architecture Building Blocks ({abbs.length})
          </h3>
          <div className="space-y-2">
            {abbs.map((abb, i) => (
              <div key={i} className="card border-l-4 border-blue-500/40 hover:bg-gray-800/60 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Link
                      to={`/patterns/${abb.id}`}
                      className="text-blue-400 font-mono text-xs hover:underline"
                    >
                      {abb.id}
                    </Link>
                    <span className="text-white font-medium">{abb.name}</span>
                    {abb.confidence && (
                      <span className={`text-xs px-2 py-0.5 rounded border ${
                        CONFIDENCE_COLORS[abb.confidence] || CONFIDENCE_COLORS.MEDIUM
                      }`}>{abb.confidence}</span>
                    )}
                  </div>
                </div>
                {abb.role && (
                  <p className="text-gray-400 text-sm mt-2">{abb.role}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SBBs */}
      {sbbs.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-green-400 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-400" />
            Solution Building Blocks ({sbbs.length})
          </h3>
          <div className="space-y-2">
            {sbbs.map((sbb, i) => (
              <div key={i} className="card border-l-4 border-green-500/40 hover:bg-gray-800/60 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Link
                      to={`/patterns/${sbb.id}`}
                      className="text-green-400 font-mono text-xs hover:underline"
                    >
                      {sbb.id}
                    </Link>
                    <span className="text-white font-medium">{sbb.name}</span>
                    {sbb.confidence && (
                      <span className={`text-xs px-2 py-0.5 rounded border ${
                        CONFIDENCE_COLORS[sbb.confidence] || CONFIDENCE_COLORS.MEDIUM
                      }`}>{sbb.confidence}</span>
                    )}
                  </div>
                </div>
                {sbb.justification && (
                  <p className="text-gray-400 text-sm mt-2">{sbb.justification}</p>
                )}
                {sbb.restrictions_note && (
                  <p className="text-orange-400 text-xs mt-2 bg-orange-500/10 rounded px-2 py-1">
                    ⚠️ {sbb.restrictions_note}
                  </p>
                )}
                {sbb.technologies?.length > 0 && (
                  <div className="flex gap-2 flex-wrap mt-2">
                    {sbb.technologies.map(t => (
                      <span key={t} className="text-xs bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded font-mono">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}


/* ========== SBB COMPARISONS TAB ========== */

function ComparisonsTab({ analysis }) {
  const comparisons = analysis.sbb_comparisons || []

  if (comparisons.length === 0) {
    return (
      <div className="text-gray-500 text-center py-8">
        No SBB comparisons available in this analysis.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {comparisons.map((group, gi) => (
        <div key={gi} className="card">
          <h3 className="text-sm font-semibold text-white mb-4">{group.context || `Comparison Group ${gi + 1}`}</h3>

          {/* Comparison Table */}
          <div className="overflow-x-auto rounded-lg border border-gray-700">
            <table className="w-full text-sm">
              <thead className="bg-gray-800/80">
                <tr>
                  <th className="text-left py-2.5 px-3 text-gray-300 font-semibold text-xs uppercase tracking-wider">SBB</th>
                  <th className="text-left py-2.5 px-3 text-gray-300 font-semibold text-xs uppercase tracking-wider">Strengths</th>
                  <th className="text-left py-2.5 px-3 text-gray-300 font-semibold text-xs uppercase tracking-wider">Weaknesses</th>
                  <th className="text-left py-2.5 px-3 text-gray-300 font-semibold text-xs uppercase tracking-wider">Best For</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {(group.sbbs || []).map((sbb, si) => (
                  <tr key={si} className="hover:bg-gray-800/40 transition-colors">
                    <td className="py-2.5 px-3">
                      <Link
                        to={`/patterns/${sbb.id}`}
                        className="text-green-400 font-mono text-xs hover:underline"
                      >
                        {sbb.id}
                      </Link>
                      {sbb.name && (
                        <p className="text-gray-400 text-xs mt-0.5">{sbb.name}</p>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-gray-300 text-xs">
                      {Array.isArray(sbb.strengths)
                        ? <ul className="list-disc list-inside space-y-0.5">{sbb.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                        : sbb.strengths}
                    </td>
                    <td className="py-2.5 px-3 text-gray-300 text-xs">
                      {Array.isArray(sbb.weaknesses)
                        ? <ul className="list-disc list-inside space-y-0.5">{sbb.weaknesses.map((w, i) => <li key={i}>{w}</li>)}</ul>
                        : sbb.weaknesses}
                    </td>
                    <td className="py-2.5 px-3 text-gray-300 text-xs">{sbb.best_for}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Recommendation */}
          {group.recommendation && (
            <div className="mt-3 bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
              <span className="text-xs font-semibold text-blue-400 block mb-1">Recommendation</span>
              <p className="text-gray-300 text-sm">{group.recommendation}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}


/* ========== ARCHITECTURE TAB ========== */

function ArchitectureTab({ analysis }) {
  const hasComposition = analysis.architecture_composition
  const hasDataFlow = analysis.data_flow

  if (!hasComposition && !hasDataFlow) {
    return (
      <div className="text-gray-500 text-center py-8">
        No architecture composition details available in this analysis.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {hasComposition && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">Architecture Composition</h3>
          <MarkdownContent content={analysis.architecture_composition} />
        </div>
      )}

      {hasDataFlow && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">Data Flow</h3>
          <MarkdownContent content={analysis.data_flow} />
        </div>
      )}
    </div>
  )
}


/* ========== PLATFORM GAPS TAB ========== */

function GapsTab({ analysis }) {
  const gaps = analysis.platform_gaps || []

  if (gaps.length === 0) {
    return (
      <div className="text-gray-500 text-center py-8">
        No platform gaps identified. Your pattern library covers the problem well!
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-gray-500 text-sm">
        These capabilities are needed for your problem but are not currently covered by patterns in the library.
      </p>
      {gaps.map((gap, i) => (
        <div key={i} className="card border-l-4 border-red-500/40 hover:bg-gray-800/60 transition-colors">
          <div className="flex items-start justify-between mb-2">
            <h4 className="text-white font-medium text-sm">{gap.capability}</h4>
            <div className="flex items-center gap-2">
              {gap.priority && (
                <span className={`text-xs px-2 py-0.5 rounded ${
                  PRIORITY_COLORS[gap.priority] || PRIORITY_COLORS.MEDIUM
                }`}>
                  {gap.priority} priority
                </span>
              )}
              {gap.category && (
                <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded">
                  {gap.category}
                </span>
              )}
            </div>
          </div>
          {gap.description && (
            <p className="text-gray-400 text-sm">{gap.description}</p>
          )}
          {gap.rationale && (
            <p className="text-gray-500 text-xs mt-2 italic">{gap.rationale}</p>
          )}
        </div>
      ))}
    </div>
  )
}
