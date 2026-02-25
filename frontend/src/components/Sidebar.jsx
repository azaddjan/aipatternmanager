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

export default function Sidebar() {
  const { user, isAdmin, logout } = useAuth()

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

      {/* User info & Logout */}
      <div className="p-4 border-t border-gray-800">
        {user && (
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-white truncate">{user.name || user.email}</p>
              <p className="text-xs text-gray-500">
                {ROLE_LABELS[user.role] || user.role}
                {user.team_name && <span> &middot; {user.team_name}</span>}
              </p>
            </div>
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
    </aside>
  )
}
