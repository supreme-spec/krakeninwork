/**
 * RoiEditor — canvas-based ROI zone editor.
 *
 * Shows a snapshot of the camera and lets the user draw / delete
 * rectangular detection zones. Zones are stored as absolute pixel
 * coordinates relative to the *original* camera frame (not the
 * displayed canvas size) so the backend can apply them directly.
 *
 * Usage:
 *   <RoiEditor cameraId={cam.id} onClose={() => setShowRoi(false)} />
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { X, Trash2, Save, RefreshCw } from 'lucide-react'
import { apiFetch } from '../api/client'
import ConfirmModal, { AlertModal } from './ConfirmModal'

interface RoiZone {
  x1: number
  y1: number
  x2: number
  y2: number
  label: string
}

interface Props {
  cameraId: number
  cameraName: string
  onClose: () => void
}

const COLORS = [
  '#a855f7', '#22d3ee', '#f59e0b', '#10b981',
  '#ef4444', '#3b82f6', '#ec4899', '#84cc16',
]

export default function RoiEditor({ cameraId, cameraName, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Original frame dimensions (from snapshot)
  const [origW, setOrigW] = useState(0)
  const [origH, setOrigH] = useState(0)

  // Displayed canvas dimensions
  const [canvasW, setCanvasW] = useState(0)
  const [canvasH, setCanvasH] = useState(0)

  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null)
  const [zones, setZones] = useState<RoiZone[]>([])
  const [drawing, setDrawing] = useState(false)
  const [startPt, setStartPt] = useState({ x: 0, y: 0 })
  const [currentRect, setCurrentRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [newLabel, setNewLabel] = useState('Зона 1')
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    isDamage?: boolean;
  } | null>(null)
  const [alertState, setAlertState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
  } | null>(null)

  // ── Load snapshot + existing zones ────────────────────────────────────────

  const loadSnapshot = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const snap = await apiFetch<{ image: string }>(`/cameras/${cameraId}/snapshot`)
      const img = new Image()
      img.onload = () => {
        setOrigW(img.naturalWidth)
        setOrigH(img.naturalHeight)
        setBgImage(img)
        setLoading(false)
      }
      img.onerror = () => {
        setError('Не удалось загрузить снимок камеры')
        setLoading(false)
      }
      img.src = `data:image/jpeg;base64,${snap.image}`
    } catch {
      setError('Камера не запущена или нет снимка')
      setLoading(false)
    }
  }, [cameraId])

  const loadZones = useCallback(async () => {
    try {
      const data = await apiFetch<{ zones: RoiZone[] }>(`/cameras/${cameraId}/roi`)
      setZones(data.zones || [])
    } catch {
      setZones([])
    }
  }, [cameraId])

  useEffect(() => {
    loadSnapshot()
    loadZones()
  }, [loadSnapshot, loadZones])

  // ── Compute canvas size to fit container ──────────────────────────────────

  useEffect(() => {
    if (!origW || !origH || !containerRef.current) return
    const maxW = containerRef.current.clientWidth || 640
    const maxH = Math.min(window.innerHeight * 0.55, 480)
    const scale = Math.min(maxW / origW, maxH / origH, 1)
    setCanvasW(Math.round(origW * scale))
    setCanvasH(Math.round(origH * scale))
  }, [origW, origH, bgImage])

  // ── Draw everything on canvas ─────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !bgImage || !canvasW || !canvasH) return
    const ctx = canvas.getContext('2d')!
    const scaleX = canvasW / origW
    const scaleY = canvasH / origH

    ctx.clearRect(0, 0, canvasW, canvasH)
    ctx.drawImage(bgImage, 0, 0, canvasW, canvasH)

    // Dim overlay
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.fillRect(0, 0, canvasW, canvasH)

    // Draw saved zones
    zones.forEach((z, i) => {
      const color = COLORS[i % COLORS.length]
      const cx = z.x1 * scaleX
      const cy = z.y1 * scaleY
      const cw = (z.x2 - z.x1) * scaleX
      const ch = (z.y2 - z.y1) * scaleY

      // Bright fill inside zone (cut through dim)
      ctx.drawImage(bgImage, z.x1, z.y1, z.x2 - z.x1, z.y2 - z.y1, cx, cy, cw, ch)

      // Border
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.setLineDash([])
      ctx.strokeRect(cx, cy, cw, ch)

      // Label background
      const label = z.label || `Зона ${i + 1}`
      ctx.font = 'bold 12px sans-serif'
      const tw = ctx.measureText(label).width
      ctx.fillStyle = color
      ctx.fillRect(cx, cy - 20, tw + 10, 20)
      ctx.fillStyle = '#fff'
      ctx.fillText(label, cx + 5, cy - 5)

      // Corner handles
      const hs = 6
      ctx.fillStyle = color
      ;[[cx, cy], [cx + cw, cy], [cx, cy + ch], [cx + cw, cy + ch]].forEach(([hx, hy]) => {
        ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs)
      })
    })

    // Draw in-progress rect
    if (currentRect) {
      ctx.strokeStyle = '#a855f7'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 3])
      ctx.strokeRect(currentRect.x, currentRect.y, currentRect.w, currentRect.h)
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(168,85,247,0.15)'
      ctx.fillRect(currentRect.x, currentRect.y, currentRect.w, currentRect.h)
    }
  }, [bgImage, zones, currentRect, canvasW, canvasH, origW, origH])

  // ── Mouse / touch helpers ─────────────────────────────────────────────────

  const getCanvasPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }
  }

  const canvasToOrig = (cx: number, cy: number) => ({
    x: (cx / canvasW) * origW,
    y: (cy / canvasH) * origH,
  })

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getCanvasPos(e)
    setStartPt(pos)
    setDrawing(true)
    setCurrentRect({ x: pos.x, y: pos.y, w: 0, h: 0 })
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawing) return
    const pos = getCanvasPos(e)
    setCurrentRect({
      x: Math.min(startPt.x, pos.x),
      y: Math.min(startPt.y, pos.y),
      w: Math.abs(pos.x - startPt.x),
      h: Math.abs(pos.y - startPt.y),
    })
  }

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawing) return
    setDrawing(false)
    const pos = getCanvasPos(e)
    const w = Math.abs(pos.x - startPt.x)
    const h = Math.abs(pos.y - startPt.y)

    // Ignore tiny accidental clicks (< 10px)
    if (w < 10 || h < 10) {
      setCurrentRect(null)
      return
    }

    const ox1 = canvasToOrig(Math.min(startPt.x, pos.x), Math.min(startPt.y, pos.y))
    const ox2 = canvasToOrig(Math.max(startPt.x, pos.x), Math.max(startPt.y, pos.y))

    const label = newLabel.trim() || `Зона ${zones.length + 1}`
    setZones(prev => [
      ...prev,
      {
        x1: Math.round(ox1.x),
        y1: Math.round(ox1.y),
        x2: Math.round(ox2.x),
        y2: Math.round(ox2.y),
        label,
      },
    ])
    // Auto-increment label number
    const match = label.match(/^(.*?)(\d+)$/)
    if (match) setNewLabel(`${match[1]}${parseInt(match[2]) + 1}`)
    setCurrentRect(null)
  }

  const handleMouseLeave = () => {
    if (drawing) {
      setDrawing(false)
      setCurrentRect(null)
    }
  }

  // ── Delete zone ───────────────────────────────────────────────────────────

  const deleteZone = (idx: number) => {
    setZones(prev => prev.filter((_, i) => i !== idx))
  }

  const clearAll = () => {
    if (zones.length === 0) return
    setConfirmState({
      isOpen: true,
      title: 'Удалить все зоны',
      message: 'Удалить все зоны детектирования?',
      isDamage: true,
      onConfirm: () => {
        setConfirmState(null)
        setZones([])
      }
    })
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      await apiFetch(`/cameras/${cameraId}/roi`, {
        method: 'PUT',
        body: JSON.stringify({ zones, width: origW, height: origH }),
      })
      onClose()
    } catch (e: any) {
      setError(e.message || 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="panel flex flex-col w-full max-w-3xl mx-4 max-h-[95vh] overflow-hidden animate-fade-in">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-kraken-border flex-shrink-0">
          <div>
            <h2 className="text-kraken-text font-bold text-base">Зоны детектирования</h2>
            <p className="text-kraken-muted text-xs mt-0.5">{cameraName}</p>
          </div>
          <button onClick={onClose} className="text-kraken-muted hover:text-kraken-text">
            <X size={18} />
          </button>
        </div>

        {/* Canvas area */}
        <div ref={containerRef} className="flex-1 overflow-auto px-5 pt-4 min-h-0">
          {loading && (
            <div className="flex items-center justify-center h-48 text-kraken-muted gap-2">
              <RefreshCw size={16} className="animate-spin" />
              Загрузка снимка...
            </div>
          )}
          {!loading && error && (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <p className="text-kraken-red text-sm">{error}</p>
              <button onClick={loadSnapshot} className="btn-ghost text-xs flex items-center gap-1">
                <RefreshCw size={12} /> Повторить
              </button>
            </div>
          )}
          {!loading && !error && bgImage && canvasW > 0 && (
            <div className="flex flex-col items-center gap-2">
              <p className="text-kraken-muted text-xs self-start">
                Нарисуйте прямоугольник мышью — детектор будет работать только внутри зон.
                Без зон — весь кадр.
              </p>
              <canvas
                ref={canvasRef}
                width={canvasW}
                height={canvasH}
                className="rounded-lg border border-kraken-border cursor-crosshair select-none"
                style={{ maxWidth: '100%' }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
              />
            </div>
          )}
        </div>

        {/* Zone list + controls */}
        <div className="px-5 py-4 border-t border-kraken-border flex-shrink-0 space-y-3">

          {/* New zone label input */}
          <div className="flex items-center gap-2">
            <label className="text-kraken-muted text-xs whitespace-nowrap">Название новой зоны:</label>
            <input
              type="text"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              className="flex-1 bg-kraken-hover border border-kraken-border text-kraken-text text-xs px-2 py-1.5 rounded-lg focus:outline-none focus:border-kraken-purple"
              placeholder="Зона 1"
            />
          </div>

          {/* Zone list */}
          {zones.length > 0 && (
            <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto">
              {zones.map((z, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs border"
                  style={{ borderColor: COLORS[i % COLORS.length], color: COLORS[i % COLORS.length] }}
                >
                  <span className="font-medium">{z.label || `Зона ${i + 1}`}</span>
                  <span className="text-kraken-muted font-mono text-[10px]">
                    {Math.round(z.x2 - z.x1)}×{Math.round(z.y2 - z.y1)}px
                  </span>
                  <button
                    onClick={() => deleteZone(i)}
                    className="hover:text-kraken-red transition-colors ml-0.5"
                    title="Удалить зону"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {zones.length === 0 && !loading && !error && (
            <p className="text-kraken-disabled text-xs">
              Зоны не заданы — детектор работает по всему кадру.
            </p>
          )}

          {error && (
            <p className="text-kraken-red text-xs">{error}</p>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            {zones.length > 0 && (
              <button onClick={clearAll} className="btn-ghost flex items-center gap-1.5 text-xs text-kraken-red hover:text-kraken-red">
                <Trash2 size={13} />
                Очистить всё
              </button>
            )}
            <div className="flex-1" />
            <button onClick={onClose} className="btn-ghost text-sm">Отмена</button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              <Save size={14} />
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </div>
      </div>

      {confirmState && (
        <ConfirmModal
          isOpen={confirmState.isOpen}
          title={confirmState.title}
          message={confirmState.message}
          isDamage={confirmState.isDamage}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}

      {alertState && (
        <AlertModal
          isOpen={alertState.isOpen}
          title={alertState.title}
          message={alertState.message}
          onClose={() => setAlertState(null)}
        />
      )}
    </div>
  )
}
