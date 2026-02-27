/**
 * Skeleton loading components for enterprise-grade loading states.
 */

export function Skeleton({ className = '', width, height }) {
  const style = {}
  if (width) style.width = width
  if (height) style.height = height
  return <div className={`skeleton rounded ${className}`} style={style} />
}

export function SkeletonText({ lines = 3, className = '' }) {
  const widths = ['100%', '92%', '78%', '85%', '65%']
  return (
    <div className={`space-y-2.5 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton rounded h-3.5" style={{ width: widths[i % widths.length] }} />
      ))}
    </div>
  )
}

export function SkeletonStatCard() {
  return (
    <div className="card">
      <div className="skeleton rounded h-3 w-24 mb-3" />
      <div className="skeleton rounded h-8 w-16 mb-1" />
    </div>
  )
}

export function SkeletonTableRow({ cols = 5 }) {
  const widths = ['20%', '28%', '15%', '18%', '12%']
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="py-3 px-3">
          <div className="skeleton rounded h-4" style={{ width: widths[i % widths.length] }} />
        </td>
      ))}
    </tr>
  )
}

export function SkeletonCard() {
  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-3">
        <div className="skeleton rounded h-6 w-12" />
        <div className="skeleton rounded h-5 w-40" />
      </div>
      <div className="skeleton rounded h-3.5 w-full" />
      <div className="skeleton rounded h-3.5 w-3/4" />
      <div className="flex gap-2 mt-2">
        <div className="skeleton rounded h-5 w-16" />
        <div className="skeleton rounded h-5 w-20" />
      </div>
    </div>
  )
}

export function SkeletonPageHeader() {
  return (
    <div className="space-y-2">
      <div className="skeleton rounded h-8 w-64" />
      <div className="skeleton rounded h-4 w-96" />
    </div>
  )
}
