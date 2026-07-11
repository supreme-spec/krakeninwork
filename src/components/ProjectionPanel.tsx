/**
 * ProjectionPanel — панель "Передать на экран".
 * Вкладки: Экран | Уведомления | Другой ПК
 *
 * Поддерживает неограниченное количество подключённых экранов —
 * каждый window.open() создаёт независимый WebSocket клиент.
 */
import { useState, useEffect } from 'react'
import {
  X, Monitor, Bell, BellOff, ExternalLink, Maximize2,
  RotateCcw, Clock, Wifi, Copy, Check, Globe, Smartphone,
  Plus, Eye, EyeOff,
} from 'lucide-react'
import type { Camera } from '../types'
import type { NotifyPermission } from '../hooks/usePushNotifications'
import { isShiftActive, nextShiftStart, currentShiftKey } from '../hooks/usePushNotifications'

// ── Все категории ─────────────────────────────────────────────────────────────
const ALL_CATEGORIES = [
  { id: 'BLACKLIST', label: 'Чёрный список', dot: 'bg-kraken-red'      },
  { id: 'RESPONSE',  label: 'Реагирование',  dot: 'bg-kraken-orange'   },
  { id: 'VIP',       label: 'VIP',           dot: 'bg-kraken-green'    },
  { id: 'SECURITY',  label: 'Охрана',        dot: 'bg-kraken-gold'     },
  { id: 'STAFF',     label: 'Персонал',      dot: 'bg-kraken-blue'     },
  { id: 'CLIENT',    label: 'Клиент',        dot: 'bg-kraken-muted'    },
  { id: 'UNKNOWN',   label: 'Неизвестен',    dot: 'bg-kraken-disabled' },
]

// ── Блоки экрана проекции ─────────────────────────────────────────────────────
const SCREEN_BLOCKS = [
  { id: 'video',      label: 'Видео с камеры',        icon: '📹' },
  { id: 'guest',      label: 'Последний гость',        icon: '⭐' },
  { id: 'recognized', label: 'Распознанный человек',   icon: '👤' },
  { id: 'events',     label: 'Последние события',      icon: '📋' },
  { id: 'people',     label: 'База людей',             icon: '👥' },
]

// ── Конфигурация одного экрана ────────────────────────────────────────────────
interface ScreenConfig {
  id: string
  name: string
  cameraId: number
  layout: 'full' | 'split'
  blocks: Set<string>
  win: Window | null
}

function makeDefaultConfig(cameras: Camera[], idx: number): ScreenConfig {
  return {
    id: `screen_${Date.now()}_${idx}`,
    name: `Экран ${idx + 1}`,
    cameraId: cameras[0]?.id ?? 0,
    layout: 'split',
    blocks: new Set(['video', 'guest', 'recognized', 'events']),
    win: null,
  }
}

type Tab = 'screen' | 'notify' | 'remote'

interface Props {
  cameras: Camera[]
  notifyPermission: NotifyPermission
  notifyEnabled: boolean
  enabledCategories: Set<string>
  onNotifyToggle: () => void
  onRequestPermission: () => void
  onResetToday: () => void
  onCategoriesChange: (cats: Set<string>) => void
  onClose: () => void
}

export default function ProjectionPanel({
  cameras,
  notifyPermission,
  notifyEnabled,
  enabledCategories,
  onNotifyToggle,
  onRequestPermission,
  onResetToday,
  onCategoriesChange,
  onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>('screen')
  const [copied, setCopied] = useState(false)

  // ── Несколько экранов ─────────────────────────────────────────────────────
  const [screens, setScreens] = useState<ScreenConfig[]>([
    makeDefaultConfig(cameras, 0),
  ])
  const [activeScreenIdx, setActiveScreenIdx] = useState(0)

  // Следим за закрытием окон
  useEffect(() => {
    const t = setInterval(() => {
      setScreens(prev => prev.map(s => {
        if (s.win && s.win.closed) return { ...s, win: null }
        return s
      }))
    }, 1000)
    return () => clearInterval(t)
  }, [])

  // Обновляем cameraId в конфигах когда загрузились камеры
  useEffect(() => {
    if (cameras.length === 0) return
    setScreens(prev => prev.map(s =>
      s.cameraId === 0 ? { ...s, cameraId: cameras[0].id } : s
    ))
  }, [cameras])

  // ── Уведомления ───────────────────────────────────────────────────────────
  const [shiftCount, setShiftCount] = useState(() => {
    try {
      const raw = localStorage.getItem(currentShiftKey())
      return raw ? JSON.parse(raw).length : 0
    } catch { return 0 }
  })
  const [shiftActive, setShiftActive] = useState(isShiftActive())
  const [nextShift, setNextShift] = useState(nextShiftStart())
  useEffect(() => {
    const t = setInterval(() => {
      setShiftActive(isShiftActive())
      setNextShift(nextShiftStart())
    }, 60_000)
    return () => clearInterval(t)
  }, [])

  // ── Helpers ───────────────────────────────────────────────────────────────
  const activeScreen = screens[activeScreenIdx] ?? screens[0]

  const updateScreen = (idx: number, patch: Partial<ScreenConfig>) => {
    setScreens(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s))
  }

  const toggleBlock = (idx: number, blockId: string) => {
    const s = screens[idx]
    const next = new Set(s.blocks)
    if (next.has(blockId)) next.delete(blockId)
    else next.add(blockId)
    updateScreen(idx, { blocks: next })
  }

  const buildUrl = (s: ScreenConfig) => {
    const blocksStr = [...s.blocks].join(',')
    return `${window.location.origin}/?screen=1&camera=${s.cameraId}&blocks=${blocksStr}&layout=${s.layout}`
  }

  const openScreen = (idx: number) => {
    const s = screens[idx]
    const url = buildUrl(s)
    const w = window.open(url, `kraken-screen-${s.id}`,
      'width=1920,height=1080,menubar=no,toolbar=no,location=no,status=no,scrollbars=no')
    if (w) updateScreen(idx, { win: w })
  }

  const closeScreen = (idx: number) => {
    screens[idx].win?.close()
    updateScreen(idx, { win: null })
  }

  const addScreen = () => {
    const newScreen = makeDefaultConfig(cameras, screens.length)
    setScreens(prev => [...prev, newScreen])
    setActiveScreenIdx(screens.length)
  }

  const removeScreen = (idx: number) => {
    screens[idx].win?.close()
    setScreens(prev => prev.filter((_, i) => i !== idx))
    setActiveScreenIdx(Math.max(0, idx - 1))
  }

  // ── Remote ────────────────────────────────────────────────────────────────
  const currentHost = window.location.hostname  // localhost или реальный IP
  const port = window.location.port || '3000'
  const isLocalhost = currentHost === 'localhost' || currentHost === '127.0.0.1'

  // Если открыто через localhost — показываем подсказку что нужен IP
  // Если открыто через IP — используем его напрямую
  const remoteUrl = activeScreen
    ? buildUrl(activeScreen).replace(window.location.origin, `http://${currentHost}:${port}`)
    : ''
  const backendUrl = `http://${currentHost}:8000`

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-start pointer-events-none">
      <div className="absolute inset-0 bg-black/40 pointer-events-auto" onClick={onClose} />

      <div className="relative pointer-events-auto w-96 mb-0 ml-56 animate-slide-up">
        <div className="panel border-t-0 rounded-t-2xl rounded-b-none shadow-2xl overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <div className="flex items-center gap-2.5">
              <Monitor size={17} className="text-kraken-purple" />
              <span className="text-kraken-text font-bold text-sm">Передать на экран</span>
            </div>
            <button onClick={onClose} className="text-kraken-muted hover:text-kraken-text">
              <X size={16} />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 px-5 pb-3">
            {([
              { id: 'screen', label: 'Экраны',       icon: Monitor    },
              { id: 'notify', label: 'Уведомления',  icon: Bell       },
              { id: 'remote', label: 'Другой ПК',    icon: Wifi       },
            ] as { id: Tab; label: string; icon: React.ElementType }[]).map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setTab(id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  tab === id ? 'bg-kraken-purple text-white' : 'bg-kraken-hover text-kraken-muted hover:text-kraken-text'
                }`}>
                <Icon size={12} />{label}
              </button>
            ))}
          </div>

          <div className="px-5 pb-5 max-h-[75vh] overflow-y-auto space-y-4">

            {/* ══ Вкладка: Экраны ══ */}
            {tab === 'screen' && (
              <>
                {/* Список экранов */}
                <div className="flex items-center justify-between">
                  <span className="text-kraken-muted text-xs uppercase tracking-widest">Экраны</span>
                  <button onClick={addScreen}
                    className="flex items-center gap-1 text-kraken-purple hover:text-kraken-purple-hover text-xs transition-colors">
                    <Plus size={12} /> Добавить экран
                  </button>
                </div>

                {/* Табы экранов */}
                <div className="flex gap-1 flex-wrap">
                  {screens.map((s, i) => (
                    <button key={s.id} onClick={() => setActiveScreenIdx(i)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors ${
                        activeScreenIdx === i
                          ? 'bg-kraken-purple/20 text-kraken-purple border border-kraken-purple/40'
                          : 'bg-kraken-hover text-kraken-muted hover:text-kraken-text'
                      }`}>
                      {s.win && !s.win.closed && (
                        <span className="w-1.5 h-1.5 rounded-full bg-kraken-green animate-pulse" />
                      )}
                      {s.name}
                      {screens.length > 1 && (
                        <span onClick={e => { e.stopPropagation(); removeScreen(i) }}
                          className="ml-0.5 text-kraken-disabled hover:text-kraken-red transition-colors">
                          <X size={10} />
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {activeScreen && (
                  <>
                    {/* Название */}
                    <div>
                      <label className="text-kraken-disabled text-xs mb-1 block">Название</label>
                      <input
                        type="text"
                        value={activeScreen.name}
                        onChange={e => updateScreen(activeScreenIdx, { name: e.target.value })}
                        className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-sm px-3 py-1.5 rounded-lg focus:outline-none focus:border-kraken-purple"
                      />
                    </div>

                    {/* Камера */}
                    <div>
                      <label className="text-kraken-disabled text-xs mb-1 block">Камера</label>
                      <select
                        value={activeScreen.cameraId}
                        onChange={e => updateScreen(activeScreenIdx, { cameraId: Number(e.target.value) })}
                        className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple"
                      >
                        {cameras.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>

                    {/* Layout */}
                    <div>
                      <label className="text-kraken-disabled text-xs mb-1.5 block">Макет</label>
                      <div className="flex gap-2">
                        {([
                          { id: 'split', label: 'Видео + блоки', desc: 'Видео слева, панель справа' },
                          { id: 'full',  label: 'Только видео',  desc: 'На весь экран' },
                        ] as { id: 'full' | 'split'; label: string; desc: string }[]).map(({ id, label, desc }) => (
                          <button key={id}
                            onClick={() => updateScreen(activeScreenIdx, { layout: id })}
                            className={`flex-1 px-2 py-2 rounded-lg text-xs text-left transition-colors border ${
                              activeScreen.layout === id
                                ? 'bg-kraken-purple/20 border-kraken-purple/50 text-kraken-purple'
                                : 'bg-kraken-hover border-kraken-border text-kraken-muted hover:text-kraken-text'
                            }`}>
                            <div className="font-semibold">{label}</div>
                            <div className="text-[10px] opacity-70 mt-0.5">{desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Блоки */}
                    <div>
                      <label className="text-kraken-disabled text-xs mb-1.5 block">Блоки на экране</label>
                      <div className="space-y-1.5">
                        {SCREEN_BLOCKS.map(({ id, label, icon }) => {
                          const on = activeScreen.blocks.has(id)
                          const disabled = id === 'video' // видео всегда есть
                          return (
                            <label key={id}
                              className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                                on ? 'bg-kraken-hover border border-kraken-border' : 'hover:bg-kraken-hover/50 border border-transparent'
                              } ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
                              <input
                                type="checkbox"
                                checked={on}
                                disabled={disabled}
                                onChange={() => !disabled && toggleBlock(activeScreenIdx, id)}
                                className="w-3.5 h-3.5 accent-purple-500 flex-shrink-0"
                              />
                              <span className="text-base">{icon}</span>
                              <span className="text-kraken-text text-sm flex-1">{label}</span>
                              {on ? <Eye size={13} className="text-kraken-green" /> : <EyeOff size={13} className="text-kraken-disabled" />}
                            </label>
                          )
                        })}
                      </div>
                      {activeScreen.layout === 'full' && (activeScreen.blocks.has('recognized') || activeScreen.blocks.has('events')) && (
                        <p className="text-kraken-disabled text-[11px] mt-1.5">
                          В режиме "Только видео" боковые блоки скрыты.
                        </p>
                      )}
                    </div>

                    {/* Кнопки управления */}
                    {!activeScreen.win || activeScreen.win.closed ? (
                      <button onClick={() => openScreen(activeScreenIdx)}
                        disabled={cameras.length === 0}
                        className="w-full flex items-center justify-center gap-2 bg-kraken-purple hover:bg-kraken-purple-hover text-white py-2.5 rounded-lg font-semibold text-sm transition-colors disabled:opacity-40">
                        <ExternalLink size={14} /> Открыть экран
                      </button>
                    ) : (
                      <div className="flex gap-2">
                        <button onClick={() => activeScreen.win?.focus()}
                          className="flex-1 flex items-center justify-center gap-1.5 bg-kraken-green/10 hover:bg-kraken-green/20 text-kraken-green py-2 rounded-lg text-sm transition-colors">
                          <Maximize2 size={13} /> Перейти
                        </button>
                        <button onClick={() => closeScreen(activeScreenIdx)}
                          className="flex-1 flex items-center justify-center gap-1.5 bg-kraken-red/10 hover:bg-kraken-red/20 text-kraken-red py-2 rounded-lg text-sm transition-colors">
                          <X size={13} /> Закрыть
                        </button>
                      </div>
                    )}

                    {activeScreen.win && !activeScreen.win.closed && (
                      <div className="flex items-center gap-1.5 text-kraken-green text-xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-kraken-green animate-pulse" />
                        Активен — перетащите на второй монитор и нажмите F11
                      </div>
                    )}
                  </>
                )}

                <p className="text-kraken-disabled text-xs leading-relaxed">
                  Можно открыть неограниченное количество экранов — на разных мониторах, ПК или телефонах.
                </p>
              </>
            )}

            {/* ══ Вкладка: Уведомления ══ */}
            {tab === 'notify' && (
              <>
                {notifyPermission === 'default' && (
                  <button onClick={onRequestPermission}
                    className="w-full flex items-center justify-center gap-2 bg-kraken-blue/10 hover:bg-kraken-blue/20 text-kraken-blue py-2.5 rounded-lg text-sm font-semibold transition-colors">
                    <Bell size={14} /> Разрешить уведомления
                  </button>
                )}
                {notifyPermission === 'granted' && (
                  <button onClick={onNotifyToggle}
                    className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                      notifyEnabled
                        ? 'bg-kraken-green/10 hover:bg-kraken-green/20 text-kraken-green'
                        : 'bg-kraken-hover hover:bg-kraken-border text-kraken-muted'
                    }`}>
                    {notifyEnabled ? <Bell size={14} /> : <BellOff size={14} />}
                    {notifyEnabled ? 'Уведомления включены' : 'Уведомления выключены'}
                  </button>
                )}
                {notifyPermission === 'denied' && (
                  <div className="text-kraken-red text-xs bg-kraken-red/10 px-3 py-2 rounded-lg">
                    Заблокированы браузером. Разрешите через 🔒 в адресной строке.
                  </div>
                )}

                {/* Выбор категорий */}
                <div>
                  <div className="text-kraken-muted text-xs uppercase tracking-widest mb-2">
                    Уведомлять при появлении
                  </div>
                  <div className="space-y-1.5">
                    {ALL_CATEGORIES.map(({ id, label, dot }) => (
                      <label key={id}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                          enabledCategories.has(id)
                            ? 'bg-kraken-hover border border-kraken-border'
                            : 'hover:bg-kraken-hover/50 border border-transparent'
                        }`}>
                        <input type="checkbox" checked={enabledCategories.has(id)}
                          onChange={() => {
                            const next = new Set(enabledCategories)
                            if (next.has(id)) next.delete(id); else next.add(id)
                            onCategoriesChange(next)
                          }}
                          className="w-3.5 h-3.5 accent-purple-500 flex-shrink-0" />
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
                        <span className="text-kraken-text text-sm flex-1">{label}</span>
                        {enabledCategories.has(id) && (
                          <span className="text-kraken-disabled text-[10px]">1 раз/смена</span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Статус смены */}
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
                  shiftActive ? 'bg-kraken-green/10 text-kraken-green' : 'bg-kraken-hover text-kraken-muted'
                }`}>
                  <Clock size={12} />
                  {shiftActive ? 'Смена активна (21:00 → 09:00)'
                    : nextShift ? `Смена начнётся в ${nextShift}` : 'Вне смены'}
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-kraken-disabled text-xs">
                    Уведомлений за смену: <strong className="text-kraken-text">{shiftCount}</strong>
                  </span>
                  <button onClick={() => { onResetToday(); setShiftCount(0) }}
                    className="flex items-center gap-1 text-kraken-disabled hover:text-kraken-muted text-xs transition-colors">
                    <RotateCcw size={11} /> сброс
                  </button>
                </div>

                <p className="text-kraken-disabled text-[11px] leading-relaxed">
                  Один человек — одно уведомление за смену (21:00–09:00). Сброс автоматически при начале новой смены.
                </p>
              </>
            )}

            {/* ══ Вкладка: Другой ПК ══ */}
            {tab === 'remote' && (
              <>
                {/* Выбор конфига для ссылки */}
                {screens.length > 1 && (
                  <div>
                    <label className="text-kraken-disabled text-xs mb-1 block">Конфигурация экрана</label>
                    <select
                      value={activeScreenIdx}
                      onChange={e => setActiveScreenIdx(Number(e.target.value))}
                      className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple"
                    >
                      {screens.map((s, i) => <option key={s.id} value={i}>{s.name}</option>)}
                    </select>
                  </div>
                )}

                {/* Способ 1: Браузер */}
                <div className="bg-kraken-hover rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-2 text-kraken-text text-xs font-semibold">
                    <Globe size={13} className="text-kraken-purple" />
                    Способ 1 — Браузер (рекомендуется)
                  </div>

                  {isLocalhost ? (
                    <>
                      <div className="bg-kraken-orange/10 border border-kraken-orange/30 rounded-lg px-3 py-2">
                        <p className="text-kraken-orange text-xs leading-relaxed">
                          ⚠ Вы открыли через <strong>localhost</strong> — с другого ПК это не работает.
                          Введите IP вашего компьютера в сети:
                        </p>
                      </div>
                      <IpUrlBuilder
                        port={port}
                        buildUrl={(ip) => activeScreen
                          ? buildUrl(activeScreen).replace(window.location.origin, `http://${ip}:${port}`)
                          : `http://${ip}:${port}`
                        }
                      />
                    </>
                  ) : (
                    <>
                      <p className="text-kraken-disabled text-xs leading-relaxed">
                        Откройте на любом устройстве в той же сети:
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 bg-kraken-base text-kraken-green text-[11px] px-2 py-1.5 rounded-lg font-mono break-all">
                          {remoteUrl}
                        </code>
                        <button onClick={() => copyUrl(remoteUrl)}
                          className="flex-shrink-0 p-1.5 rounded-lg bg-kraken-base hover:bg-kraken-border text-kraken-muted hover:text-kraken-text transition-colors"
                          title="Скопировать ссылку">
                          {copied ? <Check size={13} className="text-kraken-green" /> : <Copy size={13} />}
                        </button>
                      </div>
                      <SendNotificationButton url={remoteUrl} />
                    </>
                  )}

                  <p className="text-kraken-disabled text-[11px]">
                    Неограниченное количество устройств. F11 — полный экран.
                  </p>
                </div>

                {/* Способ 2: WebSocket */}
                <div className="bg-kraken-hover rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-2 text-kraken-text text-xs font-semibold">
                    <Wifi size={13} className="text-kraken-blue" />
                    Способ 2 — WebSocket API
                  </div>
                  <div className="space-y-1.5">
                    <div>
                      <div className="text-kraken-disabled text-[10px] mb-0.5">Алерты и события:</div>
                      <code className="block bg-kraken-base text-kraken-blue text-[11px] px-2 py-1.5 rounded-lg font-mono break-all">
                        ws://{currentHost}:8000/ws/security
                      </code>
                    </div>
                    <div>
                      <div className="text-kraken-disabled text-[10px] mb-0.5">Видеопоток камеры {activeScreen?.cameraId}:</div>
                      <code className="block bg-kraken-base text-kraken-blue text-[11px] px-2 py-1.5 rounded-lg font-mono break-all">
                        ws://{currentHost}:8000/ws/camera/{activeScreen?.cameraId}
                      </code>
                    </div>
                  </div>
                  <p className="text-kraken-disabled text-[11px]">
                    Неограниченное количество клиентов. Формат: JSON. ALERT содержит category, person_name, camera_id.
                  </p>
                </div>

                {/* Способ 3: HTTP API */}
                <div className="bg-kraken-hover rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-2 text-kraken-text text-xs font-semibold">
                    <Smartphone size={13} className="text-kraken-orange" />
                    Способ 3 — HTTP API
                  </div>
                  <div className="space-y-1.5">
                    <div>
                      <div className="text-kraken-disabled text-[10px] mb-0.5">Последние события:</div>
                      <code className="block bg-kraken-base text-kraken-orange text-[11px] px-2 py-1.5 rounded-lg font-mono break-all">
                        GET {backendUrl}/api/events?limit=10
                      </code>
                    </div>
                    <div>
                      <div className="text-kraken-disabled text-[10px] mb-0.5">Статус системы:</div>
                      <code className="block bg-kraken-base text-kraken-orange text-[11px] px-2 py-1.5 rounded-lg font-mono break-all">
                        GET {backendUrl}/api/health
                      </code>
                    </div>
                  </div>
                  <p className="text-kraken-disabled text-[11px]">
                    Требуется: Authorization: Bearer &lt;token&gt;
                  </p>
                </div>

                <div className="bg-kraken-purple/10 border border-kraken-purple/30 rounded-xl p-3">
                  <p className="text-kraken-purple text-xs leading-relaxed">
                    💡 Брандмауэр Windows: разрешите входящие на порты 3000 и 8000, или оба устройства в одной Wi-Fi сети.
                  </p>
                </div>
              </>
            )}

          </div>
        </div>
      </div>
    </div>
  )
}

// ── Кнопка отправки уведомления со ссылкой ───────────────────────────────────

function SendNotificationButton({ url }: { url: string }) {
  const [state, setState] = useState<'idle' | 'sent' | 'denied' | 'unsupported'>('idle')

  const send = async () => {
    if (!('Notification' in window)) { setState('unsupported'); return }

    let perm = Notification.permission
    if (perm === 'default') perm = await Notification.requestPermission()
    if (perm === 'denied') { setState('denied'); return }

    try {
      const n = new Notification('🖥 Kraken — Открыть экран', {
        body: `Нажмите чтобы открыть трансляцию на этом устройстве`,
        icon: '/logo.jpg',
        tag: 'kraken-screen-link',
        requireInteraction: true,
      })
      n.onclick = () => { window.open(url, '_blank'); n.close() }
      setState('sent')
      setTimeout(() => setState('idle'), 4000)
    } catch { setState('idle') }
  }

  if (state === 'unsupported') return null

  return (
    <button
      onClick={send}
      disabled={state === 'sent' || state === 'denied'}
      className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-colors ${
        state === 'sent'
          ? 'bg-kraken-green/10 text-kraken-green cursor-default'
          : state === 'denied'
            ? 'bg-kraken-red/10 text-kraken-red cursor-default'
            : 'bg-kraken-purple/10 hover:bg-kraken-purple/20 text-kraken-purple'
      }`}
    >
      {state === 'sent'   ? <><Check size={12} /> Уведомление отправлено — нажмите на него на другом устройстве</>
       : state === 'denied' ? <>🔒 Уведомления заблокированы в браузере</>
       : <><Bell size={12} /> Отправить ссылку уведомлением на это устройство</>}
    </button>
  )
}

// ── Компонент ввода IP для формирования ссылки ────────────────────────────────

function IpUrlBuilder({ port, buildUrl }: {
  port: string
  buildUrl: (ip: string) => string
}) {
  const [ip, setIp] = useState('')
  const [copied, setCopied] = useState(false)

  const url = ip.trim() ? buildUrl(ip.trim()) : ''

  const copy = () => {
    if (!url) return
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={ip}
          onChange={e => setIp(e.target.value)}
          placeholder="192.168.1.100"
          className="flex-1 bg-kraken-base border border-kraken-border text-kraken-text text-xs px-2 py-1.5 rounded-lg focus:outline-none focus:border-kraken-purple font-mono"
        />
        <span className="text-kraken-disabled text-xs flex-shrink-0">:{port}</span>
      </div>
      <p className="text-kraken-disabled text-[10px]">
        Узнать IP: Win+R → cmd → <code className="font-mono">ipconfig</code> → IPv4 Address
      </p>
      {url && (
        <>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-kraken-base text-kraken-green text-[11px] px-2 py-1.5 rounded-lg font-mono break-all">
              {url}
            </code>
            <button onClick={copy}
              className="flex-shrink-0 p-1.5 rounded-lg bg-kraken-base hover:bg-kraken-border text-kraken-muted hover:text-kraken-text transition-colors">
              {copied ? <Check size={13} className="text-kraken-green" /> : <Copy size={13} />}
            </button>
          </div>
          <SendNotificationButton url={url} />
        </>
      )}
    </div>
  )
}
