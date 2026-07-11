import { useState, useEffect, useCallback, useRef } from 'react'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import AlertPopup from './components/AlertPopup'
import ReleaseButton from './components/ReleaseButton'
import ProjectionPanel from './components/ProjectionPanel'
import LiveMonitor from './pages/LiveMonitor'
import MultiCamera from './pages/MultiCamera'
import ScreenProjection from './pages/ScreenProjection'
import People from './pages/People'
import Events from './pages/Events'
import Cameras from './pages/Cameras'
import Settings from './pages/Settings'
import Chronicle from './pages/Chronicle'
import SmartRecording from './pages/SmartRecording'
import Categories from './pages/Categories'
import Requirements from './pages/Requirements'
import type { Camera, KrakenEvent, AlertMessage, FaceDetection } from './types'
import { apiFetch } from './api/client'
import { WS_BASE } from './api/client'
import { usePushNotifications } from './hooks/usePushNotifications'
import { playAlertSound, loadSoundConfigs, initAudio, type SoundCategory } from './hooks/useAlertSounds'
import clientLogger from './lib/client-logger'
import './App.css'

// ── Если открыт как экран проекции — рендерим только ScreenProjection ─────────
const isProjectionScreen = new URLSearchParams(window.location.search).get('screen') === '1'

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  useEffect(() => {
    clientLogger.info('Приложение инициализировано')
  }, [])

  // Если это окно проекции — рендерим только ScreenProjection
  if (isProjectionScreen) return <ScreenProjection />

  const [page, setPage] = useState('live')

  // Обработчик навигации из дочерних компонентов (например Settings → Categories)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (typeof detail === 'string') setPage(detail)
    }
    window.addEventListener('navigate', handler)
    return () => window.removeEventListener('navigate', handler)
  }, [])
  const [cameras, setCameras] = useState<Camera[]>([])
  const [selectedCameraId, setSelectedCameraId] = useState<number | null>(null)
  const [recentEvents, setRecentEvents] = useState<KrakenEvent[]>([])
  const [currentAlert, setCurrentAlert] = useState<AlertMessage | null>(null)
  const [alertHistory, setAlertHistory] = useState<AlertMessage[]>([])
  const [latestFace, setLatestFace] = useState<FaceDetection | null>(null)
  const [showProjection, setShowProjection] = useState(false)
  const [notifyEnabled, setNotifyEnabled] = useState(() =>
    localStorage.getItem('kraken_notify') !== 'false'
  )
  const [enabledCategories, setEnabledCategories] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('kraken_notify_cats')
      if (raw) return new Set(JSON.parse(raw) as string[])
    } catch {}
    return new Set(['BLACKLIST', 'RESPONSE', 'VIP'])
  })
  const wsRef = useRef<WebSocket | null>(null)
  const [isManualRecording] = useState(false)

  // Звуковые конфиги — перечитываем из localStorage при каждом воспроизведении
  // чтобы подхватывать изменения из Settings без перезагрузки
  const getSoundConfigs = () => loadSoundConfigs()

  const playSound = (category: string) => {
    initAudio()
    playAlertSound(category as SoundCategory, getSoundConfigs())
  }

  const { permission: notifyPermission, requestPermission, notify, resetToday } = usePushNotifications({
    enabled: notifyEnabled,
    enabledCategories,
  })

  // Load cameras — refresh every 5s so new cameras appear automatically
  useEffect(() => {
    const loadCameras = () => {
      apiFetch<Camera[]>('/cameras').then(data => {
        setCameras(data)
        setSelectedCameraId(prev => {
          if (prev === null && data.length > 0) return data[0].id
          if (prev !== null && data.some(c => c.id === prev)) return prev
          return data.length > 0 ? data[0].id : null
        })
      }).catch(() => {})
    }
    loadCameras()
    const t = setInterval(loadCameras, 5000)
    return () => clearInterval(t)
  }, [])

  // Load recent events — обновляем при старте и при получении алерта
  const fetchRecentEvents = useCallback(() => {
    apiFetch<KrakenEvent[]>('/events?limit=50')
      .then(setRecentEvents)
      .catch(err => {
        console.debug('Failed to load events:', err)
      })
  }, [])

  useEffect(() => {
    fetchRecentEvents()
    // Polling каждые 10 секунд как fallback
    const t = setInterval(fetchRecentEvents, 10000)
    return () => clearInterval(t)
  }, [fetchRecentEvents])

  // Security WebSocket for alerts + event refresh
  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(`${WS_BASE}/ws/security`)
      wsRef.current = ws

      ws.onmessage = (e) => {
    try {
      const data = e.data
      if (data === 'pong') {
        // Игнорируем ответ на ping
        return
      }
      const msg = JSON.parse(data)
      if (msg.type === 'ALERT') {
        const alert = msg as AlertMessage
        clientLogger.info('Получен алерт', { category: alert.category, person: alert.person_name })
        setCurrentAlert(alert)
        setAlertHistory(prev => [alert, ...prev.slice(0, 49)])
        if (alert.category === 'BLACKLIST') playSound('BLACKLIST')
        else if (alert.category === 'VIP') playSound('VIP')
        else if (alert.category === 'RESPONSE') playSound('RESPONSE')
        else if (alert.category === 'SECURITY') playSound('SECURITY')
        // Push-уведомление
        notify(alert)
        // Обновляем ленту событий при алерте
        fetchRecentEvents()
      } else if (msg.type === 'EVENT') {
        // Обычное распознавание (CLIENT/STAFF) — обновляем ленту
        fetchRecentEvents()
      }
    } catch (err) {
      clientLogger.error(err as Error, { context: 'WebSocket message' })
    }
  }

      ws.onclose = () => setTimeout(connect, 3000)

      const ping = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('ping')
      }, 5000)

      return () => { clearInterval(ping); ws.close() }
    }

    const cleanup = connect()
    return cleanup
  }, [])

  const handleAlert = useCallback((category: 'VIP' | 'BLACKLIST' | 'RESPONSE' | 'SECURITY', personName: string) => {
    const alert: AlertMessage = {
      type: 'ALERT',
      category,
      person_id: 0,
      person_name: personName,
      camera_id: selectedCameraId ?? 0,
      confidence: 1.0,
      timestamp: new Date().toISOString(),
    }
    setCurrentAlert(alert)
    setAlertHistory(prev => [alert, ...prev.slice(0, 49)])
    if (category === 'BLACKLIST') playSound('BLACKLIST')
    else if (category === 'VIP') playSound('VIP')
    else if (category === 'RESPONSE') playSound('RESPONSE')
    else if (category === 'SECURITY') playSound('SECURITY')
    notify(alert)
  }, [selectedCameraId, notify])

  // W/Ц recording handlers moved entirely to LiveMonitor.tsx
  // to avoid duplicate triggers (was calling both App.tsx and LiveMonitor.tsx)

  const goToEvents = useCallback(() => setPage('events'), [])
  const goToPeople = useCallback(() => setPage('people'), [])

  const renderPage = () => {
    switch (page) {
      case 'live':
        return (
          <LiveMonitor
            cameras={cameras}
            selectedCameraId={selectedCameraId}
            onSelectCamera={setSelectedCameraId}
            recentEvents={recentEvents}
            onLatestFace={setLatestFace}
            onNavigateEvents={goToEvents}
            onNavigatePeople={goToPeople}
          />
        )
      case 'multicam':
        return (
          <MultiCamera
            cameras={cameras}
            recentEvents={recentEvents}
            onLatestFace={setLatestFace}
          />
        )
      case 'people':
        return <People />
      case 'chronicle':
        return <Chronicle />
      case 'recordings':
        return <SmartRecording />
      case 'events':
        return <Events />
      case 'cameras':
        return <Cameras />
      case 'requirements':
        return <Requirements />
      case 'settings':
      case 'users':
      case 'notifications':
        return <Settings />
      case 'categories':
        return <Categories />
      default:
        return (
          <LiveMonitor
            cameras={cameras}
            selectedCameraId={selectedCameraId}
            onSelectCamera={setSelectedCameraId}
            recentEvents={recentEvents}
            onLatestFace={setLatestFace}
            onNavigateEvents={goToEvents}
            onNavigatePeople={goToPeople}
          />
        )
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-kraken-base">
      <Sidebar
        currentPage={page}
        onNavigate={setPage}
        onProjection={() => setShowProjection(p => !p)}
        projectionActive={showProjection}
      />

      <div className="flex-1 flex flex-col overflow-hidden relative">
        <TopBar
          cameras={cameras}
          selectedCameraId={selectedCameraId}
          onSelectCamera={setSelectedCameraId}
          alertCount={alertHistory.length}
          onOpenAlerts={() => setPage('events')}
          releaseButton={
            <ReleaseButton
              selectedCameraId={selectedCameraId}
              latestFace={latestFace}
              onAlert={handleAlert}
            />
          }
        />

        {isManualRecording && (
          <div className="absolute top-[4.5rem] right-6 flex items-center gap-2 bg-red-600/90 text-white px-3 py-1.5 rounded-full shadow-[0_0_15px_rgba(220,38,38,0.5)] z-50 animate-pulse font-bold text-sm tracking-widest backdrop-blur-sm border border-red-500/50">
            <div className="w-2.5 h-2.5 bg-white rounded-full"></div>
            ЗАПИСЬ ИДЕТ
          </div>
        )}

        <div className="flex-1 p-4 overflow-hidden">
          {renderPage()}
        </div>
      </div>

      <AlertPopup
        alert={currentAlert}
        onDismiss={() => setCurrentAlert(null)}
      />

      {showProjection && (
        <ProjectionPanel
          cameras={cameras}
          notifyPermission={notifyPermission}
          notifyEnabled={notifyEnabled}
          enabledCategories={enabledCategories}
          onNotifyToggle={() => {
            const next = !notifyEnabled
            setNotifyEnabled(next)
            localStorage.setItem('kraken_notify', String(next))
          }}
          onRequestPermission={async () => { await requestPermission() }}
          onResetToday={resetToday}
          onCategoriesChange={(cats) => {
            setEnabledCategories(new Set(cats))
            localStorage.setItem('kraken_notify_cats', JSON.stringify([...cats]))
          }}
          onClose={() => setShowProjection(false)}
        />
      )}
    </div>
  )
}

// Categories page is rendered inline in the main page switch
