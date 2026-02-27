import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import {
  fetchPattern, createPattern, updatePattern,
  fetchCategories, fetchPatterns, fetchPBCs,
  aiGenerate, aiAnalyzeContext, generatePatternId,
  fetchCategoryOverview, fetchTechnologies,
  uploadPatternImage, deletePatternImage, getUploadUrl,
  aiSmartAction, fetchTeams,
} from '../api/client'
import AIFieldAssist from '../components/AIFieldAssist'
import MarkdownContent from '../components/MarkdownContent'
import { useAuth } from '../contexts/AuthContext'
import ConfirmModal from '../components/ConfirmModal'

const TYPES = ['AB', 'ABB', 'SBB']

const TYPE_DESCRIPTIONS = {
  AB:  { name: 'Architecture Blueprint',      desc: 'High-level pattern defining structure, intent, and constraints across the system' },
  ABB: { name: 'Architecture Building Block', desc: 'Abstract functional component defining capabilities, interfaces, and quality attributes' },
  SBB: { name: 'Solution Building Block',     desc: 'Concrete implementation realizing one or more ABBs with specific technology choices' },
}

// Business capabilities are now loaded from PBC database (not hardcoded)

const SparkleIcon = () => (
  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
    <path d="M10 2a.75.75 0 01.69.46l1.52 3.56 3.56 1.52a.75.75 0 010 1.38l-3.56 1.52-1.52 3.56a.75.75 0 01-1.38 0L7.79 10.44 4.23 8.92a.75.75 0 010-1.38l3.56-1.52L9.31 2.46A.75.75 0 0110 2z" />
  </svg>
)

const Spinner = ({ text }) => (
  <span className="flex items-center gap-1.5">
    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
    </svg>
    {text}
  </span>
)

function PatternAIPromptBox({ onRun, loading, result, onClear, error }) {
  const [prompt, setPrompt] = useState('')
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="card border border-purple-500/20">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-purple-400 flex items-center gap-1.5">
          <SparkleIcon /> AI Assistant
        </h3>
        <div className="flex items-center gap-2">
          {result && onClear && (
            <button onClick={() => { onClear(); setPrompt('') }} className="text-xs text-gray-500 hover:text-red-400 transition-colors">
              Clear
            </button>
          )}
          <button onClick={() => setExpanded(!expanded)} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
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
              placeholder="Ask anything about this pattern — architecture advice, TOGAF compliance, field suggestions..."
              className="input flex-1 text-sm"
              onKeyDown={e => e.key === 'Enter' && onRun(prompt)}
            />
            <button
              onClick={() => onRun(prompt)}
              disabled={loading || !prompt.trim()}
              className="px-4 py-1.5 text-sm rounded-lg bg-purple-600/30 text-purple-300 hover:bg-purple-600/50 disabled:opacity-50 transition-colors flex items-center gap-1.5"
            >
              {loading ? <Spinner text="Generating..." /> : (<><SparkleIcon /> Generate</>)}
            </button>
          </div>
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-3 py-2 text-xs mb-3">
              {error}
            </div>
          )}
          {result && (
            <div className="bg-gray-900/50 rounded-lg px-3 py-2 max-h-64 overflow-y-auto">
              <MarkdownContent content={typeof result === 'string' ? result : JSON.stringify(result, null, 2)} />
              <div className="flex gap-2 mt-2">
                <button onClick={() => { onClear(); setPrompt('') }} className="px-3 py-1 text-xs rounded bg-gray-700 text-gray-400 hover:bg-gray-600 transition-colors">
                  Clear
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {!expanded && (
        <p className="text-xs text-gray-600">Click &quot;Expand&quot; to use AI to generate or improve content.</p>
      )}
    </div>
  )
}

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
  const [pbcs, setPbcs] = useState([])
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
  const [catOverview, setCatOverview] = useState(null)
  const [catOverviewLoading, setCatOverviewLoading] = useState(false)
  const [catOverviewOpen, setCatOverviewOpen] = useState(false)

  // AI-first workflow step: 'setup' -> 'generating' -> 'editor'
  const [step, setStep] = useState(isNew ? 'setup' : 'editor')

  // AI config
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

  // AI Analysis state
  const [aiAnalysis, setAiAnalysis] = useState(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [followUpAnswers, setFollowUpAnswers] = useState({})

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
  const [fieldErrors, setFieldErrors] = useState({})
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
  const [deleteImageTarget, setDeleteImageTarget] = useState(null) // { id, title }
  const [imageError, setImageError] = useState('')

  // Build capabilities list from PBC database + any existing caps on the pattern
  const pbcNames = pbcs.map(p => p.name)
  const allCapsSet = new Set([...pbcNames, ...businessCaps])
  const allCapsList = [...allCapsSet].sort()

  // Load initial data
  useEffect(() => {
    fetchCategories().then(res => setCategories(res.categories || [])).catch(() => {})
    fetchPatterns({ type: 'ABB', limit: 100 }).then(res => setAbbs(res.patterns || [])).catch(() => {})
    fetchPatterns({ limit: 500 }).then(res => setAllPatterns(res.patterns || [])).catch(() => {})
    fetchTechnologies().then(res => setTechnologies(res.technologies || [])).catch(() => {})
    fetchPBCs().then(res => setPbcs(res.pbcs || [])).catch(() => {})
    if (isAdmin) fetchTeams().then(setTeams).catch(() => {})
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

  // AI Analysis: predict category, relationships, and ask follow-up questions
  const handleAnalyze = async () => {
    if (!contextNotes.trim()) {
      setAiError('Please describe your pattern before analyzing')
      return
    }
    setAnalysisLoading(true)
    setAiError('')
    setAiAnalysis(null)
    try {
      const res = await aiAnalyzeContext({
        template_type: form.type,
        context_notes: contextNotes,
        provider: null,
        model: null,
      })
      setAiAnalysis(res)
      // Auto-set category from AI suggestion
      if (res.suggested_category) {
        setField('category', res.suggested_category)
      }
      // Auto-set predicted ABBs (for SBB)
      if (res.predicted_abbs?.length > 0) {
        setParentAbbs(res.predicted_abbs)
      }
      setFollowUpAnswers({})
    } catch (err) {
      setAiError(err.message)
    }
    setAnalysisLoading(false)
  }

  const handleAIGenerate = async () => {
    setAiLoading(true)
    setAiError('')
    try {
      // Build enriched context from follow-up answers and analysis
      let enriched = ''
      if (aiAnalysis?.follow_up_questions && Object.keys(followUpAnswers).length > 0) {
        const parts = aiAnalysis.follow_up_questions.map((q, i) =>
          followUpAnswers[i] ? `${q.question}: ${followUpAnswers[i]}` : null
        ).filter(Boolean)
        if (parts.length > 0) enriched = parts.join('\n')
      }
      if (aiAnalysis?.context_summary) {
        enriched = (enriched ? enriched + '\n\n' : '') + 'System context: ' + aiAnalysis.context_summary
      }

      const res = await aiGenerate({
        template_type: form.type,
        parent_abb_id: parentAbbs.length > 0 ? parentAbbs[0] : null,
        context_notes: contextNotes + (parentAbbs.length > 1 ? `\nAlso implements ABBs: ${parentAbbs.slice(1).join(', ')}` : ''),
        enriched_context: enriched || null,
        provider: null,
        model: null,
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

      // Description & Tags
      if (generated.description) setDescription(generated.description)
      if (generated.tags?.length > 0) setTags(generated.tags)

      // Quality attributes & restrictions
      if (generated.quality_attributes) setQualityAttributes(generated.quality_attributes)
      if (generated.restrictions) setSections(prev => ({ ...prev, 'Restrictions': generated.restrictions }))

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

  const validatePatternForm = () => {
    const errs = {}
    if (!form.name.trim()) errs.name = 'Name is required'
    if (!form.type) errs.type = 'Type is required'
    if (!form.category) errs.category = 'Category is required'
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSave = async () => {
    if (!validatePatternForm()) return
    setSaving(true)
    setError('')
    try {
      // Build structured payload — no markdown reconstruction!
      // Use empty string (not null) for clearable text fields so backend doesn't skip them
      const text = v => (v === undefined || v === null) ? '' : v

      const payload = {
        ...form,
        // AB fields
        intent: text(sections['Intent']),
        problem: text(sections['Problem']),
        solution: text(sections['Solution']),
        structural_elements: text(sections['Structural Elements']),
        invariants: text(sections['Invariants']),
        inter_element_contracts: text(sections['Inter-Element Contracts']),
        related_patterns_text: text(sections['Related Patterns']),
        related_adrs: text(sections['Related ADRs']),
        building_blocks_note: text(sections['Note on Building Blocks']),
        // ABB fields
        functionality: text(sections['Functionality']),
        // SBB fields
        specific_functionality: text(sections['Specific Functionality']),
        // Shared fields
        inbound_interfaces: text(interfaces.inbound),
        outbound_interfaces: text(interfaces.outbound),
        consumed_by_ids: interop.consumedBy,
        works_with_ids: interop.worksWith,
        business_capabilities: businessCaps,
        sbb_mapping: sbbMapping,
        restrictions: text(sections['Restrictions']),
        // New metadata fields
        description: text(description),
        tags: tags,
        deprecation_note: text(deprecationNote),
        quality_attributes: text(qualityAttributes),
        compliance_requirements: text(complianceRequirements),
        vendor: text(vendor),
        deployment_model: text(deploymentModel),
        cost_tier: text(costTier),
        licensing: text(licensing),
        maturity: text(maturity),
        diagrams: diagrams,
      }

      // ABBs are abstract concepts — they NEVER have technology or dependency relationships
      const isSBB = form.type === 'SBB'

      if (isNew) {
        if (!payload.id) delete payload.id
        if (parentAbbs.length > 0) payload.implements_abbs = parentAbbs
        if (isSBB && selectedTechs.length > 0) payload.technology_ids = selectedTechs
        if (isSBB && selectedCompatTechs.length > 0) payload.compatible_tech_ids = selectedCompatTechs
        if (isSBB && selectedDeps.length > 0) payload.depends_on_ids = selectedDeps
        // Admin can assign team on create via query param
        const teamIdForCreate = isAdmin && form.team_id ? form.team_id : null
        const created = await createPattern(payload, teamIdForCreate)
        navigate(`/patterns/${created.id}`, { state: { _refresh: Date.now() } })
      } else {
        const { id: _, team_id: _tid, ...updateData } = payload
        updateData.implements_abbs = isSBB ? parentAbbs : []
        updateData.technology_ids = isSBB ? selectedTechs : []
        updateData.compatible_tech_ids = isSBB ? selectedCompatTechs : []
        updateData.depends_on_ids = isSBB ? selectedDeps : []
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

  // --- Custom AI Prompt state ---
  const [customLoading, setCustomLoading] = useState(false)
  const [customResult, setCustomResult] = useState(null) // markdown text

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
        provider: null,
        model: null,
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

  const handleCustomAI = async (prompt) => {
    if (!prompt.trim()) return
    setCustomLoading(true)
    setCustomResult(null)
    setSmartError('')
    try {
      const res = await aiSmartAction({
        action: 'custom',
        custom_prompt: prompt.trim(),
        pattern_context: buildPatternContext(),
        pattern_type: form.type,
        pattern_id: id || null,
      })
      setCustomResult(res.result?.text || res.result)
    } catch (err) {
      setSmartError(err.message)
    }
    setCustomLoading(false)
  }

  // --- Category Overview Panel (collapsible) ---
  const CategoryOverviewPanel = () => {
    if (catOverviewLoading) {
      return <div className="text-xs text-gray-600 mt-2">Loading category overview...</div>
    }
    if (!catOverview) return null

    return (
      <div className="mt-2">
        <button
          onClick={() => setCatOverviewOpen(!catOverviewOpen)}
          className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          <span className={`transition-transform duration-200 ${catOverviewOpen ? 'rotate-90' : ''}`} style={{ display: 'inline-block' }}>&#9654;</span>
          <span>{catOverview.label} Overview</span>
          <span className="text-gray-600">({catOverview.abb_count} ABBs, {catOverview.sbb_count} SBBs)</span>
        </button>
        {catOverviewOpen && (
          <div className="bg-gray-800/50 rounded-lg p-3 mt-2 border border-gray-700/50">
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
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white">Create New Pattern</h1>
          <p className="text-gray-500 text-sm mt-1">Describe your pattern and let AI handle the rest</p>
        </div>

        {/* Input card: Type + Description */}
        <div className="card space-y-6">

          {/* Pattern Type */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-3">Pattern Type</label>
            <div className="grid grid-cols-3 gap-3">
              {TYPES.map(t => {
                const info = TYPE_DESCRIPTIONS[t]
                const isSelected = form.type === t
                const colorClass = isSelected
                  ? t === 'AB' ? 'bg-orange-600/20 border-orange-500/50 text-orange-400'
                  : t === 'ABB' ? 'bg-blue-600/20 border-blue-500/50 text-blue-400'
                  : 'bg-green-600/20 border-green-500/50 text-green-400'
                  : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:border-gray-600'
                return (
                  <button
                    key={t}
                    onClick={() => {
                      setField('type', t)
                      // Reset analysis when type changes
                      if (t !== form.type) {
                        setAiAnalysis(null)
                        setParentAbbs([])
                      }
                    }}
                    className={`p-4 rounded-lg border text-left transition-all ${colorClass}`}
                  >
                    <div className={`text-lg font-bold ${isSelected ? '' : 'text-gray-300'}`}>{t}</div>
                    <div className={`text-xs font-medium mt-0.5 ${isSelected ? '' : 'text-gray-400'}`}>{info.name}</div>
                    <div className="text-xs text-gray-500 mt-1.5 leading-relaxed">{info.desc}</div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="border-t border-gray-800" />

          {/* Describe Your Pattern */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-2">Describe Your Pattern</label>
            <textarea
              value={contextNotes}
              onChange={e => setContextNotes(e.target.value)}
              placeholder={form.type === 'SBB'
                ? 'What does this solution implement? E.g., "Vector search using Pinecone for knowledge retrieval, cloud-managed, with hybrid search support..."'
                : form.type === 'ABB'
                ? 'What capability does this define? E.g., "Semantic search engine for enterprise knowledge bases, supporting multiple embedding models..."'
                : 'What is this architecture blueprint about? E.g., "RAG architecture for enterprise document intelligence with multi-tenant support..."'
              }
              className="input w-full h-36 resize-none text-sm"
            />
            <p className="text-xs text-gray-600 mt-1">
              AI will analyze your description, suggest the best category, predict relationships, and ask follow-up questions
            </p>
          </div>
        </div>

        {/* Error */}
        {aiError && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 text-sm">{aiError}</div>
        )}

        {/* Actions: Analyze or Write Manually */}
        {!aiAnalysis && (
          <div className="flex gap-3">
            <button
              onClick={handleAnalyze}
              disabled={analysisLoading || !contextNotes.trim()}
              className="btn-primary flex-1 py-3 text-base"
            >
              {analysisLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z"/></svg>
                  Analyzing...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <span>&#10024;</span> Analyze with AI
                </span>
              )}
            </button>
            <button
              onClick={() => setStep('editor')}
              className="btn-secondary py-3"
            >
              Write Manually
            </button>
          </div>
        )}

        {/* AI Analysis Results */}
        {aiAnalysis && (
          <div className="card border border-purple-500/20 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-purple-400 flex items-center gap-1.5">
                <span>&#10024;</span> AI Analysis
              </h3>
              <button
                onClick={() => { setAiAnalysis(null); setFollowUpAnswers({}) }}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                Re-analyze
              </button>
            </div>

            {/* Type Guidance — shown when user's description doesn't match selected type */}
            {aiAnalysis.type_guidance && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-amber-400 text-sm">&#9888;</span>
                  <span className="text-xs font-semibold text-amber-400">Type Guidance</span>
                </div>
                <p className="text-xs text-amber-200/80 leading-relaxed whitespace-pre-line">{aiAnalysis.type_guidance}</p>
              </div>
            )}

            {/* Suggested Name */}
            {aiAnalysis.suggested_name && (
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1">Suggested Name</label>
                <p className="text-sm text-white">{aiAnalysis.suggested_name}</p>
              </div>
            )}

            {/* Suggested Category */}
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Suggested Category</label>
              {aiAnalysis.category_reasoning && (
                <p className="text-xs text-gray-500 mb-2">{aiAnalysis.category_reasoning}</p>
              )}
              <div className="flex items-center gap-3">
                <select
                  value={form.category}
                  onChange={e => setField('category', e.target.value)}
                  className="select flex-1"
                >
                  {categories.map(c => (
                    <option key={c.code} value={c.code}>{c.label} ({c.code})</option>
                  ))}
                </select>
                {previewId && (
                  <span className="text-xs text-gray-500">
                    ID: <span className="font-mono text-blue-400">{previewId}</span>
                  </span>
                )}
              </div>
              <CategoryOverviewPanel />
            </div>

            {/* Predicted ABBs (SBB only) */}
            {form.type === 'SBB' && aiAnalysis.predicted_abbs && (
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1">
                  Predicted ABBs
                  <span className="font-normal text-gray-600 ml-2">AI predicted which ABBs this SBB implements</span>
                </label>
                {aiAnalysis.abb_reasoning && (
                  <p className="text-xs text-gray-500 mb-2">{aiAnalysis.abb_reasoning}</p>
                )}
                <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-2 max-h-40 overflow-y-auto space-y-1">
                  {abbs.length === 0 && <p className="text-xs text-gray-600">Loading ABBs...</p>}
                  {/* Show predicted ABBs first, then the rest */}
                  {[...abbs].sort((a, b) => {
                    const aP = (aiAnalysis.predicted_abbs || []).includes(a.id) ? 0 : 1
                    const bP = (aiAnalysis.predicted_abbs || []).includes(b.id) ? 0 : 1
                    return aP - bP
                  }).map(a => {
                    const isPredicted = (aiAnalysis.predicted_abbs || []).includes(a.id)
                    return (
                      <label key={a.id} className={`flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-700/30 rounded px-1 py-0.5 ${isPredicted ? 'bg-purple-500/5' : ''}`}>
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
                        {isPredicted && <span className="text-purple-400 text-[10px] ml-auto">AI predicted</span>}
                      </label>
                    )
                  })}
                </div>
                {parentAbbs.length > 0 && (
                  <p className="text-xs text-gray-500 mt-1">{parentAbbs.length} ABB{parentAbbs.length > 1 ? 's' : ''} selected</p>
                )}
              </div>
            )}

            {/* Predicted PBCs (ABB only) */}
            {form.type === 'ABB' && aiAnalysis.predicted_pbcs && aiAnalysis.predicted_pbcs.length > 0 && (
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1">
                  Predicted Business Capabilities
                  <span className="font-normal text-gray-600 ml-2">PBCs that may compose this ABB</span>
                </label>
                {aiAnalysis.pbc_reasoning && (
                  <p className="text-xs text-gray-500 mb-2">{aiAnalysis.pbc_reasoning}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {aiAnalysis.predicted_pbcs.map(pbcId => (
                    <span key={pbcId} className="px-2 py-1 text-xs rounded bg-teal-500/10 text-teal-400 border border-teal-500/20 font-mono">
                      {pbcId}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-gray-600 mt-1">These can be linked after the pattern is created</p>
              </div>
            )}

            {/* Follow-up Questions */}
            {aiAnalysis.follow_up_questions && aiAnalysis.follow_up_questions.length > 0 && (
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-2">Follow-up Questions</label>
                <div className="space-y-3">
                  {aiAnalysis.follow_up_questions.map((q, i) => (
                    <div key={i}>
                      <label className="block text-xs text-gray-300 mb-1">{q.question}</label>
                      <input
                        type="text"
                        value={followUpAnswers[i] || ''}
                        onChange={e => setFollowUpAnswers(prev => ({ ...prev, [i]: e.target.value }))}
                        placeholder={q.hint || 'Optional — helps AI generate a better draft'}
                        className="input w-full text-sm"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* System Context Summary */}
            {aiAnalysis.context_summary && (
              <div className="bg-gray-900/50 rounded-lg px-3 py-2">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[10px] text-gray-500">&#128161;</span>
                  <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">System Context</span>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">{aiAnalysis.context_summary}</p>
              </div>
            )}
          </div>
        )}

        {/* Generate button — only after analysis */}
        {aiAnalysis && (
          <div className="flex gap-3">
            <button
              onClick={handleAIGenerate}
              disabled={aiLoading}
              className="btn-primary flex-1 py-3 text-base"
            >
              {aiLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z"/></svg>
                  Generating draft...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  &#128640; Generate Draft
                </span>
              )}
            </button>
            <button
              onClick={() => setStep('editor')}
              className="btn-secondary py-3"
            >
              Write Manually
            </button>
          </div>
        )}
      </div>
    )
  }

  // --- EDITOR STEP ---
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm">
        <Link to="/patterns" className="text-gray-500 hover:text-gray-300 transition-colors">&larr; Patterns</Link>
        <span className="text-gray-700">/</span>
        <span className="text-gray-400">{isNew ? 'New Pattern' : `Edit ${id}`}</span>
      </div>
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

      {/* AI Assistant — Prompt Box (matches TechnologyDetail style) */}
      <PatternAIPromptBox
        onRun={handleCustomAI}
        loading={customLoading}
        result={customResult}
        onClear={() => setCustomResult(null)}
        error={smartError}
      />

      {/* Quick AI Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-600 font-medium">Quick Actions</span>
        {[
          { action: 'auto_tags',              label: 'Auto Tags',     icon: '\u{1F3F7}' },
          { action: 'generate_description',   label: 'Description',   icon: '\u{1F4C4}' },
          { action: 'suggest_relationships',  label: 'Relationships', icon: '\u{1F517}' },
          { action: 'quality_check',          label: 'Quality Check', icon: '\u2705' },
          { action: 'auto_fill_empty',        label: 'Fill Empty',    icon: '\u{1F527}' },
        ].map(({ action, label, icon }) => (
          <button
            key={action}
            onClick={() => handleSmartAction(action)}
            disabled={!!smartLoading || customLoading}
            className="px-3 py-1 text-xs rounded-full bg-gray-800 border border-gray-700 text-gray-400 hover:border-purple-500/30 hover:text-purple-400 disabled:opacity-40 transition-colors flex items-center gap-1"
          >
            {smartLoading === action ? (
              <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" /></svg>
            ) : (
              <span>{icon}</span>
            )}
            {label}
          </button>
        ))}
      </div>

      {/* Smart Action Results */}
      {smartResult && smartResult.action === 'auto_tags' && Array.isArray(smartResult.data) && (
        <div className="p-3 bg-gray-900/50 rounded-lg border border-gray-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400 font-medium">Suggested Tags</span>
            <button onClick={() => applyAutoTags(smartResult.data)} className="px-3 py-1 text-xs rounded bg-purple-600/30 text-purple-300 hover:bg-purple-600/50 transition-colors">
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
          <button onClick={() => setSmartResult(null)} className="px-3 py-1 text-xs rounded bg-gray-700 text-gray-400 hover:bg-gray-600 transition-colors mt-2">
            Clear
          </button>
        </div>
      )}

      {smartResult && smartResult.action === 'generate_description' && (
        <div className="p-3 bg-gray-900/50 rounded-lg border border-gray-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400 font-medium">Generated Description</span>
          </div>
          <p className="text-sm text-gray-200 mb-2">{smartResult.data.description}</p>
          <div className="flex gap-2">
            <button onClick={() => applyDescription(smartResult.data.description)} className="px-3 py-1 text-xs rounded bg-purple-600/30 text-purple-300 hover:bg-purple-600/50 transition-colors">
              Apply
            </button>
            <button onClick={() => setSmartResult(null)} className="px-3 py-1 text-xs rounded bg-gray-700 text-gray-400 hover:bg-gray-600 transition-colors">
              Clear
            </button>
          </div>
        </div>
      )}

      {smartResult && smartResult.action === 'suggest_relationships' && (
        <div className="p-3 bg-gray-900/50 rounded-lg border border-gray-800">
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
          <button onClick={() => setSmartResult(null)} className="px-3 py-1 text-xs rounded bg-gray-700 text-gray-400 hover:bg-gray-600 transition-colors mt-2">
            Clear
          </button>
        </div>
      )}

      {smartResult && smartResult.action === 'quality_check' && (
        <div className="p-3 bg-gray-900/50 rounded-lg border border-gray-800">
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
          <button onClick={() => setSmartResult(null)} className="px-3 py-1 text-xs rounded bg-gray-700 text-gray-400 hover:bg-gray-600 transition-colors mt-2">
            Clear
          </button>
        </div>
      )}

      {smartResult && smartResult.action === 'auto_fill_empty' && typeof smartResult.data === 'object' && (
        <div className="p-3 bg-gray-900/50 rounded-lg border border-gray-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400 font-medium">Generated Content for Empty Fields</span>
            <button onClick={() => applyAutoFill(smartResult.data)} className="px-3 py-1 text-xs rounded bg-purple-600/30 text-purple-300 hover:bg-purple-600/50 transition-colors">
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
                    className="text-xs text-purple-400 hover:text-purple-300"
                  >
                    Apply
                  </button>
                </div>
                <p className="text-xs text-gray-300 line-clamp-3">{String(content).slice(0, 200)}{String(content).length > 200 ? '...' : ''}</p>
              </div>
            ))}
          </div>
          <button onClick={() => setSmartResult(null)} className="px-3 py-1 text-xs rounded bg-gray-700 text-gray-400 hover:bg-gray-600 transition-colors mt-2">
            Clear
          </button>
        </div>
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
            <label className="block text-xs text-gray-500 mb-1">Name <span className="text-red-400">*</span></label>
            <input
              type="text"
              value={form.name}
              onChange={e => { setField('name', e.target.value); setFieldErrors(fe => ({ ...fe, name: undefined })) }}
              placeholder="Pattern name"
              className={`input w-full ${fieldErrors.name ? 'border-red-500/50' : ''}`}
            />
            {fieldErrors.name && <p className="text-red-400 text-xs mt-1">{fieldErrors.name}</p>}
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
            <label className="block text-xs text-gray-500 mb-1">Type <span className="text-red-400">*</span></label>
            <select value={form.type} onChange={e => { setField('type', e.target.value); setFieldErrors(fe => ({ ...fe, type: undefined })) }} className={`select w-full ${fieldErrors.type ? 'border-red-500/50' : ''}`}>
              {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            {fieldErrors.type && <p className="text-red-400 text-xs mt-1">{fieldErrors.type}</p>}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Category <span className="text-red-400">*</span></label>
            <select value={form.category} onChange={e => { setField('category', e.target.value); setFieldErrors(fe => ({ ...fe, category: undefined })) }} className={`select w-full ${fieldErrors.category ? 'border-red-500/50' : ''}`}>
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
              provider={null}
              model={null}
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
                provider={null}
                model={null}
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
            'Inter-Element Contracts', 'Related Patterns', 'Related ADRs', 'Restrictions'
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
                provider={null}
                model={null}
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
              provider={null}
              model={null}
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
                  provider={null}
                  model={null}
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
                  provider={null}
                  model={null}
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
              provider={null}
              model={null}
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
              provider={null}
              model={null}
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
              provider={null}
              model={null}
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
              provider={null}
              model={null}
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
                  provider={null}
                  model={null}
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
                  provider={null}
                  model={null}
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
              provider={null}
              model={null}
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
                    onClick={() => setDeleteImageTarget(img)}
                    className="absolute top-1 right-1 bg-red-600/80 text-white text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  >{'\u2715'}</button>
                </div>
              ))}
            </div>
          )}
          {imageError && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-3 py-2 text-xs mb-2 flex items-center justify-between">
              <span>{imageError}</span>
              <button onClick={() => setImageError('')} className="text-red-400 hover:text-red-300 ml-2">&times;</button>
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
              setImageError('')
              try {
                const meta = await uploadPatternImage(id, file, file.name)
                setExistingImages(prev => [...prev, meta])
              } catch (err) {
                setImageError(err.message)
              }
              setUploadingImage(false)
              e.target.value = ''
            }}
            className="text-sm text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-gray-600 file:text-gray-300 file:bg-gray-800 file:cursor-pointer hover:file:bg-gray-700"
          />
          {uploadingImage && <p className="text-xs text-gray-500 mt-1">Uploading...</p>}
        </div>
      )}

      <ConfirmModal
        open={!!deleteImageTarget}
        title="Delete Image"
        message={`Are you sure you want to delete image "${deleteImageTarget?.title}"?`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => {
          const img = deleteImageTarget
          setDeleteImageTarget(null)
          try {
            await deletePatternImage(id, img.id)
            setExistingImages(prev => prev.filter(x => x.id !== img.id))
          } catch (err) {
            setImageError(err.message)
          }
        }}
        onCancel={() => setDeleteImageTarget(null)}
      />
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
