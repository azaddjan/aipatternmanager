import { useState, useRef, useEffect } from 'react'
import MarkdownContent from './MarkdownContent'

/**
 * Conversation thread for advisor follow-up questions.
 * Displays follow-up messages (initial analysis is shown by the existing tabs).
 * Includes a text input for new follow-up questions.
 */
export default function ConversationThread({
  messages = [],
  onSendFollowup,
  sending = false,
  messageCount = 0,
  maxMessages = 18,
  disabled = false,
}) {
  const [question, setQuestion] = useState('')
  const scrollRef = useRef(null)
  const inputRef = useRef(null)

  // Filter to only follow-up messages
  const followupMessages = messages.filter(m => m.type === 'followup')
  const followupCount = Math.floor(followupMessages.length / 2)
  const atLimit = messageCount >= maxMessages
  const lastAssistantMsg = [...followupMessages].reverse().find(m => m.role === 'assistant')
  const shouldContinue = lastAssistantMsg?.should_continue !== false

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [followupMessages.length, sending])

  const handleSend = () => {
    const q = question.trim()
    if (!q || q.length < 5 || sending || atLimit || disabled) return
    onSendFollowup(q)
    setQuestion('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="card space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
          <span className="text-lg">💬</span>
          Follow-up Conversation
          {followupCount > 0 && (
            <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded-full">
              {followupCount} follow-up{followupCount !== 1 ? 's' : ''}
            </span>
          )}
        </h3>
        {messageCount > 0 && (
          <span className="text-xs text-gray-500">{messageCount}/{maxMessages} messages</span>
        )}
      </div>

      {/* Messages */}
      {followupMessages.length > 0 && (
        <div
          ref={scrollRef}
          className="space-y-3 max-h-[500px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-gray-700"
        >
          {followupMessages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm ${
                msg.role === 'user'
                  ? 'bg-blue-600/20 text-blue-100 border border-blue-500/20'
                  : 'bg-gray-800/60 text-gray-300 border border-gray-700/50'
              }`}>
                {msg.role === 'user' ? (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                ) : (
                  <MarkdownContent content={msg.content} />
                )}
              </div>
            </div>
          ))}

          {/* Sending indicator */}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl px-4 py-2.5 text-sm text-gray-400">
                <span className="animate-pulse flex items-center gap-2">
                  <span className="inline-block w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="inline-block w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="inline-block w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  <span className="ml-2">Thinking...</span>
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Conversation ended hint */}
      {followupMessages.length > 0 && !shouldContinue && !atLimit && (
        <p className="text-xs text-gray-500 italic text-center py-1">
          The advisor has fully addressed your question. You can still ask more if needed.
        </p>
      )}

      {/* Limit reached */}
      {atLimit && (
        <p className="text-xs text-amber-400/80 text-center py-1">
          Conversation limit reached ({maxMessages} messages). Start a new analysis to continue exploring.
        </p>
      )}

      {/* Input */}
      {!atLimit && !disabled && (
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={followupMessages.length === 0
              ? "Ask a follow-up question about this analysis..."
              : "Ask another question..."}
            disabled={sending}
            rows={1}
            className="flex-1 px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500/50 resize-none disabled:opacity-50"
            style={{ minHeight: '38px', maxHeight: '120px' }}
            onInput={e => {
              e.target.style.height = '38px'
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
            }}
          />
          <button
            onClick={handleSend}
            disabled={sending || question.trim().length < 5}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            {sending ? (
              <span className="animate-spin inline-block">⟳</span>
            ) : (
              'Send'
            )}
          </button>
        </div>
      )}
    </div>
  )
}
