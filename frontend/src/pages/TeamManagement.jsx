import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { fetchTeams, createTeam, updateTeam, deleteTeam, fetchTeam } from '../api/client'
import ConfirmModal from '../components/ConfirmModal'
import { useToast } from '../components/Toast'
import { SkeletonTableRow } from '../components/Skeleton'

export default function TeamManagement({ embedded = false }) {
  const { toast } = useToast()
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ name: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [selectedTeam, setSelectedTeam] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const t = await fetchTeams()
      setTeams(t)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  function startCreate() {
    setForm({ name: '', description: '' })
    setEditingId(null)
    setShowCreate(true)
    setSelectedTeam(null)
  }

  function startEdit(team) {
    setForm({ name: team.name, description: team.description || '' })
    setEditingId(team.id)
    setShowCreate(true)
    setSelectedTeam(null)
  }

  async function viewTeam(team) {
    setError('')
    try {
      const detail = await fetchTeam(team.id)
      setSelectedTeam(detail)
      setShowCreate(false)
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (editingId) {
        await updateTeam(editingId, form)
        toast.success('Team updated')
      } else {
        await createTeam(form)
        toast.success('Team created')
      }
      setShowCreate(false)
      setEditingId(null)
      await load()
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  function handleDelete(team) {
    setDeleteTarget(team)
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setError('')
    try {
      await deleteTeam(deleteTarget.id)
      toast.success('Team deleted')
      if (selectedTeam?.id === deleteTarget.id) setSelectedTeam(null)
      await load()
    } catch (err) {
      setError(err.message)
    }
    setDeleteTarget(null)
  }

  if (loading) {
    return (
      <div className={`${embedded ? '' : 'max-w-5xl mx-auto '}space-y-6`}>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left py-3 px-4 text-gray-500 font-medium">Team</th>
                <th className="text-center py-3 px-4 text-gray-500 font-medium">Members</th>
                <th className="text-center py-3 px-4 text-gray-500 font-medium">Patterns</th>
                <th className="text-right py-3 px-4 text-gray-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonTableRow key={i} cols={4} />
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
            <span className="text-gray-400">Teams</span>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="page-title">Team Management</h1>
              <p className="page-subtitle">{teams.length} team{teams.length !== 1 ? 's' : ''}</p>
            </div>
            <button onClick={startCreate} className="btn-primary">
              + New Team
            </button>
          </div>
        </>
      )}
      {embedded && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-400">{teams.length} team{teams.length !== 1 ? 's' : ''}</p>
          <button onClick={startCreate} className="btn-primary">
            + New Team
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
            {editingId ? 'Edit Team' : 'Create Team'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Team Name</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="input w-full"
                required
                placeholder="e.g. Data Architecture"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="input w-full"
                rows={3}
                placeholder="What does this team manage?"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? 'Saving...' : editingId ? 'Update Team' : 'Create Team'}
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Teams List */}
        <div className="lg:col-span-2">
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">Team</th>
                  <th className="text-center py-3 px-4 text-gray-500 font-medium">Members</th>
                  <th className="text-center py-3 px-4 text-gray-500 font-medium">Patterns</th>
                  <th className="text-right py-3 px-4 text-gray-500 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {teams.map(team => (
                  <tr
                    key={team.id}
                    className={`border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer ${
                      selectedTeam?.id === team.id ? 'bg-gray-800/50' : ''
                    }`}
                    onClick={() => viewTeam(team)}
                  >
                    <td className="py-3 px-4">
                      <div>
                        <p className="text-white font-medium">{team.name}</p>
                        {team.description && (
                          <p className="text-xs text-gray-500 mt-0.5">{team.description}</p>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center text-gray-400">
                      {team.member_count ?? 0}
                    </td>
                    <td className="py-3 px-4 text-center text-gray-400">
                      {team.pattern_count ?? 0}
                    </td>
                    <td className="py-3 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => startEdit(team)}
                          className="text-xs text-blue-400 hover:text-blue-300"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(team)}
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {teams.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-gray-500">
                      No teams yet. Create your first team to get started.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Team Detail Panel */}
        <div>
          {selectedTeam ? (
            <div className="card">
              <h3 className="text-lg font-semibold text-white mb-3">{selectedTeam.name}</h3>
              {selectedTeam.description && (
                <p className="text-sm text-gray-400 mb-4">{selectedTeam.description}</p>
              )}
              <div className="space-y-3">
                <div>
                  <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                    Members ({selectedTeam.members?.length || 0})
                  </h4>
                  {selectedTeam.members?.length > 0 ? (
                    <div className="space-y-2">
                      {selectedTeam.members.map(m => (
                        <div key={m.id} className="flex items-center justify-between bg-gray-800/50 rounded-lg px-3 py-2">
                          <div>
                            <p className="text-sm text-white">{m.name || m.email}</p>
                            <p className="text-xs text-gray-500">{m.email}</p>
                          </div>
                          <span className="text-xs text-gray-500">{m.role}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-600">No members assigned</p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="card text-center py-8">
              <p className="text-gray-500 text-sm">Select a team to view details</p>
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete Team"
        message={`Are you sure you want to delete team "${deleteTarget?.name}"? Members will be unassigned from this team.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
