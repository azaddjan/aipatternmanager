import { useState, useEffect } from 'react'
import { fetchFullGraph } from '../api/client'
import GraphView from '../components/GraphView'

const FILTER_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'AB', label: 'AB (Topology)' },
  { value: 'ABB', label: 'ABB (Logical)' },
  { value: 'SBB', label: 'SBB (Physical)' },
  { value: 'Technology', label: 'Technologies' },
]

const CATEGORY_OPTIONS = [
  { value: '', label: 'All Categories' },
  { value: 'blueprint', label: 'Architecture Topology' },
  { value: 'core', label: 'Core AI/LLM' },
  { value: 'intg', label: 'Integration' },
  { value: 'agt', label: 'Agents' },
  { value: 'kr', label: 'Knowledge & Retrieval' },
  { value: 'xcut', label: 'Cross-Cutting' },
  { value: 'pip', label: 'Platform Integration' },
]

export default function GraphExplorer() {
  const [data, setData] = useState(null)
  const [typeFilter, setTypeFilter] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedNode, setSelectedNode] = useState(null)

  useEffect(() => {
    fetchFullGraph()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  const filteredData = data ? {
    nodes: data.nodes.filter(n => {
      if (typeFilter) {
        if (typeFilter === 'Technology') return n.node_type === 'Technology'
        return n.type === typeFilter
      }
      if (catFilter) return n.category === catFilter
      return true
    }),
    edges: data.edges.filter(e => {
      const nodeIds = new Set(
        data.nodes
          .filter(n => {
            if (typeFilter) {
              if (typeFilter === 'Technology') return n.node_type === 'Technology'
              return n.type === typeFilter
            }
            if (catFilter) return n.category === catFilter
            return true
          })
          .map(n => n.id)
      )
      return nodeIds.has(e.source) && nodeIds.has(e.target)
    }),
  } : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Graph Explorer</h1>
        <p className="text-gray-500 text-sm mt-1">Interactive pattern relationship graph. Double-click a node to navigate.</p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setCatFilter('') }} className="select">
          {FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={catFilter} onChange={e => { setCatFilter(e.target.value); setTypeFilter('') }} className="select">
          {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {filteredData && (
          <span className="text-sm text-gray-500 ml-auto">
            {filteredData.nodes.length} nodes &middot; {filteredData.edges.length} edges
          </span>
        )}
      </div>

      {loading ? (
        <div className="text-gray-500 text-center py-24">Loading graph...</div>
      ) : (
        <GraphView
          data={filteredData}
          height="calc(100vh - 220px)"
          onNodeClick={setSelectedNode}
        />
      )}
    </div>
  )
}
