import { useState, useEffect, useRef, useCallback } from 'react'
import { Network } from 'vis-network'
import { DataSet } from 'vis-data'
import { useNavigate } from 'react-router-dom'

const NODE_COLORS = {
  AB:         { background: '#f97316', border: '#ea580c', font: '#fff' },
  ABB:        { background: '#2563eb', border: '#1d4ed8', font: '#fff' },
  SBB:        { background: '#16a34a', border: '#15803d', font: '#fff' },
  PBC:        { background: '#7c3aed', border: '#6d28d9', font: '#fff' },
  Technology: { background: '#6b7280', border: '#4b5563', font: '#fff' },
}

const EDGE_COLORS = {
  IMPLEMENTS:     '#3b82f6',
  DEPENDS_ON:     '#ef4444',
  USES:           '#8b5cf6',
  REFERENCES:     '#6b7280',
  CONSTRAINED_BY: '#f59e0b',
  COMPOSES:       '#14b8a6',
  COMPATIBLE_WITH:'#22d3ee',
}

const HIERARCHY_LEVELS = { PBC: 0, AB: 1, ABB: 1, SBB: 2, Technology: 3 }

export default function GraphView({ data, height = '600px', onNodeClick }) {
  const containerRef = useRef(null)
  const networkRef = useRef(null)
  const nodesDataSetRef = useRef(null)
  const edgesDataSetRef = useRef(null)
  const allEdgesRef = useRef([])
  const navigate = useNavigate()

  // Feature 1: Edge type toggles
  const [visibleEdgeTypes, setVisibleEdgeTypes] = useState(() => new Set(Object.keys(EDGE_COLORS)))
  // Feature 2: Layout mode
  const [layoutMode, setLayoutMode] = useState('force')
  // Feature 3: Node detail sidebar (always open, collapsible)
  const [selectedNodeData, setSelectedNodeData] = useState(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  // Feature 4: Search
  const [searchQuery, setSearchQuery] = useState('')
  const searchTimerRef = useRef(null)
  const [debouncedQuery, setDebouncedQuery] = useState('')

  // Debounce search
  useEffect(() => {
    clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => setDebouncedQuery(searchQuery), 150)
    return () => clearTimeout(searchTimerRef.current)
  }, [searchQuery])

  // Reset state when data content actually changes (filter/fetch, not just re-render)
  const dataSignature = data ? `${data.nodes.length}-${data.edges.length}-${data.nodes.map(n => n.id).join(',')}` : ''
  const prevSignatureRef = useRef(dataSignature)
  useEffect(() => {
    if (prevSignatureRef.current !== dataSignature) {
      prevSignatureRef.current = dataSignature
      setSelectedNodeData(null)
      setSearchQuery('')
      setDebouncedQuery('')
    }
  }, [dataSignature])

  // Helper: get node type key for colors/levels
  const getNodeTypeKey = useCallback((n) => {
    if (n.node_type === 'Technology') return 'Technology'
    if (n.node_type === 'PBC') return 'PBC'
    return n.type || 'ABB'
  }, [])

  // ---- Main network creation ----
  useEffect(() => {
    if (!containerRef.current || !data?.nodes?.length) return

    const nodeItems = data.nodes.map((n) => {
      const colorKey = getNodeTypeKey(n)
      const colors = NODE_COLORS[colorKey] || NODE_COLORS.ABB
      return {
        id: n.id,
        label: `${n.id}\n${n.name}`,
        color: { background: colors.background, border: colors.border },
        font: { color: colors.font, size: 11, face: 'monospace' },
        shape: n.node_type === 'Technology' ? 'diamond' : 'box',
        borderWidth: 2,
        margin: 8,
        title: `${n.node_type}: ${n.id} — ${n.name}\nType: ${n.type} | Category: ${n.category} | Status: ${n.status}`,
        _nodeType: colorKey,
      }
    })

    const edgeItems = data.edges.map((e, i) => ({
      id: `e-${i}`,
      from: e.source,
      to: e.target,
      label: e.type,
      color: { color: EDGE_COLORS[e.type] || '#6b7280', opacity: 0.8 },
      font: { size: 9, color: '#9ca3af', strokeWidth: 0 },
      arrows: { to: { enabled: true, scaleFactor: 0.7 } },
      smooth: { type: 'cubicBezier', roundness: 0.4 },
      _relType: e.type,
    }))

    allEdgesRef.current = edgeItems

    const visibleEdges = edgeItems.filter(e => visibleEdgeTypes.has(e._relType))

    nodesDataSetRef.current = new DataSet(nodeItems)
    edgesDataSetRef.current = new DataSet(visibleEdges)

    const options = {
      physics: {
        solver: 'forceAtlas2Based',
        forceAtlas2Based: {
          gravitationalConstant: -80,
          centralGravity: 0.01,
          springLength: 160,
          springConstant: 0.04,
          damping: 0.4,
        },
        stabilization: { iterations: 200 },
      },
      interaction: {
        hover: true,
        tooltipDelay: 200,
        zoomView: true,
        dragView: true,
      },
      layout: { improvedLayout: true },
    }

    networkRef.current = new Network(
      containerRef.current,
      { nodes: nodesDataSetRef.current, edges: edgesDataSetRef.current },
      options,
    )

    // Single click -> sidebar detail (expand sidebar on node click)
    networkRef.current.on('click', (params) => {
      if (params.nodes.length > 0) {
        const nodeId = params.nodes[0]
        const node = data.nodes.find((nd) => nd.id === nodeId)
        if (node) {
          const relationships = data.edges
            .filter(e => e.source === nodeId || e.target === nodeId)
            .map(e => ({
              type: e.type,
              direction: e.source === nodeId ? 'out' : 'in',
              otherId: e.source === nodeId ? e.target : e.source,
              otherName: data.nodes.find(nd => nd.id === (e.source === nodeId ? e.target : e.source))?.name || '',
            }))
          setSelectedNodeData({ ...node, relationships })
          setSidebarCollapsed(false)
        }
        if (onNodeClick) onNodeClick(nodeId)
      } else {
        // Click empty space: just deselect node, don't hide sidebar
        setSelectedNodeData(null)
      }
    })

    // Double click -> navigate
    networkRef.current.on('doubleClick', (params) => {
      if (params.nodes.length > 0) {
        const nodeId = params.nodes[0]
        const node = data.nodes.find((nd) => nd.id === nodeId)
        if (node?.node_type === 'Pattern') navigate(`/patterns/${nodeId}`)
        else if (node?.node_type === 'Technology') navigate(`/technologies/${nodeId}`)
        else if (node?.node_type === 'PBC') navigate(`/pbcs/${nodeId}`)
      }
    })

    return () => {
      if (networkRef.current) networkRef.current.destroy()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, navigate, onNodeClick, getNodeTypeKey])

  // ---- Edge type toggle effect ----
  useEffect(() => {
    if (!edgesDataSetRef.current || !allEdgesRef.current.length) return

    const currentIds = new Set(edgesDataSetRef.current.getIds())
    const desired = allEdgesRef.current.filter(e => visibleEdgeTypes.has(e._relType))
    const desiredIds = new Set(desired.map(e => e.id))

    const toRemove = [...currentIds].filter(id => !desiredIds.has(id))
    if (toRemove.length) edgesDataSetRef.current.remove(toRemove)

    const toAdd = desired.filter(e => !currentIds.has(e.id))
    if (toAdd.length) edgesDataSetRef.current.add(toAdd)
  }, [visibleEdgeTypes])

  // ---- Layout mode effect ----
  useEffect(() => {
    if (!networkRef.current || !nodesDataSetRef.current) return

    if (layoutMode === 'hierarchical') {
      const updates = nodesDataSetRef.current.get().map(node => ({
        id: node.id,
        level: HIERARCHY_LEVELS[node._nodeType] ?? 2,
      }))
      nodesDataSetRef.current.update(updates)

      networkRef.current.setOptions({
        layout: {
          hierarchical: {
            enabled: true,
            direction: 'UD',
            sortMethod: 'directed',
            levelSeparation: 140,
            nodeSpacing: 80,
            treeSpacing: 200,
          },
        },
        physics: {
          enabled: true,
          hierarchicalRepulsion: {
            centralGravity: 0.0,
            springLength: 120,
            springConstant: 0.01,
            nodeDistance: 150,
          },
        },
      })
    } else {
      const updates = nodesDataSetRef.current.get().map(node => ({
        id: node.id,
        level: undefined,
      }))
      nodesDataSetRef.current.update(updates)

      networkRef.current.setOptions({
        layout: { hierarchical: { enabled: false }, improvedLayout: true },
        physics: {
          solver: 'forceAtlas2Based',
          forceAtlas2Based: {
            gravitationalConstant: -80,
            centralGravity: 0.01,
            springLength: 160,
            springConstant: 0.04,
            damping: 0.4,
          },
        },
      })
    }

    setTimeout(() => networkRef.current?.fit(), 400)
  }, [layoutMode])

  // ---- Search highlight effect ----
  useEffect(() => {
    if (!nodesDataSetRef.current || !edgesDataSetRef.current || !data) return

    const query = debouncedQuery.trim().toLowerCase()

    if (!query) {
      // Restore original colors
      const restored = nodesDataSetRef.current.get().map(node => {
        const colors = NODE_COLORS[node._nodeType] || NODE_COLORS.ABB
        return {
          id: node.id,
          color: { background: colors.background, border: colors.border },
          font: { color: colors.font, size: 11, face: 'monospace' },
          opacity: 1.0,
        }
      })
      nodesDataSetRef.current.update(restored)

      const restoredEdges = edgesDataSetRef.current.get().map(e => ({
        id: e.id,
        color: { color: EDGE_COLORS[e._relType] || '#6b7280', opacity: 0.8 },
      }))
      edgesDataSetRef.current.update(restoredEdges)
      return
    }

    const matchingIds = new Set(
      data.nodes
        .filter(n => n.id.toLowerCase().includes(query) || n.name.toLowerCase().includes(query))
        .map(n => n.id)
    )

    const nodeUpdates = nodesDataSetRef.current.get().map(node => {
      const isMatch = matchingIds.has(node.id)
      const colors = NODE_COLORS[node._nodeType] || NODE_COLORS.ABB
      return {
        id: node.id,
        color: isMatch
          ? { background: colors.background, border: '#fbbf24' }
          : { background: '#1f2937', border: '#374151' },
        font: { color: isMatch ? colors.font : '#4b5563', size: 11, face: 'monospace' },
        opacity: isMatch ? 1.0 : 0.15,
      }
    })
    nodesDataSetRef.current.update(nodeUpdates)

    const edgeUpdates = edgesDataSetRef.current.get().map(e => {
      const connected = matchingIds.has(e.from) || matchingIds.has(e.to)
      return {
        id: e.id,
        color: { color: EDGE_COLORS[e._relType] || '#6b7280', opacity: connected ? 0.8 : 0.05 },
      }
    })
    edgesDataSetRef.current.update(edgeUpdates)

    if (matchingIds.size === 1) {
      const matchId = [...matchingIds][0]
      networkRef.current?.focus(matchId, {
        scale: 1.2,
        animation: { duration: 400, easingFunction: 'easeInOutQuad' },
      })
    }
  }, [debouncedQuery, data])

  // ---- Empty state ----
  if (!data?.nodes?.length) {
    return (
      <div className="flex items-center justify-center text-gray-500" style={{ height }}>
        No graph data available
      </div>
    )
  }

  const toggleEdgeType = (type) => {
    setVisibleEdgeTypes(prev => {
      const next = new Set(prev)
      next.has(type) ? next.delete(type) : next.add(type)
      return next
    })
  }

  // Group relationships by type for sidebar
  const groupedRels = selectedNodeData?.relationships?.reduce((acc, r) => {
    if (!acc[r.type]) acc[r.type] = []
    acc[r.type].push(r)
    return acc
  }, {})

  return (
    <div className="relative flex flex-col" style={{ height }}>
      {/* ---- TOOLBAR ---- */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-900 border border-gray-800 rounded-t-lg flex-wrap min-h-[44px]">
        {/* Search */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search nodes..."
            className="input text-xs w-44 pl-7 py-1.5"
          />
          <svg className="absolute left-2 top-2 w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1.5 text-gray-500 hover:text-gray-300 text-xs">
              ✕
            </button>
          )}
        </div>

        <div className="w-px h-5 bg-gray-800" />

        {/* Layout toggle */}
        <button
          onClick={() => setLayoutMode(m => m === 'force' ? 'hierarchical' : 'force')}
          className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
            layoutMode === 'hierarchical'
              ? 'bg-purple-600/20 text-purple-400 border-purple-600/30'
              : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-gray-200'
          }`}
        >
          {layoutMode === 'hierarchical' ? '↕ Hierarchy' : '⟐ Force'}
        </button>

        {/* Fit button */}
        <button
          onClick={() => networkRef.current?.fit({ animation: { duration: 300 } })}
          className="px-2.5 py-1 rounded text-xs bg-gray-800 text-gray-400 border border-gray-700 hover:text-gray-200 transition-colors"
        >
          Fit
        </button>

        <div className="w-px h-5 bg-gray-800" />

        {/* Edge type toggles */}
        <div className="flex flex-wrap gap-1">
          {Object.entries(EDGE_COLORS).map(([type, color]) => {
            const active = visibleEdgeTypes.has(type)
            return (
              <button
                key={type}
                onClick={() => toggleEdgeType(type)}
                className={`px-2 py-0.5 rounded-full text-[10px] font-mono border transition-all ${
                  active ? 'text-white' : 'text-gray-600 opacity-40 border-gray-700'
                }`}
                style={{
                  borderColor: active ? color : undefined,
                  backgroundColor: active ? `${color}20` : 'transparent',
                }}
              >
                {type}
              </button>
            )
          })}
        </div>

        {/* Node/edge counts */}
        <span className="text-[10px] text-gray-600 ml-auto whitespace-nowrap">
          {data.nodes.length} nodes · {data.edges.filter(e => visibleEdgeTypes.has(e.type)).length} edges
        </span>
      </div>

      {/* ---- GRAPH CANVAS + OVERLAYS ---- */}
      <div className="relative flex-1 min-h-0">
        <div ref={containerRef} className="w-full h-full bg-gray-950 rounded-b-lg border border-t-0 border-gray-800" />

        {/* Legend */}
        <div className="absolute top-3 left-3 bg-gray-900/90 border border-gray-800 rounded-lg p-2.5 text-[10px] space-y-1">
          {Object.entries(NODE_COLORS).map(([key, val]) => (
            <div key={key} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: val.background }} />
              <span className="text-gray-400">{key}</span>
            </div>
          ))}
        </div>

        {/* ---- DETAIL SIDEBAR (always present, collapsible) ---- */}
        <div className={`absolute top-0 right-0 h-full z-10 transition-all duration-200 ${
          sidebarCollapsed ? 'w-8' : 'w-72'
        }`}>
          {/* Collapsed state: thin strip with expand button */}
          {sidebarCollapsed && (
            <div className="w-full h-full bg-gray-900/90 border-l border-gray-800 backdrop-blur-sm flex flex-col items-center pt-2">
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="text-gray-400 hover:text-white transition-colors p-1"
                title="Expand panel"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              {selectedNodeData && (
                <div className="mt-2 w-3 h-3 rounded-sm flex-shrink-0" style={{
                  backgroundColor: (NODE_COLORS[getNodeTypeKey(selectedNodeData)] || NODE_COLORS.ABB).background
                }} title={selectedNodeData.id} />
              )}
            </div>
          )}

          {/* Expanded state */}
          {!sidebarCollapsed && (
            <div className="w-full h-full bg-gray-900/95 border-l border-gray-800 backdrop-blur-sm overflow-y-auto">
              {selectedNodeData ? (
                <>
                  {/* Header */}
                  <div className="flex items-center justify-between p-3 border-b border-gray-800 sticky top-0 bg-gray-900/95 backdrop-blur-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{
                        backgroundColor: (NODE_COLORS[getNodeTypeKey(selectedNodeData)] || NODE_COLORS.ABB).background
                      }} />
                      <span className="text-xs font-semibold text-white truncate">{selectedNodeData.id}</span>
                    </div>
                    <button onClick={() => setSidebarCollapsed(true)} className="text-gray-500 hover:text-gray-300 text-sm ml-2 flex-shrink-0" title="Minimize panel">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>

                  {/* Node info */}
                  <div className="p-3 space-y-2 border-b border-gray-800">
                    <p className="text-sm text-gray-200 font-medium">{selectedNodeData.name}</p>
                    <div className="flex gap-3 text-[10px]">
                      <div>
                        <span className="text-gray-500 block">Type</span>
                        <span className="text-gray-300">{selectedNodeData.node_type}{selectedNodeData.type ? ` / ${selectedNodeData.type}` : ''}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">Status</span>
                        <span className={`${
                          selectedNodeData.status === 'ACTIVE' ? 'text-green-400' :
                          selectedNodeData.status === 'DEPRECATED' ? 'text-red-400' : 'text-yellow-400'
                        }`}>{selectedNodeData.status || '—'}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">Category</span>
                        <span className="text-gray-300">{selectedNodeData.category || '—'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Relationships grouped by type */}
                  <div className="p-3">
                    <h4 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      Relationships ({selectedNodeData.relationships?.length || 0})
                    </h4>
                    {groupedRels && Object.entries(groupedRels).map(([type, rels]) => (
                      <div key={type} className="mb-2">
                        <div className="flex items-center gap-1.5 mb-1">
                          <div className="w-3 h-0.5 rounded" style={{ backgroundColor: EDGE_COLORS[type] || '#6b7280' }} />
                          <span className="text-[10px] font-mono text-gray-400">{type}</span>
                          <span className="text-[10px] text-gray-600">({rels.length})</span>
                        </div>
                        {rels.map((r, i) => (
                          <div key={i} className="text-[11px] flex items-center gap-1.5 pl-4 py-0.5">
                            <span className={r.direction === 'out' ? 'text-green-500' : 'text-blue-500'}>
                              {r.direction === 'out' ? '→' : '←'}
                            </span>
                            <span className="text-gray-300 truncate">{r.otherId}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                    {(!selectedNodeData.relationships || selectedNodeData.relationships.length === 0) && (
                      <p className="text-xs text-gray-600 italic">No relationships</p>
                    )}
                  </div>

                  {/* Navigate button */}
                  <div className="p-3 border-t border-gray-800">
                    <button
                      onClick={() => {
                        if (selectedNodeData.node_type === 'Pattern') navigate(`/patterns/${selectedNodeData.id}`)
                        else if (selectedNodeData.node_type === 'Technology') navigate(`/technologies/${selectedNodeData.id}`)
                        else if (selectedNodeData.node_type === 'PBC') navigate(`/pbcs/${selectedNodeData.id}`)
                      }}
                      className="btn-primary w-full text-xs py-1.5"
                    >
                      View Details
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* Empty state: no node selected */}
                  <div className="flex items-center justify-between p-3 border-b border-gray-800">
                    <span className="text-xs font-semibold text-gray-500">Node Details</span>
                    <button onClick={() => setSidebarCollapsed(true)} className="text-gray-500 hover:text-gray-300 text-sm flex-shrink-0" title="Minimize panel">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                  <div className="p-4 text-center">
                    <div className="text-gray-600 text-xs mb-2">
                      <svg className="w-8 h-8 mx-auto mb-2 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                      </svg>
                      Click a node to see its details and relationships
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
