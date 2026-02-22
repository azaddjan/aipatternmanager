import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { fetchTechnology, updateTechnology, deleteTechnology } from '../api/client'

const TECH_CATEGORIES = [
  'cloud-compute', 'cloud-ai', 'cloud-data', 'cloud-infra',
  'framework', 'saas', 'observability', 'database',
]

const CATEGORY_LABELS = {
  'cloud-compute': 'Cloud Compute',
  'cloud-ai': 'Cloud AI Service',
  'cloud-data': 'Cloud Data & Storage',
  'cloud-infra': 'Cloud Infrastructure',
  'framework': 'Framework / Library',
  'saas': 'SaaS Platform',
  'observability': 'Observability',
  'database': 'Database',
}

const CATEGORY_COLORS = {
  'cloud-compute': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'cloud-ai': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  'cloud-data': 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  'cloud-infra': 'bg-sky-500/20 text-sky-400 border-sky-500/30',
  'framework': 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  'saas': 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  'observability': 'bg-lime-500/20 text-lime-400 border-lime-500/30',
  'database': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
}

export default function TechnologyDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [tech, setTech] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [cascadeResult, setCascadeResult] = useState(null)

  const load = () => {
    setLoading(true)
    fetchTechnology(id).then(t => {
      setTech(t)
      setForm({
        name: t.name || '',
        vendor: t.vendor || '',
        category: t.category || '',
        status: t.status || 'APPROVED',
        description: t.description || '',
        cost_tier: t.cost_tier || '',
        doc_url: t.doc_url || '',
        website: t.website || '',
        notes: t.notes || '',
      })
      setLoading(false)
    }).catch(() => {
      setTech(null)
      setLoading(false)
    })
  }

  useEffect(() => { load() }, [id])

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setCascadeResult(null)
    try {
      const res = await updateTechnology(id, form)
      if (res.cascade_deprecated && res.cascade_deprecated.length > 0) {
        setCascadeResult(res.cascade_deprecated)
      }
      setEditing(false)
      load()
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  const handleDelete = async () => {
    if (!confirm(`Delete technology ${id}? This cannot be undone.`)) return
    try {
      await deleteTechnology(id)
      navigate('/technologies')
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return <div className="text-gray-500 text-center py-12">Loading technology...</div>
  if (!tech) return <div className="text-red-400 text-center py-12">Technology {id} not found</div>

  const catColor = CATEGORY_COLORS[tech.category] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'
  const catLabel = CATEGORY_LABELS[tech.category] || tech.category
  const patterns = tech.used_by_patterns || []

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link to="/technologies" className="text-gray-500 hover:text-gray-300 transition-colors">&larr; Technologies</Link>
        <span className="text-gray-700">/</span>
        <span className="text-gray-400">{tech.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className={`text-xs px-2.5 py-1 rounded border ${catColor}`}>{catLabel}</span>
            <span className="text-gray-500 font-mono text-sm">{tech.id}</span>
            <span className={`text-xs px-2 py-0.5 rounded ${
              tech.status === 'APPROVED' ? 'bg-green-500/20 text-green-400' :
              tech.status === 'DEPRECATED' ? 'bg-red-500/20 text-red-400' :
              'bg-yellow-500/20 text-yellow-400'
            }`}>{tech.status}</span>
          </div>
          <h1 className="text-2xl font-bold text-white">{tech.name}</h1>
          <p className="text-gray-500 text-sm mt-1">Vendor: {tech.vendor}</p>
        </div>
        <div className="flex gap-2">
          {tech.doc_url && (
            <a href={tech.doc_url} target="_blank" rel="noopener noreferrer" className="btn-primary flex items-center gap-1.5">
              Documentation
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
          <button onClick={() => setEditing(!editing)} className="btn-secondary">
            {editing ? 'Cancel' : 'Edit'}
          </button>
          <button onClick={handleDelete} className="btn-danger">Delete</button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {/* Cascade Deprecation Alert */}
      {cascadeResult && cascadeResult.length > 0 && (
        <div className="bg-orange-500/10 border border-orange-500/30 text-orange-400 rounded-lg px-4 py-3">
          <p className="font-semibold text-sm mb-2">Cascade Deprecation: {cascadeResult.length} SBB(s) were automatically deprecated</p>
          <ul className="text-sm space-y-1">
            {cascadeResult.map(s => (
              <li key={s.id}>
                <Link to={`/patterns/${s.id}`} className="text-orange-300 hover:underline font-mono text-xs">{s.id}</Link>
                <span className="text-orange-400/70 ml-2">{s.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Edit Form */}
      {editing && (
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-gray-400">Edit Technology</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="input w-full" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Vendor</label>
              <input value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))} className="input w-full" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Category</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="select w-full">
                {TECH_CATEGORIES.map(c => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>
                ))}
                {!TECH_CATEGORIES.includes(form.category) && form.category && (
                  <option value={form.category}>{form.category}</option>
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Status</label>
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className="select w-full">
                <option value="APPROVED">APPROVED</option>
                <option value="UNDER_REVIEW">UNDER_REVIEW</option>
                <option value="DEPRECATED">DEPRECATED</option>
              </select>
              {form.status === 'DEPRECATED' && tech.status !== 'DEPRECATED' && (
                <p className="text-xs text-orange-400 mt-1">
                  Warning: Deprecating will also deprecate all SBBs using this technology.
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Cost Tier</label>
              <select value={form.cost_tier} onChange={e => setForm(f => ({ ...f, cost_tier: e.target.value }))} className="select w-full">
                <option value="">--</option>
                <option value="FREE">FREE</option>
                <option value="LOW">LOW</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HIGH">HIGH</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Description</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="input w-full" placeholder="Short description..." />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Documentation URL</label>
              <input value={form.doc_url} onChange={e => setForm(f => ({ ...f, doc_url: e.target.value }))} className="input w-full" placeholder="https://docs.example.com" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Website</label>
              <input value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} className="input w-full" placeholder="https://example.com" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Notes</label>
              <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="input w-full" placeholder="Internal notes..." />
            </div>
          </div>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}

      {/* Info Cards */}
      <div className="grid grid-cols-5 gap-4">
        <div className="card border-l-4 border-gray-600">
          <p className="text-xs text-gray-500">Vendor</p>
          <p className="text-lg font-semibold text-white">{tech.vendor}</p>
        </div>
        <div className="card border-l-4 border-gray-600">
          <p className="text-xs text-gray-500">Category</p>
          <p className="text-lg font-semibold text-white">{catLabel}</p>
        </div>
        <div className={`card border-l-4 ${
          tech.status === 'APPROVED' ? 'border-green-500' :
          tech.status === 'DEPRECATED' ? 'border-red-500' : 'border-yellow-500'
        }`}>
          <p className="text-xs text-gray-500">Status</p>
          <p className={`text-lg font-semibold ${
            tech.status === 'APPROVED' ? 'text-green-400' :
            tech.status === 'DEPRECATED' ? 'text-red-400' : 'text-yellow-400'
          }`}>{tech.status}</p>
        </div>
        <div className="card border-l-4 border-gray-600">
          <p className="text-xs text-gray-500">Cost Tier</p>
          <p className="text-lg font-semibold text-white">{tech.cost_tier || 'Not set'}</p>
        </div>
        <div className="card border-l-4 border-gray-600">
          <p className="text-xs text-gray-500">Used by Patterns</p>
          <p className="text-lg font-semibold text-white">{patterns.length}</p>
        </div>
      </div>

      {/* Overview */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-400 mb-2">Overview</h2>
        {tech.description ? (
          <p className="text-gray-300 leading-relaxed">{tech.description}</p>
        ) : (
          <p className="text-gray-600 italic">No overview available. Click Edit to add a description.</p>
        )}
      </div>

      {/* Links & Resources */}
      {(tech.doc_url || tech.website || tech.notes) && (
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-400 mb-3">Links & Resources</h2>
          <div className="space-y-2">
            {tech.doc_url && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-500">📄 Documentation:</span>
                <a href={tech.doc_url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline truncate">
                  {tech.doc_url}
                </a>
              </div>
            )}
            {tech.website && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-500">🌐 Website:</span>
                <a href={tech.website} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline truncate">
                  {tech.website}
                </a>
              </div>
            )}
            {tech.notes && (
              <div className="flex items-start gap-2 text-sm mt-2">
                <span className="text-gray-500">📝 Notes:</span>
                <p className="text-gray-400">{tech.notes}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Used by Patterns */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-400 mb-3">
          Used by Patterns ({patterns.length})
        </h2>
        {patterns.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left text-xs text-gray-500 pb-2 font-medium">Type</th>
                  <th className="text-left text-xs text-gray-500 pb-2 font-medium">ID</th>
                  <th className="text-left text-xs text-gray-500 pb-2 font-medium">Name</th>
                  <th className="text-left text-xs text-gray-500 pb-2 font-medium">Category</th>
                  <th className="text-right text-xs text-gray-500 pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {patterns.map(p => (
                  <tr key={p.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="py-2">
                      <span className={`text-xs font-mono px-2 py-0.5 rounded ${
                        p.type === 'AB' ? 'badge-ab' : p.type === 'ABB' ? 'badge-abb' : 'badge-sbb'
                      }`}>{p.type}</span>
                    </td>
                    <td className="py-2">
                      <Link to={`/patterns/${p.id}`} className="text-blue-400 font-mono text-xs hover:underline">
                        {p.id}
                      </Link>
                    </td>
                    <td className="py-2 text-gray-300">{p.name}</td>
                    <td className="py-2 text-gray-500 text-xs">{p.category}</td>
                    <td className="py-2 text-right">
                      <span className={`text-xs ${
                        p.status === 'ACTIVE' ? 'text-green-400' :
                        p.status === 'DEPRECATED' ? 'text-red-400' : 'text-yellow-400'
                      }`}>{p.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-600 text-sm">No patterns reference this technology.</p>
        )}
      </div>
    </div>
  )
}
