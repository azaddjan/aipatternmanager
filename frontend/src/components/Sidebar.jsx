import { NavLink } from 'react-router-dom'

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
]

export default function Sidebar() {
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

        {/* Separator */}
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
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-gray-800">
        <div className="text-xs text-gray-600">
          <p>v1.0.0 &middot; Azad Djan</p>
        </div>
      </div>
    </aside>
  )
}
