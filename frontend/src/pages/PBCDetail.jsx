import { useState, useEffect, useCallback } from 'react'
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom'
import { fetchPBC, deletePBC, fetchPBCGraph, aiPBCAssist } from '../api/client'
import GraphView from '../components/GraphView'
import MarkdownContent from '../components/MarkdownContent'

export default function PBCDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [pbc, setPbc] = useState(null)
  const [graphData, setGraphData] = useState(null)
  const [tab, setTab] = useState('overview') // overview | relationships | graph
  const [loading, setLoading] = useState(true)

  const loadPBC = useCallback(() => {
    setLoading(true)
    setPbc(null)
    Promise.all([
      fetchPBC(id),
      fetchPBCGraph(id).catch(() => null),
    ]).then(([p, g]) => {
      setPbc(p)
      setGraphData(g)
      setLoading(false)
    }).catch(() => {
      setPbc(null)
      setLoading(false)
    })
  }, [id])

  useEffect(() => {
    loadPBC()
  }, [loadPBC, location.key])

  const handleDelete = async () => {
    if (!confirm(`Delete PBC ${id}? This cannot be undone.`)) return
    try {
      await deletePBC(id)
      navigate('/pbcs')
    } catch (err) {
      alert(err.message)
    }
  }

  if (loading) return <div className="text-gray-500 text-center py-12">Loading PBC...</div>
  if (!pbc) return <div className="text-red-400 text-center py-12">PBC {id} not found</div>

  const abbIds = pbc.abb_ids || []

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link to="/pbcs" className="text-gray-500 hover:text-gray-300 transition-colors">&larr; Business Capabilities</Link>
        <span className="text-gray-700">/</span>
        <span className="text-gray-400">{pbc.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className="badge-pbc font-mono text-xs">{pbc.id}</span>
            <span className={`text-xs px-2 py-0.5 rounded ${
              pbc.status === 'ACTIVE' ? 'bg-green-500/20 text-green-400' :
              pbc.status === 'DEPRECATED' ? 'bg-red-500/20 text-red-400' :
              'bg-yellow-500/20 text-yellow-400'
            }`}>{pbc.status}</span>
          </div>
          <h1 className="text-2xl font-bold text-white">{pbc.name}</h1>
          {pbc.api_endpoint && (
            <p className="text-gray-500 text-sm mt-1 font-mono">{pbc.api_endpoint}</p>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={handleDelete} className="btn-danger">Delete</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800">
        {['overview', 'relationships', 'graph'].map(t => (
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
      {tab === 'overview' && (
        <div className="space-y-4">
          {/* Info Cards */}
          <div className="grid grid-cols-3 gap-4">
            <div className={`card border-l-4 ${
              pbc.status === 'ACTIVE' ? 'border-green-500' :
              pbc.status === 'DEPRECATED' ? 'border-red-500' : 'border-yellow-500'
            }`}>
              <p className="text-xs text-gray-500">Status</p>
              <p className={`text-lg font-semibold ${
                pbc.status === 'ACTIVE' ? 'text-green-400' :
                pbc.status === 'DEPRECATED' ? 'text-red-400' : 'text-yellow-400'
              }`}>{pbc.status}</p>
            </div>
            <div className="card border-l-4 border-blue-500">
              <p className="text-xs text-gray-500">Composed ABBs</p>
              <p className="text-lg font-semibold text-blue-400">{abbIds.length}</p>
            </div>
            <div className="card border-l-4 border-gray-600">
              <p className="text-xs text-gray-500">API Endpoint</p>
              <p className="text-lg font-semibold text-white font-mono">
                {pbc.api_endpoint || 'Not set'}
              </p>
            </div>
          </div>

          {/* Description */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-2">Description</h2>
            {pbc.description ? (
              <p className="text-gray-300 leading-relaxed">{pbc.description}</p>
            ) : (
              <p className="text-gray-600 italic">No description available.</p>
            )}
          </div>

          {/* Composed ABBs */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">
              Composed ABBs ({abbIds.length})
            </h2>
            {abbIds.length > 0 ? (
              <div className="space-y-1.5">
                {abbIds.map(abbId => (
                  <div key={abbId} className="flex items-center gap-3 text-sm py-1.5 border-b border-gray-800/50 last:border-0">
                    <span className="badge-abb text-xs font-mono">{abbId.split('-').slice(0,2).join('-')}</span>
                    <Link to={`/patterns/${abbId}`} className="text-blue-400 font-mono text-xs hover:underline">
                      {abbId}
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-600 text-sm">No ABBs composed yet.</p>
            )}
          </div>

          {/* AI Assistant */}
          <PBCAIAssistant pbc={pbc} graphData={graphData} />
        </div>
      )}

      {tab === 'relationships' && (
        <div className="space-y-4">
          {/* COMPOSES */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-400 mb-3">
              COMPOSES ({abbIds.length})
            </h3>
            {abbIds.length > 0 ? (
              <div className="space-y-1.5">
                {abbIds.map(abbId => (
                  <div key={abbId} className="flex items-center gap-3 text-sm">
                    <span className="text-teal-400 text-xs">COMPOSES</span>
                    <span className="text-gray-600">&rarr;</span>
                    <Link to={`/patterns/${abbId}`} className="text-blue-400 font-mono text-xs hover:underline">
                      {abbId}
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-600 text-sm italic">No relationships found.</p>
            )}
          </div>
        </div>
      )}

      {tab === 'graph' && (
        <GraphView data={graphData} height="500px" />
      )}
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

function PBCAIAssistant({ pbc, graphData }) {
  const [prompt, setPrompt] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(true)

  // Clean PBC data — strip large/internal fields
  const cleanPBCForAI = (p) => {
    if (!p) return {}
    const { embedding, created_at, updated_at, ...rest } = p
    return rest
  }

  // Build enriched context from composed ABBs, graph data
  const buildEnrichedContext = () => {
    const parts = []
    const abbIds = pbc.abb_ids || []

    // Composed ABBs
    if (abbIds.length > 0) {
      parts.push(`Composed ABBs (${abbIds.length}): ${abbIds.join(', ')}`)
    } else {
      parts.push('Composed ABBs: None')
    }

    // Graph data — includes connected SBBs, technologies, and other patterns
    if (graphData) {
      const nodes = graphData.nodes || []
      const edges = graphData.edges || []
      const nodeTypes = {}
      nodes.forEach(n => {
        const t = n.node_type || n.type || 'unknown'
        nodeTypes[t] = (nodeTypes[t] || 0) + 1
      })
      parts.push(`Graph: ${nodes.length} nodes (${Object.entries(nodeTypes).map(([t, c]) => `${t}=${c}`).join(', ')}), ${edges.length} edges`)

      // Extract connected SBBs and Technologies from graph
      const sbbs = nodes.filter(n => (n.node_type || n.type) === 'SBB')
      const techs = nodes.filter(n => (n.node_type || n.type) === 'Technology')
      if (sbbs.length > 0) {
        parts.push(`Connected SBBs: ${sbbs.map(n => `${n.id}(${n.name || ''})`).join(', ')}`)
      }
      if (techs.length > 0) {
        parts.push(`Connected Technologies: ${techs.map(n => `${n.id}(${n.name || ''})`).join(', ')}`)
      }
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
      const res = await aiPBCAssist({
        action: 'custom',
        pbc_data: cleanPBCForAI(pbc),
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
              placeholder="Ask anything — AI knows composed ABBs, graph connections, SBBs, technologies... (e.g., 'Suggest missing ABBs', 'What technologies support this?')"
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
        <p className="text-xs text-gray-600">Click "Expand" to use AI to ask questions about this business capability.</p>
      )}
    </div>
  )
}
