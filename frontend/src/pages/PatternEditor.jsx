import { useState, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  fetchPattern, createPattern, updatePattern,
  fetchCategories, fetchPatterns, fetchProviders,
  aiGenerate, generatePatternId,
  fetchCategoryOverview, fetchTechnologies,
} from '../api/client'

const TYPES = ['AB', 'ABB', 'SBB']

// --- Predefined Business Capabilities ---
const ALL_BUSINESS_CAPABILITIES = [
  'Intelligent Automation',
  'Customer Service Agents',
  'Process Automation',
  'Decision Support',
  'Autonomous Workflow Execution',
  'Natural Language Interaction',
  'Content Generation',
  'Text Understanding',
  'Information Extraction',
  'AI/ML Model Access',
  'Multi-Model Strategy',
  'Cost Governance and FinOps',
  'Vendor Portability',
  'Tool Integration',
  'Enterprise Connectivity',
  'API Management',
  'Agent Action Governance',
  'Semantic Search',
  'RAG (Retrieval-Augmented Generation)',
  'Knowledge Management',
  'Document Intelligence',
  'Vendor Pluggability',
  'Provider Abstraction',
  'Service-level Integration',
  'Input/Output Safety',
  'Responsible AI',
  'Compliance',
  'Content Moderation',
]


export default function PatternEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isNew = !id

  // Check for prefill from Pattern Discovery
  const prefill = {
    type: searchParams.get('prefill_type'),
    name: searchParams.get('prefill_name'),
    category: searchParams.get('prefill_category'),
    description: searchParams.get('prefill_description'),
    technologies: searchParams.get('prefill_technologies'),
    implements: searchParams.get('prefill_implements'),
  }
  const hasPrefill = !!(prefill.type || prefill.name)

  // Categories loaded from API
  const [categories, setCategories] = useState([])
  const [abbs, setAbbs] = useState([])
  const [technologies, setTechnologies] = useState([])
  const [selectedTechs, setSelectedTechs] = useState(() => {
    if (prefill.technologies) return prefill.technologies.split(',').filter(Boolean)
    return []
  })
  const [selectedCompatTechs, setSelectedCompatTechs] = useState([])
  const [allPatterns, setAllPatterns] = useState([])
  const [selectedDeps, setSelectedDeps] = useState([])
  const [providers, setProviders] = useState([])
  const [catOverview, setCatOverview] = useState(null)
  const [catOverviewLoading, setCatOverviewLoading] = useState(false)

  // AI-first workflow step: 'setup' -> 'generating' -> 'editor'
  const [step, setStep] = useState(isNew ? 'setup' : 'editor')

  // AI config
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [contextNotes, setContextNotes] = useState(() => {
    if (!hasPrefill) return ''
    const parts = []
    if (prefill.description) parts.push(prefill.description)
    if (prefill.technologies) parts.push(`Technologies: ${prefill.technologies}`)
    if (prefill.implements) parts.push(`Implements ABB: ${prefill.implements}`)
    return parts.join('\n')
  })
  const [parentAbb, setParentAbb] = useState(prefill.implements || '')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')

  // Pattern form — metadata
  const [form, setForm] = useState({
    id: '',
    name: prefill.name || '',
    type: prefill.type || 'SBB',
    category: prefill.category || 'core',
    status: 'DRAFT',
    version: '1.0.0',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [previewId, setPreviewId] = useState('')

  // --- Structured content fields ---
  const [sections, setSections] = useState({})
  const [interfaces, setInterfaces] = useState({ inbound: '', outbound: '' })
  const [interop, setInterop] = useState({ consumedBy: [], worksWith: [] })
  const [businessCaps, setBusinessCaps] = useState([])
  const [sbbMapping, setSbbMapping] = useState([])
  const [customCap, setCustomCap] = useState('')

  // Merge known + existing capabilities for the checklist
  const allCapsSet = new Set([...ALL_BUSINESS_CAPABILITIES, ...businessCaps])
  const allCapsList = [...allCapsSet].sort()

  // Load initial data
  useEffect(() => {
    fetchCategories().then(res => setCategories(res.categories || [])).catch(() => {})
    fetchPatterns({ type: 'ABB', limit: 100 }).then(res => setAbbs(res.patterns || [])).catch(() => {})
    fetchPatterns({ limit: 500 }).then(res => setAllPatterns(res.patterns || [])).catch(() => {})
    fetchTechnologies().then(res => setTechnologies(res.technologies || [])).catch(() => {})
    fetchProviders().then(res => {
      setProviders(res.providers || [])
      const def = res.providers?.find(p => p.is_default)
      if (def) {
        setProvider(def.name)
        setModel(def.default_model)
      }
    }).catch(() => {})
  }, [])

  // Load existing pattern for editing — read structured fields directly
  useEffect(() => {
    if (id) {
      fetchPattern(id).then(p => {
        setForm({
          id: p.id,
          name: p.name,
          type: p.type,
          category: p.category,
          status: p.status,
          version: p.version,
        })

        // Populate structured content fields directly from API response
        setSections({
          // AB fields
          'Intent': p.intent || '',
          'Problem': p.problem || '',
          'Solution': p.solution || '',
          'Structural Elements': p.structural_elements || '',
          'Invariants': p.invariants || '',
          'Inter-Element Contracts': p.inter_element_contracts || '',
          'Related Patterns': p.related_patterns_text || '',
          'Related ADRs': p.related_adrs || '',
          'Note on Building Blocks': p.building_blocks_note || '',
          // ABB
          'Functionality': p.functionality || '',
          // SBB
          'Specific Functionality': p.specific_functionality || '',
        })

        setInterfaces({
          inbound: p.inbound_interfaces || '',
          outbound: p.outbound_interfaces || '',
        })

        setInterop({
          consumedBy: p.consumed_by_ids || [],
          worksWith: p.works_with_ids || [],
        })

        setBusinessCaps(p.business_capabilities || [])
        setSbbMapping(p.sbb_mapping || [])

        // Populate relationships from existing pattern
        if (p.relationships) {
          const implRel = p.relationships.find(r => r.type === 'IMPLEMENTS' && r.target_label === 'Pattern')
          if (implRel) setParentAbb(implRel.target_id)
          const usesRels = p.relationships.filter(r => r.type === 'USES' && r.target_label === 'Technology')
          if (usesRels.length > 0) setSelectedTechs(usesRels.map(r => r.target_id))
          const compatRels = p.relationships.filter(r => r.type === 'COMPATIBLE_WITH' && r.target_label === 'Technology')
          if (compatRels.length > 0) setSelectedCompatTechs(compatRels.map(r => r.target_id))
          const depRels = p.relationships.filter(r => r.type === 'DEPENDS_ON' && r.target_label === 'Pattern')
          if (depRels.length > 0) setSelectedDeps(depRels.map(r => r.target_id))
        }
        setStep('editor')
      }).catch(() => setError('Pattern not found'))
    }
  }, [id])

  // Preview auto-generated ID when type/category change
  useEffect(() => {
    if (isNew && form.type && form.category) {
      generatePatternId(form.type, form.category)
        .then(res => setPreviewId(res.id))
        .catch(() => setPreviewId(''))
    }
  }, [form.type, form.category, isNew])

  // Load category overview when category changes
  useEffect(() => {
    if (form.category) {
      setCatOverviewLoading(true)
      fetchCategoryOverview(form.category)
        .then(data => { setCatOverview(data); setCatOverviewLoading(false) })
        .catch(() => { setCatOverview(null); setCatOverviewLoading(false) })
    }
  }, [form.category])

  const handleAIGenerate = async () => {
    setAiLoading(true)
    setAiError('')
    try {
      const res = await aiGenerate({
        template_type: form.type,
        parent_abb_id: parentAbb || null,
        context_notes: contextNotes,
        provider: provider || null,
        model: model || null,
      })

      // res.content is now a structured JSON object
      const generated = res.content || {}

      if (generated.name) setForm(f => ({ ...f, name: generated.name }))

      // Populate sections from structured fields
      setSections(prev => ({
        ...prev,
        'Intent': generated.intent || prev['Intent'] || '',
        'Problem': generated.problem || prev['Problem'] || '',
        'Solution': generated.solution || prev['Solution'] || '',
        'Structural Elements': generated.structural_elements || prev['Structural Elements'] || '',
        'Invariants': generated.invariants || prev['Invariants'] || '',
        'Inter-Element Contracts': generated.inter_element_contracts || prev['Inter-Element Contracts'] || '',
        'Related Patterns': generated.related_patterns_text || prev['Related Patterns'] || '',
        'Related ADRs': generated.related_adrs || prev['Related ADRs'] || '',
        'Note on Building Blocks': generated.building_blocks_note || prev['Note on Building Blocks'] || '',
        'Functionality': generated.functionality || prev['Functionality'] || '',
        'Specific Functionality': generated.specific_functionality || prev['Specific Functionality'] || '',
      }))

      setInterfaces({
        inbound: generated.inbound_interfaces || '',
        outbound: generated.outbound_interfaces || '',
      })

      if (generated.business_capabilities?.length > 0) {
        setBusinessCaps(generated.business_capabilities)
      }
      if (generated.sbb_mapping?.length > 0) {
        setSbbMapping(generated.sbb_mapping)
      }
      if (generated.consumed_by_ids?.length > 0) {
        setInterop(prev => ({ ...prev, consumedBy: generated.consumed_by_ids }))
      }
      if (generated.works_with_ids?.length > 0) {
        setInterop(prev => ({ ...prev, worksWith: generated.works_with_ids }))
      }

      setStep('editor')
    } catch (err) {
      setAiError(err.message)
    }
    setAiLoading(false)
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      // Build structured payload — no markdown reconstruction!
      const payload = {
        ...form,
        // AB fields
        intent: sections['Intent'] || null,
        problem: sections['Problem'] || null,
        solution: sections['Solution'] || null,
        structural_elements: sections['Structural Elements'] || null,
        invariants: sections['Invariants'] || null,
        inter_element_contracts: sections['Inter-Element Contracts'] || null,
        related_patterns_text: sections['Related Patterns'] || null,
        related_adrs: sections['Related ADRs'] || null,
        building_blocks_note: sections['Note on Building Blocks'] || null,
        // ABB fields
        functionality: sections['Functionality'] || null,
        // SBB fields
        specific_functionality: sections['Specific Functionality'] || null,
        // Shared fields
        inbound_interfaces: interfaces.inbound || null,
        outbound_interfaces: interfaces.outbound || null,
        consumed_by_ids: interop.consumedBy,
        works_with_ids: interop.worksWith,
        business_capabilities: businessCaps,
        sbb_mapping: sbbMapping,
      }

      if (isNew) {
        if (!payload.id) delete payload.id
        if (parentAbb) payload.implements_abb = parentAbb
        if (selectedTechs.length > 0) payload.technology_ids = selectedTechs
        if (selectedCompatTechs.length > 0) payload.compatible_tech_ids = selectedCompatTechs
        if (selectedDeps.length > 0) payload.depends_on_ids = selectedDeps
        const created = await createPattern(payload)
        navigate(`/patterns/${created.id}`, { state: { _refresh: Date.now() } })
      } else {
        const { id: _, ...updateData } = payload
        if (parentAbb) updateData.implements_abb = parentAbb
        updateData.technology_ids = selectedTechs
        updateData.compatible_tech_ids = selectedCompatTechs
        updateData.depends_on_ids = selectedDeps
        await updatePattern(id, updateData, 'none')
        navigate(`/patterns/${id}`, { state: { _refresh: Date.now() } })
      }
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  const setField = (key, value) => setForm(f => ({ ...f, [key]: value }))
  const setSection = (name, value) => setSections(s => ({ ...s, [name]: value }))

  const currentProvider = providers.find(p => p.name === provider)

  // --- Category Overview Panel ---
  const CategoryOverviewPanel = () => {
    if (catOverviewLoading) {
      return <div className="text-xs text-gray-600 mt-2">Loading category overview...</div>
    }
    if (!catOverview) return null

    return (
      <div className="bg-gray-800/50 rounded-lg p-3 mt-2 border border-gray-700/50">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-400">{catOverview.label} Overview</span>
          <div className="flex gap-3 text-xs text-gray-500">
            <span>{catOverview.abb_count} ABBs</span>
            <span>{catOverview.sbb_count} SBBs</span>
          </div>
        </div>
        {catOverview.abbs && catOverview.abbs.length > 0 ? (
          <div className="space-y-1.5">
            {catOverview.abbs.map(abb => (
              <div key={abb.id} className="text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-blue-400 font-mono">{abb.id}</span>
                  <span className="text-gray-300">{abb.name}</span>
                  <span className="text-gray-600 ml-auto">{abb.sbb_count} SBBs</span>
                </div>
                {abb.sbbs && abb.sbbs.length > 0 && (
                  <div className="ml-4 mt-0.5 space-y-0.5">
                    {abb.sbbs.slice(0, 3).map(sbb => (
                      <div key={sbb.id} className="flex items-center gap-2 text-gray-500">
                        <span className="text-gray-600">{'\u2514'}</span>
                        <span className="font-mono">{sbb.id}</span>
                        <span>{sbb.name}</span>
                        <span className={`ml-auto ${
                          sbb.status === 'ACTIVE' ? 'text-green-500' : 'text-yellow-500'
                        }`}>{sbb.status}</span>
                      </div>
                    ))}
                    {abb.sbbs.length > 3 && (
                      <div className="text-gray-600 ml-4">+{abb.sbbs.length - 3} more</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-600">No patterns in this category yet</p>
        )}
      </div>
    )
  }

  // --- Multi-Select Pattern Picker (reusable) ---
  const PatternPicker = ({ label, selected, onChange, excludeId, filterTypes }) => {
    const filtered = allPatterns.filter(p => {
      if (p.id === excludeId) return false
      if (filterTypes && filterTypes.length > 0) {
        return filterTypes.some(ft => p.id.startsWith(ft + '-'))
      }
      return true
    })
    return (
      <div>
        <label className="block text-xs text-gray-500 mb-1">{label}</label>
        <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-2 max-h-36 overflow-y-auto space-y-1">
          {allPatterns.length === 0 && <p className="text-xs text-gray-600">Loading...</p>}
          {filtered.map(p => (
            <label key={p.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-700/30 rounded px-1 py-0.5">
              <input
                type="checkbox"
                checked={selected.includes(p.id)}
                onChange={e => {
                  if (e.target.checked) onChange([...selected, p.id])
                  else onChange(selected.filter(x => x !== p.id))
                }}
                className="rounded border-gray-600"
              />
              <span className={`font-mono ${
                p.type === 'AB' ? 'text-orange-400' : p.type === 'ABB' ? 'text-blue-400' : 'text-green-400'
              }`}>{p.id}</span>
              <span className="text-gray-300">{p.name}</span>
              <span className="text-gray-600 ml-auto">{p.type}</span>
            </label>
          ))}
        </div>
        {selected.length > 0 && (
          <p className="text-xs text-gray-500 mt-1">{selected.length} selected</p>
        )}
      </div>
    )
  }

  // --- Multi-Select Technology Picker ---
  const TechPicker = ({ label, selected, onChange }) => (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-2 max-h-36 overflow-y-auto space-y-1">
        {technologies.length === 0 && <p className="text-xs text-gray-600">Loading...</p>}
        {technologies.map(t => (
          <label key={t.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-700/30 rounded px-1 py-0.5">
            <input
              type="checkbox"
              checked={selected.includes(t.id)}
              onChange={e => {
                if (e.target.checked) onChange([...selected, t.id])
                else onChange(selected.filter(x => x !== t.id))
              }}
              className="rounded border-gray-600"
            />
            <span className="text-cyan-400 font-mono">{t.id}</span>
            <span className="text-gray-300">{t.name}</span>
            <span className="text-gray-600 ml-auto">{t.vendor}</span>
          </label>
        ))}
      </div>
      {selected.length > 0 && (
        <p className="text-xs text-gray-500 mt-1">{selected.length} selected</p>
      )}
    </div>
  )

  // --- SETUP STEP: AI-first new pattern creation ---
  if (step === 'setup' && isNew) {
    return (
      <div className="space-y-6 max-w-3xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold text-white">Create New Pattern</h1>
          <p className="text-gray-500 text-sm mt-1">AI will generate a draft based on your specifications</p>
        </div>

        {/* Step 1: Pattern Type & Category */}
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-gray-400">1. Pattern Type & Category</h2>
          <div className="grid grid-cols-3 gap-4">
            {TYPES.map(t => (
              <button
                key={t}
                onClick={() => setField('type', t)}
                className={`p-4 rounded-lg border text-center transition-colors ${
                  form.type === t
                    ? t === 'AB' ? 'bg-orange-600/20 border-orange-500/50 text-orange-400'
                    : t === 'ABB' ? 'bg-blue-600/20 border-blue-500/50 text-blue-400'
                    : 'bg-green-600/20 border-green-500/50 text-green-400'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                }`}
              >
                <div className="text-lg font-bold">{t}</div>
                <div className="text-xs mt-1">
                  {t === 'AB' ? 'Architecture Blueprint' : t === 'ABB' ? 'Architecture Building Block' : 'Solution Building Block'}
                </div>
              </button>
            ))}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Category</label>
            <select
              value={form.category}
              onChange={e => setField('category', e.target.value)}
              className="select w-full"
            >
              {categories.map(c => (
                <option key={c.code} value={c.code}>{c.label} ({c.code})</option>
              ))}
            </select>
          </div>
          {previewId && (
            <div className="text-sm text-gray-500">
              Auto-generated ID: <span className="font-mono text-blue-400">{previewId}</span>
            </div>
          )}
          <CategoryOverviewPanel />
        </div>

        {/* Step 2: Context for AI */}
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-gray-400">2. AI Generation Context</h2>
          {form.type === 'SBB' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Parent ABB (for SBBs)</label>
              <select value={parentAbb} onChange={e => setParentAbb(e.target.value)} className="select w-full">
                <option value="">None</option>
                {abbs.map(a => <option key={a.id} value={a.id}>{a.id} - {a.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Context Notes</label>
            <textarea
              value={contextNotes}
              onChange={e => setContextNotes(e.target.value)}
              placeholder="Describe what this pattern should cover, any specific technologies or requirements..."
              className="input w-full h-28 resize-none"
            />
          </div>
        </div>

        {/* Step 3: LLM Provider */}
        <div className="card space-y-3">
          <h2 className="text-sm font-semibold text-gray-400">3. LLM Provider</h2>
          <div className="flex gap-2 items-center flex-wrap">
            {providers.map(p => (
              <button
                key={p.name}
                onClick={() => { setProvider(p.name); setModel(p.default_model) }}
                className={`px-4 py-2 rounded-lg text-sm border transition-colors ${
                  provider === p.name
                    ? 'bg-blue-600/20 border-blue-500/50 text-blue-400'
                    : p.available
                      ? 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'
                      : 'bg-gray-800/50 border-gray-800 text-gray-600 cursor-not-allowed'
                }`}
                disabled={!p.available}
              >
                {p.name}
                {p.is_default && <span className="text-xs ml-1 text-gray-500">(default)</span>}
              </button>
            ))}
            <input
              type="text"
              value={model}
              onChange={e => setModel(e.target.value)}
              placeholder="Model name"
              className="input w-48 ml-auto"
            />
          </div>
        </div>

        {/* Actions */}
        {aiError && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 text-sm">{aiError}</div>
        )}

        <div className="flex gap-3">
          <button
            onClick={handleAIGenerate}
            disabled={aiLoading}
            className="btn-primary flex-1 py-3 text-base"
          >
            {aiLoading ? 'Generating with AI...' : 'Generate Pattern with AI'}
          </button>
          <button
            onClick={() => setStep('editor')}
            className="btn-secondary py-3"
          >
            Skip AI, Write Manually
          </button>
        </div>
      </div>
    )
  }

  // --- EDITOR STEP ---
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">
          {isNew ? 'New Pattern' : `Edit ${id}`}
        </h1>
        <div className="flex gap-2">
          {isNew && (
            <button onClick={() => setStep('setup')} className="btn-secondary text-sm">
              Back to AI Setup
            </button>
          )}
          <button onClick={() => navigate(-1)} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? 'Saving...' : 'Save Pattern'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}
      {aiError && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 text-sm">{aiError}</div>
      )}

      {/* Metadata */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-400 mb-4">Metadata</h2>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Pattern ID</label>
            <input
              type="text"
              value={form.id || ''}
              onChange={e => setField('id', e.target.value)}
              disabled={!isNew}
              placeholder={previewId ? `Auto: ${previewId}` : 'Auto-generated'}
              className="input w-full"
            />
            {isNew && previewId && !form.id && (
              <p className="text-xs text-gray-600 mt-1">Will be: <span className="text-blue-400 font-mono">{previewId}</span></p>
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setField('name', e.target.value)}
              placeholder="Pattern name"
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Version</label>
            <input
              type="text"
              value={form.version}
              onChange={e => setField('version', e.target.value)}
              placeholder="1.0.0"
              className="input w-full font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Type</label>
            <select value={form.type} onChange={e => setField('type', e.target.value)} className="select w-full">
              {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Category</label>
            <select value={form.category} onChange={e => setField('category', e.target.value)} className="select w-full">
              {categories.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
              {form.category && !categories.find(c => c.code === form.category) && (
                <option value={form.category}>{form.category}</option>
              )}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Status</label>
            <select value={form.status} onChange={e => setField('status', e.target.value)} className="select w-full">
              {['DRAFT', 'ACTIVE', 'DEPRECATED'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* Relationships: Parent ABB (SBB only) */}
        {form.type === 'SBB' && (
          <div className="mt-4 pt-4 border-t border-gray-700/50">
            <h3 className="text-xs font-semibold text-gray-500 mb-3">Relationships</h3>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Implements ABB <span className="text-red-400">*</span>
              </label>
              <select value={parentAbb} onChange={e => setParentAbb(e.target.value)} className="select w-full">
                <option value="">{'\u2014'} Select Parent ABB {'\u2014'}</option>
                {abbs.map(a => <option key={a.id} value={a.id}>{a.id} {'\u2014'} {a.name}</option>)}
              </select>
              {!parentAbb && (
                <p className="text-xs text-orange-400 mt-1">Every SBB should implement an ABB</p>
              )}
            </div>
          </div>
        )}

        <CategoryOverviewPanel />
      </div>

      {/* ===== SECTION-BASED CONTENT EDITING ===== */}

      {/* --- AB Sections (all free-text) --- */}
      {form.type === 'AB' && (
        <>
          {['Intent', 'Problem', 'Solution', 'Structural Elements', 'Invariants',
            'Inter-Element Contracts', 'Related Patterns', 'Related ADRs', 'Note on Building Blocks'
          ].map(name => (
            <div key={name} className="card">
              <h2 className="text-sm font-semibold text-gray-400 mb-3">{name}</h2>
              <textarea
                value={sections[name] || ''}
                onChange={e => setSection(name, e.target.value)}
                placeholder={`Enter ${name.toLowerCase()} content...`}
                className="input w-full font-mono text-sm resize-y"
                rows={name === 'Structural Elements' || name === 'Inter-Element Contracts' ? 12 : 6}
              />
            </div>
          ))}
        </>
      )}

      {/* --- ABB Sections --- */}
      {form.type === 'ABB' && (
        <>
          {/* Functionality — free text */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">Functionality</h2>
            <textarea
              value={sections['Functionality'] || ''}
              onChange={e => setSection('Functionality', e.target.value)}
              placeholder="Describe the functionality of this building block..."
              className="input w-full font-mono text-sm resize-y"
              rows={10}
            />
          </div>

          {/* Interfaces — structured (inbound/outbound) */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">Interfaces</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Inbound</label>
                <textarea
                  value={interfaces.inbound}
                  onChange={e => setInterfaces(prev => ({ ...prev, inbound: e.target.value }))}
                  placeholder="Describe inbound interfaces..."
                  className="input w-full text-sm resize-y"
                  rows={2}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Outbound</label>
                <textarea
                  value={interfaces.outbound}
                  onChange={e => setInterfaces(prev => ({ ...prev, outbound: e.target.value }))}
                  placeholder="Describe outbound interfaces..."
                  className="input w-full text-sm resize-y"
                  rows={2}
                />
              </div>
            </div>
          </div>

          {/* Interoperability — multi-select */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">Interoperability</h2>
            <div className="grid grid-cols-2 gap-4">
              <PatternPicker
                label="Consumed by"
                selected={interop.consumedBy}
                onChange={ids => setInterop(prev => ({ ...prev, consumedBy: ids }))}
                excludeId={form.id}
                filterTypes={['ABB', 'SBB']}
              />
              <PatternPicker
                label="Works with"
                selected={interop.worksWith}
                onChange={ids => setInterop(prev => ({ ...prev, worksWith: ids }))}
                excludeId={form.id}
                filterTypes={['ABB', 'SBB']}
              />
            </div>
          </div>

          {/* Depending Technology — core dependency, multi-select */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">Depending Technology</h2>
            <p className="text-xs text-gray-600 mb-2">Core technology dependencies required for this building block</p>
            <TechPicker
              label="Core Dependencies"
              selected={selectedTechs}
              onChange={setSelectedTechs}
            />
          </div>

          {/* Compatible Technologies — optional, multi-select */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">Compatible Technologies</h2>
            <p className="text-xs text-gray-600 mb-2">Technologies this building block can work with or integrate into</p>
            <TechPicker
              label="Compatible With"
              selected={selectedCompatTechs}
              onChange={setSelectedCompatTechs}
            />
          </div>

          {/* Dependent Building Blocks — multi-select (ABB/SBB only) */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">Dependent Building Blocks</h2>
            <PatternPicker
              label="Depends On"
              selected={selectedDeps}
              onChange={setSelectedDeps}
              excludeId={form.id}
              filterTypes={['ABB', 'SBB']}
            />
          </div>

          {/* Business Capabilities — multi-select */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">Business Capabilities</h2>
            <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-2 max-h-48 overflow-y-auto space-y-1">
              {allCapsList.map(cap => (
                <label key={cap} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-700/30 rounded px-1 py-0.5">
                  <input
                    type="checkbox"
                    checked={businessCaps.includes(cap)}
                    onChange={e => {
                      if (e.target.checked) setBusinessCaps(prev => [...prev, cap])
                      else setBusinessCaps(prev => prev.filter(x => x !== cap))
                    }}
                    className="rounded border-gray-600"
                  />
                  <span className="text-gray-300">{cap}</span>
                </label>
              ))}
            </div>
            {/* Add custom capability */}
            <div className="flex gap-2 mt-2">
              <input
                type="text"
                value={customCap}
                onChange={e => setCustomCap(e.target.value)}
                placeholder="Add custom capability..."
                className="input flex-1 text-sm"
                onKeyDown={e => {
                  if (e.key === 'Enter' && customCap.trim()) {
                    e.preventDefault()
                    if (!businessCaps.includes(customCap.trim())) {
                      setBusinessCaps(prev => [...prev, customCap.trim()])
                    }
                    setCustomCap('')
                  }
                }}
              />
              <button
                onClick={() => {
                  if (customCap.trim() && !businessCaps.includes(customCap.trim())) {
                    setBusinessCaps(prev => [...prev, customCap.trim()])
                  }
                  setCustomCap('')
                }}
                disabled={!customCap.trim()}
                className="btn-secondary text-xs"
              >
                Add
              </button>
            </div>
            {businessCaps.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">{businessCaps.length} selected</p>
            )}
          </div>
        </>
      )}

      {/* --- SBB Sections --- */}
      {form.type === 'SBB' && (
        <>
          {/* Specific Functionality — free text */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">Specific Functionality</h2>
            <textarea
              value={sections['Specific Functionality'] || ''}
              onChange={e => setSection('Specific Functionality', e.target.value)}
              placeholder="Describe the specific functionality of this solution building block..."
              className="input w-full font-mono text-sm resize-y"
              rows={10}
            />
          </div>

          {/* Interfaces — structured */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">Interfaces</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Inbound</label>
                <textarea
                  value={interfaces.inbound}
                  onChange={e => setInterfaces(prev => ({ ...prev, inbound: e.target.value }))}
                  placeholder="Describe inbound interfaces..."
                  className="input w-full text-sm resize-y"
                  rows={2}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Outbound</label>
                <textarea
                  value={interfaces.outbound}
                  onChange={e => setInterfaces(prev => ({ ...prev, outbound: e.target.value }))}
                  placeholder="Describe outbound interfaces..."
                  className="input w-full text-sm resize-y"
                  rows={2}
                />
              </div>
            </div>
          </div>

          {/* Interoperability — multi-select */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">Interoperability</h2>
            <div className="grid grid-cols-2 gap-4">
              <PatternPicker
                label="Consumed by"
                selected={interop.consumedBy}
                onChange={ids => setInterop(prev => ({ ...prev, consumedBy: ids }))}
                excludeId={form.id}
                filterTypes={['ABB', 'SBB']}
              />
              <PatternPicker
                label="Works with"
                selected={interop.worksWith}
                onChange={ids => setInterop(prev => ({ ...prev, worksWith: ids }))}
                excludeId={form.id}
                filterTypes={['ABB', 'SBB']}
              />
            </div>
          </div>

          {/* Depending Technology — core dependency, multi-select */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">Depending Technology</h2>
            <p className="text-xs text-gray-600 mb-2">Core technology dependencies required for this building block</p>
            <TechPicker
              label="Core Dependencies"
              selected={selectedTechs}
              onChange={setSelectedTechs}
            />
          </div>

          {/* Compatible Technologies — optional, multi-select */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">Compatible Technologies</h2>
            <p className="text-xs text-gray-600 mb-2">Technologies this building block can work with or integrate into</p>
            <TechPicker
              label="Compatible With"
              selected={selectedCompatTechs}
              onChange={setSelectedCompatTechs}
            />
          </div>

          {/* Dependent Building Blocks — multi-select (ABB/SBB only) */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">Dependent Building Blocks</h2>
            <PatternPicker
              label="Depends On"
              selected={selectedDeps}
              onChange={setSelectedDeps}
              excludeId={form.id}
              filterTypes={['ABB', 'SBB']}
            />
          </div>

          {/* SBB Mapping — key-value pairs */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">SBB Mapping</h2>
            <div className="space-y-2">
              {sbbMapping.map((item, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={item.key}
                    onChange={e => {
                      const updated = [...sbbMapping]
                      updated[i] = { ...item, key: e.target.value }
                      setSbbMapping(updated)
                    }}
                    placeholder="Key (e.g. Runtime)"
                    className="input w-36 text-sm"
                  />
                  <span className="text-gray-600">:</span>
                  <input
                    type="text"
                    value={item.value}
                    onChange={e => {
                      const updated = [...sbbMapping]
                      updated[i] = { ...item, value: e.target.value }
                      setSbbMapping(updated)
                    }}
                    placeholder="Value"
                    className="input flex-1 text-sm"
                  />
                  <button
                    onClick={() => setSbbMapping(sbbMapping.filter((_, j) => j !== i))}
                    className="text-red-400 hover:text-red-300 text-xs px-2 py-1"
                    title="Remove"
                  >
                    {'\u2715'}
                  </button>
                </div>
              ))}
              <button
                onClick={() => setSbbMapping([...sbbMapping, { key: '', value: '' }])}
                className="btn-secondary text-xs"
              >
                + Add Mapping
              </button>
            </div>
          </div>
        </>
      )}

    </div>
  )
}
