import { useState, useEffect, useRef, useCallback } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { globalSearch } from '../api/client'
import { useToast } from './Toast'

const NAV_ITEMS = [
  { to: '/',             icon: '📊', label: 'Dashboard' },
  { to: '/pbcs',         icon: '📦', label: 'Business Capabilities' },
  { to: '/patterns',     icon: '🧩', label: 'Patterns' },
  { to: '/technologies', icon: '⚙️', label: 'Technologies' },
  { to: '/documents',    icon: '📄', label: 'Documents' },
  { to: '/advisor',      icon: '🧠', label: 'Pattern Advisor' },
  { to: '/impact',       icon: '💥', label: 'Impact Analysis' },
  { to: '/graph',        icon: '🔗', label: 'Graph Explorer' },
]

const ADMIN_ITEMS = [
  { to: '/admin',        icon: '🛠️', label: 'Admin' },
]

const ROLE_LABELS = {
  admin: 'Admin',
  team_member: 'Team Member',
  viewer: 'Viewer',
}

/* ── Profile Modal ── */
function ProfileModal({ onClose }) {
  const { user, updateProfile, changePassword } = useAuth()
  const { toast } = useToast()
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
      toast.success('Profile updated')
      setMsg('Profile updated')
    } catch (e) { setError(e.message); toast.error('Failed to update: ' + e.message) }
    setSaving(false)
  }

  const handlePasswordSave = async () => {
    setError(null); setMsg(null)
    if (newPw.length < 6) { setError('New password must be at least 6 characters'); return }
    if (newPw !== confirmPw) { setError('Passwords do not match'); return }
    setSaving(true)
    try {
      await changePassword(currentPw, newPw)
      toast.success('Password changed')
      setMsg('Password changed successfully')
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
    } catch (e) { setError(e.message); toast.error('Failed to update: ' + e.message) }
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

/* ── Global Search Modal (Cmd+K) ── */
const TYPE_ICONS = { pattern: '🧩', technology: '⚙️', pbc: '📦' }
const TYPE_PATHS = { pattern: '/patterns', technology: '/technologies', pbc: '/pbcs' }

function SearchModal({ onClose }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(0)
  const inputRef = useRef(null)
  const timerRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Debounced search
  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await globalSearch(query.trim())
        setResults(res.results || [])
        setSelected(0)
      } catch { setResults([]) }
      setLoading(false)
    }, 250)
    return () => clearTimeout(timerRef.current)
  }, [query])

  const goTo = useCallback((item) => {
    const path = item.result_type === 'pattern' ? `/patterns/${item.id}`
      : item.result_type === 'technology' ? `/technologies/${item.id}`
      : `/pbcs/${item.id}`
    navigate(path)
    onClose()
  }, [navigate, onClose])

  const handleKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter' && results[selected]) { goTo(results[selected]) }
    else if (e.key === 'Escape') { onClose() }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-[520px] max-h-[60vh] overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
          <svg className="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search patterns, technologies, PBCs..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            className="flex-1 bg-transparent text-white text-sm outline-none placeholder-gray-500"
          />
          <kbd className="text-[10px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded border border-gray-700">ESC</kbd>
        </div>

        {/* Results */}
        <div className="overflow-y-auto max-h-[45vh]">
          {loading && <p className="text-gray-500 text-sm text-center py-6">Searching...</p>}
          {!loading && query && results.length === 0 && (
            <p className="text-gray-500 text-sm text-center py-6">No results for "{query}"</p>
          )}
          {!loading && !query && (
            <p className="text-gray-600 text-xs text-center py-6">Type to search across all patterns, technologies, and PBCs</p>
          )}
          {results.map((item, i) => (
            <button
              key={`${item.result_type}-${item.id}`}
              className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${
                i === selected ? 'bg-blue-600/20' : 'hover:bg-gray-800'
              }`}
              onClick={() => goTo(item)}
              onMouseEnter={() => setSelected(i)}
            >
              <span className="text-lg">{TYPE_ICONS[item.result_type] || '📄'}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white truncate">{item.name || item.id}</span>
                  <span className="text-[10px] font-mono text-gray-500">{item.id}</span>
                </div>
                {item.description && (
                  <p className="text-xs text-gray-500 truncate">{item.description}</p>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {item.type && <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                  item.type === 'AB' ? 'badge-ab' : item.type === 'ABB' ? 'badge-abb' : item.type === 'SBB' ? 'badge-sbb' : 'bg-gray-800 text-gray-400'
                }`}>{item.type}</span>}
                {item.status && <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  item.status === 'ACTIVE' || item.status === 'APPROVED' ? 'bg-green-500/10 text-green-400' :
                  item.status === 'DEPRECATED' ? 'bg-red-500/10 text-red-400' : 'bg-yellow-500/10 text-yellow-400'
                }`}>{item.status}</span>}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── Sidebar ── */
export default function Sidebar() {
  const { user, isAdmin, logout } = useAuth()
  const [showProfile, setShowProfile] = useState(false)
  const [showSearch, setShowSearch] = useState(false)

  // Cmd+K / Ctrl+K global shortcut
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowSearch(s => !s)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

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

      {/* Search Bar */}
      <div className="px-3 pt-3">
        <button
          onClick={() => setShowSearch(true)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-500 text-sm hover:border-gray-600 hover:text-gray-400 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span className="flex-1 text-left">Search...</span>
          <kbd className="text-[10px] bg-gray-700/50 px-1.5 py-0.5 rounded border border-gray-600">⌘K</kbd>
        </button>
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

      {/* Modals */}
      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
      {showSearch && <SearchModal onClose={() => setShowSearch(false)} />}
    </aside>
  )
}
