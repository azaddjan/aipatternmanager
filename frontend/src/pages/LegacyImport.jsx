import { useState, useEffect, useRef } from 'react'
import {
  uploadAndAnalyzeLegacy,
  listLegacyAnalyses,
  getLegacyAnalysis,
  deleteLegacyAnalysis,
  chatLegacyAnalysis,
  chatLegacyAnalysisStream,
} from '../api/client'
import MarkdownContent from '../components/MarkdownContent'

const TYPE_COLORS = {
  AB: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  ABB: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  SBB: 'bg-green-500/20 text-green-300 border-green-500/30',
  Technology: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  PBC: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
}

const MATCH_COLORS = {
  new: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'New' },
  similar_exists: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Similar Exists' },
  likely_duplicate: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Likely Duplicate' },
  unknown: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Unknown' },
}

export default function LegacyImport() {
  // --- State ---
  const [analyses, setAnalyses] = useState([])
  const [activeAnalysis, setActiveAnalysis] = useState(null)
  const [loading, setLoading] = useState(true)

  // Upload + Analysis
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState([])
  const [uploadError, setUploadError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)

  // Chat
  const [chatOpen, setChatOpen] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [chatSending, setChatSending] = useState(false)
  const chatEndRef = useRef(null)

  // Entity expand
  const [expandedEntities, setExpandedEntities] = useState(new Set())

  // --- Load analyses on mount ---
  useEffect(() => {
    loadAnalyses()
  }, [])

  async function loadAnalyses() {
    try {
      const data = await listLegacyAnalyses()
      setAnalyses(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Failed to load analyses:', err)
    }
    setLoading(false)
  }

  async function loadAnalysis(id) {
    try {
      const data = await getLegacyAnalysis(id)
      setActiveAnalysis(data)
    } catch (err) {
      console.error('Failed to load analysis:', err)
    }
  }

  // --- File Upload + SSE Analysis ---
  async function handleUpload(file) {
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    if (!['pdf', 'docx'].includes(ext)) {
      setUploadError('Only PDF and DOCX files are supported')
      return
    }
    if (file.size > 50 * 1024 * 1024) {
      setUploadError('File too large (max 50 MB)')
      return
    }

    setUploading(true)
    setUploadError('')
    setUploadProgress([{ stage: 'upload', message: `Uploading ${file.name}...` }])
    setActiveAnalysis(null)

    try {
      const res = await uploadAndAnalyzeLegacy(file)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail || `Upload failed: ${res.status}`)
      }

      // Read SSE stream
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'progress') {
              setUploadProgress(prev => [...prev, event])
            } else if (event.type === 'complete') {
              setActiveAnalysis(event.result)
              loadAnalyses()
            } else if (event.type === 'error') {
              throw new Error(event.message)
            }
          } catch (e) {
            if (e.message && !e.message.includes('JSON')) throw e
          }
        }
      }
    } catch (err) {
      setUploadError(err.message)
    }
    setUploading(false)
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer?.files?.[0]
    if (file) handleUpload(file)
  }

  // --- Delete Analysis ---
  async function handleDelete(id, e) {
    e?.stopPropagation()
    if (!confirm('Delete this analysis?')) return
    try {
      await deleteLegacyAnalysis(id)
      if (activeAnalysis?.id === id) setActiveAnalysis(null)
      loadAnalyses()
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }

  // --- Chat (streaming) ---
  // Temporary streaming message shown during token arrival
  const [streamingContent, setStreamingContent] = useState('')

  async function handleSendChat() {
    if (!chatInput.trim() || !activeAnalysis?.id || chatSending) return
    const message = chatInput.trim()
    setChatInput('')
    setChatSending(true)
    setStreamingContent('')

    // Optimistically add the user message to local state
    setActiveAnalysis(prev => {
      const msgs = [...(prev?.messages_json || []), { role: 'user', content: message }]
      return { ...prev, messages_json: msgs }
    })
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)

    try {
      await chatLegacyAnalysisStream(activeAnalysis.id, message, (token) => {
        setStreamingContent(prev => prev + token)
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      })
      // Stream complete — reload to get persisted state (including entity updates)
      setStreamingContent('')
      await loadAnalysis(activeAnalysis.id)
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    } catch (err) {
      console.error('Chat failed:', err)
      setStreamingContent('')
      // Reload to ensure consistent state
      await loadAnalysis(activeAnalysis.id)
    }
    setChatSending(false)
  }

  function toggleEntity(key) {
    setExpandedEntities(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // --- Derived data ---
  const entities = activeAnalysis?.entities_json || {}
  const overview = activeAnalysis?.overview_json || {}
  const crossRefs = activeAnalysis?.cross_references_json || {}
  const summary = activeAnalysis?.summary_json || {}
  const messages = activeAnalysis?.messages_json || []

  // --- Render ---
  return (
    <div className="flex h-[calc(100vh-3rem)] -m-6">
      {/* Left Panel — Analyses List */}
      <div className="w-80 border-r border-gray-800 flex flex-col bg-gray-900/50">
        {/* Upload Zone */}
        <div className="p-4 border-b border-gray-800">
          <div
            className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors
              ${dragOver ? 'border-blue-500 bg-blue-500/10' : 'border-gray-700 hover:border-gray-600'}
              ${uploading ? 'pointer-events-none opacity-50' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => !uploading && fileInputRef.current?.click()}
          >
            <div className="text-2xl mb-1">{uploading ? '...' : '📄'}</div>
            <div className="text-sm text-gray-400">
              {uploading ? 'Analyzing...' : 'Drop PDF or DOCX here'}
            </div>
            <div className="text-xs text-gray-600 mt-1">or click to browse</div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx"
              className="hidden"
              onChange={(e) => handleUpload(e.target.files?.[0])}
            />
          </div>
          {uploadError && (
            <div className="mt-2 text-xs text-red-400 bg-red-500/10 rounded px-2 py-1">
              {uploadError}
            </div>
          )}
        </div>

        {/* Analyses List */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-3 text-xs text-gray-500 uppercase tracking-wider">
            Saved Analyses ({analyses.length})
          </div>
          {loading ? (
            <div className="p-4 text-gray-500 text-sm">Loading...</div>
          ) : analyses.length === 0 ? (
            <div className="p-4 text-gray-500 text-sm">
              No analyses yet. Upload a document to get started.
            </div>
          ) : (
            analyses.map(a => (
              <div
                key={a.id}
                className={`p-3 border-b border-gray-800 cursor-pointer hover:bg-gray-800/50 transition-colors
                  ${activeAnalysis?.id === a.id ? 'bg-gray-800 border-l-2 border-l-blue-500' : ''}`}
                onClick={() => loadAnalysis(a.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-200 truncate">{a.title}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{a.filename}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-gray-600">{a.document_type}</span>
                      {a.summary_json?.breakdown && (
                        <div className="flex gap-1">
                          {Object.entries(a.summary_json.breakdown).map(([type, count]) =>
                            count > 0 ? (
                              <span key={type} className={`text-[10px] px-1 rounded ${TYPE_COLORS[type] || 'bg-gray-700 text-gray-400'}`}>
                                {count} {type}
                              </span>
                            ) : null
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    className="text-gray-600 hover:text-red-400 text-xs p-1"
                    onClick={(e) => handleDelete(a.id, e)}
                    title="Delete analysis"
                  >
                    x
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right Panel — Active View */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {uploading ? (
          // Analysis Progress
          <AnalysisProgress progress={uploadProgress} />
        ) : activeAnalysis ? (
          // Report View + Chat
          <div className="flex flex-1 overflow-hidden">
            <div className={`flex-1 overflow-y-auto p-6 ${chatOpen ? '' : ''}`}>
              <ReportView
                analysis={activeAnalysis}
                entities={entities}
                overview={overview}
                crossRefs={crossRefs}
                summary={summary}
                expandedEntities={expandedEntities}
                toggleEntity={toggleEntity}
                onOpenChat={() => setChatOpen(true)}
              />
            </div>
            {chatOpen && (
              <ChatPanel
                messages={messages}
                streamingContent={streamingContent}
                chatInput={chatInput}
                setChatInput={setChatInput}
                chatSending={chatSending}
                onSend={handleSendChat}
                onClose={() => setChatOpen(false)}
                chatEndRef={chatEndRef}
              />
            )}
          </div>
        ) : (
          // Empty state
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="text-5xl mb-4">📄</div>
              <h3 className="text-lg font-medium text-gray-300 mb-2">Legacy Document Import</h3>
              <p className="text-gray-500 text-sm max-w-md">
                Upload a legacy architecture document (PDF or DOCX) and AI will analyze it
                to extract patterns, technologies, and business capabilities.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}


// --- Sub-components ---

function AnalysisProgress({ progress }) {
  const stages = ['extraction', 'overview', 'entity_extraction', 'quality_gate', 'cross_reference', 'complete']
  const currentStage = progress.length > 0 ? progress[progress.length - 1].stage : 'upload'
  const currentIdx = stages.indexOf(currentStage)

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-xl w-full">
        <h3 className="text-lg font-medium text-gray-200 mb-6 text-center">Analyzing Document</h3>

        {/* Stage indicators */}
        <div className="flex items-center justify-between mb-8">
          {['Extract', 'Overview', 'Entities', 'Quality', 'Cross-Ref', 'Done'].map((label, i) => (
            <div key={label} className="flex items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium
                ${i <= currentIdx ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-500'}`}>
                {i < currentIdx ? '✓' : i + 1}
              </div>
              {i < 5 && (
                <div className={`w-10 h-0.5 ${i < currentIdx ? 'bg-blue-600' : 'bg-gray-800'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Progress messages */}
        <div className="bg-gray-900 rounded-lg p-4 max-h-60 overflow-y-auto">
          {progress.map((p, i) => (
            <div key={i} className="flex items-start gap-2 mb-2 last:mb-0">
              <span className={`text-xs mt-0.5 ${i === progress.length - 1 ? 'text-blue-400' : 'text-gray-600'}`}>
                {i === progress.length - 1 ? '...' : '✓'}
              </span>
              <span className={`text-sm ${i === progress.length - 1 ? 'text-gray-300' : 'text-gray-500'}`}>
                {p.message}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}


function ReportView({ analysis, entities, overview, crossRefs, summary, expandedEntities, toggleEntity, onOpenChat }) {
  const primary = entities.primary_pattern
  const subPatterns = entities.sub_patterns || []
  const technologies = entities.technologies || []
  const capabilities = entities.business_capabilities || []
  const relationships = entities.relationships || []
  const skippedContent = entities.skipped_content || []
  const qualityScores = summary.quality_scores || null
  const [qualityExpanded, setQualityExpanded] = useState(false)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-100">{analysis.title}</h2>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-sm text-gray-500">{analysis.filename}</span>
            <span className="text-xs px-2 py-0.5 bg-gray-800 rounded text-gray-400">
              {analysis.document_type} - {analysis.page_count} pages
            </span>
            <span className="text-xs text-gray-600">{analysis.id}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Quality Score Badge */}
          {qualityScores && qualityScores.overall != null && (
            <div className="relative">
              <button
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  qualityScores.overall >= 8 ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                  qualityScores.overall >= 7 ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' :
                  'bg-red-500/20 text-red-400 border border-red-500/30'
                }`}
                onClick={() => setQualityExpanded(!qualityExpanded)}
                title="Quality gate score — click to expand"
              >
                Quality: {qualityScores.overall.toFixed(1)}/10
                {qualityScores.iterations > 1 && (
                  <span className="text-[10px] ml-1 opacity-60">{qualityScores.iterations} passes</span>
                )}
              </button>
              {qualityExpanded && (
                <div className="absolute right-0 top-full mt-1 z-10 bg-gray-900 border border-gray-700 rounded-lg p-3 w-64 shadow-xl">
                  <div className="text-xs font-medium text-gray-400 mb-2">Quality Breakdown</div>
                  {qualityScores.scores && Object.entries(qualityScores.scores).map(([dim, score]) => (
                    <div key={dim} className="flex items-center gap-2 mb-1.5">
                      <span className="text-[11px] text-gray-400 w-28 capitalize">{dim.replace(/_/g, ' ')}</span>
                      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            score >= 8 ? 'bg-green-500' : score >= 7 ? 'bg-yellow-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${score * 10}%` }}
                        />
                      </div>
                      <span className={`text-[11px] font-medium w-5 text-right ${
                        score >= 8 ? 'text-green-400' : score >= 7 ? 'text-yellow-400' : 'text-red-400'
                      }`}>{score}</span>
                    </div>
                  ))}
                  <div className="text-[10px] text-gray-600 mt-2 pt-1 border-t border-gray-800">
                    {qualityScores.passed ? 'Passed' : 'Did not pass threshold'} after {qualityScores.iterations} iteration{qualityScores.iterations !== 1 ? 's' : ''}
                  </div>
                </div>
              )}
            </div>
          )}
          <button
            className="px-3 py-1.5 bg-blue-600/20 text-blue-400 rounded text-sm hover:bg-blue-600/30 transition-colors"
            onClick={onOpenChat}
          >
            Discuss
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary.breakdown && (
        <div className={`grid gap-3 ${summary.skipped_content_count > 0 ? 'grid-cols-6' : 'grid-cols-5'}`}>
          {Object.entries(summary.breakdown).map(([type, count]) => (
            <div key={type} className={`p-3 rounded-lg border ${TYPE_COLORS[type] || 'bg-gray-800 border-gray-700'}`}>
              <div className="text-2xl font-bold">{count}</div>
              <div className="text-xs opacity-75">{type}</div>
            </div>
          ))}
          {summary.skipped_content_count > 0 && (
            <div className="p-3 rounded-lg border bg-orange-500/20 text-orange-300 border-orange-500/30">
              <div className="text-2xl font-bold">{summary.skipped_content_count}</div>
              <div className="text-xs opacity-75">Skipped</div>
            </div>
          )}
        </div>
      )}

      {/* Match Summary */}
      {(summary.new_entities > 0 || summary.similar_existing > 0 || summary.likely_duplicates > 0) && (
        <div className="flex gap-4 text-sm">
          <span className="text-emerald-400">{summary.new_entities} new</span>
          <span className="text-yellow-400">{summary.similar_existing} similar to existing</span>
          <span className="text-red-400">{summary.likely_duplicates} likely duplicates</span>
        </div>
      )}

      {/* Document Overview */}
      {overview.summary && (
        <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-800">
          <h3 className="text-sm font-medium text-gray-400 mb-2">Document Overview</h3>
          <p className="text-sm text-gray-300">{overview.summary}</p>
          {overview.classification_reasoning && (
            <p className="text-xs text-gray-500 mt-2">
              <span className="font-medium">Classification: </span>
              {overview.classification_reasoning}
            </p>
          )}
          {overview.pages_analyzed && (
            <p className="text-xs text-gray-600 mt-1">Pages analyzed: {overview.pages_analyzed}</p>
          )}
        </div>
      )}

      {/* Page Coverage Bar */}
      {overview.sections?.length > 0 && analysis.page_count > 0 && (
        <PageCoverageBar sections={overview.sections} totalPages={analysis.page_count} />
      )}

      {/* Primary Pattern */}
      {primary && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Primary Pattern</h3>
          <EntityCard
            entity={primary}
            entityKey="primary"
            crossRef={crossRefs.patterns?.[0]}
            expanded={expandedEntities.has('primary')}
            onToggle={() => toggleEntity('primary')}
          />
        </div>
      )}

      {/* Sub-Patterns */}
      {subPatterns.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
            Sub-Patterns ({subPatterns.length})
          </h3>
          {subPatterns.map((sp, i) => (
            <EntityCard
              key={i}
              entity={sp}
              entityKey={`sub-${i}`}
              crossRef={crossRefs.patterns?.[i + 1]}
              expanded={expandedEntities.has(`sub-${i}`)}
              onToggle={() => toggleEntity(`sub-${i}`)}
            />
          ))}
        </div>
      )}

      {/* Technologies */}
      {technologies.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
            Technologies ({technologies.length})
          </h3>
          <div className="bg-gray-900/50 rounded-lg border border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left px-4 py-2 text-gray-500 font-medium">Name</th>
                  <th className="text-left px-4 py-2 text-gray-500 font-medium">Vendor</th>
                  <th className="text-left px-4 py-2 text-gray-500 font-medium">Category</th>
                  <th className="text-left px-4 py-2 text-gray-500 font-medium">Role</th>
                  <th className="text-left px-4 py-2 text-gray-500 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {technologies.map((tech, i) => {
                  const matchRef = crossRefs.technologies?.[i]
                  const matchInfo = MATCH_COLORS[matchRef?.match_status || 'unknown']
                  return (
                    <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="px-4 py-2 text-gray-200 font-medium">{tech.name}</td>
                      <td className="px-4 py-2 text-gray-400">{tech.vendor || '-'}</td>
                      <td className="px-4 py-2 text-gray-400">{tech.category || '-'}</td>
                      <td className="px-4 py-2 text-gray-400 text-xs">{tech.role_in_document || '-'}</td>
                      <td className="px-4 py-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${matchInfo.bg} ${matchInfo.text}`}>
                          {matchInfo.label}
                        </span>
                        {matchRef?.similar_existing?.[0] && (
                          <span className="text-xs text-gray-600 ml-1">
                            ~ {matchRef.similar_existing[0].name}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Business Capabilities */}
      {capabilities.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
            Business Capabilities ({capabilities.length})
          </h3>
          <div className="grid gap-2">
            {capabilities.map((cap, i) => {
              const matchRef = crossRefs.business_capabilities?.[i]
              const matchInfo = MATCH_COLORS[matchRef?.match_status || 'unknown']
              return (
                <div key={i} className="bg-gray-900/50 rounded-lg border border-gray-800 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-200">{cap.name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${matchInfo.bg} ${matchInfo.text}`}>
                      {matchInfo.label}
                    </span>
                  </div>
                  {cap.description && (
                    <p className="text-xs text-gray-400 mt-1">{cap.description}</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Relationships */}
      {relationships.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
            Relationships ({relationships.length})
          </h3>
          <div className="bg-gray-900/50 rounded-lg border border-gray-800 p-3 space-y-1">
            {relationships.map((rel, i) => (
              <div key={i} className="text-xs text-gray-400 flex items-center gap-2">
                <span className="text-gray-300">{rel.source_name}</span>
                <span className="text-gray-600">--[{rel.type}]--&gt;</span>
                <span className="text-gray-300">{rel.target_name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Extraction Notes */}
      {entities.extraction_notes && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
          <div className="text-xs font-medium text-yellow-400 mb-1">Extraction Notes</div>
          <p className="text-xs text-yellow-300/80">{entities.extraction_notes}</p>
        </div>
      )}

      {/* Skipped Content */}
      {skippedContent.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
            Skipped Content ({skippedContent.length})
          </h3>
          <div className="grid gap-2">
            {skippedContent.map((item, i) => (
              <div key={i} className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  {item.could_be_entity && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/30 text-orange-300 font-medium">
                      Potential entity
                    </span>
                  )}
                  {item.source_pages && (
                    <span className="text-[10px] text-orange-400/60">Pages: {item.source_pages}</span>
                  )}
                </div>
                <div className="text-xs text-orange-200 font-medium">{item.content_description}</div>
                <div className="text-xs text-orange-300/60 mt-1">{item.reason_skipped}</div>
                {item.suggested_action && (
                  <div className="text-xs text-orange-400/80 mt-1 italic">
                    Suggested: {item.suggested_action}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}


function EntityCard({ entity, entityKey, crossRef, expanded, onToggle }) {
  const type = entity.suggested_type || 'Unknown'
  const typeColor = TYPE_COLORS[type] || 'bg-gray-700 text-gray-400'
  const confidence = entity.confidence || 'MEDIUM'
  const matchInfo = MATCH_COLORS[crossRef?.match_status || 'unknown']
  const fields = entity.fields || {}
  const alternatives = entity.alternative_classifications || []

  return (
    <div className="bg-gray-900/50 rounded-lg border border-gray-800 overflow-hidden">
      <div
        className="p-3 cursor-pointer hover:bg-gray-800/30 transition-colors flex items-center gap-3"
        onClick={onToggle}
      >
        <span className="text-gray-500">{expanded ? '▾' : '▸'}</span>
        <span className={`text-xs px-2 py-0.5 rounded border ${typeColor}`}>{type}</span>
        <span className="text-sm font-medium text-gray-200 flex-1">{entity.name}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
          confidence === 'HIGH' ? 'bg-green-500/20 text-green-400' :
          confidence === 'MEDIUM' ? 'bg-yellow-500/20 text-yellow-400' :
          'bg-red-500/20 text-red-400'
        }`}>
          {confidence}
        </span>
        <span className={`text-xs px-1.5 py-0.5 rounded ${matchInfo.bg} ${matchInfo.text}`}>
          {matchInfo.label}
        </span>
      </div>

      {/* Classification Reasoning — always visible below header */}
      {entity.classification_reasoning && (
        <div className="px-4 py-2 bg-gray-800/30 border-t border-gray-800/50">
          <div className="text-xs text-gray-400">
            <span className="font-medium text-gray-500">Why {type}: </span>
            {entity.classification_reasoning}
          </div>
        </div>
      )}

      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-800">
          {entity.source_section && (
            <div className="text-xs text-gray-500 mt-2 mb-2">Source: {entity.source_section}</div>
          )}
          {entity.reasoning && (
            <div className="text-xs text-gray-400 mt-2 mb-3 italic">{entity.reasoning}</div>
          )}
          {entity.suggested_category && (
            <div className="text-xs text-gray-500 mb-2">Category: {entity.suggested_category}</div>
          )}

          {/* Classification Alternatives (collapsible) */}
          {alternatives.length > 0 && (
            <details className="mb-3 border border-yellow-500/20 rounded-lg overflow-hidden">
              <summary className="text-xs font-medium text-yellow-400 cursor-pointer px-3 py-1.5 bg-yellow-500/10 hover:bg-yellow-500/15">
                Alternatives Considered ({alternatives.length})
              </summary>
              <div className="px-3 py-2 space-y-2">
                {alternatives.map((alt, i) => (
                  <div key={i} className="text-xs bg-yellow-500/5 rounded p-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-1.5 py-0.5 rounded border text-[10px] ${TYPE_COLORS[alt.type] || 'bg-gray-700 text-gray-400'}`}>
                        {alt.type}
                      </span>
                    </div>
                    <div className="text-gray-400">{alt.reasoning}</div>
                    <div className="text-gray-500 mt-0.5 italic">Rejected: {alt.why_rejected}</div>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Sub-pattern alternative_type note */}
          {entity.alternative_type && (
            <div className="text-xs text-yellow-400/70 mb-2 bg-yellow-500/5 rounded px-2 py-1">
              Could also be: {entity.alternative_type}
            </div>
          )}

          {/* Field details */}
          <div className="space-y-2 mt-2">
            {Object.entries(fields).map(([key, val]) => {
              if (!val || (Array.isArray(val) && val.length === 0)) return null
              const displayVal = Array.isArray(val)
                ? val.join(', ')
                : typeof val === 'object'
                  ? JSON.stringify(val, null, 2)
                  : String(val)
              return (
                <div key={key}>
                  <div className="text-xs font-medium text-gray-500 mb-0.5">
                    {key.replace(/_/g, ' ')}
                  </div>
                  <div className="text-xs text-gray-300 whitespace-pre-wrap bg-gray-800/50 rounded px-2 py-1">
                    {displayVal.length > 500 ? displayVal.slice(0, 500) + '...' : displayVal}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Similar existing entities */}
          {crossRef?.similar_existing?.length > 0 && (
            <div className="mt-3 pt-2 border-t border-gray-800">
              <div className="text-xs font-medium text-gray-500 mb-1">Similar Existing</div>
              {crossRef.similar_existing.map((s, i) => (
                <div key={i} className="text-xs text-gray-400 flex items-center gap-2">
                  <span className="text-gray-300">{s.id}</span>
                  <span>{s.name}</span>
                  <span className="text-gray-600">({Math.round(s.similarity * 100)}% match)</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}


function PageCoverageBar({ sections, totalPages }) {
  // Build a set of covered page numbers from section page_range fields
  const covered = new Set()
  for (const sec of sections) {
    const range = sec.page_range || ''
    // Parse ranges like "1-3", "5", "6-8"
    const parts = range.split(/[-–]/).map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
    if (parts.length === 2) {
      for (let p = parts[0]; p <= parts[1]; p++) covered.add(p)
    } else if (parts.length === 1) {
      covered.add(parts[0])
    }
  }

  const uncoveredPages = []
  for (let p = 1; p <= totalPages; p++) {
    if (!covered.has(p)) uncoveredPages.push(p)
  }

  if (totalPages <= 0) return null

  return (
    <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-800">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-gray-400">Page Coverage</span>
        <span className="text-[10px] text-gray-600">
          {totalPages - uncoveredPages.length}/{totalPages} pages covered
        </span>
      </div>
      <div className="flex gap-0.5">
        {Array.from({ length: totalPages }, (_, i) => {
          const page = i + 1
          const isCovered = covered.has(page)
          return (
            <div
              key={page}
              className={`h-2.5 rounded-sm flex-1 ${isCovered ? 'bg-blue-500' : 'bg-red-500/60'}`}
              title={`Page ${page}${isCovered ? '' : ' (not covered)'}`}
            />
          )
        })}
      </div>
      {uncoveredPages.length > 0 && (
        <div className="text-[10px] text-red-400/70 mt-1">
          Uncovered: {uncoveredPages.length <= 10
            ? `page${uncoveredPages.length > 1 ? 's' : ''} ${uncoveredPages.join(', ')}`
            : `${uncoveredPages.length} pages (${uncoveredPages.slice(0, 5).join(', ')}...)`
          }
        </div>
      )}
    </div>
  )
}


function ChatPanel({ messages, streamingContent, chatInput, setChatInput, chatSending, onSend, onClose, chatEndRef }) {
  return (
    <div className="w-96 border-l border-gray-800 flex flex-col bg-gray-900/70">
      {/* Header */}
      <div className="p-3 border-b border-gray-800 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-300">💬 Discuss Analysis</span>
        <button
          className="text-gray-500 hover:text-gray-300 text-sm"
          onClick={onClose}
        >
          x
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && !streamingContent && (
          <div className="text-xs text-gray-500 text-center mt-4">
            Ask questions about the analysis, request reclassifications, or suggest changes.
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`text-sm rounded-lg p-3 ${
              msg.role === 'user'
                ? 'bg-blue-600/20 text-blue-200 ml-4'
                : 'bg-gray-800 text-gray-300 mr-4'
            }`}
          >
            {msg.role === 'user' ? (
              <div className="whitespace-pre-wrap text-xs">{msg.content}</div>
            ) : (
              <MarkdownContent content={msg.content} />
            )}
          </div>
        ))}

        {/* Streaming assistant response */}
        {streamingContent && (
          <div className="text-sm rounded-lg p-3 bg-gray-800 text-gray-300 mr-4">
            <MarkdownContent content={streamingContent} />
            <span className="inline-block w-1.5 h-4 bg-blue-400 animate-pulse ml-0.5 align-text-bottom" />
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-gray-800">
        <div className="flex gap-2">
          <input
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
            placeholder="Ask about the analysis..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), onSend())}
            disabled={chatSending}
          />
          <button
            className={`px-3 py-2 rounded text-sm font-medium transition-colors
              ${chatSending
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'}`}
            onClick={onSend}
            disabled={chatSending}
          >
            {chatSending ? '...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
