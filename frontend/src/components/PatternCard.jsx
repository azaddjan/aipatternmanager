import { Link } from 'react-router-dom'

const TYPE_BADGE = {
  AB:  'badge-ab',
  ABB: 'badge-abb',
  SBB: 'badge-sbb',
  PBC: 'badge-pbc',
}

const CATEGORY_LABELS = {
  blueprint: 'Architecture Topology',
  core: 'Core AI/LLM',
  intg: 'Integration',
  agt: 'Agents',
  kr: 'Knowledge & Retrieval',
  xcut: 'Cross-Cutting',
  pip: 'Platform Integration',
}

export default function PatternCard({ pattern }) {
  const badgeClass = TYPE_BADGE[pattern.type] || 'badge-abb'

  return (
    <Link
      to={`/patterns/${pattern.id}`}
      className="card hover:border-gray-600 transition-colors group block"
    >
      <div className="flex items-start justify-between mb-3">
        <span className={`text-xs font-mono px-2 py-0.5 rounded ${badgeClass}`}>
          {pattern.type}
        </span>
        <span className="text-xs text-gray-500 font-mono">{pattern.id}</span>
      </div>

      <h3 className="font-semibold text-gray-100 group-hover:text-blue-400 transition-colors mb-2">
        {pattern.name}
      </h3>

      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span>{CATEGORY_LABELS[pattern.category] || pattern.category}</span>
        <span>&middot;</span>
        <span className={
          pattern.status === 'ACTIVE' ? 'text-green-400' :
          pattern.status === 'DEPRECATED' ? 'text-red-400' : 'text-yellow-400'
        }>
          {pattern.status}
        </span>
        <span>&middot;</span>
        <span>v{pattern.version}</span>
        {pattern.team_name && (
          <>
            <span>&middot;</span>
            <span className="text-purple-400">{pattern.team_name}</span>
          </>
        )}
      </div>
    </Link>
  )
}

export function TypeBadge({ type }) {
  const badgeClass = TYPE_BADGE[type] || 'badge-abb'
  return (
    <span className={`text-xs font-mono px-2 py-0.5 rounded ${badgeClass}`}>
      {type}
    </span>
  )
}
