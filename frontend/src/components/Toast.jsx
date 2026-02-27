import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from 'react'

const ToastContext = createContext(null)

const VARIANTS = {
  success: {
    bg: 'bg-green-500/10',
    border: 'border-green-500/30',
    text: 'text-green-400',
    icon: '✓',
    duration: 3000,
  },
  error: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    text: 'text-red-400',
    icon: '✕',
    duration: 5000,
  },
  info: {
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    text: 'text-blue-400',
    icon: 'i',
    duration: 3000,
  },
  warning: {
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/30',
    text: 'text-yellow-400',
    icon: '!',
    duration: 4000,
  },
}

let toastId = 0

function ToastItem({ toast, onDismiss }) {
  const v = VARIANTS[toast.variant] || VARIANTS.info
  const [exiting, setExiting] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setExiting(true)
      setTimeout(() => onDismiss(toast.id), 300)
    }, v.duration)
    return () => clearTimeout(timerRef.current)
  }, [toast.id, v.duration, onDismiss])

  const handleDismiss = () => {
    clearTimeout(timerRef.current)
    setExiting(true)
    setTimeout(() => onDismiss(toast.id), 300)
  }

  return (
    <div
      className={`flex items-start gap-3 ${v.bg} border ${v.border} rounded-lg px-4 py-3 shadow-lg shadow-black/20 min-w-[280px] max-w-[420px] backdrop-blur-sm ${
        exiting ? 'toast-exit' : 'toast-enter'
      }`}
      role="alert"
      aria-live="polite"
    >
      <span className={`${v.text} text-sm font-bold flex-shrink-0 mt-0.5 w-4 h-4 flex items-center justify-center rounded-full border ${v.border}`}>
        {v.icon}
      </span>
      <p className={`${v.text} text-sm flex-1`}>{toast.message}</p>
      <button
        onClick={handleDismiss}
        className={`${v.text} opacity-50 hover:opacity-100 text-sm flex-shrink-0 transition-opacity`}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  )
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const addToast = useCallback((message, variant = 'info') => {
    const id = ++toastId
    setToasts(prev => [...prev, { id, message, variant }])
    return id
  }, [])

  const toast = useMemo(() => ({
    success: (msg) => addToast(msg, 'success'),
    error: (msg) => addToast(msg, 'error'),
    info: (msg) => addToast(msg, 'info'),
    warning: (msg) => addToast(msg, 'warning'),
  }), [addToast])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem toast={t} onDismiss={dismiss} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>')
  return { toast: ctx }
}
