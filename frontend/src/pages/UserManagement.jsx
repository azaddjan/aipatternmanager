import { useState, useEffect } from 'react'
import { fetchUsers, createUser, updateUser, deleteUser, fetchTeams } from '../api/client'

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

export default function UserManagement() {
  const [users, setUsers] = useState([])
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'viewer', team_id: '' })
  const [saving, setSaving] = useState(false)

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

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (editingId) {
        const updates = { name: form.name, role: form.role, team_id: form.team_id || null }
        if (form.password) updates.password = form.password
        await updateUser(editingId, updates)
      } else {
        await createUser(form)
      }
      setShowCreate(false)
      setEditingId(null)
      await load()
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  async function handleDelete(user) {
    if (!confirm(`Delete user "${user.name || user.email}"? This cannot be undone.`)) return
    setError('')
    try {
      await deleteUser(user.id)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleToggleActive(user) {
    setError('')
    try {
      await updateUser(user.id, { is_active: !user.is_active })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-400">Loading users...</p>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">User Management</h1>
          <p className="text-sm text-gray-500 mt-1">{users.length} user{users.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={startCreate} className="btn-primary">
          + New User
        </button>
      </div>

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
                <label className="block text-xs text-gray-500 mb-1">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  className="input w-full"
                  required
                  disabled={!!editingId}
                />
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
                  Password {editingId && <span className="text-gray-600">(leave blank to keep)</span>}
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  className="input w-full"
                  required={!editingId}
                  minLength={6}
                />
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
    </div>
  )
}
