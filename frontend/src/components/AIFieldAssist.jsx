import { useState, useCallback } from 'react'
import { aiFieldAssist } from '../api/client'

/**
 * AIFieldAssist — wraps a textarea with an inline AI toolbar.
 *
 * Actions:
 *   Suggest  — generate content for an empty field
 *   Improve  — rewrite / enhance existing content
 *   Custom   — user-provided instruction
 *   Undo     — revert to previous value
 *
 * Props:
 *   fieldName      — API field name (e.g. "functionality", "intent")
 *   value          — current textarea value
 *   onChange        — (newValue) => void
 *   rows           — textarea rows (default 6)
 *   placeholder    — textarea placeholder
 *   patternContext — object with all current form fields
 *   patternType    — "AB" | "ABB" | "SBB"
 *   patternId      — optional, set when editing existing pattern
 *   provider       — LLM provider name
 *   model          — LLM model name
 *   className      — additional class for textarea
 */
export default function AIFieldAssist({
  fieldName,
  value,
  onChange,
  rows = 6,
  placeholder = '',
  patternContext,
  patternType,
  patternId,
  provider,
  model,
  className = '',
}) {
  const [loading, setLoading] = useState(false)
  const [showCustom, setShowCustom] = useState(false)
  const [customPrompt, setCustomPrompt] = useState('')
  const [previousValue, setPreviousValue] = useState(null)
  const [badge, setBadge] = useState(null) // 'applied' | 'error'

  const clearBadge = () => {
    setTimeout(() => setBadge(null), 3000)
  }

  const callAssist = useCallback(async (action, customText) => {
    setLoading(true)
    setBadge(null)
    try {
      const res = await aiFieldAssist({
        field_name: fieldName,
        action,
        custom_prompt: customText || null,
        current_value: value || '',
        pattern_context: patternContext || {},
        pattern_type: patternType,
        pattern_id: patternId || null,
        provider: provider || null,
        model: model || null,
      })
      // Save for undo
      setPreviousValue(value)
      onChange(res.content)
      setBadge('applied')
      clearBadge()
    } catch (err) {
      setBadge('error')
      clearBadge()
      console.error('AI Field Assist error:', err)
    }
    setLoading(false)
    setShowCustom(false)
    setCustomPrompt('')
  }, [fieldName, value, onChange, patternContext, patternType, patternId, provider, model])

  const handleUndo = () => {
    if (previousValue !== null) {
      onChange(previousValue)
      setPreviousValue(null)
    }
  }

  const handleCustomSubmit = (e) => {
    e.preventDefault()
    if (customPrompt.trim()) {
      callAssist('custom', customPrompt.trim())
    }
  }

  return (
    <div className="ai-field-assist">
      <textarea
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`input w-full font-mono text-sm resize-y ${className}`}
        rows={rows}
        disabled={loading}
      />

      {/* AI Toolbar */}
      <div className="ai-toolbar">
        <div className="ai-toolbar-actions">
          <button
            onClick={() => callAssist('suggest')}
            disabled={loading}
            className="ai-btn ai-btn-suggest"
            title="Generate content using AI"
          >
            <span className="ai-btn-icon">&#10024;</span> Suggest
          </button>
          <span className="ai-toolbar-sep" />
          <button
            onClick={() => callAssist('improve')}
            disabled={loading || !value?.trim()}
            className="ai-btn ai-btn-improve"
            title="Improve existing content"
          >
            <span className="ai-btn-icon">&#9998;</span> Improve
          </button>
          <span className="ai-toolbar-sep" />
          <button
            onClick={() => setShowCustom(!showCustom)}
            disabled={loading}
            className={`ai-btn ai-btn-custom ${showCustom ? 'ai-btn-active' : ''}`}
            title="Custom AI instruction"
          >
            <span className="ai-btn-icon">&#128172;</span> Custom
          </button>
          {previousValue !== null && (
            <>
              <span className="ai-toolbar-sep" />
              <button
                onClick={handleUndo}
                disabled={loading}
                className="ai-btn ai-btn-undo"
                title="Undo AI change"
              >
                &#8617; Undo
              </button>
            </>
          )}
        </div>

        <div className="ai-toolbar-status">
          {loading && (
            <span className="ai-loading">
              <span className="ai-spinner" /> AI generating...
            </span>
          )}
          {badge === 'applied' && (
            <span className="ai-badge ai-badge-success">&#10003; AI applied</span>
          )}
          {badge === 'error' && (
            <span className="ai-badge ai-badge-error">&#10007; AI failed</span>
          )}
        </div>
      </div>

      {/* Custom Prompt Input */}
      {showCustom && (
        <form onSubmit={handleCustomSubmit} className="ai-custom-input">
          <input
            type="text"
            value={customPrompt}
            onChange={e => setCustomPrompt(e.target.value)}
            placeholder="e.g. make more concise, add security details, restructure as bullet points..."
            className="input flex-1 text-sm"
            autoFocus
          />
          <button
            type="submit"
            disabled={loading || !customPrompt.trim()}
            className="btn-primary text-xs px-3 py-1.5"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={() => { setShowCustom(false); setCustomPrompt('') }}
            className="btn-secondary text-xs px-2 py-1.5"
          >
            Cancel
          </button>
        </form>
      )}
    </div>
  )
}
