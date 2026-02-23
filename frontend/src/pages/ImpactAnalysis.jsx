import { useState, useEffect, useMemo } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { fetchPatterns, fetchTechnologies, fetchImpactAnalysis, fetchTechnologyImpact, fetchPatternGraph } from '../api/client'
import GraphView from '../components/GraphView'
import { TypeBadge } from '../components/PatternCard'

export default function ImpactAnalysis() {
  const [searchParams] = useSearchParams()
  const [mode, setMode] = useState(searchParams.get('type') === 'technology' ? 'technology' : 'pattern')
  const [patterns, setPatterns] = useState([])
  const [technologies, setTechnologies] = useState([])
  const [selectedId, setSelectedId] = useState(searchParams.get('id') || '')
  const [impacts, setImpacts] = useState(null)
  const [techImpacts, setTechImpacts] = useState(null)
  const [graphData, setGraphData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [filterText, setFilterText] = useState('')

  useEffect(() => {
    fetchPatterns({ limit: 500 }).then(res => setPatterns(res.patterns || []))
    fetchTechnologies().then(res => setTechnologies(res.technologies || []))
  }, [])

  useEffect(() => {
    if (!selectedId) return
    setLoading(true)
    if (mode === 'pattern') {
      Promise.all([
        fetchImpactAnalysis(selectedId),
        fetchPatternGraph(selectedId),
      ]).then(([impact, graph]) => {
        setImpacts(impact)
        setTechImpacts(null)
        setGraphData(graph)
      }).finally(() => setLoading(false))
    } else {
      fetchTechnologyImpact(selectedId).then(result => {
        setTechImpacts(result)
        setImpacts(null)
        setGraphData(null)
      }).finally(() => setLoading(false))
    }
  }, [selectedId, mode])

  const switchMode = (newMode) => {
    setMode(newMode)
    setSelectedId('')
    setImpacts(null)
    setTechImpacts(null)
    setGraphData(null)
    setFilterText('')
  }

  const filteredPatterns = useMemo(() => {
    if (!filterText) return patterns
    const q = filterText.toLowerCase()
    return patterns.filter(p =>
      p.id.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      (p.type || '').toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q)
    )
  }, [patterns, filterText])

  const filteredTechnologies = useMemo(() => {
    if (!filterText) return technologies
    const q = filterText.toLowerCase()
    return technologies.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.id.toLowerCase().includes(q) ||
      (t.vendor || '').toLowerCase().includes(q) ||
      (t.category || '').toLowerCase().includes(q)
    )
  }, [technologies, filterText])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Impact Analysis</h1>
        <p className="text-gray-500 text-sm mt-1">
          What depends on a pattern? What breaks if a technology changes?
        </p>
      </div>

      {/* Mode Toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => switchMode('pattern')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            mode === 'pattern'
              ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
              : 'text-gray-500 hover:text-gray-300 border border-gray-700 hover:border-gray-600'
          }`}
        >
          Pattern Impact
        </button>
        <button
          onClick={() => switchMode('technology')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            mode === 'technology'
              ? 'bg-cyan-600/20 text-cyan-400 border border-cyan-500/30'
              : 'text-gray-500 hover:text-gray-300 border border-gray-700 hover:border-gray-600'
          }`}
        >
          Technology Impact
        </button>
      </div>

      {/* Selector */}
      <div className="card">
        <label className="block text-xs text-gray-500 mb-2">
          {mode === 'pattern' ? 'Select a pattern to analyze' : 'Select a technology to analyze'}
        </label>
        <input
          type="text"
          placeholder={mode === 'pattern' ? 'Filter patterns by name, ID, type, or category...' : 'Filter technologies by name, ID, or vendor...'}
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
          className="input w-full max-w-md mb-2"
        />
        <select
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
          className="select w-full max-w-md"
        >
          {mode === 'pattern' ? (
            <>
              <option value="">Choose a pattern... ({filteredPatterns.length} shown)</option>
              {filteredPatterns.map(p => (
                <option key={p.id} value={p.id}>{p.id} — {p.name} ({p.type})</option>
              ))}
            </>
          ) : (
            <>
              <option value="">Choose a technology... ({filteredTechnologies.length} shown)</option>
              {filteredTechnologies.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.vendor}) — {t.category}</option>
              ))}
            </>
          )}
        </select>
      </div>

      {loading && <div className="text-gray-500 text-center py-12">Analyzing impact...</div>}

      {/* Pattern Impact Results */}
      {impacts && !loading && (
        <>
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

      {/* Technology Impact Results */}
      {techImpacts && !loading && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-3">
            Technology Impact for{' '}
            <span className="text-cyan-400">{techImpacts.technology?.name || selectedId}</span>
          </h2>
          <div className="flex items-center gap-4 text-sm text-gray-400 mb-4">
            <span>{techImpacts.count} pattern(s) use this technology</span>
            {techImpacts.technology?.vendor && (
              <span className="text-gray-600">Vendor: {techImpacts.technology.vendor}</span>
            )}
            {techImpacts.technology?.status && (
              <span className={`text-xs px-2 py-0.5 rounded ${
                techImpacts.technology.status === 'APPROVED' ? 'bg-green-500/20 text-green-400' :
                techImpacts.technology.status === 'DEPRECATED' ? 'bg-red-500/20 text-red-400' :
                'bg-yellow-500/20 text-yellow-400'
              }`}>{techImpacts.technology.status}</span>
            )}
          </div>

          {techImpacts.count === 0 ? (
            <p className="text-gray-500 italic">No patterns currently use this technology.</p>
          ) : (
            <div className="space-y-2">
              {techImpacts.affected_patterns?.map((p, i) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-800/50">
                  <TypeBadge type={p.type} />
                  <Link to={`/patterns/${p.id}`} className="text-blue-400 font-mono text-xs hover:underline">
                    {p.id}
                  </Link>
                  <span className="text-gray-400 text-sm">{p.name}</span>
                  <span className="text-xs text-gray-600 ml-auto">{p.category} · {p.status}</span>
                </div>
              ))}
            </div>
          )}

          {techImpacts.technology?.status === 'DEPRECATED' && techImpacts.count > 0 && (
            <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
              <p className="text-red-400 text-sm">
                <strong>Warning:</strong> This technology is deprecated and still used by {techImpacts.count} pattern(s).
                Consider migrating affected patterns to alternative technologies.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
