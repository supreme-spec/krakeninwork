/**
 * MultiCamera — все камеры одновременно в сетке.
 * Можно добавлять/убирать блоки: события, распознанный человек.
 * Клик на камеру — разворачивает на весь экран.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import LiveVideo from '../components/LiveVideo'
import EventsFeed from '../components/EventsFeed'
import PersonCard from '../components/PersonCard'
import type { Camera, KrakenEvent, FaceDetection, Person } from '../types'
import { LayoutGrid, Maximize2, Minimize2, Eye, EyeOff, X } from 'lucide-react'

interface Props {
  cameras: Camera[]
  recentEvents: KrakenEvent[]
  onLatestFace?: (face: FaceDetection | null) => void
}

type ExtraBlock = 'events' | 'person'

const GRID_COLS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-2',
  4: 'grid-cols-2',
  5: 'grid-cols-3',
  6: 'grid-cols-3',
  7: 'grid-cols-3',
  8: 'grid-cols-4',
  9: 'grid-cols-3',
  10: 'grid-cols-4',
}

export default function MultiCamera({ cameras, recentEvents, onLatestFace }: Props) {
  const [fullscreen, setFullscreen] = useState<number | null>(null)
  const [extras, setExtras] = useState<Set<ExtraBlock>>(() => {
    try {
      const s = localStorage.getItem('kraken_multicam_extras')
      if (s) return new Set(JSON.parse(s))
    } catch {}
    return new Set<ExtraBlock>()
  })
  const [showMenu, setShowMenu] = useState(false)
  const [detectedPerson, setDetectedPerson] = useState<Person | null>(null)
  const [detectedFace, setDetectedFace] = useState<FaceDetection | null>(null)

  const onLatestFaceRef = useRef(onLatestFace)
  useEffect(() => { onLatestFaceRef.current = onLatestFace }, [onLatestFace])

  const handleFaceDetected = useCallback((face: FaceDetection) => {
    if (face.track_id === -1) {
      onLatestFaceRef.current?.(null)
      setDetectedFace(null); setDetectedPerson(null)
      return
    }
    onLatestFaceRef.current?.(face)
    setDetectedFace(face)
    if (face.person_id && face.person_name) {
      setDetectedPerson({
        id: face.person_id, name: face.person_name,
        category: (face.category ?? 'CLIENT') as any,
        comment: face.comment ?? null, photo_path: face.photo_path ?? null,
        photos: [], is_active: true, created_at: '', embedding_count: 0, visit_count: 0,
      })
    } else {
      setDetectedPerson(null)
    }
  }, [])

  const toggleExtra = (b: ExtraBlock) => {
    setExtras(prev => {
      const next = new Set(prev)
      if (next.has(b)) next.delete(b); else next.add(b)
      try { localStorage.setItem('kraken_multicam_extras', JSON.stringify([...next])) } catch {}
      return next
    })
  }

  const onlineCameras = cameras.filter(c => c.status === 'online')
  const allCameras = cameras // показываем все, даже офлайн

  // Если нет камер
  if (allCameras.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-kraken-disabled">
        <div className="text-center">
          <div className="text-4xl mb-3 opacity-20">📷</div>
          <p className="text-sm">Нет добавленных камер</p>
        </div>
      </div>
    )
  }

  const cols = GRID_COLS[allCameras.length] ?? 'grid-cols-4'
  const hasExtras = extras.size > 0

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 mb-2 flex-shrink-0">
        <span className="text-kraken-muted text-xs font-semibold">
          Все камеры
          <span className="ml-1.5 text-kraken-disabled">
            ({onlineCameras.length}/{allCameras.length} онлайн)
          </span>
        </span>

        <div className="flex-1" />

        {/* Кнопка добавить блок */}
        <div className="relative">
          <button onClick={() => setShowMenu(p => !p)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-kraken-hover text-kraken-muted hover:text-kraken-text transition-colors">
            <LayoutGrid size={13} /> Блоки
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-full mt-1 z-30 bg-kraken-panel border border-kraken-border rounded-xl shadow-2xl p-3 w-52 animate-fade-in">
                <div className="text-kraken-disabled text-[10px] uppercase tracking-widest mb-2">
                  Дополнительные блоки
                </div>
                {([
                  { id: 'events' as ExtraBlock, label: 'Последние события' },
                  { id: 'person' as ExtraBlock, label: 'Распознанный человек' },
                ] as { id: ExtraBlock; label: string }[]).map(({ id, label }) => (
                  <button key={id} onClick={() => toggleExtra(id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-kraken-hover text-sm transition-colors">
                    {extras.has(id)
                      ? <Eye size={13} className="text-kraken-green flex-shrink-0" />
                      : <EyeOff size={13} className="text-kraken-disabled flex-shrink-0" />}
                    <span className={extras.has(id) ? 'text-kraken-text' : 'text-kraken-disabled'}>
                      {label}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Основной контент ── */}
      <div className={`flex-1 min-h-0 ${hasExtras ? 'flex gap-3' : ''} overflow-hidden`}>

        {/* Сетка камер */}
        <div className={`${hasExtras ? 'flex-1 min-w-0' : 'w-full h-full'} overflow-auto`}>
          <div className={`grid ${cols} gap-2 h-full`}
            style={{ gridAutoRows: allCameras.length <= 2 ? '100%' : `calc(50% - 4px)` }}>
            {allCameras.map(cam => (
              <CameraCell
                key={cam.id}
                camera={cam}
                isFullscreen={fullscreen === cam.id}
                onFullscreen={() => setFullscreen(fullscreen === cam.id ? null : cam.id)}
                onFaceDetected={handleFaceDetected}
              />
            ))}
          </div>
        </div>

        {/* Боковые блоки */}
        {hasExtras && (
          <div className="w-72 flex-shrink-0 flex flex-col gap-3 overflow-hidden">

            {extras.has('person') && (
              <div className="panel flex flex-col overflow-hidden flex-shrink-0">
                <div className="px-3 py-2 border-b border-kraken-border flex items-center justify-between flex-shrink-0">
                  <span className="text-kraken-muted text-[10px] font-semibold uppercase tracking-widest">
                    Распознанный человек
                  </span>
                  <button onClick={() => toggleExtra('person')}
                    className="text-kraken-disabled hover:text-kraken-muted transition-colors">
                    <X size={12} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <PersonCard
                    person={detectedPerson}
                    confidence={detectedFace?.confidence}
                    onClose={() => { setDetectedPerson(null); setDetectedFace(null) }}
                  />
                </div>
              </div>
            )}

            {extras.has('events') && (
              <div className="panel flex flex-col overflow-hidden flex-1 min-h-0">
                <div className="px-3 py-2 border-b border-kraken-border flex items-center justify-between flex-shrink-0">
                  <span className="text-kraken-muted text-[10px] font-semibold uppercase tracking-widest">
                    Последние события
                  </span>
                  <button onClick={() => toggleExtra('events')}
                    className="text-kraken-disabled hover:text-kraken-muted transition-colors">
                    <X size={12} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <EventsFeed events={recentEvents} maxItems={30} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Полноэкранный режим ── */}
      {fullscreen !== null && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 bg-black/60 flex-shrink-0">
            <span className="text-white/60 text-sm">
              {cameras.find(c => c.id === fullscreen)?.name ?? `Камера ${fullscreen}`}
            </span>
            <button onClick={() => setFullscreen(null)}
              className="flex items-center gap-1.5 text-white/60 hover:text-white text-xs transition-colors">
              <Minimize2 size={14} /> Свернуть
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <LiveVideo cameraId={fullscreen} onFaceDetected={handleFaceDetected} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Ячейка камеры ─────────────────────────────────────────────────────────────

interface CellProps {
  camera: Camera
  isFullscreen: boolean
  onFullscreen: () => void
  onFaceDetected: (face: FaceDetection) => void
}

function CameraCell({ camera, onFullscreen, onFaceDetected }: CellProps) {
  const isOnline = camera.status === 'online'

  return (
    <div className="relative rounded-xl overflow-hidden border border-kraken-border bg-kraken-base group min-h-0">
      {/* Видео */}
      {isOnline ? (
        <LiveVideo cameraId={camera.id} onFaceDetected={onFaceDetected} />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-kraken-disabled">
          <div className="text-3xl opacity-20">📷</div>
          <span className="text-xs">{camera.name}</span>
          <span className="text-[10px] text-kraken-red">ОФЛАЙН</span>
        </div>
      )}

      {/* Оверлей с именем и кнопками */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            isOnline ? 'bg-kraken-green animate-pulse' : 'bg-kraken-red'
          }`} />
          <span className="text-white text-xs font-medium truncate max-w-[120px]">{camera.name}</span>
          {isOnline && camera.ping_ms != null && (
            <span className={`text-[10px] font-mono ${
              camera.ping_ms < 50 ? 'text-kraken-green' :
              camera.ping_ms < 150 ? 'text-yellow-400' : 'text-kraken-red'
            }`}>
              {camera.ping_ms}ms
            </span>
          )}
        </div>
        <button onClick={onFullscreen}
          className="text-white/70 hover:text-white transition-colors flex-shrink-0">
          <Maximize2 size={13} />
        </button>
      </div>

      {/* Имя всегда видно сверху (маленькое) */}
      <div className="absolute top-1.5 left-2 text-white/40 text-[10px] font-medium pointer-events-none">
        {camera.name}
      </div>
    </div>
  )
}
