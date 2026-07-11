import { useState, useEffect, useRef } from 'react'
import { Zap, ZapOff, User, UserX, Loader2 } from 'lucide-react'
import type { FaceDetection, Person } from '../types'
import { apiFetch } from '../api/client'
import CategoryBadge from './CategoryBadge'

// Remap ArcFace cosine similarity [0.28..0.85] → [0%..100%]
function cosineToPercent(cosine: number): number {
  const clamped = Math.max(0.28, Math.min(0.85, cosine))
  return Math.round(((clamped - 0.28) / (0.85 - 0.28)) * 100)
}

interface Props {
  selectedCameraId: number | null
  /** Latest face from LiveVideo WebSocket — passed in from parent */
  latestFace: FaceDetection | null
  onAlert: (category: 'VIP' | 'BLACKLIST', personName: string) => void
}

interface SearchResult {
  found: boolean
  person?: Person
  confidence?: number
  message: string
}

export default function ReleaseButton({ selectedCameraId, latestFace, onAlert }: Props) {
  // liveMode = кракен выпущен, постоянно следим за лицами
  const [liveMode, setLiveMode] = useState(false)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(false)

  const lastPersonIdRef = useRef<number | null | undefined>(undefined)
  const alertedRef = useRef<Set<number>>(new Set())
  const onAlertRef = useRef(onAlert)
  useEffect(() => { onAlertRef.current = onAlert }, [onAlert])

  // Check camera status on mount and when selected camera changes
  useEffect(() => {
    const checkCameraStatus = async () => {
      if (!selectedCameraId) return
      
      try {
        const cameras = await apiFetch<any[]>('/cameras')
        const currentCamera = cameras.find(c => c.id === selectedCameraId)
        if (currentCamera && currentCamera.status === 'online') {
          setLiveMode(true)
        } else {
          setLiveMode(false)
        }
      } catch (error) {
        console.error('Failed to check camera status:', error)
      }
    }
    
    checkCameraStatus()
  }, [selectedCameraId])

  // Cleanup: do NOT stop the camera on unmount — the server camera runs independently
  // of the client UI. Stopping it here kills the camera for ALL clients when
  // this component unmounts (page navigation, re-render, tab switch).
  // The camera lifecycle is managed server-side via the Cameras settings page.
  useEffect(() => {
    return () => {
      // Only clear local UI state — never stop the server camera from a client unmount
      setLiveMode(false)
      setResult(null)
    }
  }, [])  // run only on unmount

  // When liveMode is ON — react to every new face from WebSocket
  useEffect(() => {
    if (!liveMode) return
    if (!latestFace) return

    const pid = latestFace.person_id ?? null
    if (pid === lastPersonIdRef.current) return
    lastPersonIdRef.current = pid

    if (pid) {
      setLoading(true)
      apiFetch<Person>(`/persons/${pid}`)
        .then(person => {
          setResult({
            found: true,
            person,
            confidence: latestFace.confidence,
            message: `Найден: ${person.name}`,
          })
          if (!alertedRef.current.has(pid)) {
            if (person.category === 'BLACKLIST' || person.category === 'VIP') {
              onAlertRef.current(person.category as 'VIP' | 'BLACKLIST', person.name)
              alertedRef.current.add(pid)
            }
          }
        })
        .catch(() => setResult({ found: false, message: 'Ошибка загрузки данных' }))
        .finally(() => setLoading(false))
    } else {
      setResult({ found: false, message: 'Человек не найден в базе' })
    }
  }, [liveMode, latestFace])  // ← onAlert removed from deps, using ref instead

  // When liveMode turns off — clear UI state only, do NOT stop the server camera.
  // The server camera is a shared resource that must keep running for all clients.
  // Camera lifecycle (start/stop) belongs exclusively to the Cameras settings page.
  const toggleLive = async () => {
    if (liveMode) {
      // Выключаем режим наблюдения — только UI state, камера на сервере продолжает работать
      setLiveMode(false)
      setResult(null)
      lastPersonIdRef.current = undefined
      alertedRef.current.clear()
    } else {
      if (!selectedCameraId) {
        setResult({ found: false, message: 'Нет активной камеры' })
        setTimeout(() => setResult(null), 3000)
        return
      }

      // Проверяем статус камеры на сервере — если offline, запускаем
      try {
        setLoading(true)
        const cameras = await apiFetch<any[]>('/cameras')
        const cam = cameras.find((c: any) => c.id === selectedCameraId)
        if (cam && cam.status !== 'online') {
          // Камера не работает — запускаем её
          await apiFetch(`/cameras/${selectedCameraId}/start`, { method: 'POST' })
        }
        // Независимо от предыдущего статуса — включаем live mode
        setLiveMode(true)
        setResult(null)
        lastPersonIdRef.current = undefined
      } catch (error) {
        setResult({ found: false, message: 'Ошибка запуска камеры' })
        setTimeout(() => setResult(null), 3000)
      } finally {
        setLoading(false)
      }
    }
  }

  return (
    <div className="flex items-center gap-3">
      {/* Result badge */}
      {result && (
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all ${
          result.found
            ? 'bg-kraken-green/10 border border-kraken-green'
            : 'bg-kraken-hover border border-kraken-border'
        }`}>
          {result.found && result.person ? (
            <>
              <User size={14} className="text-kraken-green flex-shrink-0" />
              <span className="text-kraken-text font-medium">{result.person.name}</span>
              <CategoryBadge category={result.person.category} />
              {result.confidence != null && (
                <span className="text-kraken-muted text-xs">
                  {cosineToPercent(result.confidence)}%
                </span>
              )}
            </>
          ) : (
            <>
              {loading
                ? <Loader2 size={14} className="animate-spin text-kraken-muted flex-shrink-0" />
                : <UserX size={14} className="text-kraken-muted flex-shrink-0" />
              }
              <span className="text-kraken-muted">{result.message}</span>
            </>
          )}
        </div>
      )}

      {/* Live indicator dot when active */}
      {liveMode && (
        <span className="flex items-center gap-1.5 text-kraken-green text-xs font-medium">
          <span className="w-2 h-2 rounded-full bg-kraken-green animate-pulse" />
          LIVE
        </span>
      )}

      {/* Toggle button */}
      <button
        onClick={toggleLive}
        className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition-all ${
          liveMode
            ? 'bg-kraken-green text-black shadow-glow-green hover:bg-kraken-green-hover'
            : 'bg-kraken-purple hover:bg-kraken-purple-hover text-white shadow-glow-purple'
        }`}
      >
        {liveMode
          ? <><ZapOff size={16} /> Остановить</>
          : <><Zap size={16} /> Выпускай Кракена</>
        }
      </button>
    </div>
  )
}
