import { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { fetchPatterns, fetchTechnologies, fetchImpactAnalysis, fetchTechnologyImpact, fetchPatternGraph, fetchTechnologyGraph } from '../api/client'
import GraphView from '../components/GraphView'
import Pagination from '../components/Pagination'
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

/* ── Category labels ── */
const CAT_LABELS = {
  core: 'Core AI/LLM', intg: 'Integration', agt: 'Agents',
  kr: 'Knowledge & Retrieval', xcut: 'Cross-Cutting',
  pip: 'Platform Integration', blueprint: 'Architecture Topology',
}

/* ── Risk level helper ── */
function getRiskLevel(count, maxDepth) {
  if (count === 0) return { label: 'None', color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/30' }
  if (count <= 3 && maxDepth <= 1) return { label: 'Low', color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/30' }
  if (count <= 8 && maxDepth <= 2) return { label: 'Medium', color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/30' }
  if (count <= 15) return { label: 'High', color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/30' }
  return { label: 'Critical', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30' }
}

/* ── Stat card ── */
function StatCard({ label, value, sub, color = 'text-white' }) {
  return (
    <div className="bg-gray-800/40 rounded-lg p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}

/* ── Breakdown bar ── */
function BreakdownBar({ items, total }) {
  const colors = {
    ABB: 'bg-blue-500', SBB: 'bg-green-500', AB: 'bg-orange-500',
    APPROVED: 'bg-green-500', DEPRECATED: 'bg-red-500', EXPERIMENTAL: 'bg-yellow-500',
    DRAFT: 'bg-gray-500', ACTIVE: 'bg-blue-500', REVIEW: 'bg-purple-500',
  }
  if (total === 0) return null
  return (
    <div>
      <div className="flex h-2 rounded-full overflow-hidden bg-gray-800">
        {items.map(({ key, count }) => (
          <div
            key={key}
            className={`${colors[key] || 'bg-gray-600'} transition-all`}
            style={{ width: `${(count / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-3 mt-2">
        {items.map(({ key, count }) => (
          <div key={key} className="flex items-center gap-1.5 text-xs text-gray-400">
            <span className={`w-2 h-2 rounded-full ${colors[key] || 'bg-gray-600'}`} />
            {key} <span className="text-gray-600">({count})</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Pattern Impact Report ── */
function PatternImpactReport({ impacts, selectedId, patterns }) {
  const allItems = impacts.impacts || []
  const selectedPattern = patterns.find(p => p.id === selectedId)
  const maxDepth = allItems.reduce((m, i) => Math.max(m, i.depth || 0), 0)
  const risk = getRiskLevel(allItems.length, maxDepth)

  // Breakdowns
  const byType = {}
  const byCategory = {}
  const byDepth = {}
  allItems.forEach(imp => {
    byType[imp.type] = (byType[imp.type] || 0) + 1
    const cat = imp.category || 'unknown'
    byCategory[cat] = (byCategory[cat] || 0) + 1
    const d = imp.depth || 1
    byDepth[d] = (byDepth[d] || 0) + 1
  })
  const typeItems = Object.entries(byType).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count)
  const catItems = Object.entries(byCategory).map(([key, count]) => ({ key: CAT_LABELS[key] || key, count })).sort((a, b) => b.count - a.count)
  const depthItems = Object.entries(byDepth).map(([key, count]) => ({ key: `Depth ${key}`, count })).sort((a, b) => Number(a.key.split(' ')[1]) - Number(b.key.split(' ')[1]))

  // Direct vs transitive
  const directCount = allItems.filter(i => (i.depth || 1) === 1).length
  const transitiveCount = allItems.length - directCount

  return (
    <div className="space-y-5">
      {/* Risk Banner */}
      <div className={`rounded-lg border p-4 ${risk.bg}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wider">Change Risk Assessment</p>
            <p className={`text-2xl font-bold ${risk.color}`}>{risk.label}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">Impact Radius</p>
            <p className="text-lg font-semibold text-white">{allItems.length} pattern{allItems.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <p className="text-sm text-gray-400 mt-2">
          {allItems.length === 0
            ? `Modifying ${selectedId} has no downstream impact. This pattern is a leaf node with no dependents.`
            : `Modifying ${selectedId} could affect ${allItems.length} dependent pattern${allItems.length !== 1 ? 's' : ''} across ${maxDepth} depth level${maxDepth !== 1 ? 's' : ''}. ${
                risk.label === 'Critical' ? 'Extreme caution advised — wide blast radius with deep dependency chains.' :
                risk.label === 'High' ? 'Significant cascading potential — coordinate changes with dependent teams.' :
                risk.label === 'Medium' ? 'Moderate ripple effect — review affected patterns before changes.' :
                'Limited impact — low risk of cascading issues.'
              }`
          }
        </p>
      </div>

      {/* Subject Info */}
      {selectedPattern && (
        <div className="bg-gray-800/40 rounded-lg p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Analyzed Pattern</p>
          <div className="flex items-center gap-3">
            <TypeBadge type={selectedPattern.type} />
            <Link to={`/patterns/${selectedId}`} className="text-blue-400 font-mono text-sm hover:underline">{selectedId}</Link>
            <span className="text-white font-medium">{selectedPattern.name}</span>
            <span className="text-gray-500 text-xs ml-auto">{CAT_LABELS[selectedPattern.category] || selectedPattern.category}</span>
          </div>
        </div>
      )}

      {allItems.length > 0 && (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-4 gap-3">
            <StatCard label="Total Affected" value={allItems.length} color={risk.color} />
            <StatCard label="Direct Dependencies" value={directCount} sub={`${transitiveCount} transitive`} />
            <StatCard label="Max Depth" value={maxDepth} sub={maxDepth > 2 ? 'Deep chain' : 'Shallow'} />
            <StatCard label="Pattern Types" value={typeItems.length} sub={typeItems.map(t => t.key).join(', ')} />
          </div>

          {/* Type Breakdown */}
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">By Pattern Type</p>
            <BreakdownBar items={typeItems} total={allItems.length} />
          </div>

          {/* Depth Breakdown */}
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">By Dependency Depth</p>
            <div className="space-y-1.5">
              {depthItems.map(({ key, count }) => (
                <div key={key} className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 w-16">{key}</span>
                  <div className="flex-1 bg-gray-800 rounded-full h-2">
                    <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${(count / allItems.length) * 100}%` }} />
                  </div>
                  <span className="text-xs text-gray-400 w-8 text-right">{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Category Breakdown */}
          {catItems.length > 1 && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">By Category</p>
              <div className="grid grid-cols-2 gap-2">
                {catItems.map(({ key, count }) => (
                  <div key={key} className="flex items-center justify-between bg-gray-800/40 rounded-lg px-3 py-2">
                    <span className="text-sm text-gray-300">{key}</span>
                    <span className="text-sm font-mono text-gray-400">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ── Technology Impact Report ── */
function TechImpactReport({ techImpacts, selectedId }) {
  const tech = techImpacts.technology || {}
  const allItems = techImpacts.affected_patterns || []
  const risk = getRiskLevel(allItems.length, 1)

  // Breakdowns
  const byType = {}
  const byCategory = {}
  const byStatus = {}
  allItems.forEach(p => {
    byType[p.type] = (byType[p.type] || 0) + 1
    const cat = p.category || 'unknown'
    byCategory[cat] = (byCategory[cat] || 0) + 1
    const st = p.status || 'UNKNOWN'
    byStatus[st] = (byStatus[st] || 0) + 1
  })
  const typeItems = Object.entries(byType).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count)
  const catItems = Object.entries(byCategory).map(([key, count]) => ({ key: CAT_LABELS[key] || key, count })).sort((a, b) => b.count - a.count)
  const statusItems = Object.entries(byStatus).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count)

  const isDeprecated = tech.status === 'DEPRECATED'

  return (
    <div className="space-y-5">
      {/* Risk / Deprecation Banner */}
      <div className={`rounded-lg border p-4 ${isDeprecated && allItems.length > 0 ? 'bg-red-500/10 border-red-500/30' : risk.bg}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wider">
              {isDeprecated ? 'Migration Risk Assessment' : 'Technology Change Risk'}
            </p>
            <p className={`text-2xl font-bold ${isDeprecated && allItems.length > 0 ? 'text-red-400' : risk.color}`}>
              {isDeprecated && allItems.length > 0 ? 'Action Required' : risk.label}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">Adoption</p>
            <p className="text-lg font-semibold text-white">{allItems.length} pattern{allItems.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <p className="text-sm text-gray-400 mt-2">
          {allItems.length === 0
            ? `${tech.name || selectedId} is not currently used by any patterns. ${isDeprecated ? 'It can be safely retired.' : 'Changes to this technology will have no impact.'}`
            : isDeprecated
              ? `${tech.name || selectedId} is deprecated and still used by ${allItems.length} pattern${allItems.length !== 1 ? 's' : ''}. These patterns must be migrated to an alternative technology to avoid compliance issues and technical debt.`
              : `${tech.name || selectedId} is used by ${allItems.length} pattern${allItems.length !== 1 ? 's' : ''}. ${
                  risk.label === 'Critical' || risk.label === 'High'
                    ? 'Significant adoption — version upgrades or configuration changes should be coordinated across teams.'
                    : risk.label === 'Medium'
                      ? 'Moderate adoption — notify affected pattern owners before making changes.'
                      : 'Low adoption — changes can be made with limited coordination.'
                }`
          }
        </p>
      </div>

      {/* Technology Info */}
      <div className="bg-gray-800/40 rounded-lg p-4">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Analyzed Technology</p>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-cyan-400 font-medium">{tech.name || selectedId}</span>
          {tech.vendor && <span className="text-gray-500 text-sm">by {tech.vendor}</span>}
          {tech.category && <span className="text-xs bg-gray-700/50 text-gray-400 px-2 py-0.5 rounded">{tech.category}</span>}
          {tech.status && (
            <span className={`text-xs px-2 py-0.5 rounded ${
              tech.status === 'APPROVED' ? 'bg-green-500/20 text-green-400' :
              tech.status === 'DEPRECATED' ? 'bg-red-500/20 text-red-400' :
              'bg-yellow-500/20 text-yellow-400'
            }`}>{tech.status}</span>
          )}
        </div>
      </div>

      {allItems.length > 0 && (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Patterns Using" value={allItems.length} color={isDeprecated ? 'text-red-400' : risk.color} />
            <StatCard label="Pattern Types" value={typeItems.length} sub={typeItems.map(t => t.key).join(', ')} />
            <StatCard label="Categories Affected" value={catItems.length} sub={catItems.length > 1 ? 'Cross-domain impact' : 'Single domain'} />
          </div>

          {/* Type Breakdown */}
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">By Pattern Type</p>
            <BreakdownBar items={typeItems} total={allItems.length} />
          </div>

          {/* Status Breakdown */}
          {statusItems.length > 1 && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">By Pattern Status</p>
              <BreakdownBar items={statusItems} total={allItems.length} />
            </div>
          )}

          {/* Category Breakdown */}
          {catItems.length > 1 && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">By Category</p>
              <div className="grid grid-cols-2 gap-2">
                {catItems.map(({ key, count }) => (
                  <div key={key} className="flex items-center justify-between bg-gray-800/40 rounded-lg px-3 py-2">
                    <span className="text-sm text-gray-300">{key}</span>
                    <span className="text-sm font-mono text-gray-400">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Deprecation Action Items */}
          {isDeprecated && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4">
              <p className="text-xs text-red-400 uppercase tracking-wider font-semibold mb-2">Recommended Actions</p>
              <ul className="space-y-1.5 text-sm text-gray-400">
                <li className="flex items-start gap-2">
                  <span className="text-red-400 mt-0.5">1.</span>
                  Identify replacement technology and create migration SBBs
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-400 mt-0.5">2.</span>
                  Update {allItems.length} affected pattern{allItems.length !== 1 ? 's' : ''} to reference the new technology
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-400 mt-0.5">3.</span>
                  Run impact analysis on replacement technology to verify coverage
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-400 mt-0.5">4.</span>
                  Archive deprecated technology once all patterns are migrated
                </li>
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ── Tab Button ── */
function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
        active ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
      }`}
    >
      {children}
    </button>
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
  const [page, setPage] = useState(1)
  const [resultTab, setResultTab] = useState('report')
  const PAGE_SIZE = 25

  useEffect(() => {
    fetchPatterns({ limit: 500 }).then(res => setPatterns(res.patterns || []))
    fetchTechnologies().then(res => setTechnologies(res.technologies || []))
  }, [])

  useEffect(() => {
    if (!selectedId) return
    setLoading(true)
    setPage(1)
    setResultTab('report')
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
      Promise.all([
        fetchTechnologyImpact(selectedId),
        fetchTechnologyGraph(selectedId),
      ]).then(([result, graph]) => {
        setTechImpacts(result)
        setImpacts(null)
        setGraphData(graph)
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
      <div className="flex items-center gap-2 text-sm">
        <Link to="/" className="text-gray-500 hover:text-gray-300 transition-colors">&larr; Dashboard</Link>
        <span className="text-gray-700">/</span>
        <span className="text-gray-400">Impact Analysis</span>
      </div>
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
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">
              Impact for <span className="text-blue-400 font-mono">{selectedId}</span>
            </h2>
            <div className="flex gap-1 bg-gray-800/50 rounded-lg p-1">
              <TabButton active={resultTab === 'report'} onClick={() => setResultTab('report')}>Report</TabButton>
              {impacts.count > 0 && (
                <TabButton active={resultTab === 'list'} onClick={() => setResultTab('list')}>List</TabButton>
              )}
              {impacts.count > 0 && graphData && (
                <TabButton active={resultTab === 'graph'} onClick={() => setResultTab('graph')}>Graph</TabButton>
              )}
            </div>
          </div>

          {resultTab === 'report' ? (
            <PatternImpactReport impacts={impacts} selectedId={selectedId} patterns={patterns} />
          ) : resultTab === 'graph' && graphData ? (
            <GraphView data={graphData} height="500px" />
          ) : (() => {
            const allItems = impacts.impacts || []
            const totalPages = Math.ceil(allItems.length / PAGE_SIZE)
            const paged = allItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
            return (
              <>
                <div className="space-y-2">
                  {paged.map((imp, i) => (
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
                <Pagination
                  page={page}
                  totalPages={totalPages}
                  total={allItems.length}
                  pageSize={PAGE_SIZE}
                  onPageChange={setPage}
                />
              </>
            )
          })()}
        </div>
      )}

      {/* Technology Impact Results */}
      {techImpacts && !loading && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">
              Technology Impact for{' '}
              <span className="text-cyan-400">{techImpacts.technology?.name || selectedId}</span>
            </h2>
            <div className="flex gap-1 bg-gray-800/50 rounded-lg p-1">
              <TabButton active={resultTab === 'report'} onClick={() => setResultTab('report')}>Report</TabButton>
              {techImpacts.count > 0 && (
                <TabButton active={resultTab === 'list'} onClick={() => setResultTab('list')}>List</TabButton>
              )}
              {techImpacts.count > 0 && graphData && (
                <TabButton active={resultTab === 'graph'} onClick={() => setResultTab('graph')}>Graph</TabButton>
              )}
            </div>
          </div>

          {resultTab === 'report' ? (
            <TechImpactReport techImpacts={techImpacts} selectedId={selectedId} />
          ) : resultTab === 'graph' && graphData ? (
            <GraphView data={graphData} height="500px" />
          ) : (() => {
            const allItems = techImpacts.affected_patterns || []
            const totalPages = Math.ceil(allItems.length / PAGE_SIZE)
            const paged = allItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
            return (
              <>
                <div className="space-y-2">
                  {paged.map((p, i) => (
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
                <Pagination
                  page={page}
                  totalPages={totalPages}
                  total={allItems.length}
                  pageSize={PAGE_SIZE}
                  onPageChange={setPage}
                />
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}
