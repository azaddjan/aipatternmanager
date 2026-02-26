import { useState, useEffect } from 'react'
import { fetchPBCs, createPBC, updatePBC, deletePBC, fetchPatterns } from '../api/client'
import { Link } from 'react-router-dom'
import Pagination from '../components/Pagination'
import SortableHeader, { sortItems } from '../components/SortableHeader'
import ConfirmModal from '../components/ConfirmModal'

export default function PBCManager() {
  const [pbcs, setPbcs] = useState([])
  const [abbs, setAbbs] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [view, setView] = useState('table') // 'table' or 'grid'
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25
  const [sortBy, setSortBy] = useState('name')
  const [sortDir, setSortDir] = useState('asc')

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortDir('asc')
    }
  }

  const [form, setForm] = useState({ name: '', description: '', api_endpoint: '', status: 'ACTIVE', abb_ids: [] })
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [deleteTarget, setDeleteTarget] = useState(null) // { id, name } for confirm modal

  const loadData = () => {
    Promise.all([
      fetchPBCs().catch(() => ({ pbcs: [] })),
      fetchPatterns({ type: 'ABB', limit: 100 }).catch(() => ({ patterns: [] })),
    ]).then(([pbcRes, abbRes]) => {
      setPbcs(pbcRes.pbcs || [])
      setAbbs(abbRes.patterns || [])
      setLoading(false)
    })
  }

  useEffect(() => { loadData() }, [])

  const resetForm = () => {
    setForm({ name: '', description: '', api_endpoint: '', status: 'ACTIVE', abb_ids: [] })
    setEditing(null)
    setShowForm(false)
    setError('')
    setFieldErrors({})
  }

  const validateForm = () => {
    const errs = {}
    if (!form.name.trim()) errs.name = 'Name is required'
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSave = async () => {
    setError('')
    if (!validateForm()) return
    try {
      if (editing) {
        await updatePBC(editing, form)
      } else {
        await createPBC(form)
      }
      resetForm()
      loadData()
    } catch (err) {
      setError(err.message)
    }
  }

  const handleEdit = (pbc) => {
    setForm({
      name: pbc.name,
      description: pbc.description || '',
      api_endpoint: pbc.api_endpoint || '',
      status: pbc.status || 'ACTIVE',
      abb_ids: pbc.abb_ids || [],
    })
    setEditing(pbc.id)
    setShowForm(true)
  }

  const handleDelete = (id, name) => {
    setDeleteTarget({ id, name: name || id })
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await deletePBC(deleteTarget.id)
      loadData()
    } catch (err) {
      setError(err.message)
    }
    setDeleteTarget(null)
  }

  const toggleAbb = (abbId) => {
    setForm(f => ({
      ...f,
      abb_ids: f.abb_ids.includes(abbId)
        ? f.abb_ids.filter(id => id !== abbId)
        : [...f.abb_ids, abbId]
    }))
  }

  // Filter PBCs by search and status
  const filtered = pbcs.filter(pbc => {
    if (statusFilter && pbc.status !== statusFilter) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (
      pbc.name?.toLowerCase().includes(q) ||
      pbc.id?.toLowerCase().includes(q) ||
      pbc.description?.toLowerCase().includes(q) ||
      pbc.api_endpoint?.toLowerCase().includes(q) ||
      (pbc.abb_ids || []).some(id => id.toLowerCase().includes(q))
    )
  })

  const sorted = sortItems(filtered, sortBy, sortDir)

  // Reset page when search/filter/sort changes
  useEffect(() => { setPage(1) }, [search, statusFilter, sortBy, sortDir])

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)
  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-500">Loading...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Business Capabilities (PBCs)</h1>
          <p className="text-gray-500 text-sm mt-1">{filtered.length}{filtered.length !== pbcs.length ? ` of ${pbcs.length}` : ''} business capabilities</p>
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
              Cards
            </button>
          </div>
          <button onClick={() => { resetForm(); setShowForm(true) }} className="btn-primary">
            + New PBC
          </button>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="flex gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Search by name, ID, description, or ABB..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input w-64"
        />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="select"
        >
          <option value="">All Statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="DRAFT">Draft</option>
          <option value="DEPRECATED">Deprecated</option>
        </select>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {/* Form */}
      {showForm && (
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-gray-400">
            {editing ? `Edit ${editing}` : 'New Business Capability'}
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Name <span className="text-red-400">*</span></label>
              <input
                type="text"
                value={form.name}
                onChange={e => { setForm(f => ({ ...f, name: e.target.value })); setFieldErrors(fe => ({ ...fe, name: undefined })) }}
                placeholder="e.g. Intelligent Chat"
                className={`input w-full ${fieldErrors.name ? 'border-red-500/50' : ''}`}
              />
              {fieldErrors.name && <p className="text-red-400 text-xs mt-1">{fieldErrors.name}</p>}
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Status</label>
              <select
                value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="select w-full"
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="DRAFT">DRAFT</option>
                <option value="DEPRECATED">DEPRECATED</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Describe this business capability..."
              className="input w-full h-20 resize-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">API Endpoint (optional)</label>
            <input
              type="text"
              value={form.api_endpoint}
              onChange={e => setForm(f => ({ ...f, api_endpoint: e.target.value }))}
              placeholder="/api/v1/chat"
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-2">Composed ABBs</label>
            <div className="flex flex-wrap gap-2">
              {abbs.map(abb => (
                <button
                  key={abb.id}
                  onClick={() => toggleAbb(abb.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                    form.abb_ids.includes(abb.id)
                      ? 'bg-blue-600/20 border-blue-500/50 text-blue-400'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                  }`}
                >
                  {abb.id} - {abb.name}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} className="btn-primary">
              {editing ? 'Update PBC' : 'Create PBC'}
            </button>
            <button onClick={resetForm} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      {/* Content */}
      {filtered.length === 0 ? (
        <div className="text-center text-gray-500 py-12">
          {pbcs.length === 0 ? 'No PBCs yet. Click "+ New PBC" to create one.' : 'No PBCs match your search.'}
        </div>
      ) : view === 'table' ? (
        /* Table View (Default) */
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-left border-b border-gray-800">
                <SortableHeader label="ID" field="id" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="text-xs" />
                <SortableHeader label="Name" field="name" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="text-xs" />
                <SortableHeader label="Status" field="status" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="text-xs" />
                <th className="text-left text-xs text-gray-500 pb-3 font-medium">Description</th>
                <th className="text-left text-xs text-gray-500 pb-3 font-medium">ABBs</th>
                <SortableHeader label="Endpoint" field="api_endpoint" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="text-xs" />
                <th className="text-right text-xs text-gray-500 pb-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map(pbc => (
                <tr key={pbc.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="py-2.5">
                    <Link to={`/pbcs/${pbc.id}`} className="badge-pbc font-mono text-xs hover:underline">{pbc.id}</Link>
                  </td>
                  <td className="py-2.5">
                    <Link to={`/pbcs/${pbc.id}`} className="text-white font-medium hover:text-blue-400 transition-colors">{pbc.name}</Link>
                  </td>
                  <td className="py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      pbc.status === 'ACTIVE' ? 'bg-green-500/20 text-green-400' :
                      pbc.status === 'DEPRECATED' ? 'bg-red-500/20 text-red-400' :
                      'bg-yellow-500/20 text-yellow-400'
                    }`}>{pbc.status}</span>
                  </td>
                  <td className="py-2.5 text-gray-500 text-xs truncate max-w-48">{pbc.description}</td>
                  <td className="py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {(pbc.abb_ids || []).map(abbId => (
                        <Link key={abbId} to={`/patterns/${abbId}`} className="badge-abb text-xs hover:underline">
                          {abbId}
                        </Link>
                      ))}
                    </div>
                  </td>
                  <td className="py-2.5 text-gray-500 font-mono text-xs">{pbc.api_endpoint}</td>
                  <td className="py-2.5 text-right">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => handleEdit(pbc)} className="btn-secondary text-xs">Edit</button>
                      <button onClick={() => handleDelete(pbc.id, pbc.name)} className="btn-danger text-xs">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* Card View */
        <div className="grid grid-cols-1 gap-4">
          {paginated.map(pbc => (
            <div key={pbc.id} className="card border-l-4 border-purple-500/30">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <Link to={`/pbcs/${pbc.id}`} className="badge-pbc font-mono text-xs hover:underline">{pbc.id}</Link>
                    <Link to={`/pbcs/${pbc.id}`} className="text-lg font-semibold text-white hover:text-blue-400 transition-colors">{pbc.name}</Link>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      pbc.status === 'ACTIVE' ? 'bg-green-500/20 text-green-400' :
                      pbc.status === 'DEPRECATED' ? 'bg-red-500/20 text-red-400' :
                      'bg-yellow-500/20 text-yellow-400'
                    }`}>{pbc.status}</span>
                  </div>
                  {pbc.description && (
                    <p className="text-sm text-gray-400 mb-3">{pbc.description}</p>
                  )}
                  {pbc.api_endpoint && (
                    <p className="text-xs text-gray-600 mb-2">
                      Endpoint: <span className="text-gray-400 font-mono">{pbc.api_endpoint}</span>
                    </p>
                  )}
                  {pbc.abb_ids && pbc.abb_ids.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <span className="text-xs text-gray-600">Composes:</span>
                      {pbc.abb_ids.map(abbId => (
                        <Link
                          key={abbId}
                          to={`/patterns/${abbId}`}
                          className="badge-abb text-xs hover:underline"
                        >
                          {abbId}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 ml-4">
                  <button onClick={() => handleEdit(pbc)} className="btn-secondary text-xs">Edit</button>
                  <button onClick={() => handleDelete(pbc.id, pbc.name)} className="btn-danger text-xs">Delete</button>
                </div>
              </div>
            </div>
          ))}
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

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete Business Capability"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
