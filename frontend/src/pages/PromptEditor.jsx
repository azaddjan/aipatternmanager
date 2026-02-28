import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  fetchPrompts, updatePrompt, resetPrompt, testPrompt,
  fetchPromptHistory, restorePromptVersion,
} from '../api/client'
import ConfirmModal from '../components/ConfirmModal'
import { useToast } from '../components/Toast'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(isoString) {
  if (!isoString) return ''
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(isoString).toLocaleDateString()
}

// ---------------------------------------------------------------------------
// Simple inline diff (no external deps)
// ---------------------------------------------------------------------------

function SimpleDiff({ left, right, leftLabel, rightLabel }) {
  const leftLines = left.split('\n')
  const rightLines = right.split('\n')

  return (
    <div className="grid grid-cols-2 gap-0 border border-gray-700 rounded-lg overflow-hidden">
      <div className="border-r border-gray-700">
        <div className="bg-gray-800/50 px-3 py-1.5 text-[10px] text-gray-400 font-semibold border-b border-gray-700">
          {leftLabel}
        </div>
        <pre className="p-3 text-xs font-mono leading-relaxed overflow-auto max-h-[400px] m-0">
          {leftLines.map((line, i) => {
            const changed = line !== (rightLines[i] ?? '')
            return (
              <div key={i} className={changed ? 'bg-red-500/10 text-red-300' : 'text-gray-400'}>
                {line || '\u00A0'}
              </div>
            )
          })}
        </pre>
      </div>
      <div>
        <div className="bg-gray-800/50 px-3 py-1.5 text-[10px] text-gray-400 font-semibold border-b border-gray-700">
          {rightLabel}
        </div>
        <pre className="p-3 text-xs font-mono leading-relaxed overflow-auto max-h-[400px] m-0">
          {rightLines.map((line, i) => {
            const changed = line !== (leftLines[i] ?? '')
            return (
              <div key={i} className={changed ? 'bg-green-500/10 text-green-300' : 'text-gray-400'}>
                {line || '\u00A0'}
              </div>
            )
          })}
        </pre>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function PromptEditor({ embedded = false }) {
  const { toast } = useToast()

  // Core data
  const [promptsData, setPromptsData] = useState(null)
  const [loading, setLoading] = useState(true)

  // Sidebar
  const [filter, setFilter] = useState('')
  const [collapsedSections, setCollapsedSections] = useState({})

  // Editor
  const [selectedPrompt, setSelectedPrompt] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  // Testing
  const [testing, setTesting] = useState(false)
  const [testResponse, setTestResponse] = useState(null)

  // History
  const [history, setHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  // Diff view: null | 'default' | version number
  const [diffMode, setDiffMode] = useState(null)
  const [diffValue, setDiffValue] = useState('')

  // Confirm modal
  const [confirmAction, setConfirmAction] = useState(null)

  // -------------------------------------------------------------------------
  // Computed
  // -------------------------------------------------------------------------

  const liveTokenEstimate = useMemo(() => {
    if (!editValue) return 0
    return Math.round(editValue.split(/\s+/).filter(Boolean).length * 1.3)
  }, [editValue])

  const currentPrompt = useMemo(() => {
    if (!selectedPrompt || !promptsData) return null
    return promptsData.prompts?.find(
      p => p.section === selectedPrompt.section && p.sub_prompt === selectedPrompt.sub_prompt
    )
  }, [selectedPrompt, promptsData])

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  const loadPrompts = useCallback(() => {
    setLoading(true)
    fetchPrompts()
      .then(data => { setPromptsData(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { loadPrompts() }, [loadPrompts])

  const loadHistory = useCallback(async (section, sub_prompt) => {
    setLoadingHistory(true)
    try {
      const data = await fetchPromptHistory(section, sub_prompt)
      setHistory(data.history || [])
    } catch {
      setHistory([])
    }
    setLoadingHistory(false)
  }, [])

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleSelectPrompt = (section, sub_prompt) => {
    const prompt = promptsData?.prompts?.find(p => p.section === section && p.sub_prompt === sub_prompt)
    if (prompt) {
      setSelectedPrompt({ section, sub_prompt })
      setEditValue(prompt.current_value)
      setDirty(false)
      setTestResponse(null)
      setDiffMode(null)
      setDiffValue('')
      setShowHistory(false)
      setHistory([])
    }
  }

  const handleSave = async () => {
    if (!selectedPrompt) return
    setSaving(true)
    try {
      await updatePrompt(selectedPrompt.section, selectedPrompt.sub_prompt, editValue)
      toast.success('Prompt saved')
      setDirty(false)
      loadPrompts()
      if (showHistory) loadHistory(selectedPrompt.section, selectedPrompt.sub_prompt)
    } catch (err) {
      toast.error(`Failed to save: ${err.message}`)
    }
    setSaving(false)
  }

  const handleReset = () => {
    if (!selectedPrompt) return
    setConfirmAction({
      title: 'Reset Prompt',
      message: 'Reset this prompt to the YAML default? Your override will be deleted.',
      confirmLabel: 'Reset',
      variant: 'warning',
      onConfirm: async () => {
        setConfirmAction(null)
        setSaving(true)
        try {
          const result = await resetPrompt(selectedPrompt.section, selectedPrompt.sub_prompt)
          setEditValue(result.current_value)
          setDirty(false)
          toast.success('Prompt reset to default')
          loadPrompts()
          if (showHistory) loadHistory(selectedPrompt.section, selectedPrompt.sub_prompt)
        } catch (err) {
          toast.error(`Failed to reset: ${err.message}`)
        }
        setSaving(false)
      },
    })
  }

  const handleTest = async () => {
    if (!editValue.trim()) return
    setTesting(true)
    setTestResponse(null)
    try {
      const isSystem = selectedPrompt?.sub_prompt === 'system'
      const systemText = isSystem
        ? editValue
        : (promptsData?.prompts?.find(p => p.section === selectedPrompt?.section && p.sub_prompt === 'system')?.current_value || 'You are a helpful assistant.')
      const userText = isSystem
        ? 'Hello, please confirm you understand your role. Respond briefly.'
        : 'This is a test of the prompt template. Please respond briefly confirming you understand the instructions.'
      const result = await testPrompt(systemText, userText)
      setTestResponse(result)
    } catch (err) {
      setTestResponse({ status: 'error', response: err.message })
    }
    setTesting(false)
  }

  const handleRestore = (version) => {
    setConfirmAction({
      title: 'Restore Version',
      message: `Restore version v${version}? This will save it as a new version.`,
      confirmLabel: 'Restore',
      variant: 'warning',
      onConfirm: async () => {
        setConfirmAction(null)
        setSaving(true)
        try {
          const result = await restorePromptVersion(
            selectedPrompt.section, selectedPrompt.sub_prompt, version
          )
          setEditValue(result.current_value)
          setDirty(false)
          setDiffMode(null)
          toast.success(`Restored from v${version}`)
          loadPrompts()
          if (showHistory) loadHistory(selectedPrompt.section, selectedPrompt.sub_prompt)
        } catch (err) {
          toast.error(`Restore failed: ${err.message}`)
        }
        setSaving(false)
      },
    })
  }

  const toggleSection = (section) => {
    setCollapsedSections(prev => ({ ...prev, [section]: !prev[section] }))
  }

  const toggleHistory = () => {
    if (!showHistory && selectedPrompt) {
      loadHistory(selectedPrompt.section, selectedPrompt.sub_prompt)
    }
    setShowHistory(!showHistory)
  }

  const toggleDiffDefault = () => {
    if (diffMode === 'default') {
      setDiffMode(null)
    } else {
      setDiffMode('default')
      setDiffValue(currentPrompt?.default_value || '')
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (loading) {
    return <div className="text-gray-500 text-center py-12">Loading prompts...</div>
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white mb-1">AI Prompt Editor</h2>
        <p className="text-gray-500 text-xs">
          View, edit, and test all AI prompts. Overrides are stored in the database — reset returns a prompt to its YAML default.
        </p>
      </div>

      <div className="flex gap-4" style={{ minHeight: '600px' }}>

        {/* --- Left Sidebar: Prompt Tree --- */}
        <div className="w-72 flex-shrink-0 space-y-1">
          <input
            type="text"
            placeholder="Filter prompts..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="input w-full text-xs mb-2"
          />
          {promptsData && Object.entries(promptsData.sections || {}).map(([section, sectionData]) => {
            const prompts = sectionData.prompts || []
            const filtered = prompts.filter(p =>
              !filter ||
              p.section.toLowerCase().includes(filter.toLowerCase()) ||
              p.sub_prompt.toLowerCase().includes(filter.toLowerCase())
            )
            if (!filtered.length) return null
            const overriddenCount = filtered.filter(p => p.is_overridden).length
            const isCollapsed = collapsedSections[section]

            return (
              <div key={section} className="mb-2">
                {/* Section header — clickable accordion */}
                <button
                  onClick={() => toggleSection(section)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider hover:text-gray-200 hover:bg-gray-800/30 rounded transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <span className={`text-[10px] transition-transform ${isCollapsed ? '' : 'rotate-90'}`}>&#9654;</span>
                    {sectionData.label || section}
                  </span>
                  <span className="flex items-center gap-1.5">
                    {overriddenCount > 0 && (
                      <span className="text-[9px] bg-yellow-500/20 text-yellow-400 px-1 py-0.5 rounded">
                        {overriddenCount}
                      </span>
                    )}
                    <span className="text-[10px] text-gray-600 font-normal">{filtered.length}</span>
                  </span>
                </button>

                {/* Prompt items */}
                {!isCollapsed && filtered.map(p => {
                  const isActive = selectedPrompt?.section === p.section && selectedPrompt?.sub_prompt === p.sub_prompt
                  return (
                    <button
                      key={`${p.section}.${p.sub_prompt}`}
                      onClick={() => handleSelectPrompt(p.section, p.sub_prompt)}
                      className={`w-full text-left px-3 py-1.5 ml-2 rounded text-xs flex items-center gap-2 transition-colors ${
                        isActive
                          ? 'bg-blue-600/20 text-blue-400 border border-blue-600/30'
                          : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200 border border-transparent'
                      }`}
                      style={{ width: 'calc(100% - 8px)' }}
                    >
                      <span className="truncate flex-1">{p.sub_prompt}</span>
                      {p.is_overridden && (
                        <span className="text-[9px] bg-yellow-500/20 text-yellow-400 px-1 py-0.5 rounded whitespace-nowrap">
                          modified
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* --- Right Panel: Prompt Editor --- */}
        <div className="flex-1 min-w-0">
          {currentPrompt ? (
            <div className="space-y-4">

              {/* Header */}
              <div className="flex items-center justify-between border-b border-gray-800 pb-3">
                <div>
                  <h3 className="text-white font-semibold text-sm">
                    {currentPrompt.section_label} <span className="text-gray-600">/</span> {selectedPrompt.sub_prompt}
                  </h3>
                  <div className="flex items-center gap-3 mt-1 text-[11px]">
                    <span className="text-gray-500">
                      ~{dirty ? liveTokenEstimate : currentPrompt.token_estimate} tokens
                    </span>
                    {currentPrompt.version > 0 && (
                      <span className="text-gray-500 font-mono">v{currentPrompt.version}</span>
                    )}
                    {currentPrompt.updated_at && (
                      <span className="text-gray-600" title={currentPrompt.updated_at}>
                        {formatRelativeTime(currentPrompt.updated_at)}
                      </span>
                    )}
                    {currentPrompt.is_overridden && (
                      <span className="bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded text-[10px] border border-yellow-500/30">
                        Override Active
                      </span>
                    )}
                    {dirty && (
                      <span className="text-orange-400 text-[10px]">Unsaved changes</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {currentPrompt.is_overridden && (
                    <button
                      onClick={toggleDiffDefault}
                      className={`text-[11px] px-2 py-1 rounded transition-colors ${
                        diffMode === 'default'
                          ? 'bg-blue-600/20 text-blue-400 border border-blue-600/30'
                          : 'text-gray-500 hover:text-gray-300 border border-transparent'
                      }`}
                    >
                      Diff vs Default
                    </button>
                  )}
                </div>
              </div>

              {/* Variables */}
              {currentPrompt.variables.length > 0 && (
                <div className="flex flex-wrap gap-1.5 items-center">
                  <span className="text-[10px] text-gray-600">Variables:</span>
                  {currentPrompt.variables.map(v => (
                    <span key={v} className="text-[10px] bg-purple-500/15 text-purple-400 px-1.5 py-0.5 rounded border border-purple-500/20 font-mono">
                      {'{' + v + '}'}
                    </span>
                  ))}
                </div>
              )}

              {/* Diff view OR Textarea editor */}
              {diffMode ? (
                <SimpleDiff
                  left={diffValue}
                  right={editValue}
                  leftLabel={diffMode === 'default' ? 'YAML Default' : `Version v${diffMode}`}
                  rightLabel="Current"
                />
              ) : (
                <textarea
                  value={editValue}
                  onChange={e => { setEditValue(e.target.value); setDirty(true) }}
                  className="input w-full font-mono text-xs leading-relaxed"
                  rows={22}
                  spellCheck={false}
                  style={{ minHeight: '320px', resize: 'vertical' }}
                />
              )}

              {/* Action buttons */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSave}
                  disabled={saving || !dirty}
                  className="btn-primary text-xs px-4 py-1.5"
                >
                  {saving ? 'Saving...' : 'Save Override'}
                </button>
                {currentPrompt.is_overridden && (
                  <button
                    onClick={handleReset}
                    disabled={saving}
                    className="btn-secondary text-xs px-4 py-1.5"
                  >
                    Reset to Default
                  </button>
                )}
                <button
                  onClick={handleTest}
                  disabled={testing}
                  className="btn-secondary text-xs px-4 py-1.5"
                >
                  {testing ? 'Testing...' : 'Test Prompt'}
                </button>
                {currentPrompt.is_overridden && !diffMode && (
                  <button
                    onClick={() => {
                      setEditValue(currentPrompt.default_value)
                      setDirty(true)
                    }}
                    className="text-xs text-gray-600 hover:text-gray-400"
                  >
                    View Default
                  </button>
                )}
                {diffMode && (
                  <button
                    onClick={() => setDiffMode(null)}
                    className="text-xs text-gray-500 hover:text-gray-300"
                  >
                    Close Diff
                  </button>
                )}
                <button
                  onClick={toggleHistory}
                  className={`text-xs px-3 py-1.5 ml-auto rounded transition-colors ${
                    showHistory
                      ? 'bg-purple-600/20 text-purple-400 border border-purple-600/30'
                      : 'text-gray-500 hover:text-gray-300 border border-transparent'
                  }`}
                >
                  History {currentPrompt.version > 0 ? `(${currentPrompt.version})` : ''}
                </button>
              </div>

              {/* Test response */}
              {testResponse && (
                <div className={`card border-l-4 ${
                  testResponse.status === 'ok' ? 'border-l-green-500' : 'border-l-red-500'
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs font-semibold ${testResponse.status === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
                      {testResponse.status === 'ok' ? 'Test Passed' : 'Test Failed'}
                    </span>
                    {testResponse.provider && (
                      <span className="text-[10px] text-gray-600">
                        {testResponse.provider} / {testResponse.model}
                      </span>
                    )}
                    {testResponse.latency_ms != null && (
                      <span className="text-[10px] text-gray-600">({testResponse.latency_ms}ms)</span>
                    )}
                  </div>
                  <pre className="text-xs text-gray-300 whitespace-pre-wrap overflow-auto max-h-48 font-mono bg-gray-950/50 rounded p-3 border border-gray-800">
                    {testResponse.response}
                  </pre>
                </div>
              )}

              {/* History panel */}
              {showHistory && (
                <div className="border border-gray-700 rounded-lg overflow-hidden">
                  <div className="bg-gray-800/50 px-4 py-2 flex items-center justify-between border-b border-gray-700">
                    <span className="text-xs font-semibold text-gray-300">Version History</span>
                    {loadingHistory && <span className="text-[10px] text-gray-500">Loading...</span>}
                  </div>
                  <div className="max-h-64 overflow-y-auto divide-y divide-gray-800">
                    {history.length === 0 && !loadingHistory && (
                      <div className="px-4 py-6 text-center text-gray-600 text-xs">
                        No history yet. Save an override to create the first version.
                      </div>
                    )}
                    {history.map(entry => (
                      <div key={entry.id} className="px-4 py-2.5 flex items-center gap-3 hover:bg-gray-800/30">
                        <span className={`flex-shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded ${
                          entry.action === 'reset'
                            ? 'bg-orange-500/15 text-orange-400'
                            : 'bg-blue-500/15 text-blue-400'
                        }`}>
                          v{entry.version}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs text-gray-300">
                            {entry.action === 'reset' ? 'Reset to default' : 'Saved override'}
                          </span>
                          <span className="text-[10px] text-gray-600 ml-2">
                            by {entry.user_name || entry.user_email || 'unknown'}
                          </span>
                        </div>
                        <span className="flex-shrink-0 text-[10px] text-gray-600">
                          {formatRelativeTime(entry.created_at)}
                        </span>
                        <div className="flex-shrink-0 flex gap-2">
                          <button
                            onClick={() => {
                              setDiffMode(entry.version)
                              setDiffValue(entry.value)
                            }}
                            className="text-[10px] text-gray-500 hover:text-blue-400 transition-colors"
                          >
                            Diff
                          </button>
                          <button
                            onClick={() => handleRestore(entry.version)}
                            className="text-[10px] text-gray-500 hover:text-green-400 transition-colors"
                          >
                            Restore
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-600">
              <div className="text-center">
                <div className="text-4xl mb-3 opacity-30">&#x1F4DD;</div>
                <p className="text-sm">Select a prompt from the sidebar to view and edit it</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Confirm modal */}
      {confirmAction && (
        <ConfirmModal
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel={confirmAction.confirmLabel}
          variant={confirmAction.variant}
          onConfirm={confirmAction.onConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  )
}
