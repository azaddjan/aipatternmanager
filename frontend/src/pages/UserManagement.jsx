import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { fetchUsers, createUser, updateUser, deleteUser, fetchTeams } from '../api/client'
import ConfirmModal from '../components/ConfirmModal'
import { useToast } from '../components/Toast'
import { SkeletonTableRow } from '../components/Skeleton'

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'team_member', label: 'Team Member' },
  { value: 'viewer', label: 'Viewer' },
]

const ROLE_COLORS = {
  admin: 'bg-red-500/20 text-red-400 border-red-500/30',
  team_member: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  viewer: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
}

export default function UserManagement({ embedded = false }) {
  const { toast } = useToast()
  const [users, setUsers] = useState([])
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'viewer', team_id: '' })
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [u, t] = await Promise.all([fetchUsers(), fetchTeams()])
      setUsers(u)
      setTeams(t)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  function startCreate() {
    setForm({ email: '', name: '', password: '', role: 'viewer', team_id: '' })
    setEditingId(null)
    setShowCreate(true)
    setFieldErrors({})
  }

  function startEdit(user) {
    setForm({
      email: user.email,
      name: user.name || '',
      password: '',
      role: user.role,
      team_id: user.team_id || '',
    })
    setEditingId(user.id)
    setShowCreate(true)
  }

  function validateUserForm() {
    const errs = {}
    if (!form.email.trim()) errs.email = 'Email is required'
    else if (!/\S+@\S+\.\S+/.test(form.email)) errs.email = 'Enter a valid email'
    if (!editingId && !form.password.trim()) errs.password = 'Password is required'
    else if (!editingId && form.password.length < 6) errs.password = 'Password must be at least 6 characters'
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!validateUserForm()) return
    setSaving(true)
    setError('')
    try {
      if (editingId) {
        const updates = { name: form.name, role: form.role, team_id: form.team_id || null }
        if (form.password) updates.password = form.password
        await updateUser(editingId, updates)
        toast.success('User updated')
      } else {
        await createUser(form)
        toast.success('User created')
      }
      setShowCreate(false)
      setEditingId(null)
      setFieldErrors({})
      await load()
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  function handleDelete(user) {
    setDeleteTarget(user)
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setError('')
    try {
      await deleteUser(deleteTarget.id)
      toast.success('User deleted')
      await load()
    } catch (err) {
      setError(err.message)
    }
    setDeleteTarget(null)
  }

  async function handleToggleActive(user) {
    setError('')
    try {
      await updateUser(user.id, { is_active: !user.is_active })
      toast.success('User status updated')
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) {
    return (
      <div className={`${embedded ? '' : 'max-w-5xl mx-auto '}space-y-6`}>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left py-3 px-4 text-gray-500 font-medium">Name</th>
                <th className="text-left py-3 px-4 text-gray-500 font-medium">Email</th>
                <th className="text-left py-3 px-4 text-gray-500 font-medium">Role</th>
                <th className="text-left py-3 px-4 text-gray-500 font-medium">Team</th>
                <th className="text-left py-3 px-4 text-gray-500 font-medium">Status</th>
                <th className="text-right py-3 px-4 text-gray-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 5 }).map((_, i) => (
                <SkeletonTableRow key={i} cols={6} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className={`${embedded ? '' : 'max-w-5xl mx-auto '}space-y-6`}>
      {!embedded && (
        <>
          <div className="flex items-center gap-2 text-sm">
            <Link to="/admin" className="text-gray-500 hover:text-gray-300 transition-colors">&larr; Admin</Link>
            <span className="text-gray-700">/</span>
            <span className="text-gray-400">Users</span>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="page-title">User Management</h1>
              <p className="page-subtitle">{users.length} user{users.length !== 1 ? 's' : ''}</p>
            </div>
            <button onClick={startCreate} className="btn-primary">
              + New User
            </button>
          </div>
        </>
      )}
      {embedded && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-400">{users.length} user{users.length !== 1 ? 's' : ''}</p>
          <button onClick={startCreate} className="btn-primary">
            + New User
          </button>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Create / Edit Form */}
      {showCreate && (
        <div className="card">
          <h2 className="text-lg font-semibold text-white mb-4">
            {editingId ? 'Edit User' : 'Create User'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Email <span className="text-red-400">*</span></label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => { setForm(f => ({ ...f, email: e.target.value })); setFieldErrors(fe => ({ ...fe, email: undefined })) }}
                  className={`input w-full ${fieldErrors.email ? 'border-red-500/50' : ''}`}
                  disabled={!!editingId}
                />
                {fieldErrors.email && <p className="text-red-400 text-xs mt-1">{fieldErrors.email}</p>}
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="input w-full"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Password {!editingId && <span className="text-red-400">*</span>}
                  {editingId && <span className="text-gray-600">(leave blank to keep)</span>}
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={e => { setForm(f => ({ ...f, password: e.target.value })); setFieldErrors(fe => ({ ...fe, password: undefined })) }}
                  className={`input w-full ${fieldErrors.password ? 'border-red-500/50' : ''}`}
                />
                {fieldErrors.password && <p className="text-red-400 text-xs mt-1">{fieldErrors.password}</p>}
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Role</label>
                <select
                  value={form.role}
                  onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                  className="input w-full"
                >
                  {ROLE_OPTIONS.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Team</label>
                <select
                  value={form.team_id}
                  onChange={e => setForm(f => ({ ...f, team_id: e.target.value }))}
                  className="input w-full"
                >
                  <option value="">No team</option>
                  {teams.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? 'Saving...' : editingId ? 'Update User' : 'Create User'}
              </button>
              <button
                type="button"
                onClick={() => { setShowCreate(false); setEditingId(null) }}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Users Table */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Name</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Email</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Role</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Team</th>
              <th className="text-left py-3 px-4 text-gray-500 font-medium">Status</th>
              <th className="text-right py-3 px-4 text-gray-500 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <tr key={user.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                <td className="py-3 px-4 text-white">{user.name || '-'}</td>
                <td className="py-3 px-4 text-gray-400">{user.email}</td>
                <td className="py-3 px-4">
                  <span className={`text-xs px-2 py-1 rounded-full border ${ROLE_COLORS[user.role] || ROLE_COLORS.viewer}`}>
                    {ROLE_OPTIONS.find(r => r.value === user.role)?.label || user.role}
                  </span>
                </td>
                <td className="py-3 px-4 text-gray-400">{user.team_name || '-'}</td>
                <td className="py-3 px-4">
                  <button
                    onClick={() => handleToggleActive(user)}
                    className={`text-xs px-2 py-1 rounded-full border cursor-pointer ${
                      user.is_active
                        ? 'bg-green-500/20 text-green-400 border-green-500/30'
                        : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                    }`}
                  >
                    {user.is_active ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td className="py-3 px-4 text-right">
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => startEdit(user)}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(user)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-gray-500">
                  No users found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete User"
        message={`Are you sure you want to delete user "${deleteTarget?.name || deleteTarget?.email}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
