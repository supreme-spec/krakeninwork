import { useState, useEffect, useRef } from 'react'
import { Trash2, RefreshCw } from 'lucide-react'
import type { KrakenEvent } from '../types'
import { apiFetch, PHOTO_BASE, wsUrl } from '../api/client'
import CategoryBadge from '../components/CategoryBadge'
import ConfirmModal from '../components/ConfirmModal'

// Remap ArcFace cosine similarity [0.28..0.85] → [0%..100%]
function cosineToPercent(cosine: number): number {
  const clamped = Math.max(0.28, Math.min(0.85, cosine))
  return Math.round(((clamped - 0.28) / (0.85 - 0.28)) * 100)
}

const EVENT_ICONS: Record<string, string> = {
  RECOGNIZED: '✅',
  UNKNOWN: '❓',
  BLACKLIST_ALERT: '🚨',
  VIP_ARRIVAL: '⭐',
}

const EVENT_LABELS: Record<string, string> = {
  RECOGNIZED: 'Распознан',
  UNKNOWN: 'Неизвестен',
  BLACKLIST_ALERT: 'Чёрный список',
  VIP_ARRIVAL: 'VIP прибыл',
}

const FILTER_OPTIONS = [
  { value: '', label: 'Все события' },
  { value: 'RECOGNIZED', label: 'Распознанные' },
  { value: 'UNKNOWN', label: 'Неизвестные' },
  { value: 'BLACKLIST_ALERT', label: 'Чёрный список' },
  { value: 'VIP_ARRIVAL', label: 'VIP визиты' },
]

export default function Events() {
  const [events, setEvents] = useState<KrakenEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [filterType, setFilterType] = useState('')
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const filterRef = useRef(filterType)
  useEffect(() => { filterRef.current = filterType }, [filterType])

  const fetchEvents = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '200' })
      if (filterRef.current) params.set('event_type', filterRef.current)
      const data = await apiFetch<KrakenEvent[]>(`/events?${params}`)
      setEvents(data)
    } catch (e) {
      console.error(e)
    } finally {
      if (!silent) setLoading(false)
    }
  }

  // Загружаем при монтировании и смене фильтра
  useEffect(() => { fetchEvents() }, [filterType])

  // Автообновление каждые 15 секунд (тихое)
  useEffect(() => {
    const t = setInterval(() => fetchEvents(true), 15000)
    return () => clearInterval(t)
  }, [])

  // WebSocket — мгновенное обновление при новых событиях
  useEffect(() => {
    const ws = new WebSocket(wsUrl("/ws/security"))
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'ALERT' || msg.type === 'EVENT') {
          fetchEvents(true)
        }
      } catch {}
    }
    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('ping')
    }, 5000)
    return () => { clearInterval(ping); ws.close() }
  }, [])

  // Обновляем при возврате на вкладку
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchEvents(true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const handleClear = async () => {
    setShowClearConfirm(false)
    await apiFetch('/events/clear', { method: 'DELETE' })
    fetchEvents()
  }

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="bg-kraken-panel border border-kraken-border text-kraken-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple"
        >
          {FILTER_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <button onClick={() => fetchEvents()} className="btn-ghost flex items-center gap-2">
          <RefreshCw size={14} />
          Обновить
        </button>

        <button onClick={() => setShowClearConfirm(true)} className="btn-danger flex items-center gap-2 ml-auto">
          <Trash2 size={14} />
          Очистить
        </button>
      </div>

      {/* Timeline */}
      <div className="panel flex-1 overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-kraken-border">
          <span className="text-kraken-text text-sm font-semibold">История событий</span>
          <span className="text-kraken-disabled text-xs ml-2">({events.length} записей)</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="text-center py-8 text-kraken-disabled">Загрузка...</div>
          )}
          {!loading && events.length === 0 && (
            <div className="text-center py-8 text-kraken-disabled">Событий нет</div>
          )}
          {events.map(ev => (
            <div
              key={ev.id}
              className={`flex items-center gap-4 px-4 py-3 border-b border-kraken-border hover:bg-kraken-hover transition-colors ${
                ev.event_type === 'BLACKLIST_ALERT' ? 'border-l-2 border-l-kraken-red' :
                ev.event_type === 'VIP_ARRIVAL' ? 'border-l-2 border-l-kraken-green' : ''
              }`}
            >
              {/* Icon */}
              <span className="text-xl flex-shrink-0">{EVENT_ICONS[ev.event_type] ?? '•'}</span>

              {/* Snapshot */}
              {ev.snapshot_path ? (
                <img
                  src={`${PHOTO_BASE}/${ev.snapshot_path}`}
                  alt=""
                  className="w-10 h-10 rounded-lg object-cover border border-kraken-border flex-shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-kraken-hover flex items-center justify-center text-lg flex-shrink-0">
                  👤
                </div>
              )}

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-kraken-text font-medium text-sm">
                    {ev.person_name ?? 'Неизвестен'}
                  </span>
                  {ev.person_category && <CategoryBadge category={ev.person_category} />}
                </div>
                <div className="text-kraken-disabled text-xs mt-0.5">
                  Камера {ev.camera_id ?? '?'} · {EVENT_LABELS[ev.event_type] ?? ev.event_type}
                </div>
              </div>

              {/* Confidence */}
              {ev.event_type !== 'UNKNOWN' && ev.confidence ? (
                <div className="text-xs text-kraken-purple font-semibold">
                  Совпадение: {cosineToPercent(ev.confidence)}%
                </div>
              ) : ev.event_type === 'UNKNOWN' ? (
                <div className="text-xs text-kraken-muted">
                  Лицо обнаружено
                </div>
              ) : null}

              {/* Operator confirmation actions */}
              {ev.needs_operator_confirmation && (
                <div className="flex items-center gap-2 border-l border-kraken-border pl-4 flex-shrink-0">
                  {ev.confirmation_status === 'pending' ? (
                    <>
                      <span className="text-amber-500 text-xs font-semibold px-2 py-1 bg-amber-500/10 rounded-md border border-amber-500/20 whitespace-nowrap">
                        Ожидает подтверждения
                      </span>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            await apiFetch(`/events/${ev.id}/confirm`, { method: 'POST' })
                            fetchEvents(true)
                          } catch (err) {
                            console.error(err)
                          }
                        }}
                        className="px-2 py-1 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-md transition-colors"
                      >
                        Подтвердить
                      </button>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            await apiFetch(`/events/${ev.id}/reject`, { method: 'POST' })
                            fetchEvents(true)
                          } catch (err) {
                            console.error(err)
                          }
                        }}
                        className="px-2 py-1 text-xs bg-rose-600 hover:bg-rose-500 text-white font-medium rounded-md transition-colors"
                      >
                        Удалить
                      </button>
                    </>
                  ) : (
                    <span className="text-emerald-500 text-xs font-medium px-2 py-1 bg-emerald-500/10 rounded-md border border-emerald-500/20 whitespace-nowrap">
                      Подтверждено
                    </span>
                  )}
                </div>
              )}

              {/* Time */}
              <span className="text-kraken-disabled text-xs flex-shrink-0">
                {new Date(ev.created_at).toLocaleString('ru-RU')}
              </span>
            </div>
          ))}
        </div>
      </div>

      <ConfirmModal
        isOpen={showClearConfirm}
        title="Очистить все события"
        message="Вы уверены, что хотите очистить всю историю событий? Это действие необратимо."
        confirmText="Очистить"
        isDamage={true}
        onConfirm={handleClear}
        onCancel={() => setShowClearConfirm(false)}
      />
    </div>
  )
}
