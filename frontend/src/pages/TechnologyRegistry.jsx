import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { fetchTechnologies, createTechnology, deleteTechnology } from '../api/client'

const VENDORS = ['', 'AWS', 'Microsoft', 'Open Source', 'Hugging Face', 'LangChain', 'Salesforce', 'Redis']

const TECH_CATEGORIES = [
  { value: 'cloud-compute', label: 'Cloud Compute' },
  { value: 'cloud-ai', label: 'Cloud AI Service' },
  { value: 'cloud-data', label: 'Cloud Data & Storage' },
  { value: 'cloud-infra', label: 'Cloud Infrastructure' },
  { value: 'framework', label: 'Framework / Library' },
  { value: 'saas', label: 'SaaS Platform' },
  { value: 'observability', label: 'Observability' },
  { value: 'database', label: 'Database' },
]

const CATEGORY_COLORS = {
  'cloud-compute': 'bg-blue-500/20 text-blue-400',
  'cloud-ai': 'bg-purple-500/20 text-purple-400',
  'cloud-data': 'bg-cyan-500/20 text-cyan-400',
  'cloud-infra': 'bg-sky-500/20 text-sky-400',
  'framework': 'bg-amber-500/20 text-amber-400',
  'saas': 'bg-pink-500/20 text-pink-400',
  'observability': 'bg-lime-500/20 text-lime-400',
  'database': 'bg-emerald-500/20 text-emerald-400',
}

const CATEGORY_LABELS = Object.fromEntries(TECH_CATEGORIES.map(c => [c.value, c.label]))

export default function TechnologyRegistry() {
  const [technologies, setTechnologies] = useState([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ vendor: '', category: '', status: '' })
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const [view, setView] = useState('table') // 'table' or 'grid'
  const [form, setForm] = useState({
    id: '', name: '', vendor: '', category: 'framework', status: 'APPROVED', description: '', cost_tier: '',
  })

  const load = () => {
    setLoading(true)
    fetchTechnologies(filters)
      .then(res => setTechnologies(res.technologies || []))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [filters])

  const handleCreate = async () => {
    try {
      await createTechnology(form)
      setForm({ id: '', name: '', vendor: '', category: 'framework', status: 'APPROVED', description: '', cost_tier: '' })
      setShowForm(false)
      load()
    } catch (err) {
      alert(err.message)
    }
  }

  const filtered = technologies.filter(t =>
    !search ||
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.id.toLowerCase().includes(search.toLowerCase()) ||
    t.vendor.toLowerCase().includes(search.toLowerCase()) ||
    (t.description || '').toLowerCase().includes(search.toLowerCase()) ||
    (t.category || '').toLowerCase().includes(search.toLowerCase())
  )

  // Group by category for grid display
  const grouped = {}
  filtered.forEach(t => {
    const cat = t.category || 'other'
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(t)
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Technology Registry</h1>
          <p className="text-gray-500 text-sm mt-1">{technologies.length} technologies linked to SBB patterns</p>
        </div>
        <div className="flex gap-2">
          {/* View Toggle */}
          <div className="flex bg-gray-800 rounded-lg border border-gray-700">
            <button
              onClick={() => setView('table')}
              className={`px-3 py-1.5 text-xs rounded-l-lg transition-colors ${
                view === 'table' ? 'bg-blue-600/20 text-blue-400' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Table
            </button>
            <button
              onClick={() => setView('grid')}
              className={`px-3 py-1.5 text-xs rounded-r-lg transition-colors ${
                view === 'grid' ? 'bg-blue-600/20 text-blue-400' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Grid
            </button>
          </div>
          <button onClick={() => setShowForm(!showForm)} className="btn-primary">
            {showForm ? 'Cancel' : '+ Add Technology'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Search by name, ID, vendor, description, or category..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input w-64"
        />
        <select value={filters.vendor} onChange={e => setFilters(f => ({ ...f, vendor: e.target.value }))} className="select">
          <option value="">All Vendors</option>
          {VENDORS.filter(Boolean).map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={filters.category} onChange={e => setFilters(f => ({ ...f, category: e.target.value }))} className="select">
          <option value="">All Categories</option>
          {TECH_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} className="select">
          <option value="">All Statuses</option>
          <option value="APPROVED">Approved</option>
          <option value="UNDER_REVIEW">Under Review</option>
          <option value="DEPRECATED">Deprecated</option>
        </select>
      </div>

      {/* Add Form */}
      {showForm && (
        <div className="card space-y-4">
          <h2 className="font-semibold text-sm text-gray-400">New Technology</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">ID</label>
              <input placeholder="e.g. aws-bedrock" value={form.id} onChange={e => setForm(f => ({ ...f, id: e.target.value }))} className="input w-full" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Name</label>
              <input placeholder="Display name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="input w-full" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Vendor</label>
              <input placeholder="Vendor" value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))} className="input w-full" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Category</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="select w-full">
                {TECH_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Status</label>
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className="select w-full">
                <option value="APPROVED">APPROVED</option>
                <option value="UNDER_REVIEW">UNDER_REVIEW</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Description</label>
              <input placeholder="Short description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="input w-full" />
            </div>
          </div>
          <button onClick={handleCreate} className="btn-primary">Create Technology</button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="text-gray-500 text-center py-12">Loading technologies...</div>
      ) : filtered.length === 0 ? (
        <div className="text-gray-500 text-center py-12">No technologies found</div>
      ) : view === 'table' ? (
        /* Table View (Default) */
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left text-xs text-gray-500 pb-3 font-medium">ID</th>
                <th className="text-left text-xs text-gray-500 pb-3 font-medium">Name</th>
                <th className="text-left text-xs text-gray-500 pb-3 font-medium">Vendor</th>
                <th className="text-left text-xs text-gray-500 pb-3 font-medium">Category</th>
                <th className="text-left text-xs text-gray-500 pb-3 font-medium">Status</th>
                <th className="text-left text-xs text-gray-500 pb-3 font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <tr key={t.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer group">
                  <td className="py-2.5">
                    <Link to={`/technologies/${t.id}`} className="text-blue-400 font-mono text-xs hover:underline">
                      {t.id}
                    </Link>
                  </td>
                  <td className="py-2.5">
                    <Link to={`/technologies/${t.id}`} className="text-white group-hover:text-blue-400 transition-colors font-medium">
                      {t.name}
                    </Link>
                  </td>
                  <td className="py-2.5 text-gray-400">{t.vendor}</td>
                  <td className="py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded ${CATEGORY_COLORS[t.category] || 'bg-gray-500/20 text-gray-400'}`}>
                      {CATEGORY_LABELS[t.category] || t.category}
                    </span>
                  </td>
                  <td className="py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      t.status === 'APPROVED' ? 'bg-green-500/20 text-green-400' :
                      t.status === 'DEPRECATED' ? 'bg-red-500/20 text-red-400' :
                      'bg-yellow-500/20 text-yellow-400'
                    }`}>{t.status}</span>
                  </td>
                  <td className="py-2.5 text-gray-500 text-xs truncate max-w-48">{t.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* Grid View */
        Object.entries(grouped)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([cat, techs]) => (
            <div key={cat}>
              <h2 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-xs ${CATEGORY_COLORS[cat] || 'bg-gray-500/20 text-gray-400'}`}>
                  {CATEGORY_LABELS[cat] || cat}
                </span>
                <span className="text-gray-600">({techs.length})</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                {techs.map(t => (
                  <Link
                    key={t.id}
                    to={`/technologies/${t.id}`}
                    className="card hover:bg-gray-800/60 transition-colors cursor-pointer group"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold text-white group-hover:text-blue-400 transition-colors">{t.name}</h3>
                        <p className="text-xs text-gray-500 font-mono">{t.id}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        t.status === 'APPROVED' ? 'bg-green-500/20 text-green-400' :
                        t.status === 'DEPRECATED' ? 'bg-red-500/20 text-red-400' :
                        'bg-yellow-500/20 text-yellow-400'
                      }`}>{t.status}</span>
                    </div>
                    <p className="text-sm text-gray-500 mt-2">{t.vendor}</p>
                    {t.description && (
                      <p className="text-xs text-gray-600 mt-1 truncate">{t.description}</p>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          ))
      )}
    </div>
  )
}
