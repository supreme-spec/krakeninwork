import { AlertTriangle, Info } from 'lucide-react'

interface ConfirmModalProps {
  isOpen: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  isDamage?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = 'Подтвердить',
  cancelText = 'Отмена',
  isDamage = false,
  onConfirm,
  onCancel
}: ConfirmModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 animate-fade-in" onClick={onCancel}>
      <div 
        className="panel bg-kraken-base border border-kraken-border/80 w-full max-w-sm p-6 mx-4 rounded-xl shadow-2xl relative"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className={`p-2 rounded-lg flex-shrink-0 ${isDamage ? 'bg-kraken-red/10 text-kraken-red' : 'bg-kraken-purple/10 text-kraken-purple'}`}>
            <AlertTriangle size={20} />
          </div>
          <div>
            <h3 className="text-kraken-text font-bold text-base leading-tight">{title}</h3>
            <p className="text-kraken-muted text-xs mt-1.5 leading-relaxed">{message}</p>
          </div>
        </div>
        <div className="flex gap-2.5 mt-6 justify-end">
          <button
            onClick={onCancel}
            className="flex-1 sm:flex-initial px-4 py-2 text-xs font-semibold rounded-lg bg-kraken-hover text-kraken-muted hover:text-kraken-text transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 sm:flex-initial px-4 py-2 text-xs font-semibold rounded-lg text-white transition-colors ${
              isDamage
                ? 'bg-kraken-red hover:bg-kraken-red-active'
                : 'bg-kraken-purple hover:bg-kraken-purple-hover'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

interface AlertModalProps {
  isOpen: boolean
  title: string
  message: string
  buttonText?: string
  onClose: () => void
}

export function AlertModal({
  isOpen,
  title,
  message,
  buttonText = 'ОК',
  onClose
}: AlertModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 animate-fade-in" onClick={onClose}>
      <div 
        className="panel bg-kraken-base border border-kraken-border/80 w-full max-w-sm p-6 mx-4 rounded-xl shadow-2xl relative"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 rounded-lg bg-kraken-purple/10 text-kraken-purple flex-shrink-0">
            <Info size={20} />
          </div>
          <div>
            <h3 className="text-kraken-text font-bold text-base leading-tight">{title}</h3>
            <p className="text-kraken-muted text-xs mt-1.5 leading-relaxed">{message}</p>
          </div>
        </div>
        <div className="flex mt-6 justify-end">
          <button
            onClick={onClose}
            className="w-full sm:w-auto px-5 py-2 text-xs font-semibold rounded-lg bg-kraken-purple hover:bg-kraken-purple-hover text-white transition-colors"
          >
            {buttonText}
          </button>
        </div>
      </div>
    </div>
  )
}
