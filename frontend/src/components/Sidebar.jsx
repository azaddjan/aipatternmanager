import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const NAV_ITEMS = [
  { to: '/',             icon: '📊', label: 'Dashboard' },
  { to: '/patterns',     icon: '🧩', label: 'Patterns' },
  { to: '/graph',        icon: '🕸️', label: 'Graph Explorer' },
  { to: '/technologies', icon: '⚙️', label: 'Technologies' },
  { to: '/pbcs',         icon: '📦', label: 'Business Capabilities' },
  { to: '/discovery',    icon: '🔍', label: 'Pattern Discovery' },
  { to: '/advisor',      icon: '🧠', label: 'Pattern Advisor' },
  { to: '/health',       icon: '🏥', label: 'Pattern Health' },
  { to: '/impact',       icon: '💥', label: 'Impact Analysis' },
]

const ADMIN_ITEMS = [
  { to: '/admin',        icon: '🛠️', label: 'Admin' },
  { to: '/admin/users',  icon: '👥', label: 'Users' },
  { to: '/admin/teams',  icon: '🏢', label: 'Teams' },
]

const ROLE_LABELS = {
  admin: 'Admin',
  team_member: 'Team Member',
  viewer: 'Viewer',
}

/* ── Profile Modal ── */
function ProfileModal({ onClose }) {
  const { user, updateProfile, changePassword } = useAuth()
  const [tab, setTab] = useState('profile') // profile | password
  const [name, setName] = useState(user?.name || '')
  const [email, setEmail] = useState(user?.email || '')
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [error, setError] = useState(null)

  const handleProfileSave = async () => {
    setError(null); setMsg(null)
    const updates = {}
    if (name !== user.name) updates.name = name
    if (email !== user.email) updates.email = email
    if (Object.keys(updates).length === 0) { setMsg('No changes'); return }
    setSaving(true)
    try {
      await updateProfile(updates)
      setMsg('Profile updated')
    } catch (e) { setError(e.message) }
    setSaving(false)
  }

  const handlePasswordSave = async () => {
    setError(null); setMsg(null)
    if (newPw.length < 6) { setError('New password must be at least 6 characters'); return }
    if (newPw !== confirmPw) { setError('Passwords do not match'); return }
    setSaving(true)
    try {
      await changePassword(currentPw, newPw)
      setMsg('Password changed successfully')
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
    } catch (e) { setError(e.message) }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-[420px] max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <h2 className="text-white font-semibold">Account Settings</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800">
          <button
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${tab === 'profile' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-500 hover:text-gray-300'}`}
            onClick={() => { setTab('profile'); setError(null); setMsg(null) }}
          >
            Profile
          </button>
          <button
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${tab === 'password' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-500 hover:text-gray-300'}`}
            onClick={() => { setTab('password'); setError(null); setMsg(null) }}
          >
            Password
          </button>
        </div>

        <div className="p-4 space-y-4">
          {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}
          {msg && <p className="text-green-400 text-sm bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">{msg}</p>}

          {tab === 'profile' && (
            <>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Name</label>
                <input className="input w-full" value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Email</label>
                <input className="input w-full" type="email" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Role</label>
                <input className="input w-full opacity-60" value={ROLE_LABELS[user?.role] || user?.role} disabled />
              </div>
              {user?.team_name && (
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Team</label>
                  <input className="input w-full opacity-60" value={user.team_name} disabled />
                </div>
              )}
              <button
                className="btn-primary w-full"
                onClick={handleProfileSave}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save Profile'}
              </button>
            </>
          )}

          {tab === 'password' && (
            <>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Current Password</label>
                <input className="input w-full" type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">New Password</label>
                <input className="input w-full" type="password" value={newPw} onChange={e => setNewPw(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Confirm New Password</label>
                <input className="input w-full" type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} />
              </div>
              <button
                className="btn-primary w-full"
                onClick={handlePasswordSave}
                disabled={saving || !currentPw || !newPw}
              >
                {saving ? 'Changing...' : 'Change Password'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Sidebar ── */
export default function Sidebar() {
  const { user, isAdmin, logout } = useAuth()
  const [showProfile, setShowProfile] = useState(false)

  return (
    <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col h-screen shrink-0">
      {/* Logo */}
      <div className="p-5 border-b border-gray-800">
        <h1 className="text-lg font-bold text-white flex items-center gap-2">
          <span className="text-2xl">🧩</span>
          <span>AI Pattern<br/><span className="text-blue-400">Manager</span></span>
        </h1>
        <p className="text-xs text-gray-500 mt-1">Architecture Patterns</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map(({ to, icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-blue-600/20 text-blue-400 border border-blue-600/30'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
              }`
            }
          >
            <span className="text-lg">{icon}</span>
            <span>{label}</span>
          </NavLink>
        ))}

        {/* Admin section - only visible to admins */}
        {isAdmin && (
          <>
            <div className="border-t border-gray-800 my-2" />
            {ADMIN_ITEMS.map(({ to, icon, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-blue-600/20 text-blue-400 border border-blue-600/30'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                  }`
                }
              >
                <span className="text-lg">{icon}</span>
                <span>{label}</span>
              </NavLink>
            ))}
          </>
        )}
      </nav>

      {/* User info & Actions */}
      <div className="p-4 border-t border-gray-800">
        {user && (
          <div className="flex items-center justify-between">
            <button
              className="min-w-0 flex-1 text-left hover:bg-gray-800 rounded-lg px-2 py-1.5 -ml-2 transition-colors"
              onClick={() => setShowProfile(true)}
              title="Account Settings"
            >
              <p className="text-sm text-white truncate">{user.name || user.email}</p>
              <p className="text-xs text-gray-500">
                {ROLE_LABELS[user.role] || user.role}
                {user.team_name && <span> &middot; {user.team_name}</span>}
              </p>
            </button>
            <button
              onClick={logout}
              className="ml-2 p-1.5 text-gray-500 hover:text-red-400 hover:bg-gray-800 rounded-lg transition-colors"
              title="Sign out"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        )}
        <div className="text-xs text-gray-600 mt-2">
          <p>v1.0.0 &middot; Azad Djan</p>
        </div>
      </div>

      {/* Profile Modal */}
      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
    </aside>
  )
}
