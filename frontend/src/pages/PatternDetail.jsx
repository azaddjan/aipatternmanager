import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom'
import { fetchPattern, deletePattern, fetchPatternGraph } from '../api/client'
import AutoLinkedText from '../components/AutoLinkedText'
import MarkdownContent from '../components/MarkdownContent'
import GraphView from '../components/GraphView'
import { TypeBadge } from '../components/PatternCard'

export default function PatternDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [pattern, setPattern] = useState(null)
  const [graphData, setGraphData] = useState(null)
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

  const handleDelete = async () => {
    if (!confirm(`Delete pattern ${id}? This cannot be undone.`)) return
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
          </p>
          {pattern.deprecation_note && (
            <p className="text-red-400 text-sm mt-1 bg-red-500/10 rounded px-2 py-1 inline-block">
              {pattern.deprecation_note}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Link to={`/patterns/${id}/edit`} className="btn-secondary">Edit</Link>
          <Link to={`/impact?id=${id}`} className="btn-secondary">Impact Analysis</Link>
          <button onClick={handleDelete} className="btn-danger">Delete</button>
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
      {tab === 'content' && <StructuredContent pattern={pattern} />}

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

function StructuredContent({ pattern }) {
  const type = pattern.type

  if (type === 'AB') return <ABContent p={pattern} />
  if (type === 'ABB') return <ABBContent p={pattern} />
  if (type === 'SBB') return <SBBContent p={pattern} />

  // Fallback for unknown types
  return (
    <div className="card">
      <p className="text-gray-500 italic">No structured content available for this pattern type.</p>
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
      <CapabilitiesSection capabilities={p.business_capabilities} />
      <RestrictionsSection restrictions={p.restrictions} />
      <InteropSection title="Consumed By" ids={p.consumed_by_ids} />
      <InteropSection title="Works With" ids={p.works_with_ids} />
    </div>
  )
}

function SBBContent({ p }) {
  // Find parent ABB from IMPLEMENTS relationships
  const parentAbb = useMemo(() => {
    const rels = p.relationships || []
    const impl = rels.find(r => r.type === 'IMPLEMENTS' && r.target_id?.startsWith('ABB-'))
    return impl ? { id: impl.target_id, name: impl.target_name } : null
  }, [p.relationships])

  // Fetch parent ABB's business capabilities
  const [inheritedCaps, setInheritedCaps] = useState(null)
  useEffect(() => {
    if (!parentAbb) return
    fetchPattern(parentAbb.id)
      .then(abb => setInheritedCaps(abb.business_capabilities || []))
      .catch(() => setInheritedCaps(null))
  }, [parentAbb])

  return (
    <div className="space-y-4">
      <ContentSection title="Specific Functionality" content={p.specific_functionality} />
      <InterfaceSection title="Inbound Interfaces" content={p.inbound_interfaces} />
      <InterfaceSection title="Outbound Interfaces" content={p.outbound_interfaces} />
      <MappingSection mapping={p.sbb_mapping} />
      {inheritedCaps && inheritedCaps.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">
            Business Capabilities
            {parentAbb && (
              <span className="font-normal text-gray-600 ml-2">
                inherited via{' '}
                <Link to={`/patterns/${parentAbb.id}`} className="text-blue-400 hover:underline">
                  {parentAbb.id}
                </Link>
              </span>
            )}
          </h3>
          <div className="flex flex-wrap gap-2">
            {inheritedCaps.map((cap, i) => (
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
