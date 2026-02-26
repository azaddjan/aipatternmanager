import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  fetchTechnology, updateTechnology, deleteTechnology,
  aiTechnologySuggest, aiTechnologyAssist,
  fetchTechnologyGraph, fetchTechnologyImpact,
  fetchTechnologyAlternatives, fetchTechnologyAdoption, fetchTechnologyHealth,
} from '../api/client'
import GraphView from '../components/GraphView'
import MarkdownContent from '../components/MarkdownContent'

const TECH_CATEGORIES = [
  'cloud-compute', 'cloud-ai', 'cloud-data', 'cloud-infra',
  'framework', 'saas', 'observability', 'database',
]

const CATEGORY_LABELS = {
  'cloud-compute': 'Cloud Compute',
  'cloud-ai': 'Cloud AI Service',
  'cloud-data': 'Cloud Data & Storage',
  'cloud-infra': 'Cloud Infrastructure',
  'framework': 'Framework / Library',
  'saas': 'SaaS Platform',
  'observability': 'Observability',
  'database': 'Database',
}

const CATEGORY_COLORS = {
  'cloud-compute': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'cloud-ai': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  'cloud-data': 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  'cloud-infra': 'bg-sky-500/20 text-sky-400 border-sky-500/30',
  'framework': 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  'saas': 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  'observability': 'bg-lime-500/20 text-lime-400 border-lime-500/30',
  'database': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
}

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'graph', label: 'Graph' },
  { key: 'impact', label: 'Impact' },
  { key: 'alternatives', label: 'Alternatives' },
  { key: 'adoption', label: 'Adoption' },
  { key: 'health', label: 'Health' },
]

// Clean tech data for AI — strip large/internal fields
function cleanTechForAI(tech) {
  if (!tech) return {}
  const { used_by_patterns, embedding, created_at, updated_at, ...rest } = tech
  return rest
}

export default function TechnologyDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [tech, setTech] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [cascadeResult, setCascadeResult] = useState(null)
  const [suggesting, setSuggesting] = useState(false)
  const [tab, setTab] = useState('overview')

  // Lazy-loaded tab data
  const [graphData, setGraphData] = useState(null)
  const [impactData, setImpactData] = useState(null)
  const [alternativesData, setAlternativesData] = useState(null)
  const [adoptionData, setAdoptionData] = useState(null)
  const [healthData, setHealthData] = useState(null)
  const [tabLoading, setTabLoading] = useState(false)

  // AI assist states
  const [aiLoading, setAiLoading] = useState('')
  const [aiResult, setAiResult] = useState(null) // {field, text} for last AI result
  const [aiRecommendations, setAiRecommendations] = useState(null)

  const handleAISuggest = async () => {
    const name = form.name || tech?.name
    if (!name?.trim()) return
    setSuggesting(true)
    try {
      const result = await aiTechnologySuggest({ name: name.trim(), partial_data: { id: tech?.id } })
      const s = result.suggestion || {}
      setForm(f => ({
        ...f,
        vendor: s.vendor || f.vendor,
        category: s.category || f.category,
        description: s.description || f.description,
        cost_tier: s.cost_tier || f.cost_tier,
        doc_url: s.doc_url || f.doc_url,
        website: s.website || f.website,
        notes: s.notes || f.notes,
      }))
    } catch (err) {
      setError(`AI suggest failed: ${err.message}`)
    }
    setSuggesting(false)
  }

  const handleAIAssist = async (action, customPrompt = '', targetField = null) => {
    setAiLoading(action)
    setError('')
    try {
      // Merge saved tech with current form edits so AI sees what the user typed
      const techForAI = cleanTechForAI({ ...tech, ...(editing ? form : {}) })
      const result = await aiTechnologyAssist({
        action,
        tech_data: techForAI,
        field: targetField,
        custom_prompt: customPrompt || undefined,
        health_data: action === 'health_recommendations' ? healthData : undefined,
      })
      if (action === 'health_recommendations') {
        setAiRecommendations(result.result?.recommendations || [])
      } else {
        // Store AI result for review before applying
        const field = targetField || (action === 'rewrite_description' ? 'description' : (action === 'suggest_notes' || action === 'rewrite_notes') ? 'notes' : null)
        setAiResult({ field, text: result.result, action })
      }
    } catch (err) {
      setError(`AI assist failed: ${err.message}`)
    }
    setAiLoading('')
  }

  const applyAIResult = () => {
    if (!aiResult) return
    setForm(f => ({ ...f, [aiResult.field]: aiResult.text }))
    if (!editing) setEditing(true)
    setAiResult(null)
  }

  const load = () => {
    setLoading(true)
    fetchTechnology(id).then(t => {
      setTech(t)
      setForm({
        name: t.name || '',
        vendor: t.vendor || '',
        category: t.category || '',
        status: t.status || 'APPROVED',
        description: t.description || '',
        cost_tier: t.cost_tier || '',
        doc_url: t.doc_url || '',
        website: t.website || '',
        notes: t.notes || '',
      })
      setLoading(false)
    }).catch(() => {
      setTech(null)
      setLoading(false)
    })
  }

  useEffect(() => { load() }, [id])

  // Eagerly load impact, alternatives, adoption for AI context
  useEffect(() => {
    if (!tech) return
    if (!impactData) fetchTechnologyImpact(id).then(setImpactData).catch(() => {})
    if (!alternativesData) fetchTechnologyAlternatives(id).then(setAlternativesData).catch(() => {})
    if (!adoptionData) fetchTechnologyAdoption(id).then(setAdoptionData).catch(() => {})
  }, [tech])

  // Lazy-load tab data (graph, health still lazy)
  useEffect(() => {
    if (!tech) return
    const loadTab = async () => {
      setTabLoading(true)
      try {
        if (tab === 'graph' && !graphData) {
          setGraphData(await fetchTechnologyGraph(id))
        } else if (tab === 'health' && !healthData) {
          setHealthData(await fetchTechnologyHealth(id))
        }
      } catch (err) {
        setError(`Failed to load ${tab}: ${err.message}`)
      }
      setTabLoading(false)
    }
    loadTab()
  }, [tab, tech])

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setCascadeResult(null)
    try {
      const res = await updateTechnology(id, form)
      if (res.cascade_deprecated && res.cascade_deprecated.length > 0) {
        setCascadeResult(res.cascade_deprecated)
      }
      setEditing(false)
      // Reset tab data so they re-fetch fresh
      setGraphData(null)
      setImpactData(null)
      setAlternativesData(null)
      setAdoptionData(null)
      setHealthData(null)
      setAiRecommendations(null)
      setAiResult(null)
      load()
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  const handleDelete = async () => {
    if (!confirm(`Delete technology ${id}? This cannot be undone.`)) return
    try {
      await deleteTechnology(id)
      navigate('/technologies')
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return <div className="text-gray-500 text-center py-12">Loading technology...</div>
  if (!tech) return <div className="text-red-400 text-center py-12">Technology {id} not found</div>

  const catColor = CATEGORY_COLORS[tech.category] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'
  const catLabel = CATEGORY_LABELS[tech.category] || tech.category
  const patterns = tech.used_by_patterns || []

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link to="/technologies" className="text-gray-500 hover:text-gray-300 transition-colors">&larr; Technologies</Link>
        <span className="text-gray-700">/</span>
        <span className="text-gray-400">{tech.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className={`text-xs px-2.5 py-1 rounded border ${catColor}`}>{catLabel}</span>
            <span className="text-gray-500 font-mono text-sm">{tech.id}</span>
            <span className={`text-xs px-2 py-0.5 rounded ${
              tech.status === 'APPROVED' ? 'bg-green-500/20 text-green-400' :
              tech.status === 'DEPRECATED' ? 'bg-red-500/20 text-red-400' :
              'bg-yellow-500/20 text-yellow-400'
            }`}>{tech.status}</span>
          </div>
          <h1 className="text-2xl font-bold text-white">{tech.name}</h1>
          <p className="text-gray-500 text-sm mt-1">Vendor: {tech.vendor}</p>
        </div>
        <div className="flex gap-2">
          {tech.doc_url && (
            <a href={tech.doc_url} target="_blank" rel="noopener noreferrer" className="btn-primary flex items-center gap-1.5">
              Docs
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
          <button onClick={() => setEditing(!editing)} className="btn-secondary">
            {editing ? 'Cancel' : 'Edit'}
          </button>
          <button onClick={handleDelete} className="btn-danger">Delete</button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400/60 hover:text-red-400">x</button>
        </div>
      )}

      {cascadeResult && cascadeResult.length > 0 && (
        <div className="bg-orange-500/10 border border-orange-500/30 text-orange-400 rounded-lg px-4 py-3">
          <p className="font-semibold text-sm mb-2">Cascade Deprecation: {cascadeResult.length} SBB(s) were automatically deprecated</p>
          <ul className="text-sm space-y-1">
            {cascadeResult.map(s => (
              <li key={s.id}>
                <Link to={`/patterns/${s.id}`} className="text-orange-300 hover:underline font-mono text-xs">{s.id}</Link>
                <span className="text-orange-400/70 ml-2">{s.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* AI Result Preview Banner */}
      {aiResult && (
        <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-purple-400">
              AI Generated: {aiResult.field}
            </span>
            <div className="flex gap-2">
              <button onClick={applyAIResult} className="px-3 py-1 text-xs rounded bg-purple-600/30 text-purple-300 hover:bg-purple-600/50 transition-colors">
                Apply to Form
              </button>
              <button onClick={() => setAiResult(null)} className="px-3 py-1 text-xs rounded bg-gray-700 text-gray-400 hover:bg-gray-600 transition-colors">
                Dismiss
              </button>
            </div>
          </div>
          <div className="bg-gray-900/50 rounded px-3 py-2 max-h-40 overflow-y-auto">
            <MarkdownContent content={aiResult.text} />
          </div>
        </div>
      )}

      {/* Edit Form */}
      {editing && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-400">Edit Technology</h2>
            <button
              onClick={handleAISuggest}
              disabled={suggesting}
              className="px-3 py-1.5 text-xs rounded-lg bg-purple-600/20 text-purple-400 border border-purple-500/30 hover:bg-purple-600/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
              title="Auto-populate empty fields using AI"
            >
              {suggesting ? <Spinner text="Thinking..." /> : (
                <><SparkleIcon /> Populate All with AI</>
              )}
            </button>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="input w-full" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Vendor</label>
              <input value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))} className="input w-full" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Category</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="select w-full">
                {TECH_CATEGORIES.map(c => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>
                ))}
                {!TECH_CATEGORIES.includes(form.category) && form.category && (
                  <option value={form.category}>{form.category}</option>
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Status</label>
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className="select w-full">
                <option value="APPROVED">APPROVED</option>
                <option value="UNDER_REVIEW">UNDER_REVIEW</option>
                <option value="DEPRECATED">DEPRECATED</option>
              </select>
              {form.status === 'DEPRECATED' && tech.status !== 'DEPRECATED' && (
                <p className="text-xs text-orange-400 mt-1">
                  Warning: Deprecating will also deprecate all SBBs using this technology.
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Cost Tier</label>
              <select value={form.cost_tier} onChange={e => setForm(f => ({ ...f, cost_tier: e.target.value }))} className="select w-full">
                <option value="">--</option>
                <option value="FREE">FREE</option>
                <option value="LOW">LOW</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HIGH">HIGH</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Documentation URL</label>
              <input value={form.doc_url} onChange={e => setForm(f => ({ ...f, doc_url: e.target.value }))} className="input w-full" placeholder="https://docs.example.com" />
            </div>
            {/* Description with AI */}
            <div className="col-span-3">
              <AIFieldLabel
                label="Description"
                field="description"
                actions={[
                  { action: 'rewrite_description', label: 'AI Rewrite' },
                ]}
                onAI={handleAIAssist}
                loading={aiLoading}
              />
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="input w-full" rows={2} placeholder="Short description..." />
            </div>
            <div className="col-span-1">
              <label className="block text-xs text-gray-500 mb-1">Website</label>
              <input value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} className="input w-full" placeholder="https://example.com" />
            </div>
            {/* Notes with AI */}
            <div className="col-span-2">
              <AIFieldLabel
                label="Notes"
                field="notes"
                actions={[
                  { action: 'rewrite_notes', label: 'AI Rewrite' },
                  { action: 'suggest_notes', label: 'AI Suggest' },
                ]}
                onAI={handleAIAssist}
                loading={aiLoading}
              />
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="input w-full" rows={3} placeholder="Internal notes, best practices..." />
            </div>
          </div>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm transition-colors border-b-2 ${
              tab === t.key
                ? 'text-blue-400 border-blue-400'
                : 'text-gray-500 border-transparent hover:text-gray-300'
            }`}
          >{t.label}</button>
        ))}
      </div>

      {/* Tab Content */}
      {tabLoading ? (
        <div className="text-gray-500 text-center py-12">Loading...</div>
      ) : (
        <>
          {tab === 'overview' && (
            <OverviewTab
              tech={tech}
              patterns={patterns}
              catLabel={catLabel}
              onAI={handleAIAssist}
              aiLoading={aiLoading}
              impactData={impactData}
              alternativesData={alternativesData}
              adoptionData={adoptionData}
            />
          )}
          {tab === 'graph' && <GraphTab data={graphData} />}
          {tab === 'impact' && <ImpactTab data={impactData} tech={tech} />}
          {tab === 'alternatives' && <AlternativesTab data={alternativesData} />}
          {tab === 'adoption' && <AdoptionTab data={adoptionData} />}
          {tab === 'health' && (
            <HealthTab
              data={healthData}
              onAIRecommend={(prompt) => handleAIAssist('health_recommendations', prompt)}
              aiLoading={aiLoading === 'health_recommendations'}
              recommendations={aiRecommendations}
              onClearRecommendations={() => setAiRecommendations(null)}
            />
          )}
        </>
      )}
    </div>
  )
}


/* ==================== Shared Components ==================== */

function SparkleIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
      <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582a1 1 0 01.588.764l.003.046-.003.046a1 1 0 01-.588.764L11 9.107V11a1 1 0 11-2 0V9.107L5.046 7.525a1 1 0 01-.588-.764L4.455 6.715l.003-.046a1 1 0 01.588-.764L9 4.323V3a1 1 0 011-1zM5 14a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zm10 0a1 1 0 011 1v1h1a1 1 0 110 2h-1v1a1 1 0 11-2 0v-1h-1a1 1 0 110-2h1v-1a1 1 0 011-1z" />
    </svg>
  )
}

function Spinner({ text }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z"/></svg>
      {text}
    </span>
  )
}

function StatCard({ label, value, color = 'text-white', border = 'border-gray-600' }) {
  return (
    <div className={`card border-l-4 ${border}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-semibold ${color}`}>{value}</p>
    </div>
  )
}

/** Per-field AI label with Rewrite + Suggest buttons + expandable custom prompt */
function AIFieldLabel({ label, field, actions, onAI, loading }) {
  const [showPrompt, setShowPrompt] = useState(false)
  const [prompt, setPrompt] = useState('')
  const isLoading = actions.some(a => loading === a.action) || loading === `custom_${field}`

  const handleRun = () => {
    if (prompt.trim()) {
      onAI('custom', prompt.trim(), field)
    } else {
      onAI(actions[0].action, '', field)
    }
  }

  return (
    <div className="mb-1">
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500">{label}</label>
        <span className="text-gray-700">|</span>
        {actions.map(a => (
          <button
            key={a.action}
            onClick={() => onAI(a.action, '', field)}
            disabled={isLoading}
            className="text-xs text-purple-400/60 hover:text-purple-400 disabled:opacity-50 transition-colors flex items-center gap-1"
          >
            <SparkleIcon />
            {loading === a.action ? 'Generating...' : a.label}
          </button>
        ))}
        <button
          onClick={() => setShowPrompt(!showPrompt)}
          disabled={isLoading}
          className="text-xs text-gray-500 hover:text-purple-400 transition-colors disabled:opacity-50"
          title="Custom AI instruction"
        >
          {showPrompt ? 'Hide' : 'Custom...'}
        </button>
      </div>
      {showPrompt && (
        <div className="flex gap-2 mt-1 mb-1">
          <input
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder={`Custom instruction for ${label.toLowerCase()}... (leave empty for default)`}
            className="input flex-1 text-xs"
            onKeyDown={e => e.key === 'Enter' && handleRun()}
          />
          <button
            onClick={handleRun}
            disabled={isLoading}
            className="px-3 py-1 text-xs rounded bg-purple-600/30 text-purple-300 hover:bg-purple-600/50 disabled:opacity-50 transition-colors flex items-center gap-1"
          >
            {isLoading ? <Spinner text="" /> : <SparkleIcon />}
            Run
          </button>
          <button
            onClick={() => { setShowPrompt(false); setPrompt('') }}
            className="px-2 py-1 text-xs rounded bg-gray-700 text-gray-400 hover:bg-gray-600 transition-colors"
          >
            x
          </button>
        </div>
      )}
    </div>
  )
}

/** Standalone AI prompt box with Clear button */
function AIPromptBox({ title, placeholder, onRun, loading, result, onClear, onApply, applyLabel, defaultExpanded = false }) {
  const [prompt, setPrompt] = useState('')
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div className="card border border-purple-500/20">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-purple-400 flex items-center gap-1.5">
          <SparkleIcon /> {title}
        </h3>
        <div className="flex items-center gap-2">
          {result && onClear && (
            <button
              onClick={() => { onClear(); setPrompt('') }}
              className="text-xs text-gray-500 hover:text-red-400 transition-colors"
            >
              Clear
            </button>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>
      {expanded && (
        <>
          <div className="flex gap-2 mb-3">
            <input
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder={placeholder}
              className="input flex-1 text-sm"
              onKeyDown={e => e.key === 'Enter' && onRun(prompt)}
            />
            <button
              onClick={() => onRun(prompt)}
              disabled={loading}
              className="px-4 py-1.5 text-sm rounded-lg bg-purple-600/30 text-purple-300 hover:bg-purple-600/50 disabled:opacity-50 transition-colors flex items-center gap-1.5"
            >
              {loading ? <Spinner text="Generating..." /> : (<><SparkleIcon /> Generate</>)}
            </button>
          </div>
          {result && (
            <div className="bg-gray-900/50 rounded-lg px-3 py-2 max-h-64 overflow-y-auto">
              <MarkdownContent content={typeof result === 'string' ? result : JSON.stringify(result, null, 2)} />
              <div className="flex gap-2 mt-2">
                {onApply && (
                  <button
                    onClick={onApply}
                    className="px-3 py-1 text-xs rounded bg-purple-600/30 text-purple-300 hover:bg-purple-600/50 transition-colors"
                  >
                    {applyLabel || 'Apply'}
                  </button>
                )}
                {onClear && (
                  <button
                    onClick={() => { onClear(); setPrompt('') }}
                    className="px-3 py-1 text-xs rounded bg-gray-700 text-gray-400 hover:bg-gray-600 transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
      {!expanded && (
        <p className="text-xs text-gray-600">Click "Expand" to use AI to generate or improve content.</p>
      )}
    </div>
  )
}


/* ==================== Overview Tab ==================== */

function OverviewTab({ tech, patterns, catLabel, onAI, aiLoading, impactData, alternativesData, adoptionData }) {
  const [customResult, setCustomResult] = useState(null)
  const [customLoading, setCustomLoading] = useState(false)

  // Build enriched context with impact, alternatives, adoption data
  const buildEnrichedContext = () => {
    const parts = []
    if (impactData) {
      const affected = impactData.affected_patterns || []
      const active = affected.filter(p => p.status === 'ACTIVE').length
      parts.push(`Impact: ${affected.length} affected patterns (${active} active). Patterns: ${affected.slice(0, 15).map(p => `${p.id}(${p.type},${p.status})`).join(', ')}${affected.length > 15 ? ` +${affected.length - 15} more` : ''}`)
    }
    if (alternativesData) {
      const alts = alternativesData.alternatives || []
      if (alts.length > 0) {
        parts.push(`Alternatives: ${alts.map(a => `${a.name}(${a.vendor}, ${a.category}, cost=${a.cost_tier || 'N/A'}, usage=${a.usage_count}${a.same_category ? ', same-category' : ''})`).join('; ')}`)
      }
    }
    if (adoptionData) {
      const { total_patterns, by_type = {}, by_status = {}, by_category = [], by_team = [] } = adoptionData
      parts.push(`Adoption: ${total_patterns} patterns. Types: SBB=${by_type.SBB || 0}, ABB=${by_type.ABB || 0}, AB=${by_type.AB || 0}. Status: ${Object.entries(by_status).map(([s, c]) => `${s}=${c}`).join(', ')}. Categories: ${by_category.map(c => `${c.category}(${c.count})`).join(', ')}. Teams: ${by_team.map(t => `${t.team_name}(${t.count})`).join(', ')}`)
    }
    return parts.length > 0 ? '\n\nAdditional context from the system:\n' + parts.join('\n') : ''
  }

  const handleCustomAI = async (prompt) => {
    if (!prompt.trim()) return
    setCustomResult(null)
    setCustomLoading(true)
    try {
      const enriched = buildEnrichedContext()
      const result = await aiTechnologyAssist({
        action: 'custom',
        tech_data: cleanTechForAI(tech),
        custom_prompt: prompt.trim() + enriched,
      })
      setCustomResult(result.result)
    } catch (err) {
      setCustomResult(`Error: ${err.message}`)
    }
    setCustomLoading(false)
  }

  return (
    <div className="space-y-6">
      {/* AI Assistant */}
      <AIPromptBox
        title="AI Assistant"
        placeholder="Ask anything — AI knows impact, alternatives & adoption data... (e.g., 'Compare with alternatives', 'Migration risk?', 'Adoption strategy')"
        onRun={handleCustomAI}
        loading={customLoading}
        result={customResult}
        onClear={() => setCustomResult(null)}
        defaultExpanded
      />

      {/* Info Cards */}
      <div className="grid grid-cols-5 gap-4">
        <StatCard label="Vendor" value={tech.vendor} />
        <StatCard label="Category" value={catLabel} />
        <StatCard
          label="Status"
          value={tech.status}
          color={tech.status === 'APPROVED' ? 'text-green-400' : tech.status === 'DEPRECATED' ? 'text-red-400' : 'text-yellow-400'}
          border={tech.status === 'APPROVED' ? 'border-green-500' : tech.status === 'DEPRECATED' ? 'border-red-500' : 'border-yellow-500'}
        />
        <StatCard label="Cost Tier" value={tech.cost_tier || 'Not set'} />
        <StatCard label="Used by Patterns" value={patterns.length} />
      </div>

      {/* Overview */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-400 mb-2">Overview</h2>
        {tech.description ? (
          <p className="text-gray-300 leading-relaxed">{tech.description}</p>
        ) : (
          <p className="text-gray-600 italic">No overview available. Click Edit to add a description.</p>
        )}
      </div>

      {/* Links & Resources */}
      {(tech.doc_url || tech.website || tech.notes) && (
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-400 mb-3">Links & Resources</h2>
          <div className="space-y-2">
            {tech.doc_url && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-500 w-28">Documentation:</span>
                <a href={tech.doc_url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline truncate">{tech.doc_url}</a>
              </div>
            )}
            {tech.website && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-500 w-28">Website:</span>
                <a href={tech.website} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline truncate">{tech.website}</a>
              </div>
            )}
            {tech.notes && (
              <div className="flex items-start gap-2 text-sm mt-2">
                <span className="text-gray-500 w-28 flex-shrink-0">Notes:</span>
                <p className="text-gray-400 whitespace-pre-wrap">{tech.notes}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Used by Patterns */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-400 mb-3">
          Used by Patterns ({patterns.length})
        </h2>
        {patterns.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left text-xs text-gray-500 pb-2 font-medium">Type</th>
                  <th className="text-left text-xs text-gray-500 pb-2 font-medium">ID</th>
                  <th className="text-left text-xs text-gray-500 pb-2 font-medium">Name</th>
                  <th className="text-left text-xs text-gray-500 pb-2 font-medium">Category</th>
                  <th className="text-right text-xs text-gray-500 pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {patterns.map(p => (
                  <tr key={p.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="py-2">
                      <span className={`text-xs font-mono px-2 py-0.5 rounded ${
                        p.type === 'AB' ? 'badge-ab' : p.type === 'ABB' ? 'badge-abb' : 'badge-sbb'
                      }`}>{p.type}</span>
                    </td>
                    <td className="py-2">
                      <Link to={`/patterns/${p.id}`} className="text-blue-400 font-mono text-xs hover:underline">{p.id}</Link>
                    </td>
                    <td className="py-2 text-gray-300">{p.name}</td>
                    <td className="py-2 text-gray-500 text-xs">{p.category}</td>
                    <td className="py-2 text-right">
                      <span className={`text-xs ${
                        p.status === 'ACTIVE' ? 'text-green-400' :
                        p.status === 'DEPRECATED' ? 'text-red-400' : 'text-yellow-400'
                      }`}>{p.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-600 text-sm">No patterns reference this technology.</p>
        )}
      </div>
    </div>
  )
}


/* ==================== Graph Tab ==================== */

function GraphTab({ data }) {
  if (!data || (!data.nodes?.length)) {
    return <div className="text-gray-500 text-center py-12">No graph data available. This technology has no connected patterns.</div>
  }
  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-gray-400 mb-3">Technology Dependency Graph</h2>
      <p className="text-xs text-gray-500 mb-3">
        Showing patterns that use this technology and their relationships.
        {data.nodes?.length > 0 && ` ${data.nodes.length} nodes, ${data.edges?.length || 0} edges.`}
      </p>
      <GraphView data={data} height="500px" />
    </div>
  )
}


/* ==================== Impact Tab ==================== */

function ImpactTab({ data, tech }) {
  if (!data) return <div className="text-gray-500 text-center py-12">Loading impact data...</div>

  const affected = data.affected_patterns || []
  const activeAffected = affected.filter(p => p.status === 'ACTIVE')
  const isDeprecated = tech.status === 'DEPRECATED'

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Affected Patterns" value={affected.length} border="border-blue-500" />
        <StatCard label="Active Patterns Affected" value={activeAffected.length} color="text-green-400" border="border-green-500" />
        <StatCard
          label="Risk Level"
          value={isDeprecated && activeAffected.length > 0 ? 'HIGH' : activeAffected.length > 5 ? 'MEDIUM' : 'LOW'}
          color={isDeprecated && activeAffected.length > 0 ? 'text-red-400' : activeAffected.length > 5 ? 'text-yellow-400' : 'text-green-400'}
          border={isDeprecated && activeAffected.length > 0 ? 'border-red-500' : activeAffected.length > 5 ? 'border-yellow-500' : 'border-green-500'}
        />
      </div>

      {isDeprecated && activeAffected.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3">
          <p className="font-semibold text-sm mb-1">Deprecation Warning</p>
          <p className="text-sm">
            This technology is deprecated but still used by {activeAffected.length} active pattern(s).
            Consider migrating these patterns to an alternative technology.
          </p>
        </div>
      )}

      <div className="card">
        <h2 className="text-sm font-semibold text-gray-400 mb-3">Affected Patterns ({affected.length})</h2>
        {affected.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left text-xs text-gray-500 pb-2 font-medium">Type</th>
                  <th className="text-left text-xs text-gray-500 pb-2 font-medium">ID</th>
                  <th className="text-left text-xs text-gray-500 pb-2 font-medium">Name</th>
                  <th className="text-left text-xs text-gray-500 pb-2 font-medium">Category</th>
                  <th className="text-right text-xs text-gray-500 pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {affected.map(p => (
                  <tr key={p.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="py-2">
                      <span className={`text-xs font-mono px-2 py-0.5 rounded ${
                        p.type === 'AB' ? 'badge-ab' : p.type === 'ABB' ? 'badge-abb' : 'badge-sbb'
                      }`}>{p.type}</span>
                    </td>
                    <td className="py-2">
                      <Link to={`/patterns/${p.id}`} className="text-blue-400 font-mono text-xs hover:underline">{p.id}</Link>
                    </td>
                    <td className="py-2 text-gray-300">{p.name}</td>
                    <td className="py-2 text-gray-500 text-xs">{p.category}</td>
                    <td className="py-2 text-right">
                      <span className={`text-xs ${
                        p.status === 'ACTIVE' ? 'text-green-400' :
                        p.status === 'DEPRECATED' ? 'text-red-400' : 'text-yellow-400'
                      }`}>{p.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-600 text-sm">No patterns are affected by changes to this technology.</p>
        )}
      </div>
    </div>
  )
}


/* ==================== Alternatives Tab ==================== */

function AlternativesTab({ data }) {
  if (!data) return <div className="text-gray-500 text-center py-12">Loading alternatives...</div>

  const alternatives = data.alternatives || []

  if (alternatives.length === 0) {
    return (
      <div className="text-gray-500 text-center py-12">
        <p>No alternatives found.</p>
        <p className="text-sm mt-1">Alternatives are identified by same category or shared pattern usage.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        {alternatives.length} alternative technolog{alternatives.length === 1 ? 'y' : 'ies'} found
        based on category and shared pattern usage.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {alternatives.map(alt => (
            <Link
              key={alt.id}
              to={`/technologies/${alt.id}`}
              className="card hover:bg-gray-800/60 transition-colors cursor-pointer group"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <h3 className="font-semibold text-white group-hover:text-blue-400 transition-colors">{alt.name}</h3>
                  <p className="text-xs text-gray-500 font-mono">{alt.id}</p>
                </div>
                <div className="flex flex-col items-end gap-1 ml-2 flex-shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    alt.status === 'APPROVED' ? 'bg-green-500/20 text-green-400' :
                    alt.status === 'DEPRECATED' ? 'bg-red-500/20 text-red-400' :
                    'bg-yellow-500/20 text-yellow-400'
                  }`}>{alt.status}</span>
                  {alt.same_category && (
                    <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">Same category</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 mt-2 text-sm">
                <span className="text-gray-400">{alt.vendor}</span>
                {alt.category && (
                  <span className={`text-xs px-2 py-0.5 rounded ${CATEGORY_COLORS[alt.category] || 'bg-gray-500/20 text-gray-400'}`}>
                    {CATEGORY_LABELS[alt.category] || alt.category}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                {alt.cost_tier && <span>Cost: {alt.cost_tier}</span>}
                <span>Used by {alt.usage_count} pattern{alt.usage_count !== 1 ? 's' : ''}</span>
              </div>
              {alt.description && (
                <p className="text-xs text-gray-600 mt-2 truncate">{alt.description}</p>
              )}
            </Link>
          ))}
      </div>
    </div>
  )
}


/* ==================== Adoption Tab ==================== */

function AdoptionTab({ data }) {
  if (!data) return <div className="text-gray-500 text-center py-12">Loading adoption data...</div>

  const { total_patterns, by_type = {}, by_status = {}, by_category = [], by_team = [] } = data

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Total Patterns" value={total_patterns} border="border-blue-500" />
        <StatCard label="SBBs" value={by_type.SBB || 0} border="border-orange-500" />
        <StatCard label="ABBs" value={by_type.ABB || 0} border="border-sky-500" />
        <StatCard label="ABs" value={by_type.AB || 0} border="border-emerald-500" />
      </div>

      <div className="card">
        <h2 className="text-sm font-semibold text-gray-400 mb-3">By Status</h2>
        <div className="flex gap-6">
          {Object.entries(by_status).map(([status, count]) => (
            <div key={status} className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full ${
                status === 'ACTIVE' ? 'bg-green-400' :
                status === 'DEPRECATED' ? 'bg-red-400' : 'bg-yellow-400'
              }`} />
              <span className="text-sm text-gray-300">{status}</span>
              <span className="text-sm font-semibold text-white">{count}</span>
            </div>
          ))}
        </div>
        {total_patterns > 0 && (
          <div className="flex h-3 rounded-full overflow-hidden mt-3 bg-gray-800">
            {(by_status.ACTIVE || 0) > 0 && (
              <div className="bg-green-500 transition-all" style={{ width: `${(by_status.ACTIVE / total_patterns) * 100}%` }} />
            )}
            {(by_status.DRAFT || 0) > 0 && (
              <div className="bg-yellow-500 transition-all" style={{ width: `${(by_status.DRAFT / total_patterns) * 100}%` }} />
            )}
            {(by_status.DEPRECATED || 0) > 0 && (
              <div className="bg-red-500 transition-all" style={{ width: `${(by_status.DEPRECATED / total_patterns) * 100}%` }} />
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-400 mb-3">By Category</h2>
          {by_category.length > 0 ? (
            <div className="space-y-2">
              {by_category.map(({ category, count }) => (
                <div key={category} className="flex items-center justify-between">
                  <span className="text-sm text-gray-300">{category}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 rounded-full bg-gray-800 overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(count / total_patterns) * 100}%` }} />
                    </div>
                    <span className="text-sm font-mono text-gray-400 w-8 text-right">{count}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-600 text-sm">No category data available.</p>
          )}
        </div>

        <div className="card">
          <h2 className="text-sm font-semibold text-gray-400 mb-3">By Team</h2>
          {by_team.length > 0 ? (
            <div className="space-y-2">
              {by_team.map(({ team_name, count }) => (
                <div key={team_name} className="flex items-center justify-between">
                  <span className="text-sm text-gray-300">{team_name}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 rounded-full bg-gray-800 overflow-hidden">
                      <div className="h-full bg-purple-500 rounded-full" style={{ width: `${(count / total_patterns) * 100}%` }} />
                    </div>
                    <span className="text-sm font-mono text-gray-400 w-8 text-right">{count}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-600 text-sm">No team data available.</p>
          )}
        </div>
      </div>
    </div>
  )
}


/* ==================== Health Tab ==================== */

function HealthTab({ data, onAIRecommend, aiLoading, recommendations, onClearRecommendations }) {
  if (!data) return <div className="text-gray-500 text-center py-12">Loading health data...</div>

  const { health_score, score_breakdown = {}, field_completeness = {}, usage_stats = {}, documentation = {}, problems = [] } = data
  const [prompt, setPrompt] = useState('')

  const scoreColor = health_score >= 80 ? 'text-green-400' : health_score >= 60 ? 'text-yellow-400' : 'text-red-400'
  const scoreBg = health_score >= 80 ? 'bg-green-500' : health_score >= 60 ? 'bg-yellow-500' : 'bg-red-500'
  const scoreLabel = health_score >= 80 ? 'Good' : health_score >= 60 ? 'Fair' : 'Needs Work'

  return (
    <div className="space-y-6">
      {/* Score Card */}
      <div className="card flex items-center gap-6">
        <div className="flex-shrink-0 text-center">
          <div className={`text-4xl font-bold ${scoreColor}`}>{health_score}</div>
          <div className={`text-xs mt-1 px-2 py-0.5 rounded ${scoreBg}/20 ${scoreColor}`}>{scoreLabel}</div>
        </div>
        <div className="flex-1">
          <div className="h-4 rounded-full bg-gray-800 overflow-hidden">
            <div className={`h-full ${scoreBg} transition-all rounded-full`} style={{ width: `${health_score}%` }} />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Health score based on completeness ({score_breakdown.completeness?.weight}%),
            usage ({score_breakdown.usage?.weight}%),
            documentation ({score_breakdown.documentation?.weight}%),
            and problems ({score_breakdown.problems?.weight}%).
          </p>
        </div>
      </div>

      {/* Score Breakdown */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-400 mb-4">Score Breakdown</h2>
        <div className="space-y-4">
          {Object.entries(score_breakdown).map(([key, { score, weight }]) => (
            <div key={key}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-gray-300 capitalize">{key}</span>
                <span className="text-sm text-gray-400">{score}/100 ({weight}%)</span>
              </div>
              <div className="h-2.5 rounded-full bg-gray-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${score >= 80 ? 'bg-green-500' : score >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`}
                  style={{ width: `${score}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Field Completeness + Usage Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-400 mb-3">Field Completeness</h2>
          <p className="text-sm text-gray-300 mb-3">
            {field_completeness.filled}/{field_completeness.total} fields filled
          </p>
          {field_completeness.missing_fields?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {field_completeness.missing_fields.map(f => (
                <span key={f} className="text-xs px-2 py-1 rounded bg-red-500/10 text-red-400 border border-red-500/20">
                  {f}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="text-sm font-semibold text-gray-400 mb-3">Usage & Documentation</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Total patterns</span>
              <span className="text-white">{usage_stats.total_patterns}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Active patterns</span>
              <span className="text-green-400">{usage_stats.active}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Documentation URL</span>
              <span className={documentation.has_doc_url ? 'text-green-400' : 'text-red-400'}>
                {documentation.has_doc_url ? 'Yes' : 'Missing'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Website</span>
              <span className={documentation.has_website ? 'text-green-400' : 'text-red-400'}>
                {documentation.has_website ? 'Yes' : 'Missing'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Problems */}
      {problems.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-400 mb-3">Problems ({problems.length})</h2>
          <div className="space-y-2">
            {problems.map((p, i) => (
              <div key={i} className={`flex items-start gap-2 text-sm px-3 py-2 rounded ${
                p.severity === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-yellow-500/10 text-yellow-400'
              }`}>
                <span className="flex-shrink-0">{p.severity === 'error' ? '!' : '!'}</span>
                <span>{p.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Recommendations */}
      <div className="card border border-purple-500/20">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-purple-400 flex items-center gap-1.5">
            <SparkleIcon /> AI Recommendations
          </h3>
          {recommendations && recommendations.length > 0 && onClearRecommendations && (
            <button
              onClick={() => { onClearRecommendations(); setPrompt('') }}
              className="text-xs text-gray-500 hover:text-red-400 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        <div className="flex gap-2 mb-3">
          <input
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Optional: specific focus for recommendations... (e.g., 'focus on security aspects')"
            className="input flex-1 text-sm"
            onKeyDown={e => e.key === 'Enter' && onAIRecommend(prompt)}
          />
          <button
            onClick={() => onAIRecommend(prompt)}
            disabled={aiLoading}
            className="px-4 py-1.5 text-sm rounded-lg bg-purple-600/30 text-purple-300 hover:bg-purple-600/50 disabled:opacity-50 transition-colors flex items-center gap-1.5"
          >
            {aiLoading ? <Spinner text="Analyzing..." /> : (<><SparkleIcon /> Analyze</>)}
          </button>
        </div>
        {recommendations && recommendations.length > 0 ? (
          <div className="space-y-3">
            {recommendations.map((rec, i) => (
              <div key={i} className="bg-gray-800/50 rounded-lg px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    rec.priority === 'high' ? 'bg-red-500/20 text-red-400' :
                    rec.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-green-500/20 text-green-400'
                  }`}>{rec.priority}</span>
                  <span className="text-sm font-medium text-white">{rec.title}</span>
                </div>
                <p className="text-sm text-gray-400">{rec.description}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-600 text-sm">
            Click "Analyze" to get AI-powered recommendations for improving this technology entry.
          </p>
        )}
      </div>
    </div>
  )
}
