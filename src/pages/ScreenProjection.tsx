/**
 * ScreenProjection — страница для вывода на второй экран / другой ПК.
 *
 * URL параметры:
 *   ?screen=1           — включает этот режим
 *   &camera=<id>        — ID камеры
 *   &blocks=video,recognized,people,events,guest  — какие блоки показывать
 *   &layout=full|split  — full = только видео, split = видео + боковые блоки
 *
 * Примеры:
 *   /?screen=1&camera=1&blocks=video,recognized,events
 *   /?screen=1&camera=1&blocks=video&layout=full
 *
 * Подключается неограниченное количество клиентов — каждый браузер
 * открывает свой WebSocket, сервер рассылает всем.
 */
import { useEffect, useState, useRef, useCallback } from 'react'
import LiveVideo from '../components/LiveVideo'
import CategoryBadge from '../components/CategoryBadge'
import type { FaceDetection, AlertMessage, Camera, KrakenEvent, Person } from '../types'
import { apiFetch, PHOTO_BASE, WS_BASE } from '../api/client'
// ── Парсим URL параметры ──────────────────────────────────────────────────────
function parseParams() {
  const p = new URLSearchParams(window.location.search)
  const blocksRaw = p.get('blocks') ?? 'video,recognized,events'
  const blocks = new Set(blocksRaw.split(',').map(s => s.trim()))
  return {
    cameraId: p.get('camera') ? Number(p.get('camera')) : null,
    layout:   (p.get('layout') ?? 'split') as 'full' | 'split',
    blocks,
  }
}

// ── Цвета алертов ─────────────────────────────────────────────────────────────
const ALERT_STYLES: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  BLACKLIST: { bg: 'bg-red-950/90',    border: 'border-red-500',    text: 'text-red-400',    icon: '⚠' },
  RESPONSE:  { bg: 'bg-orange-950/90', border: 'border-orange-500', text: 'text-orange-400', icon: '🚨' },
  VIP:       { bg: 'bg-green-950/90',  border: 'border-green-500',  text: 'text-green-400',  icon: '⭐' },
  STAFF:     { bg: 'bg-blue-950/90',   border: 'border-blue-500',   text: 'text-blue-400',   icon: '👤' },
  CLIENT:    { bg: 'bg-gray-900/90',   border: 'border-gray-500',   text: 'text-gray-400',   icon: '👤' },
}

export default function ScreenProjection() {
  const { cameraId: initCamId, layout: initLayout, blocks: initBlocks } = parseParams()

  const [cameras, setCameras]         = useState<Camera[]>([])
  const [cameraId, setCameraId]       = useState<number | null>(initCamId)
  const [layout]                      = useState(initLayout)
  const [blocks]                      = useState(initBlocks)
  const [alert, setAlert]             = useState<AlertMessage | null>(null)
  const [alertVisible, setAlertVisible] = useState(false)
  const [time, setTime]               = useState(new Date())
  const [events, setEvents]           = useState<KrakenEvent[]>([])
  const [detectedPerson, setDetectedPerson] = useState<Person | null>(null)
  const [detectedFace, setDetectedFace]     = useState<FaceDetection | null>(null)
  const [people, setPeople]           = useState<Person[]>([])
  const [guestLoyalty, setGuestLoyalty] = useState<any>(null)
  const alertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Часы
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Загрузка камер
  useEffect(() => {
    apiFetch<Camera[]>('/cameras').then(data => {
      setCameras(data)
      if (!cameraId && data.length > 0) setCameraId(data[0].id)
    }).catch(() => {})
  }, [])

  // Загрузка событий (если блок включён)
  useEffect(() => {
    if (!blocks.has('events')) return
    const load = () => apiFetch<KrakenEvent[]>('/events?limit=20').then(setEvents).catch(() => {})
    load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [blocks])

  // Загрузка людей (если блок включён)
  useEffect(() => {
    if (!blocks.has('people')) return
    const load = () => apiFetch<Person[]>('/persons/').then(setPeople).catch(() => {})
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [blocks])

  // WebSocket для алертов + обновление событий
  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(`${WS_BASE}/ws/security`)
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'ALERT') {
            setAlert(msg as AlertMessage)
            setAlertVisible(true)
            if (alertTimerRef.current) clearTimeout(alertTimerRef.current)
            alertTimerRef.current = setTimeout(() => setAlertVisible(false), 10_000)
            // Обновляем события
            if (blocks.has('events')) {
              apiFetch<KrakenEvent[]>('/events?limit=20').then(setEvents).catch(() => {})
            }
          }
        } catch {}
      }
      ws.onclose = () => setTimeout(connect, 3000)
      const ping = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping') }, 5000)
      return () => { clearInterval(ping); ws.close() }
    }
    return connect()
  }, [blocks])

  // Полноэкранный режим
  useEffect(() => {
    document.documentElement.requestFullscreen?.().catch(() => {})
  }, [])

  // Обработка распознанного лица
  const handleFaceDetected = useCallback((face: FaceDetection) => {
    if (!blocks.has('recognized')) return
    if (face.track_id === -1) {
      setDetectedFace(null)
      setDetectedPerson(null)
      setGuestLoyalty(null)
      return
    }
    setDetectedFace(face)
    if (face.person_id && face.person_name) {
      setDetectedPerson({
        id: face.person_id,
        name: face.person_name,
        category: (face.category ?? 'CLIENT') as any,
        comment: face.comment ?? null,
        photo_path: face.photo_path ?? null,
        photos: [],
        is_active: true,
        created_at: '',
        embedding_count: 0,
        visit_count: 0,
      })
      apiFetch<Person>(`/persons/${face.person_id}`)
        .then(full => setDetectedPerson(full))
        .catch(() => {})
      // Загружаем лояльность для блока "Последний гость"
      if (blocks.has('guest')) {
        apiFetch<any>(`/loyalty/${face.person_id}`)
          .then(r => setGuestLoyalty(r.loyalty))
          .catch(() => setGuestLoyalty(null))
      }
    } else {
      setDetectedPerson(null)
      setGuestLoyalty(null)
    }
  }, [blocks])

  const alertStyle = alert
    ? (ALERT_STYLES[alert.category] ?? ALERT_STYLES['CLIENT'])
    : ALERT_STYLES['CLIENT']

  const showSidebar = layout === 'split' && (blocks.has('recognized') || blocks.has('events') || blocks.has('people') || blocks.has('guest'))

  return (
    <div className="w-screen h-screen bg-black flex flex-col overflow-hidden select-none">

      {/* ── HUD верхняя строка ── */}
      <div className="flex items-center justify-between px-5 py-2.5 bg-black/70 backdrop-blur-sm flex-shrink-0 z-20 border-b border-white/5">
        <div className="flex items-center gap-4">
          <span className="text-white/25 text-xs font-bold tracking-widest uppercase">KRAKEN</span>

          {/* Переключатель камер */}
          {cameras.length > 1 && (
            <div className="flex gap-1">
              {cameras.map(c => (
                <button
                  key={c.id}
                  onClick={() => setCameraId(c.id)}
                  className={`px-2.5 py-0.5 rounded text-xs transition-colors ${
                    cameraId === c.id
                      ? 'bg-purple-600 text-white'
                      : 'bg-white/10 text-white/40 hover:bg-white/20 hover:text-white/70'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-green-400 text-xs font-bold tracking-wider">LIVE</span>
          </div>
          <span className="text-white/50 text-sm font-mono tabular-nums">
            {time.toLocaleTimeString('ru-RU')}
          </span>
        </div>
      </div>

      {/* ── Основной контент ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Видео */}
        <div className={`flex-1 min-w-0 min-h-0 ${showSidebar ? '' : 'w-full'}`}>
          {blocks.has('video') ? (
            <LiveVideo
              cameraId={cameraId}
              onFaceDetected={blocks.has('recognized') ? handleFaceDetected : undefined}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white/20 text-lg">
              Видео отключено
            </div>
          )}
        </div>

        {/* Боковая панель */}
        {showSidebar && (
          <div className="w-80 flex-shrink-0 flex flex-col gap-0 border-l border-white/5 bg-black/40 overflow-hidden">

            {/* Блок: Последний гость (с индексом лояльности) */}
            {blocks.has('guest') && detectedPerson && (
              <div className="flex-shrink-0 border-b border-white/5">
                <div className="px-3 py-2 text-white/30 text-[10px] uppercase tracking-widest">Последний гость</div>
                <div className="px-3 pb-3">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-12 h-12 rounded-xl overflow-hidden bg-white/5 flex-shrink-0 border border-white/10"
                      style={{ borderColor: guestLoyalty?.label_color ?? '#9AA6B2' }}>
                      {detectedPerson.photo_path
                        ? <img src={`${PHOTO_BASE}/${detectedPerson.photo_path}`} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-xl">👤</div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-white font-bold text-sm truncate">{detectedPerson.name}</div>
                      <CategoryBadge category={detectedPerson.category} />
                    </div>
                    {detectedFace?.confidence != null && (
                      <div className="text-right flex-shrink-0">
                        <div className="text-lg font-black" style={{ color: guestLoyalty?.label_color ?? '#00FF94' }}>
                          {Math.round(Math.max(0, Math.min(1, (detectedFace.confidence - 0.28) / 0.57)) * 100)}%
                        </div>
                      </div>
                    )}
                  </div>
                  {guestLoyalty && (
                    <div className="bg-white/5 rounded-lg p-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-white/40 text-[10px]">⭐ Индекс лояльности</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-base font-black" style={{ color: guestLoyalty.label_color }}>{guestLoyalty.score}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ color: guestLoyalty.label_color, backgroundColor: guestLoyalty.label_color + '20' }}>{guestLoyalty.label}</span>
                        </div>
                      </div>
                      <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${guestLoyalty.score}%`, backgroundColor: guestLoyalty.label_color }} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Блок: Распознанный человек */}
            {blocks.has('recognized') && (
              <div className="flex-shrink-0 border-b border-white/5">
                <div className="px-3 py-2 text-white/30 text-[10px] uppercase tracking-widest">
                  Распознанный человек
                </div>
                {detectedPerson ? (
                  <div className="px-3 pb-3 flex items-center gap-3">
                    <div className="w-14 h-14 rounded-xl overflow-hidden bg-white/5 flex-shrink-0 border border-white/10">
                      {detectedPerson.photo_path ? (
                        <img src={`${PHOTO_BASE}/${detectedPerson.photo_path}`} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-2xl">👤</div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-white font-bold text-sm truncate">{detectedPerson.name}</div>
                      <CategoryBadge category={detectedPerson.category} />
                      {detectedFace?.confidence != null && (
                        <div className="text-white/40 text-xs mt-1">
                          {Math.round(Math.max(0, Math.min(1, (detectedFace.confidence - 0.28) / 0.57)) * 100)}% совпадение
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="px-3 pb-3 text-white/20 text-xs">Ожидание...</div>
                )}
              </div>
            )}

            {/* Блок: База людей */}
            {blocks.has('people') && (
              <div className="flex-shrink-0 border-b border-white/5 max-h-48 overflow-y-auto">
                <div className="px-3 py-2 text-white/30 text-[10px] uppercase tracking-widest sticky top-0 bg-black/40">
                  База людей ({people.length})
                </div>
                <div className="divide-y divide-white/5">
                  {people.slice(0, 10).map(p => (
                    <div key={p.id} className="flex items-center gap-2 px-3 py-1.5">
                      <div className="w-10 h-10 rounded-lg overflow-hidden bg-white/5 flex-shrink-0">
                        {p.photo_path
                          ? <img src={`${PHOTO_BASE}/${p.photo_path}`} alt="" className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center text-xs">👤</div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-white/80 text-xs font-medium truncate">{p.name}</div>
                        <div className="text-white/30 text-[10px]">{p.visit_count ?? 0} визитов</div>
                      </div>
                      <CategoryBadge category={p.category} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Блок: Последние события */}
            {blocks.has('events') && (
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <div className="px-3 py-2 text-white/30 text-[10px] uppercase tracking-widest flex-shrink-0 border-b border-white/5">
                  Последние события
                </div>
                <div className="flex-1 overflow-y-auto">
                  {events.length === 0 ? (
                    <div className="px-3 py-4 text-white/20 text-xs">Событий пока нет</div>
                  ) : (
                    <div className="divide-y divide-white/5">
                      {events.slice(0, 15).map(ev => (
                        <div key={ev.id} className="flex items-center gap-2.5 px-3 py-2">
                          <div className="w-10 h-10 rounded-lg overflow-hidden bg-white/5 flex-shrink-0">
                            {ev.person_photo_path ? (
                              <img src={`${PHOTO_BASE}/${ev.person_photo_path}`} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-xs">👤</div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-white/80 text-xs font-medium truncate">
                              {ev.person_name ?? 'Неизвестен'}
                            </div>
                            <div className="text-white/30 text-[10px]">
                              {new Date(ev.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                              {ev.camera_id ? ` · Кам ${ev.camera_id}` : ''}
                            </div>
                          </div>
                          {ev.person_category && (
                            <CategoryBadge category={ev.person_category} size="sm" />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Алерт — всплывает снизу по центру ── */}
      {alert && (
        <div className={`absolute bottom-8 left-1/2 -translate-x-1/2 z-30 transition-all duration-500 ${
          alertVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10 pointer-events-none'
        }`}>
          <div className={`${alertStyle.bg} ${alertStyle.border} border-2 rounded-2xl px-8 py-5 backdrop-blur-xl shadow-2xl flex items-center gap-5 min-w-[420px] max-w-[600px]`}>
            <span className="text-5xl flex-shrink-0">{alertStyle.icon}</span>
            <div className="flex-1 min-w-0">
              <div className={`${alertStyle.text} font-black text-xl tracking-wide`}>
                {alert.category === 'BLACKLIST' ? 'ВНИМАНИЕ — ЧЁРНЫЙ СПИСОК'
                  : alert.category === 'RESPONSE' ? 'ТРЕБУЕТСЯ РЕАГИРОВАНИЕ'
                  : alert.category === 'VIP'      ? 'VIP ПРИБЫЛ'
                  : alert.category === 'SECURITY' ? 'СЕКЬЮРИТИ'
                  : 'ОБНАРУЖЕН ЧЕЛОВЕК'}
              </div>
              <div className="text-white text-lg font-semibold mt-1 truncate">{alert.person_name}</div>
              <div className="text-white/40 text-sm mt-0.5">Камера {alert.camera_id}</div>
            </div>
            <button
              onClick={() => setAlertVisible(false)}
              className="text-white/30 hover:text-white/70 flex-shrink-0 text-xl leading-none"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
