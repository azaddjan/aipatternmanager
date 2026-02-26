/**
 * Reusable sortable table header component.
 * Props:
 *   label - column display name
 *   field - sort key to use
 *   sortBy - current sort field
 *   sortDir - current sort direction ('asc' | 'desc')
 *   onSort(field) - callback when header is clicked
 *   className - optional extra classes
 */
export default function SortableHeader({ label, field, sortBy, sortDir, onSort, className = '' }) {
  const isActive = sortBy === field
  return (
    <th
      className={`pb-2 font-medium cursor-pointer select-none hover:text-gray-300 transition-colors ${className}`}
      onClick={() => onSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`text-xs ${isActive ? 'text-blue-400' : 'text-gray-700'}`}>
          {isActive ? (sortDir === 'asc' ? '\u25B2' : '\u25BC') : '\u25BC'}
        </span>
      </span>
    </th>
  )
}

/**
 * Generic sort helper — sorts an array by a key.
 * Handles strings (case-insensitive), numbers, and nulls.
 */
export function sortItems(items, sortBy, sortDir) {
  if (!sortBy) return items
  return [...items].sort((a, b) => {
    let va = a[sortBy]
    let vb = b[sortBy]
    // Nulls go last
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    // String comparison (case-insensitive)
    if (typeof va === 'string') va = va.toLowerCase()
    if (typeof vb === 'string') vb = vb.toLowerCase()
    if (va < vb) return sortDir === 'asc' ? -1 : 1
    if (va > vb) return sortDir === 'asc' ? 1 : -1
    return 0
  })
}
