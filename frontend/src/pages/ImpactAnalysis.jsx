import { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { fetchPatterns, fetchTechnologies, fetchImpactAnalysis, fetchTechnologyImpact, fetchPatternGraph } from '../api/client'
import GraphView from '../components/GraphView'
import { TypeBadge } from '../components/PatternCard'

/* ── Searchable Autocomplete Dropdown ── */
function SearchableSelect({ items, value, onChange, placeholder, renderItem, renderSelected, idKey = 'id' }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const inputRef = useRef(null)

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = useMemo(() => {
    if (!query) return items.slice(0, 50)
    const q = query.toLowerCase()
    return items.filter(item => {
      const text = Object.values(item).filter(v => typeof v === 'string').join(' ').toLowerCase()
      return text.includes(q)
    }).slice(0, 50)
  }, [items, query])

  const selected = value ? items.find(i => i[idKey] === value) : null

  function handleSelect(item) {
    onChange(item[idKey])
    setQuery('')
    setOpen(false)
  }

  function handleClear(e) {
    e.stopPropagation()
    onChange('')
    setQuery('')
  }

  return (
    <div ref={ref} className="relative w-full max-w-lg">
      {/* Selected value or search input */}
      {selected && !open ? (
        <div
          onClick={() => { setOpen(true); setQuery(''); setTimeout(() => inputRef.current?.focus(), 0) }}
          className="input w-full flex items-center justify-between cursor-pointer"
        >
          <span className="text-sm text-gray-200 truncate">{renderSelected(selected)}</span>
          <button onClick={handleClear} className="text-gray-500 hover:text-gray-300 ml-2 shrink-0" title="Clear">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      ) : (
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          className="input w-full"
        />
      )}

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-h-72 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-sm text-gray-500">No results found</div>
          ) : (
            filtered.map(item => (
              <div
                key={item[idKey]}
                onClick={() => handleSelect(item)}
                className={`px-4 py-2.5 cursor-pointer hover:bg-gray-800 transition-colors border-b border-gray-800/50 last:border-0 ${
                  item[idKey] === value ? 'bg-gray-800/70' : ''
                }`}
              >
                {renderItem(item)}
              </div>
            ))
          )}
          {items.length > 50 && !query && (
            <div className="px-4 py-2 text-xs text-gray-600 border-t border-gray-800">
              Type to search all {items.length} items...
            </div>
          )}
        </div>
      )}
    </div>
  )
}

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
  }

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
        {mode === 'pattern' ? (
          <SearchableSelect
            items={patterns}
            value={selectedId}
            onChange={setSelectedId}
            placeholder="Type to search patterns by name, ID, type, or category..."
            renderItem={p => (
              <div className="flex items-center gap-2">
                <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                  p.type === 'AB' ? 'badge-ab' : p.type === 'ABB' ? 'badge-abb' : 'badge-sbb'
                }`}>{p.type}</span>
                <span className="text-blue-400 font-mono text-xs">{p.id}</span>
                <span className="text-gray-300 text-sm">{p.name}</span>
                <span className="text-gray-600 text-xs ml-auto">{p.category}</span>
              </div>
            )}
            renderSelected={p => `${p.id} — ${p.name} (${p.type})`}
          />
        ) : (
          <SearchableSelect
            items={technologies}
            value={selectedId}
            onChange={setSelectedId}
            placeholder="Type to search technologies by name, vendor, or category..."
            renderItem={t => (
              <div className="flex items-center gap-2">
                <span className="text-cyan-400 text-sm font-medium">{t.name}</span>
                {t.vendor && <span className="text-gray-500 text-xs">({t.vendor})</span>}
                <span className="text-gray-600 text-xs ml-auto">{t.category}</span>
              </div>
            )}
            renderSelected={t => `${t.name}${t.vendor ? ` (${t.vendor})` : ''} — ${t.category}`}
          />
        )}
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
