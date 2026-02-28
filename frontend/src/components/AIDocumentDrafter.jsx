import { useState, useRef, useEffect } from 'react'
import { draftDocumentStream, draftDiscussStream } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import MarkdownContent from './MarkdownContent'

const DOC_TYPES = ['guide', 'reference', 'adr', 'overview', 'other']

const AUDIENCES = [
  'Software Engineers and Architects',
  'Enterprise Architects',
  'Domain Architects (AI)',
  'Domain Architects (Security)',
  'Domain Architects (Cloud)',
  'Solution Architects',
  'Software Engineers',
]

/**
 * AIDocumentDrafter — AI assistant box for auto-drafting and discussing documents.
 *
 * Props:
 *   isNew        — true when creating a new document
 *   title        — current document title
 *   docType      — current doc type
 *   summary      — current summary
 *   tags         — current tags string
 *   sections     — current sections array
 *   onApplyDraft — async (draft) => void — applies {title, doc_type, summary, tags, sections}
 */
export default function AIDocumentDrafter({
  isNew,
  title,
  docType,
  summary,
  tags,
  sections,
  onApplyDraft,
}) {
  const { isAdmin } = useAuth()
  const [expanded, setExpanded] = useState(isNew)
  const [mode, setMode] = useState('draft') // 'draft' | 'discuss'
  const [prompt, setPrompt] = useState('')
  const [draftType, setDraftType] = useState(docType || 'guide')
  const [targetAudience, setTargetAudience] = useState(AUDIENCES[0])

  // Draft state
  const [drafting, setDrafting] = useState(false)
  const [progressSteps, setProgressSteps] = useState([])
  const [draftResult, setDraftResult] = useState(null)
  const [draftError, setDraftError] = useState(null)
  const [applying, setApplying] = useState(false)

  // Progress bar state
  const [progressPercent, setProgressPercent] = useState(0)
  const [progressStage, setProgressStage] = useState('')
  const [progressComplete, setProgressComplete] = useState(false)

  // Discuss state
  const [messages, setMessages] = useState([])
  const [discussInput, setDiscussInput] = useState('')
  const [discussing, setDiscussing] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [pendingDraft, setPendingDraft] = useState(null)

  const chatEndRef = useRef(null)
  const textareaRef = useRef(null)

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  // --- Auto Draft ---
  const handleAutoDraft = async () => {
    if (!prompt.trim()) return
    setDrafting(true)
    setDraftError(null)
    setDraftResult(null)
    setProgressSteps([])
    setProgressPercent(0)
    setProgressStage('')
    setProgressComplete(false)

    try {
      const result = await draftDocumentStream(
        { prompt: prompt.trim(), doc_type: draftType, target_audience: targetAudience },
        (event) => {
          // Update checkmark step list
          setProgressSteps(prev => {
            // Replace if same stage, otherwise append
            const existing = prev.findIndex(s => s.stage === event.stage)
            if (existing >= 0) {
              const copy = [...prev]
              copy[existing] = event
              return copy
            }
            return [...prev, event]
          })

          // Update progress bar
          const { step, total, stage } = event
          setProgressStage(stage)
          if (stage === 'quality_gate' && total <= 3) {
            // Quality gate sub-iterations — interpolate within 75-90% range
            const basePercent = 75
            const range = 15
            const subPercent = basePercent + ((step / total) * range)
            setProgressPercent(Math.round(subPercent))
          } else if (total > 0) {
            setProgressPercent(Math.round((step / total) * 100))
          }
          if (stage === 'complete') {
            setProgressComplete(true)
            setProgressPercent(100)
          }
        }
      )
      setDraftResult(result)
      setProgressPercent(100)
      setProgressComplete(true)
    } catch (err) {
      setDraftError(err.message)
    }
    setDrafting(false)
  }

  const handleApplyDraft = async () => {
    if (!draftResult) return
    setApplying(true)
    try {
      await onApplyDraft({
        title: draftResult.title || 'Untitled',
        doc_type: draftResult.doc_type || draftType,
        summary: draftResult.summary || '',
        target_audience: targetAudience,
        tags: (draftResult.tags || []).join(', '),
        sections: (draftResult.sections || []).map((s, i) => ({
          id: `new-${Date.now()}-${i}`,
          title: s.title,
          content: s.content,
          order_index: i,
        })),
        linked_entities: draftResult.linked_entities || [],
      })
      // Only clear state if we didn't navigate away (existing docs)
      if (!isNew) {
        setDraftResult(null)
        setProgressSteps([])
        setProgressPercent(0)
        setProgressStage('')
        setProgressComplete(false)
        setPrompt('')
      }
    } catch (err) {
      setDraftError(err.message)
    }
    setApplying(false)
  }

  const handleDiscardDraft = () => {
    setDraftResult(null)
    setProgressSteps([])
    setProgressPercent(0)
    setProgressStage('')
    setProgressComplete(false)
  }

  // --- Discuss ---
  const handleDiscuss = async () => {
    const msg = discussInput.trim()
    if (!msg) return

    const userMsg = { role: 'user', content: msg }
    setMessages(prev => [...prev, userMsg])
    setDiscussInput('')
    setDiscussing(true)
    setStreamingText('')
    setPendingDraft(null)

    const currentDraft = {
      title,
      doc_type: docType,
      summary,
      tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      sections: sections.map(s => ({ title: s.title, content: s.content })),
    }

    const history = [...messages, userMsg].map(m => ({
      role: m.role,
      content: m.content,
    }))

    let fullText = ''
    try {
      const updatedDraft = await draftDiscussStream(
        {
          message: msg,
          current_draft: currentDraft,
          conversation_history: history,
        },
        (token) => {
          fullText += token
          setStreamingText(fullText)
        }
      )

      // Parse out the display text (before ---DRAFT_UPDATE--- separator)
      let displayText = fullText
      if (fullText.includes('---DRAFT_UPDATE---')) {
        displayText = fullText.split('---DRAFT_UPDATE---')[0].trim()
      }

      setMessages(prev => [...prev, { role: 'assistant', content: displayText }])
      setStreamingText('')

      if (updatedDraft) {
        setPendingDraft(updatedDraft)
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }])
      setStreamingText('')
    }
    setDiscussing(false)
  }

  const handleApplyDiscussChanges = () => {
    if (!pendingDraft) return
    onApplyDraft({
      title: pendingDraft.title || title,
      doc_type: pendingDraft.doc_type || docType,
      summary: pendingDraft.summary || '',
      tags: (pendingDraft.tags || []).join(', '),
      sections: (pendingDraft.sections || []).map((s, i) => ({
        id: `new-${Date.now()}-${i}`,
        title: s.title,
        content: s.content,
        order_index: i,
      })),
      linked_entities: pendingDraft.linked_entities || [],
    })
    setPendingDraft(null)
  }

  const handleDiscussKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleDiscuss()
    }
  }

  // Stage label for progress bar
  const stageLabel = (stage) => {
    switch (stage) {
      case 'context': return 'Loading catalog...'
      case 'planning': return 'Planning structure...'
      case 'drafting': return 'Drafting document...'
      case 'enriching': return 'Enriching sections...'
      case 'quality_gate': return 'Quality review...'
      case 'complete': return 'Complete'
      default: return 'Starting...'
    }
  }

  // Quality score display
  const renderQualityScores = (scores) => {
    if (!scores || scores.skipped) return null
    const overall = scores.overall || 0
    const passed = scores.passed
    return (
      <div className="flex items-center gap-3 text-xs mt-1">
        <span className={`font-medium ${passed ? 'text-green-400' : 'text-amber-400'}`}>
          {passed ? '✓' : '○'} Quality: {overall.toFixed(1)}/10
        </span>
        {scores.iterations > 1 && (
          <span className="text-gray-500">{scores.iterations} iterations</span>
        )}
        {scores.scores && Object.entries(scores.scores).map(([k, v]) => (
          <span key={k} className={`text-gray-500 ${v < 7 ? 'text-amber-500' : ''}`}>
            {k}: {v}
          </span>
        ))}
      </div>
    )
  }

  // Collapsed state (for existing documents)
  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full text-left px-4 py-2.5 rounded-xl border border-dashed border-gray-700 hover:border-purple-500/50 hover:bg-purple-500/5 transition-all text-sm text-gray-400 hover:text-purple-300 flex items-center gap-2"
      >
        <span className="text-base">&#10024;</span>
        AI Document Assistant
        <span className="text-xs text-gray-600 ml-auto">Click to expand</span>
      </button>
    )
  }

  return (
    <div className="bg-gray-900/80 border border-gray-700/60 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <span className="text-purple-400 text-sm">&#10024;</span>
          <span className="text-sm font-medium text-gray-200">AI Document Assistant</span>
        </div>
        <div className="flex items-center gap-1">
          {/* Mode toggle */}
          <button
            onClick={() => setMode('draft')}
            className={`text-xs px-2.5 py-1 rounded transition-colors ${
              mode === 'draft'
                ? 'bg-purple-500/20 text-purple-300'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            Auto Draft
          </button>
          <button
            onClick={() => setMode('discuss')}
            className={`text-xs px-2.5 py-1 rounded transition-colors ${
              mode === 'discuss'
                ? 'bg-blue-500/20 text-blue-300'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            Discuss
          </button>
          <span className="w-px h-4 bg-gray-700 mx-1" />
          <button
            onClick={() => setExpanded(false)}
            className="text-gray-500 hover:text-gray-300 text-xs px-1"
            title="Collapse"
          >
            &#x25B2;
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="p-4">
        {mode === 'draft' ? (
          /* ─── Auto Draft Mode ─── */
          <div className="space-y-3">
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Describe the document you want to create... e.g. 'Create an ADR for choosing between REST and GraphQL for our API gateway'"
              className="input w-full text-sm resize-y"
              rows={3}
              disabled={drafting}
            />
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">Type:</label>
                <select
                  value={draftType}
                  onChange={e => setDraftType(e.target.value)}
                  className="input text-xs py-1"
                  disabled={drafting}
                >
                  {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">Audience:</label>
                <select
                  value={targetAudience}
                  onChange={e => setTargetAudience(e.target.value)}
                  className="input text-xs py-1"
                  disabled={drafting}
                >
                  {AUDIENCES.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <button
                onClick={handleAutoDraft}
                disabled={drafting || !prompt.trim()}
                className="btn-primary text-xs px-4 py-1.5 flex items-center gap-1.5"
              >
                {drafting ? (
                  <>
                    <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Drafting...
                  </>
                ) : (
                  <>&#128640; Auto Draft</>
                )}
              </button>
            </div>

            {/* Progress bar + steps */}
            {(drafting || progressSteps.length > 0) && (
              <div className="space-y-2 py-2">
                {/* Progress bar */}
                <div className="space-y-1">
                  <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ease-out ${
                        progressComplete ? 'bg-green-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className={progressComplete ? 'text-green-400' : 'text-blue-400'}>
                      {stageLabel(progressStage)}
                    </span>
                    <span className="text-gray-500">{progressPercent}%</span>
                  </div>
                </div>

                {/* Checkmark steps */}
                <div className="space-y-1">
                  {progressSteps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      {step.stage === 'complete' ? (
                        <span className="text-green-400">&#10003;</span>
                      ) : i === progressSteps.length - 1 && drafting ? (
                        <span className="inline-block w-3 h-3 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin" />
                      ) : (
                        <span className="text-green-400">&#10003;</span>
                      )}
                      <span className={step.stage === 'complete' ? 'text-green-400' : 'text-gray-400'}>
                        {step.message}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Error */}
            {draftError && (
              <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                Error: {draftError}
              </div>
            )}

            {/* Draft result preview */}
            {draftResult && (
              <div className="border border-gray-700 rounded-lg overflow-hidden">
                <div className="bg-gray-800/60 px-3 py-2 flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-gray-200">{draftResult.title}</span>
                    <span className="text-xs text-gray-500 ml-2">[{draftResult.doc_type}]</span>
                    {draftResult.tags?.length > 0 && (
                      <span className="text-xs text-gray-500 ml-2">
                        Tags: {draftResult.tags.join(', ')}
                      </span>
                    )}
                    {renderQualityScores(draftResult.quality_scores)}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleApplyDraft}
                      disabled={applying}
                      className="btn-primary text-xs px-3 py-1"
                    >
                      {applying ? (
                        <span className="flex items-center gap-1">
                          <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Saving...
                        </span>
                      ) : isNew ? (
                        '✓ Create & Save'
                      ) : (
                        '✓ Apply Draft'
                      )}
                    </button>
                    <button
                      onClick={handleDiscardDraft}
                      disabled={applying}
                      className="btn-secondary text-xs px-3 py-1"
                    >
                      Discard
                    </button>
                  </div>
                </div>
                <div className="px-3 py-2 space-y-2 max-h-64 overflow-y-auto">
                  {draftResult.summary && (
                    <p className="text-xs text-gray-400 italic">{draftResult.summary}</p>
                  )}
                  {(draftResult.sections || []).map((s, i) => (
                    <div key={i} className="border-t border-gray-800 pt-2">
                      <div className="text-xs font-medium text-gray-300 mb-1">
                        S{String(i + 1).padStart(2, '0')}: {s.title}
                      </div>
                      <div className="text-xs text-gray-500 line-clamp-3">
                        {s.content?.slice(0, 200)}
                        {s.content?.length > 200 && '...'}
                      </div>
                    </div>
                  ))}
                  {/* Linked entities */}
                  {draftResult.linked_entities?.length > 0 && (
                    <div className="border-t border-gray-800 pt-2">
                      <div className="text-xs font-medium text-gray-400 mb-1">Linked Entities</div>
                      <div className="flex flex-wrap gap-1">
                        {draftResult.linked_entities.map((e, i) => (
                          <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded border ${
                            e.label === 'Pattern' ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                            : e.label === 'Technology' ? 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                            : 'bg-green-500/10 text-green-400 border-green-500/30'
                          }`}>
                            {e.name || e.id}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Suggested patterns — admin only */}
                  {isAdmin && draftResult.suggested_patterns?.length > 0 && (
                    <div className="border-t border-gray-800 pt-2">
                      <div className="text-xs font-medium text-amber-400 mb-1">Suggested New Patterns</div>
                      <div className="space-y-1">
                        {draftResult.suggested_patterns.map((sp, i) => (
                          <div key={i} className="text-xs text-gray-400">
                            <span className="text-amber-300 font-medium">{sp.name}</span>
                            <span className="text-gray-600 ml-1">[{sp.type}]</span>
                            {sp.description && (
                              <span className="text-gray-500 ml-1">— {sp.description}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* ─── Discuss Mode ─── */
          <div className="space-y-3">
            {/* Chat messages */}
            {messages.length > 0 && (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`text-xs rounded-lg px-3 py-2 ${
                      msg.role === 'user'
                        ? 'bg-blue-600/15 text-blue-100 border border-blue-500/20 ml-8'
                        : 'bg-gray-800/60 text-gray-300 border border-gray-700/50 mr-8'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      <MarkdownContent content={msg.content} />
                    ) : (
                      msg.content
                    )}
                  </div>
                ))}
                {/* Streaming response */}
                {discussing && streamingText && (
                  <div className="bg-gray-800/60 text-gray-300 border border-gray-700/50 mr-8 text-xs rounded-lg px-3 py-2">
                    <MarkdownContent content={streamingText} />
                  </div>
                )}
                {discussing && !streamingText && (
                  <div className="text-xs text-gray-500 flex items-center gap-1 px-3">
                    <span className="inline-block w-3 h-3 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin" />
                    Thinking...
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            )}

            {/* Pending draft changes */}
            {pendingDraft && (
              <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-green-300">
                    &#10024; AI updated the document ({pendingDraft.sections?.length || 0} sections)
                    {pendingDraft.linked_entities?.length > 0 && ` · ${pendingDraft.linked_entities.length} linked entities`}
                  </span>
                  <button
                    onClick={handleApplyDiscussChanges}
                    className="btn-primary text-xs px-3 py-1"
                  >
                    Apply Changes
                  </button>
                </div>
                {isAdmin && pendingDraft.suggested_patterns?.length > 0 && (
                  <div className="mt-1 text-xs text-amber-300">
                    Suggested patterns: {pendingDraft.suggested_patterns.map(p => p.name).join(', ')}
                  </div>
                )}
              </div>
            )}

            {/* Input */}
            <div className="flex items-end gap-2">
              <textarea
                value={discussInput}
                onChange={e => setDiscussInput(e.target.value)}
                onKeyDown={handleDiscussKeyDown}
                placeholder={messages.length === 0
                  ? 'Ask about your document, request changes... e.g. "add a security section"'
                  : 'Type a follow-up message...'
                }
                className="input flex-1 text-sm resize-none"
                rows={2}
                disabled={discussing}
              />
              <button
                onClick={handleDiscuss}
                disabled={discussing || !discussInput.trim()}
                className="btn-primary text-xs px-3 py-2 self-end"
              >
                {discussing ? (
                  <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  'Send'
                )}
              </button>
            </div>

            {messages.length === 0 && (
              <p className="text-[11px] text-gray-600">
                Discuss mode lets you refine the current document through conversation.
                The AI sees all your existing patterns and technologies.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
