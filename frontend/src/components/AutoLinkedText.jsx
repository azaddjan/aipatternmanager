import { Link } from 'react-router-dom'

// Pattern ID regex: ABB-XXX-NNN, SBB-XXX-NNN, AB-PAT-NNN
const PATTERN_ID_RE = /\b((?:ABB|SBB|AB)-[\w]+-\d{3})\b/g

/**
 * Renders text with auto-linked pattern IDs.
 * Any ABB-xxx-nnn / SBB-xxx-nnn / AB-xxx-nnn references become clickable links.
 */
export default function AutoLinkedText({ text }) {
  if (!text) return null

  const parts = []
  let remaining = text
  let keyIdx = 0

  while (remaining.length > 0) {
    const match = PATTERN_ID_RE.exec(remaining)
    PATTERN_ID_RE.lastIndex = 0

    const pos = remaining.search(PATTERN_ID_RE)
    PATTERN_ID_RE.lastIndex = 0

    if (pos === -1) {
      parts.push(remaining)
      break
    }

    const m = remaining.match(PATTERN_ID_RE)
    PATTERN_ID_RE.lastIndex = 0
    const matchText = m[0]

    if (pos > 0) {
      parts.push(remaining.slice(0, pos))
    }

    const linkClass = matchText.startsWith('ABB') ? 'text-blue-400'
      : matchText.startsWith('SBB') ? 'text-green-400'
      : 'text-orange-400'

    parts.push(
      <Link
        key={`link-${keyIdx++}`}
        to={`/patterns/${matchText}`}
        className={`${linkClass} hover:underline font-medium`}
      >
        {matchText}
      </Link>
    )

    remaining = remaining.slice(pos + matchText.length)
  }

  return <>{parts}</>
}
