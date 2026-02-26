import { useEffect, useRef } from 'react'

/**
 * Styled confirmation modal to replace browser alert()/confirm().
 * Props:
 *   open - boolean to show/hide
 *   title - modal title
 *   message - description text
 *   confirmLabel - text for confirm button (default: "Confirm")
 *   cancelLabel - text for cancel button (default: "Cancel")
 *   variant - 'danger' | 'warning' | 'info' (default: 'danger')
 *   onConfirm - callback when confirmed
 *   onCancel - callback when cancelled
 */
export default function ConfirmModal({
  open,
  title = 'Confirm Action',
  message = 'Are you sure?',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  onConfirm,
  onCancel,
}) {
  const confirmRef = useRef(null)

  useEffect(() => {
    if (open) {
      // Focus confirm button on open for keyboard accessibility
      setTimeout(() => confirmRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleKey = (e) => {
      if (e.key === 'Escape') onCancel?.()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onCancel])

  if (!open) return null

  const btnColors = {
    danger: 'bg-red-600 hover:bg-red-700 text-white',
    warning: 'bg-yellow-600 hover:bg-yellow-700 text-white',
    info: 'bg-blue-600 hover:bg-blue-700 text-white',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl max-w-md w-full mx-4 p-6">
        <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
        <p className="text-sm text-gray-400 mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className={`px-4 py-2 text-sm rounded-lg transition-colors ${btnColors[variant] || btnColors.danger}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
