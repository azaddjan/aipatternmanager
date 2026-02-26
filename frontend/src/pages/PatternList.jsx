import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { fetchPatterns, fetchCategories, updatePattern } from '../api/client'
import PatternCard from '../components/PatternCard'
import Pagination from '../components/Pagination'
import SortableHeader, { sortItems } from '../components/SortableHeader'
import { useAuth } from '../contexts/AuthContext'

const TYPE_OPTIONS = ['', 'AB', 'ABB', 'SBB']
const STATUS_OPTIONS = ['', 'DRAFT', 'ACTIVE', 'DEPRECATED']

export default function PatternList() {
  const { canCreatePattern } = useAuth()
  const [patterns, setPatterns] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ type: '', category: '', status: '', team: '' })
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState('table') // grid | table
  const [categoryOptions, setCategoryOptions] = useState([])
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25
  const [sortBy, setSortBy] = useState('id')
  const [sortDir, setSortDir] = useState('asc')

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortDir('asc')
    }
  }

  // Derive unique team names from loaded patterns
  const teamOptions = useMemo(() => {
    const teams = new Set()
    patterns.forEach(p => { if (p.team_name) teams.add(p.team_name) })
    return [...teams].sort()
  }, [patterns])

  // Load dynamic categories
  useEffect(() => {
    fetchCategories().then(res => {
      setCategoryOptions(res.categories || [])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchPatterns({ ...filters, limit: 500 })
      .then(res => {
        setPatterns(res.patterns || [])
        setTotal(res.total || 0)
      })
      .catch(() => setPatterns([]))
      .finally(() => setLoading(false))
  }, [filters])

  const filtered = patterns.filter(p => {
    // Team filter
    if (filters.team && p.team_name !== filters.team) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (
      p.name?.toLowerCase().includes(q) ||
      p.id?.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q) ||
      p.category?.toLowerCase().includes(q) ||
      p.vendor?.toLowerCase().includes(q) ||
      p.team_name?.toLowerCase().includes(q) ||
      (p.tags || []).some(t => t.toLowerCase().includes(q))
    )
  })

  const sorted = sortItems(filtered, sortBy, sortDir)

  // Reset page when search/filters change
  useEffect(() => { setPage(1) }, [search, filters, sortBy, sortDir])

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)
  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Patterns</h1>
          <p className="text-gray-500 text-sm mt-1">{filtered.length}{filtered.length !== total ? ` of ${total}` : ''} patterns</p>
        </div>
        {canCreatePattern && (
          <Link to="/patterns/new" className="btn-primary">+ New Pattern</Link>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Search by name, ID, description, tags, or vendor..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input w-64"
        />
        <select
          value={filters.type}
          onChange={e => setFilters(f => ({ ...f, type: e.target.value }))}
          className="select"
        >
          <option value="">All Types</option>
          {TYPE_OPTIONS.filter(Boolean).map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={filters.category}
          onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}
          className="select"
        >
          <option value="">All Categories</option>
          {categoryOptions.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
        </select>
        <select
          value={filters.status}
          onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
          className="select"
        >
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.filter(Boolean).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {teamOptions.length > 0 && (
          <select
            value={filters.team}
            onChange={e => setFilters(f => ({ ...f, team: e.target.value }))}
            className="select"
          >
            <option value="">All Teams</option>
            {teamOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}

        <div className="ml-auto flex gap-1">
          <button
            onClick={() => setViewMode('grid')}
            className={`px-3 py-1.5 rounded text-sm ${viewMode === 'grid' ? 'bg-gray-700 text-white' : 'text-gray-500'}`}
          >Grid</button>
          <button
            onClick={() => setViewMode('table')}
            className={`px-3 py-1.5 rounded text-sm ${viewMode === 'table' ? 'bg-gray-700 text-white' : 'text-gray-500'}`}
          >Table</button>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-500 text-center py-12">Loading patterns...</div>
      ) : filtered.length === 0 ? (
        <div className="text-gray-500 text-center py-12">No patterns found</div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {paginated.map(p => <PatternCard key={p.id} pattern={p} />)}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-left border-b border-gray-800">
                <SortableHeader label="ID" field="id" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="Name" field="name" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="Type" field="type" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="Category" field="category" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="Status" field="status" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="Team" field="team_name" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader label="Version" field="version" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
              </tr>
            </thead>
            <tbody>
              {paginated.map(p => (
                <tr key={p.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="py-2.5">
                    <Link to={`/patterns/${p.id}`} className="text-blue-400 font-mono text-xs hover:underline">{p.id}</Link>
                  </td>
                  <td className="py-2.5 text-gray-300">{p.name}</td>
                  <td className="py-2.5">
                    <span className={`text-xs font-mono px-2 py-0.5 rounded ${
                      p.type === 'AB' ? 'badge-ab' : p.type === 'ABB' ? 'badge-abb' : 'badge-sbb'
                    }`}>{p.type}</span>
                  </td>
                  <td className="py-2.5 text-gray-400 text-xs">{p.category}</td>
                  <td className="py-2.5">
                    <select
                      value={p.status}
                      onChange={async (e) => {
                        const newStatus = e.target.value
                        const oldStatus = p.status
                        setPatterns(prev => prev.map(x => x.id === p.id ? { ...x, status: newStatus } : x))
                        try {
                          await updatePattern(p.id, { status: newStatus }, 'none')
                        } catch {
                          setPatterns(prev => prev.map(x => x.id === p.id ? { ...x, status: oldStatus } : x))
                        }
                      }}
                      className={`text-xs font-medium bg-transparent border border-transparent rounded px-1.5 py-0.5 cursor-pointer transition-colors
                        hover:border-gray-600 focus:border-blue-500 focus:outline-none
                        ${p.status === 'ACTIVE' ? 'text-green-400' :
                          p.status === 'DEPRECATED' ? 'text-red-400' : 'text-yellow-400'}`}
                    >
                      <option value="DRAFT" className="bg-gray-900 text-yellow-400">DRAFT</option>
                      <option value="ACTIVE" className="bg-gray-900 text-green-400">ACTIVE</option>
                      <option value="DEPRECATED" className="bg-gray-900 text-red-400">DEPRECATED</option>
                    </select>
                  </td>
                  <td className="py-2.5 text-gray-400 text-xs">{p.team_name || <span className="text-gray-600">—</span>}</td>
                  <td className="py-2.5 text-gray-500 font-mono text-xs">{p.version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sorted.length > PAGE_SIZE && (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={sorted.length}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />
      )}
    </div>
  )
}
