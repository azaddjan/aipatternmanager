import { Link } from 'react-router-dom'

/**
 * Reusable empty state component with optional call-to-action.
 *
 * @param {string} icon - Display icon/emoji (optional)
 * @param {string} title - Main heading text
 * @param {string} description - Supporting description text
 * @param {string} actionLabel - Button text for CTA
 * @param {Function} onAction - Click handler for CTA button
 * @param {string} actionLink - React Router link for CTA (alternative to onAction)
 */
export default function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  actionLink,
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {icon && (
        <div className="text-4xl mb-4 opacity-30">{icon}</div>
      )}
      <h3 className="text-lg font-semibold text-gray-300 mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-gray-500 max-w-md mb-5">{description}</p>
      )}
      {actionLabel && actionLink && (
        <Link to={actionLink} className="btn-primary text-sm">
          {actionLabel}
        </Link>
      )}
      {actionLabel && onAction && !actionLink && (
        <button onClick={onAction} className="btn-primary text-sm">
          {actionLabel}
        </button>
      )}
    </div>
  )
}
