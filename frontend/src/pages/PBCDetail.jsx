import { useState, useEffect, useCallback } from 'react'
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom'
import { fetchPBC, deletePBC, fetchPBCGraph } from '../api/client'
import GraphView from '../components/GraphView'

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
