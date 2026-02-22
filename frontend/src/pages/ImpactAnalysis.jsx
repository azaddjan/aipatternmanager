import { useState, useEffect } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { fetchPatterns, fetchImpactAnalysis, fetchPatternGraph } from '../api/client'
import GraphView from '../components/GraphView'
import { TypeBadge } from '../components/PatternCard'

export default function ImpactAnalysis() {
  const [searchParams] = useSearchParams()
  const [patterns, setPatterns] = useState([])
  const [selectedId, setSelectedId] = useState(searchParams.get('id') || '')
  const [impacts, setImpacts] = useState(null)
  const [graphData, setGraphData] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchPatterns({ limit: 500 }).then(res => setPatterns(res.patterns || []))
  }, [])

  useEffect(() => {
    if (selectedId) {
      setLoading(true)
      Promise.all([
        fetchImpactAnalysis(selectedId),
        fetchPatternGraph(selectedId),
      ]).then(([impact, graph]) => {
        setImpacts(impact)
        setGraphData(graph)
      }).finally(() => setLoading(false))
    }
  }, [selectedId])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Impact Analysis</h1>
        <p className="text-gray-500 text-sm mt-1">What depends on this pattern? What breaks if it changes?</p>
      </div>

      {/* Selector */}
      <div className="card">
        <label className="block text-xs text-gray-500 mb-2">Select a pattern or technology</label>
        <select
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
          className="select w-full max-w-md"
        >
          <option value="">Choose a pattern...</option>
          {patterns.map(p => (
            <option key={p.id} value={p.id}>{p.id} — {p.name} ({p.type})</option>
          ))}
        </select>
      </div>

      {loading && <div className="text-gray-500 text-center py-12">Analyzing impact...</div>}

      {impacts && !loading && (
        <>
          {/* Impact Summary */}
          <div className="card">
            <h2 className="text-lg font-semibold mb-3">
              Impact for <span className="text-blue-400 font-mono">{selectedId}</span>
            </h2>
            <p className="text-gray-400 text-sm mb-4">
              {impacts.count} pattern(s) depend on this pattern (directly or transitively)
            </p>

            {impacts.count === 0 ? (
              <p className="text-gray-500 italic">No downstream dependencies found.</p>
            ) : (
              <div className="space-y-2">
                {impacts.impacts?.map((imp, i) => (
                  <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-800/50">
                    <span className="text-xs text-gray-600 font-mono w-16">depth {imp.depth}</span>
                    <TypeBadge type={imp.type} />
                    <Link to={`/patterns/${imp.id}`} className="text-blue-400 font-mono text-xs hover:underline">
                      {imp.id}
                    </Link>
                    <span className="text-gray-400 text-sm">{imp.name}</span>
                    <span className="text-xs text-gray-600 ml-auto">
                      Path: {imp.path?.join(' → ')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Graph */}
          {graphData && (
            <div>
              <h2 className="text-lg font-semibold mb-3">Dependency Graph</h2>
              <GraphView data={graphData} height="400px" />
            </div>
          )}
        </>
      )}
    </div>
  )
}
