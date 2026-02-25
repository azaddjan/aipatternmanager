import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom'
import { fetchPattern, deletePattern, fetchPatternGraph, fetchImpactAnalysis, aiPatternAssist, getArtifactsUrl, getUploadUrl, authenticatedDownload } from '../api/client'
import AutoLinkedText from '../components/AutoLinkedText'
import MarkdownContent from '../components/MarkdownContent'
import GraphView from '../components/GraphView'
import { TypeBadge } from '../components/PatternCard'
import { useAuth } from '../contexts/AuthContext'

export default function PatternDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { canEditPattern } = useAuth()
  const [pattern, setPattern] = useState(null)
  const [graphData, setGraphData] = useState(null)
  const [impactData, setImpactData] = useState(null)
  const [tab, setTab] = useState('content') // content | relationships | graph
  const [loading, setLoading] = useState(true)

  const loadPattern = useCallback(() => {
    setLoading(true)
    setPattern(null)
    Promise.all([
      fetchPattern(id),
      fetchPatternGraph(id).catch(() => null),
    ]).then(([p, g]) => {
      setPattern(p)
      setGraphData(g)
      setLoading(false)
    }).catch(() => {
      setPattern(null)
      setLoading(false)
    })
  }, [id])

  useEffect(() => {
    loadPattern()
  }, [loadPattern, location.key, location.state])

  // Eagerly load impact data for AI context
  useEffect(() => {
    if (!pattern) return
    if (!impactData) fetchImpactAnalysis(id).then(setImpactData).catch(() => {})
  }, [pattern])

  const handleDelete = async () => {
    const imgCount = pattern?.images?.length || 0
    const diagCount = pattern?.diagrams?.length || 0
    const hasArtifacts = imgCount > 0 || diagCount > 0
    let msg = `Delete pattern ${id}? This cannot be undone.`
    if (hasArtifacts) {
      msg += `\n\nThis pattern has ${imgCount} image(s) and ${diagCount} diagram(s). They will be deleted.\nDownload artifacts first from the button in the header.`
    }
    if (!confirm(msg)) return
    try {
      await deletePattern(id)
      navigate('/patterns')
    } catch (err) {
      alert(err.message)
    }
  }

  if (loading) return <div className="text-gray-500 text-center py-12">Loading pattern...</div>
  if (!pattern) return <div className="text-red-400 text-center py-12">Pattern {id} not found</div>

  const relationships = pattern.relationships || []
  const implements_rels = relationships.filter(r => r.type === 'IMPLEMENTS')
  const depends_on_rels = relationships.filter(r => r.type === 'DEPENDS_ON')
  const uses_rels = relationships.filter(r => r.type === 'USES')
  const ref_rels = relationships.filter(r => r.type === 'REFERENCES')
  const composes_rels = relationships.filter(r => r.type === 'COMPOSES')
  const compatible_rels = relationships.filter(r => r.type === 'COMPATIBLE_WITH')

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link to="/patterns" className="text-gray-500 hover:text-gray-300 transition-colors">&larr; Patterns</Link>
        <span className="text-gray-700">/</span>
        <span className="text-gray-400">{pattern.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <TypeBadge type={pattern.type} />
            <span className="text-gray-500 font-mono text-sm">{pattern.id}</span>
            <span className={`text-xs px-2 py-0.5 rounded ${
              pattern.status === 'ACTIVE' ? 'bg-green-500/20 text-green-400' :
              pattern.status === 'DEPRECATED' ? 'bg-red-500/20 text-red-400' :
              'bg-yellow-500/20 text-yellow-400'
            }`}>{pattern.status}</span>
          </div>
          <h1 className="text-2xl font-bold text-white">{pattern.name}</h1>
          <p className="text-gray-500 text-sm mt-1">
            Category: {pattern.category} &middot; Version: {pattern.version}
            {pattern.team_name && <> &middot; Team: <span className="text-purple-400">{pattern.team_name}</span></>}
            {pattern.created_by && <> &middot; Created by: {pattern.created_by}</>}
          </p>
          {pattern.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {pattern.tags.map(tag => (
                <span key={tag} className="px-2 py-0.5 bg-blue-500/15 text-blue-400 text-xs rounded-full">{tag}</span>
              ))}
            </div>
          )}
          {pattern.deprecation_note && (
            <p className="text-red-400 text-sm mt-1 bg-red-500/10 rounded px-2 py-1 inline-block">
              {pattern.deprecation_note}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {(pattern.images?.length > 0 || pattern.diagrams?.length > 0) && (
            <button onClick={() => authenticatedDownload(getArtifactsUrl(id), `${id}-artifacts.zip`)} className="btn-secondary">Download Artifacts</button>
          )}
          {canEditPattern(pattern) && (
            <Link to={`/patterns/${id}/edit`} className="btn-secondary">Edit</Link>
          )}
          <Link to={`/impact?id=${id}`} className="btn-secondary">Impact Analysis</Link>
          {canEditPattern(pattern) && (
            <button onClick={handleDelete} className="btn-danger">Delete</button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800">
        {['content', 'relationships', 'graph'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm capitalize transition-colors border-b-2 ${
              tab === t
                ? 'text-blue-400 border-blue-400'
                : 'text-gray-500 border-transparent hover:text-gray-300'
            }`}
          >{t}</button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'content' && (
        <StructuredContent
          pattern={pattern}
          impactData={impactData}
          graphData={graphData}
        />
      )}

      {tab === 'relationships' && (
        <div className="space-y-4">
          <RelSection title="Implements" icon="🔗" rels={implements_rels} />
          <RelSection title="Depends On" icon="📦" rels={depends_on_rels} />
          <RelSection title="Uses Technologies" icon="⚙️" rels={uses_rels} linkPrefix="/technologies/" />
          <RelSection title="Compatible With" icon="🔌" rels={compatible_rels} linkPrefix="/technologies/" />
          <RelSection title="Composes" icon="🧱" rels={composes_rels} />
          <RelSection title="References" icon="📎" rels={ref_rels} />
        </div>
      )}

      {tab === 'graph' && (
        <GraphView data={graphData} height="500px" />
      )}
    </div>
  )
}

/* ---------- Structured Content Renderer ---------- */

function StructuredContent({ pattern, impactData, graphData }) {
  const type = pattern.type

  let typeContent = null
  if (type === 'AB') typeContent = <ABContent p={pattern} />
  else if (type === 'ABB') typeContent = <ABBContent p={pattern} />
  else if (type === 'SBB') typeContent = <SBBContent p={pattern} />
  else typeContent = (
    <div className="card">
      <p className="text-gray-500 italic">No structured content available for this pattern type.</p>
    </div>
  )

  return (
    <div className="space-y-4">
      <ContentSection title="Description" content={pattern.description} />
      {typeContent}
      <PatternAIAssistant pattern={pattern} impactData={impactData} graphData={graphData} />
      <DiagramsSection diagrams={pattern.diagrams} />
      <ImagesSection images={pattern.images} />
    </div>
  )
}

/* ---------- AI Assistant Components ---------- */

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

function PatternAIAssistant({ pattern, impactData, graphData }) {
  const [prompt, setPrompt] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(true)

  // Clean pattern data — strip large/internal fields
  const cleanPatternForAI = (p) => {
    if (!p) return {}
    const { embedding, created_at, updated_at, images, diagrams, ...rest } = p
    return rest
  }

  // Build enriched context from relationships, impact, graph, technologies
  const buildEnrichedContext = () => {
    const parts = []
    const rels = pattern.relationships || []

    // Relationships summary
    const relsByType = {}
    rels.forEach(r => {
      if (!relsByType[r.type]) relsByType[r.type] = []
      relsByType[r.type].push(r)
    })
    if (Object.keys(relsByType).length > 0) {
      const relSummary = Object.entries(relsByType).map(([type, items]) =>
        `${type}: ${items.map(r => `${r.target_id}(${r.target_name || ''})`).join(', ')}`
      ).join('. ')
      parts.push(`Relationships: ${relSummary}`)
    }

    // Technologies used (from USES relationships)
    const techRels = rels.filter(r => r.type === 'USES')
    if (techRels.length > 0) {
      parts.push(`Technologies used: ${techRels.map(r => `${r.target_id}(${r.target_name || ''})`).join(', ')}`)
    }

    // Impact data
    if (impactData) {
      const affected = impactData.affected_patterns || []
      const active = affected.filter(p => p.status === 'ACTIVE').length
      if (affected.length > 0) {
        parts.push(`Impact Analysis: ${affected.length} affected patterns (${active} active). Patterns: ${affected.slice(0, 15).map(p => `${p.id}(${p.type},${p.status})`).join(', ')}${affected.length > 15 ? ` +${affected.length - 15} more` : ''}`)
      } else {
        parts.push('Impact Analysis: No downstream affected patterns.')
      }
    }

    // Graph data
    if (graphData) {
      const nodes = graphData.nodes || []
      const edges = graphData.edges || []
      const nodeTypes = {}
      nodes.forEach(n => {
        const t = n.node_type || n.type || 'unknown'
        nodeTypes[t] = (nodeTypes[t] || 0) + 1
      })
      parts.push(`Graph: ${nodes.length} nodes (${Object.entries(nodeTypes).map(([t, c]) => `${t}=${c}`).join(', ')}), ${edges.length} edges`)
    }

    return parts.length > 0 ? '\n\nAdditional context from the system:\n' + parts.join('\n') : ''
  }

  const handleGenerate = async (userPrompt) => {
    const q = userPrompt || prompt
    if (!q.trim()) return
    setResult(null)
    setLoading(true)
    try {
      const enriched = buildEnrichedContext()
      const res = await aiPatternAssist({
        action: 'custom',
        pattern_data: cleanPatternForAI(pattern),
        custom_prompt: q.trim(),
        extra_context: enriched || undefined,
      })
      setResult(res.result)
    } catch (err) {
      setResult(`Error: ${err.message}`)
    }
    setLoading(false)
  }

  return (
    <div className="card border border-purple-500/20">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-purple-400 flex items-center gap-1.5">
          <SparkleIcon /> AI Assistant
        </h3>
        <div className="flex items-center gap-2">
          {result && (
            <button
              onClick={() => { setResult(null); setPrompt('') }}
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
              placeholder="Ask anything — AI knows relationships, impact, graph data... (e.g., 'Suggest improvements', 'Migration risk?', 'How is this used?')"
              className="input flex-1 text-sm"
              onKeyDown={e => e.key === 'Enter' && handleGenerate()}
            />
            <button
              onClick={() => handleGenerate()}
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
                <button
                  onClick={() => { setResult(null); setPrompt('') }}
                  className="px-3 py-1 text-xs rounded bg-gray-700 text-gray-400 hover:bg-gray-600 transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {!expanded && (
        <p className="text-xs text-gray-600">Click "Expand" to use AI to ask questions about this pattern.</p>
      )}
    </div>
  )
}

function ABContent({ p }) {
  return (
    <div className="space-y-4">
      <ContentSection title="Intent" content={p.intent} />
      <ContentSection title="Problem" content={p.problem} />
      <ContentSection title="Solution" content={p.solution} />
      <ContentSection title="Structural Elements" content={p.structural_elements} />
      <ContentSection title="Invariants" content={p.invariants} />
      <ContentSection title="Inter-Element Contracts" content={p.inter_element_contracts} />
      <ContentSection title="Related Patterns" content={p.related_patterns_text} />
      <ContentSection title="Related ADRs" content={p.related_adrs} />
      <ContentSection title="Building Blocks Note" content={p.building_blocks_note} />
      <RestrictionsSection restrictions={p.restrictions} />
    </div>
  )
}

function ABBContent({ p }) {
  return (
    <div className="space-y-4">
      <ContentSection title="Functionality" content={p.functionality} />
      <InterfaceSection title="Inbound Interfaces" content={p.inbound_interfaces} />
      <InterfaceSection title="Outbound Interfaces" content={p.outbound_interfaces} />
      <ContentSection title="Quality Attributes" content={p.quality_attributes} />
      <ContentSection title="Compliance Requirements" content={p.compliance_requirements} />
      <CapabilitiesSection capabilities={p.business_capabilities} />
      <RestrictionsSection restrictions={p.restrictions} />
      <InteropSection title="Consumed By" ids={p.consumed_by_ids} />
      <InteropSection title="Works With" ids={p.works_with_ids} />
    </div>
  )
}

function SBBContent({ p }) {
  // Find ALL parent ABBs from IMPLEMENTS relationships (SBB can realize multiple ABBs)
  const parentAbbs = useMemo(() => {
    const rels = p.relationships || []
    return rels
      .filter(r => r.type === 'IMPLEMENTS' && r.target_id?.startsWith('ABB-'))
      .map(r => ({ id: r.target_id, name: r.target_name }))
  }, [p.relationships])

  // Fetch business capabilities from ALL parent ABBs and merge them
  const [inheritedCapsMap, setInheritedCapsMap] = useState({}) // { abbId: [caps] }
  useEffect(() => {
    if (parentAbbs.length === 0) return
    Promise.all(
      parentAbbs.map(abb =>
        fetchPattern(abb.id)
          .then(data => ({ id: abb.id, caps: data.business_capabilities || [] }))
          .catch(() => ({ id: abb.id, caps: [] }))
      )
    ).then(results => {
      const map = {}
      results.forEach(r => { map[r.id] = r.caps })
      setInheritedCapsMap(map)
    })
  }, [parentAbbs])

  // Merge all inherited capabilities (deduplicated)
  const allInheritedCaps = useMemo(() => {
    const capSet = new Set()
    Object.values(inheritedCapsMap).forEach(caps => caps.forEach(c => capSet.add(c)))
    return [...capSet].sort()
  }, [inheritedCapsMap])

  return (
    <div className="space-y-4">
      <ContentSection title="Specific Functionality" content={p.specific_functionality} />
      <SolutionDetailsSection p={p} />
      <InterfaceSection title="Inbound Interfaces" content={p.inbound_interfaces} />
      <InterfaceSection title="Outbound Interfaces" content={p.outbound_interfaces} />
      <MappingSection mapping={p.sbb_mapping} />
      {allInheritedCaps.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">
            Business Capabilities
            {parentAbbs.length > 0 && (
              <span className="font-normal text-gray-600 ml-2">
                inherited via{' '}
                {parentAbbs.map((abb, i) => (
                  <span key={abb.id}>
                    {i > 0 && ', '}
                    <Link to={`/patterns/${abb.id}`} className="text-blue-400 hover:underline">
                      {abb.id}
                    </Link>
                  </span>
                ))}
              </span>
            )}
          </h3>
          <div className="flex flex-wrap gap-2">
            {allInheritedCaps.map((cap, i) => (
              <span key={i} className="px-3 py-1 bg-blue-500/10 text-blue-300 text-sm rounded-full border border-blue-500/20">
                {cap}
              </span>
            ))}
          </div>
        </div>
      )}
      <RestrictionsSection restrictions={p.restrictions} />
      <InteropSection title="Consumed By" ids={p.consumed_by_ids} />
      <InteropSection title="Works With" ids={p.works_with_ids} />
    </div>
  )
}

/* ---------- Shared Section Components ---------- */

function RestrictionsSection({ restrictions }) {
  if (!restrictions) return null
  return (
    <div className="card border-orange-500/20">
      <h3 className="text-sm font-semibold text-orange-400 mb-3">⚠️ Restrictions</h3>
      <MarkdownContent content={restrictions} />
    </div>
  )
}

function ContentSection({ title, content }) {
  if (!content) return null
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-400 mb-3">{title}</h3>
      <MarkdownContent content={content} />
    </div>
  )
}

function InterfaceSection({ title, content }) {
  if (!content) return null
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-400 mb-3">{title}</h3>
      <MarkdownContent content={content} />
    </div>
  )
}

function CapabilitiesSection({ capabilities }) {
  if (!capabilities || capabilities.length === 0) return null
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-400 mb-3">Business Capabilities</h3>
      <div className="flex flex-wrap gap-2">
        {capabilities.map((cap, i) => (
          <span key={i} className="px-3 py-1 bg-blue-500/10 text-blue-300 text-sm rounded-full border border-blue-500/20">
            {cap}
          </span>
        ))}
      </div>
    </div>
  )
}

function MappingSection({ mapping }) {
  if (!mapping || mapping.length === 0) return null
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-400 mb-3">SBB Mapping</h3>
      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-800/80">
            <tr>
              <th className="text-left py-2.5 px-3 text-gray-300 font-semibold text-xs uppercase tracking-wider">Key</th>
              <th className="text-left py-2.5 px-3 text-gray-300 font-semibold text-xs uppercase tracking-wider">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {mapping.map((row, i) => (
              <tr key={i} className="hover:bg-gray-800/40 transition-colors">
                <td className="py-2.5 px-3 text-white font-medium"><MarkdownContent content={row.key} /></td>
                <td className="py-2.5 px-3 text-gray-300"><MarkdownContent content={row.value} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function InteropSection({ title, ids }) {
  if (!ids || ids.length === 0) return null
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-400 mb-3">{title}</h3>
      <div className="flex flex-wrap gap-2">
        {ids.map((pid, i) => (
          <Link
            key={i}
            to={`/patterns/${pid}`}
            className="px-3 py-1 bg-gray-800 text-blue-400 text-sm rounded-lg border border-gray-700 hover:border-blue-500/40 hover:bg-gray-700 transition-colors font-mono"
          >
            {pid}
          </Link>
        ))}
      </div>
    </div>
  )
}

/* ---------- Solution Details (SBB) ---------- */

function SolutionDetailsSection({ p }) {
  if (!p.vendor && !p.deployment_model && !p.cost_tier && !p.licensing && !p.maturity) return null
  const items = [
    { label: 'Vendor', value: p.vendor },
    { label: 'Deployment', value: p.deployment_model },
    { label: 'Cost Tier', value: p.cost_tier },
    { label: 'Licensing', value: p.licensing },
    { label: 'Maturity', value: p.maturity },
  ].filter(x => x.value)
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-400 mb-3">Solution Details</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {items.map(({ label, value }) => (
          <div key={label}>
            <span className="text-xs text-gray-500">{label}</span>
            <p className="text-sm text-gray-200">{value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------- Diagrams Section ---------- */

function DiagramsSection({ diagrams }) {
  if (!diagrams || diagrams.length === 0) return null
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-400 mb-3">Diagrams ({diagrams.length})</h3>
      <div className="space-y-4">
        {diagrams.map(diag => (
          <div key={diag.id}>
            {diag.title && <p className="text-sm text-gray-300 font-medium mb-2">{diag.title}</p>}
            <MermaidRenderer content={diag.content} />
          </div>
        ))}
      </div>
    </div>
  )
}

function MermaidRenderer({ content }) {
  const containerRef = useRef(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!content || !containerRef.current) return
    let cancelled = false
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
        if (!cancelled) setError(err.message || 'Render error')
      })
    })
    return () => { cancelled = true }
  }, [content])

  return (
    <div>
      <div ref={containerRef} className="bg-gray-900 rounded p-3 overflow-auto" />
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  )
}

/* ---------- Images Section ---------- */

function ImagesSection({ images }) {
  if (!images || images.length === 0) return null
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-400 mb-3">Images ({images.length})</h3>
      <div className="grid grid-cols-2 gap-4">
        {images.map(img => (
          <div key={img.id}>
            <img
              src={getUploadUrl(img.filename)}
              alt={img.title}
              className="w-full rounded-lg border border-gray-700"
            />
            {img.title && <p className="text-xs text-gray-500 mt-1">{img.title}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------- Relationship Section ---------- */

function RelSection({ title, icon, rels, linkPrefix = '/patterns/' }) {
  if (rels.length === 0) return null
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-400 mb-3">{icon} {title} ({rels.length})</h3>
      <div className="space-y-1.5">
        {rels.map((r, i) => (
          <div key={i} className="flex items-center gap-3 text-sm">
            <Link to={`${linkPrefix}${r.target_id}`} className="text-blue-400 font-mono text-xs hover:underline">
              {r.target_id}
            </Link>
            <span className="text-gray-400">{r.target_name}</span>
            <span className="text-xs text-gray-600 ml-auto">{r.target_label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
