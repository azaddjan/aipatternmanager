import { Children, isValidElement, cloneElement, useState, useEffect, useRef, useId } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import mermaid from 'mermaid'

// Initialize mermaid with dark theme (runs once)
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    primaryColor: '#3b82f6',
    primaryTextColor: '#e5e7eb',
    primaryBorderColor: '#4b5563',
    lineColor: '#6b7280',
    secondaryColor: '#1f2937',
    tertiaryColor: '#111827',
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    fontSize: '14px',
  },
  flowchart: { curve: 'basis' },
  securityLevel: 'loose',
})

/**
 * Renders a Mermaid diagram from source code.
 * Shows rendered SVG on success, raw code + error on failure.
 */
function MermaidBlock({ code }) {
  const containerRef = useRef(null)
  const [error, setError] = useState(null)
  const uniqueId = useId().replace(/:/g, '-')

  useEffect(() => {
    if (!code?.trim() || !containerRef.current) return
    let cancelled = false
    ;(async () => {
      try {
        const { svg } = await mermaid.render(`mermaid${uniqueId}`, code.trim())
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Mermaid render error')
          if (containerRef.current) containerRef.current.innerHTML = ''
        }
      }
    })()
    return () => { cancelled = true }
  }, [code, uniqueId])

  if (error) return null

  return (
    <div className="mb-3 rounded-lg border border-gray-700 overflow-hidden">
      <div ref={containerRef} className="p-3 flex justify-center bg-gray-900/50 [&_svg]:max-w-full" />
    </div>
  )
}

// Pattern ID regex: ABB-XXX-NNN, SBB-XXX-NNN, AB-PAT-NNN
const PATTERN_ID_RE = /\b((?:ABB|SBB|AB)-[\w]+-\d{3})\b/g

/**
 * Renders markdown content with:
 *  - GitHub-flavored markdown (tables, strikethrough, etc.)
 *  - Auto-linked pattern IDs (ABB-xxx-nnn, SBB-xxx-nnn, AB-xxx-nnn)
 *  - Mermaid diagram rendering for ```mermaid code blocks
 *  - Dark theme styled tables, lists, and headings
 */
export default function MarkdownContent({ content }) {
  if (!content) return null

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => (
          <p className="text-gray-300 text-sm leading-relaxed mb-3 last:mb-0">
            {processChildren(children)}
          </p>
        ),
        strong: ({ children }) => (
          <strong className="text-white font-semibold">{processChildren(children)}</strong>
        ),
        em: ({ children }) => (
          <em className="text-gray-200 italic">{processChildren(children)}</em>
        ),

        // Tables — dark theme
        table: ({ children }) => (
          <div className="overflow-x-auto rounded-lg border border-gray-700 mb-3">
            <table className="w-full text-sm">{children}</table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-gray-800/80">{children}</thead>
        ),
        tbody: ({ children }) => (
          <tbody className="divide-y divide-gray-800">{children}</tbody>
        ),
        tr: ({ children }) => (
          <tr className="hover:bg-gray-800/40 transition-colors">{children}</tr>
        ),
        th: ({ children }) => (
          <th className="text-left py-2.5 px-3 text-gray-300 font-semibold text-xs uppercase tracking-wider">
            {processChildren(children)}
          </th>
        ),
        td: ({ children }) => (
          <td className="py-2.5 px-3 text-gray-300 text-sm leading-relaxed">
            {processChildren(children)}
          </td>
        ),

        // Lists
        ul: ({ children }) => (
          <ul className="list-disc list-inside space-y-1.5 text-gray-300 text-sm mb-3 ml-1">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal list-inside space-y-1.5 text-gray-300 text-sm mb-3 ml-1">{children}</ol>
        ),
        li: ({ children }) => (
          <li className="text-gray-300 leading-relaxed">{processChildren(children)}</li>
        ),

        // Code — detect mermaid blocks
        code: ({ inline, children, className }) => {
          if (className === 'language-mermaid') {
            const code = String(children).replace(/\n$/, '')
            return <MermaidBlock code={code} />
          }
          return inline !== false && !className ? (
            <code className="px-1.5 py-0.5 bg-gray-800 text-blue-300 text-xs rounded font-mono">{children}</code>
          ) : (
            <code className="text-gray-300 text-xs font-mono">{children}</code>
          )
        },
        pre: ({ children }) => {
          // If child is a MermaidBlock, don't wrap in <pre>
          if (isValidElement(children) && children.props?.className === 'language-mermaid') {
            return <>{children}</>
          }
          return <pre className="bg-gray-900 rounded-lg p-3 overflow-x-auto mb-3">{children}</pre>
        },

        // Headings
        h1: ({ children }) => <h1 className="text-xl font-bold text-white mb-2">{processChildren(children)}</h1>,
        h2: ({ children }) => <h2 className="text-lg font-semibold text-white mb-2">{processChildren(children)}</h2>,
        h3: ({ children }) => <h3 className="text-md font-semibold text-gray-200 mb-2">{processChildren(children)}</h3>,

        // Horizontal rule
        hr: () => <hr className="border-gray-700 my-4" />,

        // Links
        a: ({ href, children }) => (
          <a href={href} className="text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),

        // Blockquotes
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-blue-500/40 pl-3 italic text-gray-400 mb-3">{children}</blockquote>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

/**
 * Recursively processes React children to auto-link pattern IDs in text strings.
 */
function processChildren(children) {
  return Children.map(children, child => {
    if (typeof child === 'string') {
      return autoLinkPatternIds(child)
    }
    if (isValidElement(child) && child.props?.children) {
      return cloneElement(child, {}, processChildren(child.props.children))
    }
    return child
  })
}

let linkKeyCounter = 0

/**
 * Splits a text string into parts, replacing pattern IDs with <Link> elements.
 */
function autoLinkPatternIds(text) {
  if (!text || typeof text !== 'string') return text

  const parts = []
  let lastIndex = 0
  let match

  // Reset regex state
  PATTERN_ID_RE.lastIndex = 0

  while ((match = PATTERN_ID_RE.exec(text)) !== null) {
    const matchText = match[0]
    const index = match.index

    // Add text before the match
    if (index > lastIndex) {
      parts.push(text.slice(lastIndex, index))
    }

    // Add the linked pattern ID
    const linkClass = matchText.startsWith('ABB') ? 'text-blue-400'
      : matchText.startsWith('SBB') ? 'text-green-400'
      : 'text-orange-400'

    parts.push(
      <Link
        key={`pat-${linkKeyCounter++}`}
        to={`/patterns/${matchText}`}
        className={`${linkClass} hover:underline font-medium`}
      >
        {matchText}
      </Link>
    )

    lastIndex = index + matchText.length
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  // If no patterns found, return original string
  if (parts.length === 0) return text
  if (parts.length === 1 && typeof parts[0] === 'string') return parts[0]

  return <>{parts}</>
}
