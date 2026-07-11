import type { ReactNode } from 'react'
import { GripHorizontal } from 'lucide-react'
import { useDraggable } from '../hooks/useDraggable'

interface Props {
  title: string
  storageKey: string
  initialX?: number
  initialY?: number
  width?: number
  children: ReactNode
  onClose?: () => void
  className?: string
}

/**
 * Floating draggable panel — drag by the title bar.
 * Position is persisted in localStorage per storageKey.
 */
export default function DraggablePanel({
  title,
  storageKey,
  initialX = 20,
  initialY = 20,
  width = 320,
  children,
  onClose,
  className = '',
}: Props) {
  const { pos, onMouseDown } = useDraggable({
    initialPosition: { x: initialX, y: initialY },
    storageKey,
  })

  return (
    <div
      className={`absolute z-30 panel shadow-glow-purple select-none ${className}`}
      style={{
        left: pos.x,
        top: pos.y,
        width,
        minWidth: 240,
      }}
    >
      {/* Drag handle */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-kraken-border cursor-grab active:cursor-grabbing bg-kraken-hover rounded-t-xl"
        onMouseDown={onMouseDown}
      >
        <div className="flex items-center gap-2">
          <GripHorizontal size={14} className="text-kraken-disabled" />
          <span className="text-kraken-muted text-xs font-semibold uppercase tracking-wider">
            {title}
          </span>
        </div>
        {onClose && (
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={onClose}
            className="text-kraken-disabled hover:text-kraken-text text-xs leading-none"
          >
            ✕
          </button>
        )}
      </div>

      {/* Content */}
      <div className="p-3">
        {children}
      </div>
    </div>
  )
}
