/**
 * useDragResize — перемещение и изменение размера блока.
 *
 * Перемещение: тянешь за любое место блока.
 *   - Порог 4px перед началом drag — случайные клики не триггерят
 *   - Исключение: INPUT, SELECT, TEXTAREA, BUTTON, A — клики работают нормально
 *
 * Изменение размера: тянешь за любой из 8 краёв (зона EDGE px по периметру).
 *   - Курсор меняется автоматически при наведении на край
 */
import { useRef, useCallback } from 'react'

export interface Rect { x: number; y: number; w: number; h: number }
type OnChange = (rect: Rect) => void

const EDGE      = 10   // px — зона resize по краям
const DRAG_THRESHOLD = 4  // px — минимальное движение для начала drag

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | null

// Теги которые НЕ должны триггерить drag при клике
const INTERACTIVE = new Set(['INPUT','SELECT','TEXTAREA','BUTTON','A',
  'LABEL','OPTION','SUMMARY','DETAILS'])

function detectEdge(clientX: number, clientY: number, el: HTMLElement): Edge {
  const r = el.getBoundingClientRect()
  const x = clientX - r.left
  const y = clientY - r.top
  const w = r.width
  const h = r.height

  const top    = y < EDGE
  const bottom = y > h - EDGE
  const left   = x < EDGE
  const right  = x > w - EDGE

  if (top    && left)  return 'nw'
  if (top    && right) return 'ne'
  if (bottom && left)  return 'sw'
  if (bottom && right) return 'se'
  if (top)    return 'n'
  if (bottom) return 's'
  if (left)   return 'w'
  if (right)  return 'e'
  return null
}

const EDGE_CURSOR: Record<string, string> = {
  n: 'n-resize', s: 's-resize', e: 'e-resize', w: 'w-resize',
  ne: 'ne-resize', nw: 'nw-resize', se: 'se-resize', sw: 'sw-resize',
}

export function useDragResize(
  rect: Rect,
  onChange: OnChange,
  containerRef: React.RefObject<HTMLElement | null>,
) {
  const elRef = useRef<HTMLDivElement>(null)

  // Обновляем курсор при движении мыши над блоком
  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = elRef.current
    if (!el) return
    const edge = detectEdge(e.clientX, e.clientY, el)
    el.style.cursor = edge ? EDGE_CURSOR[edge] : 'move'
  }, [])

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = elRef.current
    const container = containerRef.current
    if (!el || !container) return

    // Пропускаем клики на интерактивных элементах
    let t = e.target as HTMLElement | null
    while (t && t !== el) {
      if (INTERACTIVE.has(t.tagName)) return
      t = t.parentElement
    }

    // Только левая кнопка
    if (e.button !== 0) return

    const edge = detectEdge(e.clientX, e.clientY, el)
    const startX = e.clientX
    const startY = e.clientY
    const startRect = { ...rect }
    const containerBounds = container.getBoundingClientRect()
    const MIN_W = 120
    const MIN_H = 80

    let started = false

    // Для resize — начинаем сразу, для move — после порога
    if (edge) {
      e.preventDefault()
      e.stopPropagation()
      started = true
    }

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY

      // Порог для перемещения
      if (!started) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
        started = true
        e.preventDefault()
      }

      let { x, y, w, h } = startRect

      if (!edge) {
        // Перемещение — свободно, без ограничений по контейнеру
        x = startRect.x + dx
        y = startRect.y + dy
        // Не даём уйти полностью за пределы
        x = Math.max(-w + 40, Math.min(x, containerBounds.width - 40))
        y = Math.max(0, Math.min(y, containerBounds.height - 40))
      } else {
        // Изменение размера
        if (edge.includes('e')) w = Math.max(MIN_W, startRect.w + dx)
        if (edge.includes('s')) h = Math.max(MIN_H, startRect.h + dy)
        if (edge.includes('w')) {
          const newW = Math.max(MIN_W, startRect.w - dx)
          x = startRect.x + (startRect.w - newW)
          w = newW
        }
        if (edge.includes('n')) {
          const newH = Math.max(MIN_H, startRect.h - dy)
          y = startRect.y + (startRect.h - newH)
          h = newH
        }
        x = Math.max(0, x)
        y = Math.max(0, y)
        if (x + w > containerBounds.width)  w = containerBounds.width - x
        if (y + h > containerBounds.height) h = containerBounds.height - y
      }

      onChange({ x, y, w, h })
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (el) el.style.cursor = ''
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [rect, onChange, containerRef])

  return { elRef, onMouseDown, onMouseMove }
}
