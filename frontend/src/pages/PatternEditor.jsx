import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  fetchPattern, createPattern, updatePattern,
  fetchCategories, fetchPatterns, fetchProviders,
  aiGenerate, generatePatternId,
  fetchCategoryOverview, fetchTechnologies,
  uploadPatternImage, deletePatternImage, getUploadUrl,
  aiSmartAction, fetchTeams,
} from '../api/client'
import AIFieldAssist from '../components/AIFieldAssist'
import { useAuth } from '../contexts/AuthContext'

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
  const { canCreatePattern, canEditPattern, isAdmin } = useAuth()
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
  const [teams, setTeams] = useState([])
  const [originalTeamId, setOriginalTeamId] = useState(null)
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
  const [parentAbbs, setParentAbbs] = useState(() => {
    if (prefill.implements) return [prefill.implements]
    return []
  })
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
    team_id: '',
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

  // --- New metadata fields ---
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState([])
  const [tagInput, setTagInput] = useState('')
  const [deprecationNote, setDeprecationNote] = useState('')
  // ABB-specific
  const [qualityAttributes, setQualityAttributes] = useState('')
  const [complianceRequirements, setComplianceRequirements] = useState('')
  // SBB-specific
  const [vendor, setVendor] = useState('')
  const [deploymentModel, setDeploymentModel] = useState('')
  const [costTier, setCostTier] = useState('')
  const [licensing, setLicensing] = useState('')
  const [maturity, setMaturity] = useState('')
  // Diagrams & Images
  const [diagrams, setDiagrams] = useState([])
  const [existingImages, setExistingImages] = useState([])
  const [uploadingImage, setUploadingImage] = useState(false)

  // Merge known + existing capabilities for the checklist
  const allCapsSet = new Set([...ALL_BUSINESS_CAPABILITIES, ...businessCaps])
  const allCapsList = [...allCapsSet].sort()

  // Load initial data
  useEffect(() => {
    fetchCategories().then(res => setCategories(res.categories || [])).catch(() => {})
    fetchPatterns({ type: 'ABB', limit: 100 }).then(res => setAbbs(res.patterns || [])).catch(() => {})
    fetchPatterns({ limit: 500 }).then(res => setAllPatterns(res.patterns || [])).catch(() => {})
    fetchTechnologies().then(res => setTechnologies(res.technologies || [])).catch(() => {})
    if (isAdmin) fetchTeams().then(setTeams).catch(() => {})
    fetchProviders().then(res => {
      setProviders(res.providers || [])
      const def = res.providers?.find(p => p.is_default)
      if (def) {
        setProvider(def.name)
        setModel(def.default_model)
      }
    }).catch(() => {})
  }, [])

  // Permission check: redirect if user can't create/edit
  useEffect(() => {
    if (isNew && !canCreatePattern) {
      navigate('/patterns', { replace: true })
    }
  }, [isNew, canCreatePattern, navigate])

  // Load existing pattern for editing — read structured fields directly
  useEffect(() => {
    if (id) {
      fetchPattern(id).then(p => {
        // Check edit permission once pattern is loaded
        if (!canEditPattern(p)) {
          navigate(`/patterns/${id}`, { replace: true })
          return
        }
        setForm({
          id: p.id,
          name: p.name,
          type: p.type,
          category: p.category,
          status: p.status,
          version: p.version,
          team_id: p.team_id || '',
        })
        setOriginalTeamId(p.team_id || '')

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
          // All types
          'Restrictions': p.restrictions || '',
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

        // New metadata fields
        setDescription(p.description || '')
        setTags(p.tags || [])
        setDeprecationNote(p.deprecation_note || '')
        setQualityAttributes(p.quality_attributes || '')
        setComplianceRequirements(p.compliance_requirements || '')
        setVendor(p.vendor || '')
        setDeploymentModel(p.deployment_model || '')
        setCostTier(p.cost_tier || '')
        setLicensing(p.licensing || '')
        setMaturity(p.maturity || '')
        setDiagrams(p.diagrams || [])
        setExistingImages(p.images || [])

        // Populate relationships from existing pattern
        if (p.relationships) {
          const implRels = p.relationships.filter(r => r.type === 'IMPLEMENTS' && r.target_label === 'Pattern')
          if (implRels.length > 0) setParentAbbs(implRels.map(r => r.target_id))
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
        parent_abb_id: parentAbbs.length > 0 ? parentAbbs[0] : null,
        context_notes: contextNotes + (parentAbbs.length > 1 ? `\nAlso implements ABBs: ${parentAbbs.slice(1).join(', ')}` : ''),
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
        'Restrictions': generated.restrictions || prev['Restrictions'] || '',
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
        restrictions: sections['Restrictions'] || null,
        // New metadata fields
        description: description || null,
        tags: tags,
        deprecation_note: deprecationNote || null,
        quality_attributes: qualityAttributes || null,
        compliance_requirements: complianceRequirements || null,
        vendor: vendor || null,
        deployment_model: deploymentModel || null,
        cost_tier: costTier || null,
        licensing: licensing || null,
        maturity: maturity || null,
        diagrams: diagrams,
      }

      if (isNew) {
        if (!payload.id) delete payload.id
        if (parentAbbs.length > 0) payload.implements_abbs = parentAbbs
        if (selectedTechs.length > 0) payload.technology_ids = selectedTechs
        if (selectedCompatTechs.length > 0) payload.compatible_tech_ids = selectedCompatTechs
        if (selectedDeps.length > 0) payload.depends_on_ids = selectedDeps
        // Admin can assign team on create via query param
        const teamIdForCreate = isAdmin && form.team_id ? form.team_id : null
        const created = await createPattern(payload, teamIdForCreate)
        navigate(`/patterns/${created.id}`, { state: { _refresh: Date.now() } })
      } else {
        const { id: _, team_id: _tid, ...updateData } = payload
        updateData.implements_abbs = parentAbbs
        updateData.technology_ids = selectedTechs
        updateData.compatible_tech_ids = selectedCompatTechs
        updateData.depends_on_ids = selectedDeps
        // Pass team_id only if admin changed it
        const teamChanged = isAdmin && form.team_id !== originalTeamId
        const teamIdParam = teamChanged ? (form.team_id || '') : null
        await updatePattern(id, updateData, 'none', teamIdParam)
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

  // Section display name → API field name mapping
  const SECTION_FIELD_MAP = {
    'Intent': 'intent',
    'Problem': 'problem',
    'Solution': 'solution',
    'Structural Elements': 'structural_elements',
    'Invariants': 'invariants',
    'Inter-Element Contracts': 'inter_element_contracts',
    'Related Patterns': 'related_patterns_text',
    'Related ADRs': 'related_adrs',
    'Note on Building Blocks': 'building_blocks_note',
    'Functionality': 'functionality',
    'Specific Functionality': 'specific_functionality',
    'Restrictions': 'restrictions',
  }

  // Build full pattern context for AI calls
  const buildPatternContext = useCallback(() => ({
    name: form.name,
    type: form.type,
    category: form.category,
    status: form.status,
    version: form.version,
    // Map sections back to field names
    ...Object.fromEntries(
      Object.entries(sections).map(([name, val]) => [SECTION_FIELD_MAP[name] || name, val])
    ),
    inbound_interfaces: interfaces.inbound,
    outbound_interfaces: interfaces.outbound,
    description: description,
    tags: tags,
    deprecation_note: deprecationNote,
    quality_attributes: qualityAttributes,
    compliance_requirements: complianceRequirements,
    vendor: vendor,
    deployment_model: deploymentModel,
    cost_tier: costTier,
    licensing: licensing,
    maturity: maturity,
    business_capabilities: businessCaps,
    sbb_mapping: sbbMapping,
    consumed_by_ids: interop.consumedBy,
    works_with_ids: interop.worksWith,
  }), [form, sections, interfaces, description, tags, deprecationNote,
       qualityAttributes, complianceRequirements, vendor, deploymentModel,
       costTier, licensing, maturity, businessCaps, sbbMapping, interop])

  // --- Smart Actions state ---
  const [smartLoading, setSmartLoading] = useState(null) // action name or null
  const [smartResult, setSmartResult] = useState(null) // { action, data }
  const [smartError, setSmartError] = useState('')

  const handleSmartAction = async (action) => {
    setSmartLoading(action)
    setSmartError('')
    setSmartResult(null)
    try {
      const res = await aiSmartAction({
        action,
        pattern_context: buildPatternContext(),
        pattern_type: form.type,
        pattern_id: id || null,
        provider: provider || null,
        model: model || null,
      })
      setSmartResult({ action, data: res.result })
    } catch (err) {
      setSmartError(err.message)
    }
    setSmartLoading(null)
  }

  // Apply smart action results
  const applyAutoTags = (newTags) => {
    const merged = [...new Set([...tags, ...newTags])]
    setTags(merged)
    setSmartResult(null)
  }

  const applyDescription = (desc) => {
    setDescription(desc)
    setSmartResult(null)
  }

  const applyAutoFill = (fieldMap) => {
    // fieldMap is { field_name: content }
    const sectionFieldReverse = Object.fromEntries(
      Object.entries(SECTION_FIELD_MAP).map(([k, v]) => [v, k])
    )
    for (const [field, content] of Object.entries(fieldMap)) {
      if (sectionFieldReverse[field]) {
        setSection(sectionFieldReverse[field], content)
      } else if (field === 'description') setDescription(content)
      else if (field === 'inbound_interfaces') setInterfaces(prev => ({ ...prev, inbound: content }))
      else if (field === 'outbound_interfaces') setInterfaces(prev => ({ ...prev, outbound: content }))
      else if (field === 'quality_attributes') setQualityAttributes(content)
      else if (field === 'compliance_requirements') setComplianceRequirements(content)
      else if (field === 'deprecation_note') setDeprecationNote(content)
    }
    setSmartResult(null)
  }

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
              <label className="block text-xs text-gray-500 mb-1">Implements ABBs (one SBB can realize multiple ABBs)</label>
              <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-2 max-h-36 overflow-y-auto space-y-1">
                {abbs.length === 0 && <p className="text-xs text-gray-600">Loading ABBs...</p>}
                {abbs.map(a => (
                  <label key={a.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-700/30 rounded px-1 py-0.5">
                    <input
                      type="checkbox"
                      checked={parentAbbs.includes(a.id)}
                      onChange={e => {
                        if (e.target.checked) setParentAbbs(prev => [...prev, a.id])
                        else setParentAbbs(prev => prev.filter(x => x !== a.id))
                      }}
                      className="rounded border-gray-600"
                    />
                    <span className="text-blue-400 font-mono">{a.id}</span>
                    <span className="text-gray-300">{a.name}</span>
                  </label>
                ))}
              </div>
              {parentAbbs.length > 0 && (
                <p className="text-xs text-gray-500 mt-1">{parentAbbs.length} ABB{parentAbbs.length > 1 ? 's' : ''} selected</p>
              )}
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

      {/* AI Provider Bar */}
      <div className="card flex items-center gap-3">
        <span className="text-xs text-gray-500 font-semibold">AI Provider:</span>
        <div className="flex gap-1.5 items-center flex-wrap">
          {providers.map(p => (
            <button
              key={p.name}
              onClick={() => { setProvider(p.name); setModel(p.default_model) }}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                provider === p.name
                  ? 'bg-purple-600/20 border border-purple-500/40 text-purple-400'
                  : p.available
                    ? 'bg-gray-800 border border-gray-700 text-gray-400 hover:border-gray-600'
                    : 'bg-gray-800/50 border border-gray-800 text-gray-600 cursor-not-allowed'
              }`}
              disabled={!p.available}
            >
              {p.name}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={model}
          onChange={e => setModel(e.target.value)}
          placeholder="Model"
          className="input text-xs py-1 px-2 w-44 ml-auto"
        />
      </div>

      {/* AI Smart Actions */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-400 flex items-center gap-2">
            <span>&#10024;</span> AI Assistant
          </h2>
          {smartLoading && (
            <span className="ai-loading">
              <span className="ai-spinner" /> Running {smartLoading.replace('_', ' ')}...
            </span>
          )}
        </div>
        <div className="ai-smart-toolbar">
          <button
            onClick={() => handleSmartAction('auto_tags')}
            disabled={!!smartLoading}
            className="ai-smart-btn ai-smart-btn-tags"
          >
            &#127991; Auto-suggest Tags
          </button>
          <button
            onClick={() => handleSmartAction('generate_description')}
            disabled={!!smartLoading}
            className="ai-smart-btn ai-smart-btn-desc"
          >
            &#128196; Generate Description
          </button>
          <button
            onClick={() => handleSmartAction('suggest_relationships')}
            disabled={!!smartLoading}
            className="ai-smart-btn ai-smart-btn-rels"
          >
            &#128279; Suggest Relationships
          </button>
          <button
            onClick={() => handleSmartAction('quality_check')}
            disabled={!!smartLoading}
            className="ai-smart-btn ai-smart-btn-quality"
          >
            &#9989; Quality Check
          </button>
          <button
            onClick={() => handleSmartAction('auto_fill_empty')}
            disabled={!!smartLoading}
            className="ai-smart-btn ai-smart-btn-fill"
          >
            &#128295; Fill Empty Fields
          </button>
        </div>

        {smartError && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-3 py-2 text-xs mt-3">
            {smartError}
          </div>
        )}

        {/* Smart Action Results */}
        {smartResult && smartResult.action === 'auto_tags' && Array.isArray(smartResult.data) && (
          <div className="mt-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400 font-medium">Suggested Tags</span>
              <button onClick={() => applyAutoTags(smartResult.data)} className="text-xs text-green-400 hover:text-green-300">
                Add All
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {smartResult.data.map(tag => (
                <button
                  key={tag}
                  onClick={() => {
                    if (!tags.includes(tag)) setTags([...tags, tag])
                  }}
                  className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                    tags.includes(tag)
                      ? 'bg-blue-500/15 text-blue-400 border-blue-500/30'
                      : 'bg-gray-700/50 text-gray-300 border-gray-600 hover:bg-purple-500/15 hover:text-purple-400 hover:border-purple-500/30'
                  }`}
                >
                  {tags.includes(tag) ? '\u2713 ' : '+ '}{tag}
                </button>
              ))}
            </div>
            <button onClick={() => setSmartResult(null)} className="text-xs text-gray-500 hover:text-gray-400 mt-2">
              Dismiss
            </button>
          </div>
        )}

        {smartResult && smartResult.action === 'generate_description' && (
          <div className="mt-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400 font-medium">Generated Description</span>
            </div>
            <p className="text-sm text-gray-200 mb-2">{smartResult.data.description}</p>
            <div className="flex gap-2">
              <button onClick={() => applyDescription(smartResult.data.description)} className="text-xs text-green-400 hover:text-green-300">
                &#10003; Apply
              </button>
              <button onClick={() => setSmartResult(null)} className="text-xs text-gray-500 hover:text-gray-400">
                Dismiss
              </button>
            </div>
          </div>
        )}

        {smartResult && smartResult.action === 'suggest_relationships' && (
          <div className="mt-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400 font-medium">Suggested Relationships</span>
            </div>
            {smartResult.data.depends_on?.length > 0 && (
              <div className="mb-2">
                <span className="text-xs text-cyan-400 font-semibold">DEPENDS_ON:</span>
                {smartResult.data.depends_on.map(r => (
                  <div key={r.id} className="flex items-center gap-2 mt-1 ml-2">
                    <button
                      onClick={() => {
                        if (!selectedDeps.includes(r.id)) setSelectedDeps([...selectedDeps, r.id])
                      }}
                      className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                        selectedDeps.includes(r.id)
                          ? 'bg-green-500/15 text-green-400 border-green-500/30'
                          : 'bg-gray-700/50 text-gray-300 border-gray-600 hover:bg-cyan-500/15 hover:text-cyan-400'
                      }`}
                    >
                      {selectedDeps.includes(r.id) ? '\u2713 ' : '+ '}{r.id}
                    </button>
                    <span className="text-xs text-gray-400">{r.name} — {r.reason}</span>
                  </div>
                ))}
              </div>
            )}
            {smartResult.data.references?.length > 0 && (
              <div className="mb-2">
                <span className="text-xs text-cyan-400 font-semibold">REFERENCES:</span>
                {smartResult.data.references.map(r => (
                  <div key={r.id} className="flex items-center gap-2 mt-1 ml-2">
                    <span className="text-xs font-mono text-gray-300">{r.id}</span>
                    <span className="text-xs text-gray-400">{r.name} — {r.reason}</span>
                  </div>
                ))}
              </div>
            )}
            {smartResult.data.reasoning && (
              <p className="text-xs text-gray-500 mt-2 italic">{smartResult.data.reasoning}</p>
            )}
            <button onClick={() => setSmartResult(null)} className="text-xs text-gray-500 hover:text-gray-400 mt-2">
              Dismiss
            </button>
          </div>
        )}

        {smartResult && smartResult.action === 'quality_check' && (
          <div className="mt-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700/50">
            <div className="flex items-center gap-4 mb-3">
              <div className="text-center">
                <div className={`quality-score quality-grade-${smartResult.data.grade || 'C'}`}>
                  {smartResult.data.score || 0}
                </div>
                <div className="text-xs text-gray-500">Score</div>
              </div>
              <div className={`text-2xl font-bold quality-grade-${smartResult.data.grade || 'C'}`}>
                {smartResult.data.grade || '?'}
              </div>
            </div>
            {smartResult.data.strengths?.length > 0 && (
              <div className="mb-2">
                <span className="text-xs text-green-400 font-semibold">Strengths:</span>
                {smartResult.data.strengths.map((s, i) => (
                  <div key={i} className="text-xs text-gray-300 ml-2 mt-0.5">&#10003; {s}</div>
                ))}
              </div>
            )}
            {smartResult.data.issues?.length > 0 && (
              <div className="mb-2">
                <span className="text-xs text-amber-400 font-semibold">Issues:</span>
                {smartResult.data.issues.map((issue, i) => (
                  <div key={i} className="flex items-center gap-2 ml-2 mt-0.5">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      issue.severity === 'HIGH' ? 'bg-red-500/15 text-red-400'
                      : issue.severity === 'MEDIUM' ? 'bg-amber-500/15 text-amber-400'
                      : 'bg-gray-700 text-gray-400'
                    }`}>{issue.severity}</span>
                    <span className="text-xs text-gray-300">{issue.field}: {issue.message}</span>
                  </div>
                ))}
              </div>
            )}
            {smartResult.data.suggestions?.length > 0 && (
              <div className="mb-2">
                <span className="text-xs text-blue-400 font-semibold">Suggestions:</span>
                {smartResult.data.suggestions.map((s, i) => (
                  <div key={i} className="text-xs text-gray-300 ml-2 mt-0.5">&#8226; {s}</div>
                ))}
              </div>
            )}
            <button onClick={() => setSmartResult(null)} className="text-xs text-gray-500 hover:text-gray-400 mt-2">
              Dismiss
            </button>
          </div>
        )}

        {smartResult && smartResult.action === 'auto_fill_empty' && typeof smartResult.data === 'object' && (
          <div className="mt-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400 font-medium">Generated Content for Empty Fields</span>
              <button onClick={() => applyAutoFill(smartResult.data)} className="text-xs text-green-400 hover:text-green-300">
                Apply All
              </button>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {Object.entries(smartResult.data).map(([field, content]) => (
                <div key={field} className="border border-gray-700/50 rounded p-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-mono text-purple-400">{field}</span>
                    <button
                      onClick={() => {
                        applyAutoFill({ [field]: content })
                      }}
                      className="text-xs text-green-400 hover:text-green-300"
                    >
                      Apply
                    </button>
                  </div>
                  <p className="text-xs text-gray-300 line-clamp-3">{String(content).slice(0, 200)}{String(content).length > 200 ? '...' : ''}</p>
                </div>
              ))}
            </div>
            <button onClick={() => setSmartResult(null)} className="text-xs text-gray-500 hover:text-gray-400 mt-2">
              Dismiss
            </button>
          </div>
        )}
      </div>

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
          {isAdmin && teams.length > 0 && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Team</label>
              <select value={form.team_id || ''} onChange={e => setField('team_id', e.target.value)} className="select w-full">
                <option value="">Unassigned</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Relationships: Parent ABBs (SBB only — can implement multiple ABBs) */}
        {form.type === 'SBB' && (
          <div className="mt-4 pt-4 border-t border-gray-700/50">
            <h3 className="text-xs font-semibold text-gray-500 mb-3">Relationships</h3>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Implements ABBs <span className="text-red-400">*</span>
                <span className="font-normal text-gray-600 ml-2">One SBB can realize multiple ABBs</span>
              </label>
              <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-2 max-h-44 overflow-y-auto space-y-1">
                {abbs.length === 0 && <p className="text-xs text-gray-600">Loading ABBs...</p>}
                {abbs.map(a => (
                  <label key={a.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-700/30 rounded px-1 py-0.5">
                    <input
                      type="checkbox"
                      checked={parentAbbs.includes(a.id)}
                      onChange={e => {
                        if (e.target.checked) setParentAbbs(prev => [...prev, a.id])
                        else setParentAbbs(prev => prev.filter(x => x !== a.id))
                      }}
                      className="rounded border-gray-600"
                    />
                    <span className="text-blue-400 font-mono">{a.id}</span>
                    <span className="text-gray-300">{a.name}</span>
                  </label>
                ))}
              </div>
              {parentAbbs.length > 0 ? (
                <p className="text-xs text-gray-500 mt-1">{parentAbbs.length} ABB{parentAbbs.length > 1 ? 's' : ''} selected</p>
              ) : (
                <p className="text-xs text-orange-400 mt-1">Every SBB should implement at least one ABB</p>
              )}
            </div>
          </div>
        )}

        <CategoryOverviewPanel />
      </div>

      {/* Description & Tags (all types) */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-400 mb-3">Description & Tags</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Description</label>
            <AIFieldAssist
              fieldName="description"
              value={description}
              onChange={setDescription}
              placeholder="Short summary of this pattern..."
              rows={3}
              patternContext={buildPatternContext()}
              patternType={form.type}
              patternId={id || null}
              provider={provider}
              model={model}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Tags</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {tags.map(tag => (
                <span key={tag} className="inline-flex items-center gap-1 bg-blue-500/15 text-blue-400 text-xs px-2 py-0.5 rounded-full">
                  {tag}
                  <button onClick={() => setTags(tags.filter(t => t !== tag))} className="hover:text-red-400">{'\u2715'}</button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                placeholder="Add tag..."
                className="input flex-1 text-sm"
                onKeyDown={e => {
                  if (e.key === 'Enter' && tagInput.trim()) {
                    e.preventDefault()
                    const t = tagInput.trim().toLowerCase()
                    if (!tags.includes(t)) setTags([...tags, t])
                    setTagInput('')
                  }
                }}
              />
              <button
                onClick={() => {
                  const t = tagInput.trim().toLowerCase()
                  if (t && !tags.includes(t)) setTags([...tags, t])
                  setTagInput('')
                }}
                disabled={!tagInput.trim()}
                className="btn-secondary text-xs"
              >Add</button>
            </div>
          </div>
          {form.status === 'DEPRECATED' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Deprecation Note</label>
              <AIFieldAssist
                fieldName="deprecation_note"
                value={deprecationNote}
                onChange={setDeprecationNote}
                placeholder="Reason for deprecation, migration guidance..."
                rows={2}
                patternContext={buildPatternContext()}
                patternType={form.type}
                patternId={id || null}
                provider={provider}
                model={model}
              />
            </div>
          )}
        </div>
      </div>

      {/* ===== SECTION-BASED CONTENT EDITING ===== */}

      {/* --- AB Sections (all free-text with AI assist) --- */}
      {form.type === 'AB' && (
        <>
          {['Intent', 'Problem', 'Solution', 'Structural Elements', 'Invariants',
            'Inter-Element Contracts', 'Related Patterns', 'Related ADRs', 'Note on Building Blocks', 'Restrictions'
          ].map(name => (
            <div key={name} className="card">
              <h2 className="text-sm font-semibold text-gray-400 mb-3">{name}</h2>
              <AIFieldAssist
                fieldName={SECTION_FIELD_MAP[name]}
                value={sections[name] || ''}
                onChange={val => setSection(name, val)}
                placeholder={`Enter ${name.toLowerCase()} content...`}
                rows={name === 'Structural Elements' || name === 'Inter-Element Contracts' ? 12 : 6}
                patternContext={buildPatternContext()}
                patternType={form.type}
                patternId={id || null}
                provider={provider}
                model={model}
              />
            </div>
          ))}
        </>
      )}

      {/* --- ABB Sections --- */}
      {form.type === 'ABB' && (
        <>
          {/* Functionality — free text with AI assist */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">Functionality</h2>
            <AIFieldAssist
              fieldName="functionality"
              value={sections['Functionality'] || ''}
              onChange={val => setSection('Functionality', val)}
              placeholder="Describe the functionality of this building block..."
              rows={10}
              patternContext={buildPatternContext()}
              patternType={form.type}
              patternId={id || null}
              provider={provider}
              model={model}
            />
          </div>

          {/* Interfaces — structured (inbound/outbound) with AI assist */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">Interfaces</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Inbound</label>
                <AIFieldAssist
                  fieldName="inbound_interfaces"
                  value={interfaces.inbound}
                  onChange={val => setInterfaces(prev => ({ ...prev, inbound: val }))}
                  placeholder="Describe inbound interfaces..."
                  rows={2}
                  patternContext={buildPatternContext()}
                  patternType={form.type}
                  patternId={id || null}
                  provider={provider}
                  model={model}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Outbound</label>
                <AIFieldAssist
                  fieldName="outbound_interfaces"
                  value={interfaces.outbound}
                  onChange={val => setInterfaces(prev => ({ ...prev, outbound: val }))}
                  placeholder="Describe outbound interfaces..."
                  rows={2}
                  patternContext={buildPatternContext()}
                  patternType={form.type}
                  patternId={id || null}
                  provider={provider}
                  model={model}
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

          {/* Quality Attributes (ABB) with AI assist */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">
              Quality Attributes
              <span className="font-normal text-gray-600 ml-2">NFR contract: latency, availability, throughput</span>
            </h2>
            <AIFieldAssist
              fieldName="quality_attributes"
              value={qualityAttributes}
              onChange={setQualityAttributes}
              placeholder="Define quality attributes: latency targets, availability SLAs, throughput expectations..."
              rows={4}
              patternContext={buildPatternContext()}
              patternType={form.type}
              patternId={id || null}
              provider={provider}
              model={model}
            />
          </div>

          {/* Compliance Requirements (ABB) with AI assist */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">
              Compliance Requirements
              <span className="font-normal text-gray-600 ml-2">GDPR, SOC2, ISO 27001, etc.</span>
            </h2>
            <AIFieldAssist
              fieldName="compliance_requirements"
              value={complianceRequirements}
              onChange={setComplianceRequirements}
              placeholder="Define compliance requirements: regulatory standards, data protection, audit requirements..."
              rows={4}
              patternContext={buildPatternContext()}
              patternType={form.type}
              patternId={id || null}
              provider={provider}
              model={model}
            />
          </div>

          {/* Restrictions with AI assist */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">
              Restrictions
              <span className="font-normal text-gray-600 ml-2">Usage allowances, platform constraints, licensing</span>
            </h2>
            <AIFieldAssist
              fieldName="restrictions"
              value={sections['Restrictions'] || ''}
              onChange={val => setSection('Restrictions', val)}
              placeholder="Define restrictions: platform requirements, technology constraints, licensing limits, deployment restrictions..."
              rows={4}
              patternContext={buildPatternContext()}
              patternType={form.type}
              patternId={id || null}
              provider={provider}
              model={model}
            />
          </div>
        </>
      )}

      {/* --- SBB Sections --- */}
      {form.type === 'SBB' && (
        <>
          {/* Specific Functionality — free text with AI assist */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">Specific Functionality</h2>
            <AIFieldAssist
              fieldName="specific_functionality"
              value={sections['Specific Functionality'] || ''}
              onChange={val => setSection('Specific Functionality', val)}
              placeholder="Describe the specific functionality of this solution building block..."
              rows={10}
              patternContext={buildPatternContext()}
              patternType={form.type}
              patternId={id || null}
              provider={provider}
              model={model}
            />
          </div>

          {/* Interfaces — structured with AI assist */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">Interfaces</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Inbound</label>
                <AIFieldAssist
                  fieldName="inbound_interfaces"
                  value={interfaces.inbound}
                  onChange={val => setInterfaces(prev => ({ ...prev, inbound: val }))}
                  placeholder="Describe inbound interfaces..."
                  rows={2}
                  patternContext={buildPatternContext()}
                  patternType={form.type}
                  patternId={id || null}
                  provider={provider}
                  model={model}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Outbound</label>
                <AIFieldAssist
                  fieldName="outbound_interfaces"
                  value={interfaces.outbound}
                  onChange={val => setInterfaces(prev => ({ ...prev, outbound: val }))}
                  placeholder="Describe outbound interfaces..."
                  rows={2}
                  patternContext={buildPatternContext()}
                  patternType={form.type}
                  patternId={id || null}
                  provider={provider}
                  model={model}
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

          {/* Solution Details (SBB) */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">Solution Details</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Vendor</label>
                <input
                  type="text"
                  value={vendor}
                  onChange={e => setVendor(e.target.value)}
                  placeholder="e.g. AWS, Azure, Google"
                  className="input w-full text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Deployment Model</label>
                <select value={deploymentModel} onChange={e => setDeploymentModel(e.target.value)} className="select w-full">
                  <option value="">-- Select --</option>
                  <option value="SaaS">SaaS</option>
                  <option value="self-hosted">Self-hosted</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="managed">Managed</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Cost Tier</label>
                <select value={costTier} onChange={e => setCostTier(e.target.value)} className="select w-full">
                  <option value="">-- Select --</option>
                  <option value="FREE">FREE</option>
                  <option value="LOW">LOW</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="HIGH">HIGH</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Licensing</label>
                <input
                  type="text"
                  value={licensing}
                  onChange={e => setLicensing(e.target.value)}
                  placeholder="e.g. open-source, commercial, pay-per-use"
                  className="input w-full text-sm"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Maturity</label>
                <select value={maturity} onChange={e => setMaturity(e.target.value)} className="select w-full">
                  <option value="">-- Select --</option>
                  <option value="POC">POC</option>
                  <option value="pilot">Pilot</option>
                  <option value="production-ready">Production-ready</option>
                  <option value="battle-tested">Battle-tested</option>
                </select>
              </div>
            </div>
          </div>

          {/* Restrictions with AI assist */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">
              Restrictions
              <span className="font-normal text-gray-600 ml-2">Usage allowances, platform constraints, licensing</span>
            </h2>
            <AIFieldAssist
              fieldName="restrictions"
              value={sections['Restrictions'] || ''}
              onChange={val => setSection('Restrictions', val)}
              placeholder="Define restrictions: platform requirements, technology constraints, licensing limits, deployment restrictions..."
              rows={4}
              patternContext={buildPatternContext()}
              patternType={form.type}
              patternId={id || null}
              provider={provider}
              model={model}
            />
          </div>
        </>
      )}

      {/* ===== DIAGRAMS (all types) ===== */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-400 mb-3">
          Diagrams
          <span className="font-normal text-gray-600 ml-2">Mermaid diagrams</span>
        </h2>
        {diagrams.map((diag, i) => (
          <div key={diag.id} className="mb-4 border border-gray-700 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <input
                type="text"
                value={diag.title}
                onChange={e => {
                  const updated = [...diagrams]
                  updated[i] = { ...diag, title: e.target.value }
                  setDiagrams(updated)
                }}
                placeholder="Diagram title"
                className="input flex-1 text-sm"
              />
              <button
                onClick={() => setDiagrams(diagrams.filter((_, j) => j !== i))}
                className="text-red-400 hover:text-red-300 text-xs px-2 py-1"
              >{'\u2715'} Remove</button>
            </div>
            <textarea
              value={diag.content}
              onChange={e => {
                const updated = [...diagrams]
                updated[i] = { ...diag, content: e.target.value }
                setDiagrams(updated)
              }}
              placeholder={'---\nconfig:\n  theme: dark\n---\nflowchart LR\nA[Start] --Some text--> B(Continue)\nB --> C{Evaluate}\nC -- One --> D[Option 1]\nC -- Two --> E[Option 2]\nC -- Three --> F[fa:fa-car Option 3]'}
              className="input w-full font-mono text-sm resize-y mb-2"
              rows={8}
            />
            <MermaidPreview content={diag.content} />
          </div>
        ))}
        <button
          onClick={() => setDiagrams([...diagrams, { id: crypto.randomUUID(), title: '', content: '---\nconfig:\n  theme: dark\n---\nflowchart LR\nA[Start] --Some text--> B(Continue)\nB --> C{Evaluate}\nC -- One --> D[Option 1]\nC -- Two --> E[Option 2]\nC -- Three --> F[fa:fa-car Option 3]' }])}
          className="btn-secondary text-xs"
        >+ Add Diagram</button>
      </div>

      {/* ===== IMAGES (all types) ===== */}
      {!isNew && (
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-400 mb-3">
            Images
            <span className="font-normal text-gray-600 ml-2">Upload JPEG, PNG, or SVG</span>
          </h2>
          {existingImages.length > 0 && (
            <div className="grid grid-cols-3 gap-3 mb-3">
              {existingImages.map(img => (
                <div key={img.id} className="border border-gray-700 rounded-lg p-2 group relative">
                  <img
                    src={getUploadUrl(img.filename)}
                    alt={img.title}
                    className="w-full h-32 object-cover rounded mb-1"
                  />
                  <p className="text-xs text-gray-400 truncate">{img.title}</p>
                  <button
                    onClick={async () => {
                      if (!confirm(`Delete image "${img.title}"?`)) return
                      try {
                        await deletePatternImage(id, img.id)
                        setExistingImages(existingImages.filter(x => x.id !== img.id))
                      } catch (err) {
                        alert(err.message)
                      }
                    }}
                    className="absolute top-1 right-1 bg-red-600/80 text-white text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  >{'\u2715'}</button>
                </div>
              ))}
            </div>
          )}
          <input
            type="file"
            accept="image/jpeg,image/png,image/svg+xml"
            disabled={uploadingImage}
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              setUploadingImage(true)
              try {
                const meta = await uploadPatternImage(id, file, file.name)
                setExistingImages(prev => [...prev, meta])
              } catch (err) {
                alert(err.message)
              }
              setUploadingImage(false)
              e.target.value = ''
            }}
            className="text-sm text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-gray-600 file:text-gray-300 file:bg-gray-800 file:cursor-pointer hover:file:bg-gray-700"
          />
          {uploadingImage && <p className="text-xs text-gray-500 mt-1">Uploading...</p>}
        </div>
      )}

    </div>
  )
}


// --- Mermaid Live Preview Component ---
function MermaidPreview({ content }) {
  const containerRef = useRef(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!content || !containerRef.current) {
      if (containerRef.current) containerRef.current.innerHTML = ''
      setError(null)
      return
    }

    let cancelled = false
    const timer = setTimeout(() => {
      import('mermaid').then(mod => {
        if (cancelled) return
        const mermaid = mod.default
        mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' })
        const id = `mermaid-${Math.random().toString(36).slice(2)}`
        mermaid.render(id, content).then(({ svg }) => {
          if (!cancelled && containerRef.current) {
            containerRef.current.innerHTML = svg
            setError(null)
          }
        }).catch(err => {
          if (!cancelled) {
            setError(err.message || 'Invalid mermaid syntax')
            if (containerRef.current) containerRef.current.innerHTML = ''
          }
        })
      })
    }, 500) // debounce

    return () => { cancelled = true; clearTimeout(timer) }
  }, [content])

  return (
    <div>
      <div ref={containerRef} className="bg-gray-900 rounded p-2 overflow-auto min-h-[40px]" />
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  )
}
