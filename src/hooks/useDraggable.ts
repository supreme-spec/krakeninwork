import { useRef, useState, useCallback, useEffect } from 'react'

interface Position {
  x: number
  y: number
}

interface UseDraggableOptions {
  initialPosition?: Position
  storageKey?: string  // persist position in localStorage
}

/**
 * Makes a panel draggable by its handle.
 * Returns ref to attach to the draggable container and position state.
 */
export function useDraggable({ initialPosition = { x: 0, y: 0 }, storageKey }: UseDraggableOptions = {}) {
  const getInitial = (): Position => {
    if (storageKey) {
      try {
        const saved = localStorage.getItem(`kraken_pos_${storageKey}`)
        if (saved) return JSON.parse(saved)
      } catch {}
    }
    return initialPosition
  }

  const [pos, setPos] = useState<Position>(getInitial)
  const dragging = useRef(false)
  const startMouse = useRef<Position>({ x: 0, y: 0 })
  const startPos = useRef<Position>({ x: 0, y: 0 })

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startMouse.current = { x: e.clientX, y: e.clientY }
    startPos.current = pos
  }, [pos])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const dx = e.clientX - startMouse.current.x
      const dy = e.clientY - startMouse.current.y
      const newPos = {
        x: startPos.current.x + dx,
        y: startPos.current.y + dy,
      }
      setPos(newPos)
      if (storageKey) {
        localStorage.setItem(`kraken_pos_${storageKey}`, JSON.stringify(newPos))
      }
    }
    const onUp = () => { dragging.current = false }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [storageKey])

  return { pos, onMouseDown }
}
