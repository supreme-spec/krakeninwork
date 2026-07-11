import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../api/client'
import { Activity, Database, Download, RefreshCw, FileText, Camera, AlertTriangle, Shield, Volume2, VolumeX, Upload, Play, Tag, Zap } from 'lucide-react'
import velesLogo from '../assets/images/veles_voyage_logo_1783510761883.jpg'
import ConfirmModal, { AlertModal } from '../components/ConfirmModal'
import {
  loadSoundConfigs, saveSoundConfigs, playAlertSound, initAudio,
  type SoundCategory, type SoundConfig,
} from '../hooks/useAlertSounds'
import { useCategories } from '../hooks/useCategories'
import type { Camera as CameraType } from '../types'

interface HealthData {
  status: string
  version: string
  cameras: Record<string, { status: string; fps: number }>
  faiss?: Record<string, number>
  faiss_index_types?: Record<string, string>
  ai_ready?: boolean
  recognition_threshold?: number
  recognition_threshold_pct?: number
  gpu_enabled?: boolean
  gpu_policy?: string
  gpu_available?: boolean
  gpu_detected?: boolean
  gpu_name?: string
  gpu_vendor?: string
  gpu_providers?: string[]
  recognition_provider?: string
  engine_mode?: string
  setup_ok?: boolean | null
  setup_errors?: string[]
  setup_warnings?: string[]
  setup_recommendation?: string
  onnx_version?: string
  onnx_package?: string
}

export default function Settings() {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [backupMsg, setBackupMsg] = useState('')
  const [backingUp, setBackingUp] = useState(false)
  const [restoreMsg, setRestoreMsg] = useState('')
  const [restoring, setRestoring] = useState(false)
  const [soundConfigs, setSoundConfigs] = useState(() => loadSoundConfigs())
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
  const [thresholdPct, setThresholdPct] = useState<number>(30)
  const [thresholdSaving, setThresholdSaving] = useState(false)
  const [thresholdMsg, setThresholdMsg] = useState('')

  // Категории из БД
  const { categories } = useCategories()
  const [activeCats, setActiveCats] = useState<Set<string>>(new Set())
  const [catsSaving, setCatsSaving] = useState(false)
  const [catsMsg, setCatsMsg] = useState('')
  const [downloadingModels, setDownloadingModels] = useState(false)
  const [modelsMsg, setModelsMsg] = useState('')
  const [reindexing, setReindexing] = useState(false)
  const [reindexMsg, setReindexMsg] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  // GPU
  const [gpuEnabled, setGpuEnabled] = useState(true)
  const [gpuSaving, setGpuSaving] = useState(false)
  const [gpuMsg, setGpuMsg] = useState('')
  const [simulatedGpu, setSimulatedGpu] = useState('nvidia')
  const [simulationEnabled, setSimulationEnabled] = useState(false)
  const [setupRunning, setSetupRunning] = useState(false)

  // ML Optimization
  const [embCacheEnabled, setEmbCacheEnabled] = useState(true)
  const [embCacheTtl, setEmbCacheTtl] = useState(30)
  const [faceQualityMin, setFaceQualityMin] = useState(0.10)
  const [adaptiveFrameSkip, setAdaptiveFrameSkip] = useState(true)
  const [faissIvfThreshold, setFaissIvfThreshold] = useState(1000)
  const [faissIvfNprobe, setFaissIvfNprobe] = useState(10)
  const [cameras, setCameras] = useState<CameraType[]>([])
  const [cameraPriorityWeights, setCameraPriorityWeights] = useState<Record<string, number>>({})
  const [mlSaving, setMlSaving] = useState(false)
  const [mlMsg, setMlMsg] = useState('')

  const fetchHealth = async () => {
    try {
      const data = await apiFetch<HealthData>('/health')
      setHealth(data)
      if (data.recognition_threshold_pct !== undefined) {
        setThresholdPct(data.recognition_threshold_pct)
      }
      if (data.gpu_enabled !== undefined) {
        setGpuEnabled(data.gpu_enabled)
      }
    } catch {}
    // Загружаем активные категории
    try {
      const cats = await apiFetch<{ active_categories: string[] }>('/settings/categories')
      setActiveCats(new Set(cats.active_categories))
    } catch {}
  }

  useEffect(() => {
    fetchHealth()
    fetchMlSettings()
    // Pause polling when tab is hidden — saves CPU and network
    const t = setInterval(() => {
      if (!document.hidden) fetchHealth()
    }, 5000)
    return () => clearInterval(t)
  }, [])

  // Инициализируем activeCats из категорий БД если ещё не загружено из API
  useEffect(() => {
    if (activeCats.size === 0 && categories.length > 0) {
      setActiveCats(new Set(categories.filter(c => c.detect_enabled).map(c => c.code)))
    }
  }, [categories])

  const handleSaveCats = async () => {
    setCatsSaving(true); setCatsMsg('')
    try {
      const res = await apiFetch<{ ok: boolean; active_categories: string[] }>(
        '/settings/categories', {
          method: 'POST',
          body: JSON.stringify([...activeCats]),
        }
      )
      setCatsMsg(`✅ Сохранено: ${res.active_categories.join(', ')}`)
    } catch (e: any) {
      setCatsMsg(`❌ ${e.message}`)
    } finally {
      setCatsSaving(false)
    }
  }

  const handleSaveThreshold = async () => {
    setThresholdSaving(true)
    setThresholdMsg('')
    try {
      const res = await apiFetch<{ ok: boolean; threshold_pct: number; threshold_cosine: number }>(
        `/settings/threshold?threshold_pct=${thresholdPct}`, { method: 'POST' }
      )
      setThresholdMsg(`✅ Порог установлен: ${res.threshold_pct}% (cosine ${res.threshold_cosine})`)
    } catch (e: any) {
      setThresholdMsg(`❌ ${e.message}`)
    } finally {
      setThresholdSaving(false)
    }
  }

  const handleReindexAll = async () => {
    setReindexing(true)
    setReindexMsg('')
    try {
      const res = await apiFetch<{ success: string[]; failed: any[]; no_photo: string[] }>(
        '/persons/reindex_all', { method: 'POST' }
      )
      setReindexMsg(`✅ Готово: ${res.success.length} обработано, ${res.failed.length} ошибок, ${res.no_photo.length} без фото`)
      fetchHealth()
    } catch (e: any) {
      setReindexMsg(`❌ ${e.message}`)
    } finally {
      setReindexing(false)
    }
  }

  const handleDownloadModels = async () => {
    setDownloadingModels(true)
    setModelsMsg('')
    try {
      const res = await apiFetch<{ ok: boolean; ai_ready: boolean }>('/ai/download_models', { method: 'POST' })
      setModelsMsg(res.ok && res.ai_ready ? '✅ Модели загружены, AI готов!' : '⚠ Загружено, но AI не инициализирован')
      fetchHealth()
    } catch (e: any) {
      setModelsMsg(`❌ ${e.message}`)
    } finally {
      setDownloadingModels(false)
    }
  }

  const handleRerunSetup = async () => {
    setSetupRunning(true)
    setGpuMsg('')
    try {
      const res = await apiFetch<{ ok: boolean; message: string; setup?: { errors?: string[] } }>(
        '/settings/setup/rerun', { method: 'POST' }
      )
      if (res.ok) {
        setGpuMsg(`✅ ${res.message}`)
      } else {
        const errs = res.setup?.errors?.join('; ') || res.message
        setGpuMsg(`❌ ${errs}`)
      }
      fetchHealth()
    } catch (e: any) {
      setGpuMsg(`❌ ${e.message}`)
    } finally {
      setSetupRunning(false)
    }
  }

  const fetchMlSettings = async () => {
    try {
      const s = await apiFetch<{
        embedding_cache_enabled: boolean
        embedding_cache_ttl_days: number
        face_quality_min_threshold: number
        ai_adaptive_frame_skip: boolean
        faiss_ivf_threshold: number
        faiss_ivf_nprobe: number
        camera_priority_weights: Record<string, number>
        simulated_gpu?: string
        simulation_enabled?: boolean
      }>('/settings/')
      setEmbCacheEnabled(s.embedding_cache_enabled)
      setEmbCacheTtl(s.embedding_cache_ttl_days)
      setFaceQualityMin(s.face_quality_min_threshold)
      setAdaptiveFrameSkip(s.ai_adaptive_frame_skip)
      setFaissIvfThreshold(s.faiss_ivf_threshold)
      setFaissIvfNprobe(s.faiss_ivf_nprobe)
      setCameraPriorityWeights(s.camera_priority_weights || {})
      if (s.simulated_gpu) {
        setSimulatedGpu(s.simulated_gpu)
      }
      if (s.simulation_enabled !== undefined) {
        setSimulationEnabled(s.simulation_enabled)
      }
    } catch {}
    // Загружаем список камер для UI весов
    try {
      const cams = await apiFetch<CameraType[]>('/cameras/')
      setCameras(cams)
    } catch {}
  }

  const handleSaveMl = async () => {
    setMlSaving(true)
    setMlMsg('')
    try {
      const res = await apiFetch<{ ok: boolean; updated: string[] }>('/settings/', {
        method: 'POST',
        body: JSON.stringify({
          embedding_cache_enabled: embCacheEnabled,
          embedding_cache_ttl_days: embCacheTtl,
          face_quality_min_threshold: faceQualityMin,
          ai_adaptive_frame_skip: adaptiveFrameSkip,
          faiss_ivf_threshold: faissIvfThreshold,
          faiss_ivf_nprobe: faissIvfNprobe,
          camera_priority_weights: cameraPriorityWeights,
        }),
      })
      setMlMsg(`✅ Сохранено: ${res.updated.join(', ')}`)
    } catch (e: any) {
      setMlMsg(`❌ ${e.message}`)
    } finally {
      setMlSaving(false)
    }
  }

  const handleToggleGpu = async (enabled: boolean) => {
    setGpuSaving(true)
    setGpuMsg('')
    try {
      const res = await apiFetch<{ ok: boolean; updated: string[]; message: string }>(
        '/settings/', {
          method: 'POST',
          body: JSON.stringify({ gpu_enabled: enabled }),
        }
      )
      setGpuEnabled(enabled)
      setGpuMsg(`✅ GPU ${enabled ? 'включён' : 'отключён'}. ${res.message}`)
      fetchHealth()
    } catch (e: any) {
      setGpuMsg(`❌ ${e.message}`)
    } finally {
      setGpuSaving(false)
    }
  }

  const handleSimulatedGpuChange = async (val: string) => {
    setSimulatedGpu(val)
    setGpuMsg('')
    try {
      const res = await apiFetch<{ ok: boolean; message: string }>('/settings/', {
        method: 'POST',
        body: JSON.stringify({ simulated_gpu: val }),
      })
      setGpuMsg(`✅ Видеокарта переключена на ${val.toUpperCase()}. ${res.message}`)
      fetchHealth()
    } catch (e: any) {
      setGpuMsg(`❌ ${e.message}`)
    }
  }

  const handleToggleSimulation = async (enabled: boolean) => {
    setSimulationEnabled(enabled)
    setGpuMsg('')
    try {
      const res = await apiFetch<{ ok: boolean; message: string }>('/settings/', {
        method: 'POST',
        body: JSON.stringify({ simulation_enabled: enabled }),
      })
      setGpuMsg(`✅ Симуляция ${enabled ? 'включена' : 'отключена'}. ${res.message}`)
    } catch (e: any) {
      setGpuMsg(`❌ ${e.message}`)
    }
  }



  const handleSyncCameras = async () => {    setSyncing(true)
    setSyncMsg('')
    try {
      const res = await apiFetch<{
        ok: boolean; stopped: number[]; started: number[]
        already_running: number[]; running_now: number[]
      }>('/cameras/sync', { method: 'POST' })
      const parts = []
      if (res.started.length) parts.push(`запущено: ${res.started.join(', ')}`)
      if (res.stopped.length) parts.push(`остановлено: ${res.stopped.join(', ')}`)
      if (res.already_running.length) parts.push(`уже работают: ${res.already_running.join(', ')}`)
      setSyncMsg(`✅ Синхронизировано. ${parts.join(' | ')}`)
      fetchHealth()
    } catch (e: any) {
      setSyncMsg(`❌ ${e.message}`)
    } finally {
      setSyncing(false)
    }
  }

  const handleBackup = async () => {
    setBackingUp(true)
    setBackupMsg('')
    try {
      const res = await apiFetch<{ ok: boolean; backup?: string; error?: string }>('/backup', { method: 'POST' })
      setBackupMsg(res.ok ? `✅ Резервная копия: ${res.backup}` : `❌ ${res.error}`)
    } catch (e: any) {
      setBackupMsg(`❌ ${e.message}`)
    } finally {
      setBackingUp(false)
    }
  }

  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.name.endsWith('.zip')) {
      setRestoreMsg('❌ Выберите ZIP файл бэкапа Kraken')
      return
    }

    setConfirmState({
      isOpen: true,
      title: 'Восстановление резервной копии',
      message: `Восстановить из файла "${file.name}"?\n\nБаза данных, фотографии и снимки будут заменены.\nТекущая БД будет сохранена в папку backups/ перед заменой.`,
      isDamage: true,
      onConfirm: async () => {
        setConfirmState(null)
        setRestoring(true)
        setRestoreMsg('')
        try {
          const token = localStorage.getItem('kraken_token')
          const fd = new FormData()
          fd.append('file', file)
          const res = await fetch('/api/backup/restore', {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: fd,
          })
          const data = await res.json()
          if (data.ok) {
            setRestoreMsg(`✅ ${data.message}`)
            // Перезагружаем страницу через 2 сек чтобы подтянуть новые данные
            setTimeout(() => window.location.reload(), 2000)
          } else {
            setRestoreMsg(`❌ ${data.message}${data.errors?.length ? '\n' + data.errors.join('\n') : ''}`)
          }
        } catch (err: any) {
          setRestoreMsg(`❌ ${err.message}`)
        } finally {
          setRestoring(false)
          // Сбрасываем input чтобы можно было выбрать тот же файл снова
          e.target.value = ''
        }
      }
    })
  }

  const statusColor = (s: string) => {
    if (s === 'online') return 'text-kraken-green'
    if (s === 'connecting' || s === 'reconnecting') return 'text-yellow-400'
    return 'text-kraken-red'
  }

  const statusLabel = (s: string) => {
    const map: Record<string, string> = { online: 'онлайн', offline: 'офлайн', connecting: 'подключение', reconnecting: 'переподключение' }
    return map[s] ?? s
  }

  return (
    <div className="h-full overflow-y-auto">
    <div className="max-w-2xl mx-auto flex flex-col gap-5 pb-8 p-4">
      <h1 className="text-kraken-text text-xl font-bold">Настройки</h1>

      {/* System health */}
      <div className="panel p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity size={18} className="text-kraken-green" />
            <span className="text-kraken-text font-semibold">Состояние системы</span>
          </div>
          <button onClick={fetchHealth} className="btn-ghost flex items-center gap-1.5 text-xs py-1 px-2">
            <RefreshCw size={12} />
            Обновить
          </button>
        </div>
        {health ? (
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-kraken-muted">Статус</span>
              <span className="text-kraken-green font-bold">{health.status === 'ok' ? 'РАБОТАЕТ' : health.status.toUpperCase()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-kraken-muted">Версия</span>
              <span className="text-kraken-text">Kraken {health.version}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-kraken-muted">Бэкенд</span>
              <span className="text-kraken-green">{window.location.origin}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-kraken-muted">WebSocket</span>
              <span className="text-kraken-green">{window.location.origin.replace('http', 'ws')}</span>
            </div>
            {Object.entries(health.cameras).length > 0 && (
              <div className="mt-2 border-t border-kraken-border pt-2">
                <div className="text-kraken-muted text-xs mb-2">Камеры</div>
                {Object.entries(health.cameras).map(([id, info]) => (
                  <div key={id} className="flex justify-between text-xs">
                    <span className="text-kraken-muted">Камера {id}</span>
                    <span className={statusColor(info.status)}>
                      {statusLabel(info.status)} · {info.fps} FPS
                    </span>
                  </div>
                ))}
              </div>
            )}
            {health.faiss && Object.keys(health.faiss).length > 0 && (
              <div className="mt-2 border-t border-kraken-border pt-2">
                <div className="text-kraken-muted text-xs mb-2">База лиц (FAISS)</div>
                {Object.entries(health.faiss).map(([cat, count]) => (
                  <div key={cat} className="flex justify-between text-xs">
                    <span className="text-kraken-muted">{cat}</span>
                    <span className="text-kraken-text font-bold">
                      {count} эмбеддингов
                      {health.faiss_index_types?.[cat] && (
                        <span className="text-kraken-muted font-normal ml-1">
                          ({health.faiss_index_types[cat]})
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="text-kraken-disabled text-sm">Подключение к бэкенду...</div>
        )}
      </div>

      {/* ── Управление детектированием по категориям ── */}
      <div className="panel p-5">
        <div className="flex items-center gap-2 mb-4">
          <Shield size={18} className="text-kraken-blue" />
          <span className="text-kraken-text font-semibold">Детектирование по категориям</span>
          <a href="#" onClick={e => { e.preventDefault(); window.dispatchEvent(new CustomEvent('navigate', { detail: 'categories' })) }}
            className="ml-auto text-kraken-purple text-xs flex items-center gap-1 hover:underline">
            <Tag size={11} /> Управление категориями
          </a>
        </div>
        <p className="text-kraken-muted text-sm mb-4">
          Включите или отключите реакцию системы на каждую категорию.
          Отключённые категории: человек распознаётся, но сигнал, событие и алерт не создаются.
        </p>

        <div className="space-y-2 mb-4">
          {categories.map(cat => {
            const on = activeCats.has(cat.code)
            return (
              <label key={cat.code}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-colors border ${
                  on ? 'bg-kraken-hover border-kraken-border' : 'bg-kraken-base border-transparent opacity-60'
                }`}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => {
                    const next = new Set(activeCats)
                    if (next.has(cat.code)) next.delete(cat.code); else next.add(cat.code)
                    setActiveCats(next)
                  }}
                  className="w-4 h-4 accent-purple-500 flex-shrink-0"
                />
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                <div className="flex-1 min-w-0">
                  <div className="text-kraken-text text-sm font-semibold">{cat.label}</div>
                  <div className="text-kraken-disabled text-xs">
                    {cat.is_alert ? '🔔 Алерт при обнаружении' : 'Без алерта'} · {cat.alert_sound !== 'off' ? `Звук: ${cat.alert_sound}` : 'Без звука'}
                  </div>
                </div>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                  on ? 'bg-kraken-green/10 text-kraken-green' : 'bg-kraken-hover text-kraken-disabled'
                }`}>
                  {on ? 'Активно' : 'Выкл'}
                </span>
              </label>
            )
          })}
        </div>

        <div className="flex items-center gap-3">
          <button onClick={handleSaveCats} disabled={catsSaving}
            className="btn-primary flex items-center gap-2">
            <RefreshCw size={14} className={catsSaving ? 'animate-spin' : ''} />
            {catsSaving ? 'Применяю...' : 'Применить'}
          </button>
          <button onClick={() => setActiveCats(new Set(categories.map(c => c.code)))}
            className="btn-ghost text-sm">
            Включить все
          </button>
          <button onClick={() => setActiveCats(new Set())}
            className="btn-ghost text-sm text-kraken-muted">
            Выключить все
          </button>
        </div>

        {catsMsg && (
          <div className={`mt-3 text-xs p-2 rounded ${
            catsMsg.startsWith('✅') ? 'text-kraken-green bg-kraken-green/10' : 'text-kraken-red bg-kraken-red/10'
          }`}>{catsMsg}</div>
        )}
      </div>

      {/* ── Чувствительность распознавания ── */}
      <div className="panel p-5">
        <div className="flex items-center gap-2 mb-4">
          <Activity size={18} className="text-kraken-purple" />
          <span className="text-kraken-text font-semibold">Чувствительность распознавания</span>
          <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${
            thresholdPct < 20 ? 'bg-kraken-red/20 text-kraken-red' :
            thresholdPct < 35 ? 'bg-yellow-400/20 text-yellow-400' :
            thresholdPct < 60 ? 'bg-kraken-green/20 text-kraken-green' :
            'bg-kraken-blue/20 text-kraken-blue'
          }`}>
            {thresholdPct < 20 ? 'Очень мягко' :
             thresholdPct < 35 ? 'Мягко' :
             thresholdPct < 60 ? 'Оптимально' : 'Строго'}
          </span>
        </div>

        <p className="text-kraken-muted text-sm mb-4">
          Минимальный процент совпадения для распознавания человека.
          Ниже порога — человек считается неизвестным, сигнал не подаётся.
        </p>

        {/* Ползунок */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-kraken-disabled text-xs">0% — любое совпадение</span>
            <span className="text-kraken-text font-bold text-lg tabular-nums">{thresholdPct}%</span>
            <span className="text-kraken-disabled text-xs">100% — точное совпадение</span>
          </div>
          <input
            type="range" min={0} max={100} step={1}
            value={thresholdPct}
            onChange={e => setThresholdPct(Number(e.target.value))}
            className="w-full h-2 rounded-full accent-purple-500 cursor-pointer"
            style={{
              background: `linear-gradient(to right, #7B61FF ${thresholdPct}%, #1F2A36 ${thresholdPct}%)`
            }}
          />
          {/* Метки */}
          <div className="flex justify-between text-[10px] text-kraken-disabled mt-1">
            <span>0</span>
            <span className="text-kraken-red">25 — мин. рекомендуемый</span>
            <span className="text-kraken-green">35-50 — оптимально</span>
            <span>100</span>
          </div>
        </div>

        {/* Пояснение текущего значения */}
        <div className="bg-kraken-hover rounded-xl p-3 mb-4 text-sm">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-kraken-muted">Текущий порог:</span>
            <span className="text-kraken-purple font-bold">{thresholdPct}%</span>
            <span className="text-kraken-disabled text-xs">
              (cosine {(thresholdPct / 100).toFixed(3)})
            </span>
          </div>
          <p className="text-kraken-disabled text-xs leading-relaxed">
            {thresholdPct < 20
              ? '⚠ Очень низкий порог — много ложных распознаваний. Незнакомые люди могут совпасть с базой.'
              : thresholdPct < 35
              ? '⚡ Мягкий порог — хорошо для тёмных условий и плохих фото. Возможны редкие ложные совпадения.'
              : thresholdPct < 60
              ? '✅ Оптимальный диапазон — баланс между точностью и пропусками. Рекомендуется для ночного клуба.'
              : '🔒 Строгий порог — минимум ложных совпадений, но система может не узнать человека при плохом освещении.'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSaveThreshold}
            disabled={thresholdSaving}
            className="btn-primary flex items-center gap-2"
          >
            <RefreshCw size={14} className={thresholdSaving ? 'animate-spin' : ''} />
            {thresholdSaving ? 'Применяю...' : 'Применить'}
          </button>
          <button
            onClick={() => setThresholdPct(30)}
            className="btn-ghost text-sm"
          >
            Сбросить (30%)
          </button>
        </div>

        {thresholdMsg && (
          <div className={`mt-3 text-xs p-2 rounded ${
            thresholdMsg.startsWith('✅')
              ? 'text-kraken-green bg-kraken-green/10'
              : 'text-kraken-red bg-kraken-red/10'
          }`}>
            {thresholdMsg}
          </div>
        )}

        {/* Таблица рекомендаций */}
        <div className="mt-4 border-t border-kraken-border pt-4">
          <div className="text-kraken-disabled text-[10px] uppercase tracking-widest mb-2">Рекомендуемые значения</div>
          <div className="space-y-1.5">
            {[
              { pct: '20–25%', label: 'Плохое освещение, старые фото', color: 'text-yellow-400', dot: 'bg-yellow-400', note: 'Больше ложных совпадений' },
              { pct: '30–35%', label: 'Ночной клуб — стандарт', color: 'text-kraken-green', dot: 'bg-kraken-green', note: 'Оптимальный баланс ✓' },
              { pct: '40–50%', label: 'Хорошее освещение, качественные фото', color: 'text-kraken-blue', dot: 'bg-kraken-blue', note: 'Меньше ложных, больше пропусков' },
              { pct: '55–70%', label: 'Максимальная точность', color: 'text-kraken-purple', dot: 'bg-kraken-purple', note: 'Только при идеальных условиях' },
            ].map(({ pct, label, color, dot, note }) => (
              <div key={pct} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-kraken-hover">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
                <span className={`text-xs font-bold w-16 flex-shrink-0 ${color}`}>{pct}</span>
                <span className="text-kraken-text text-xs flex-1">{label}</span>
                <span className="text-kraken-disabled text-[10px] flex-shrink-0">{note}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* GPU Acceleration */}
      <div className="panel p-5">
        <div className="flex items-center gap-2 mb-4">
          <Zap size={18} className={gpuEnabled && health?.gpu_available ? 'text-kraken-green' : 'text-kraken-muted'} />
          <span className="text-kraken-text font-semibold">GPU ускорение</span>
          <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${
            health?.gpu_available
              ? gpuEnabled
                ? 'bg-kraken-green/15 text-kraken-green'
                : 'bg-kraken-hover text-kraken-muted'
              : 'bg-kraken-red/15 text-kraken-red'
          }`}>
            {health?.gpu_available
              ? gpuEnabled ? 'АКТИВНО' : 'ВЫКЛЮЧЕНО'
              : health?.gpu_detected
                ? 'CPU РЕЖИМ'
                : 'НЕТ GPU'}
          </span>
        </div>

        {/* Статус GPU */}
        <div className="bg-kraken-base rounded-xl p-3 mb-4 text-sm space-y-1.5">
          <div className="flex justify-between">
            <span className="text-kraken-muted text-xs">Видеокарта</span>
            <span className={`text-xs font-bold ${health?.gpu_detected ? 'text-kraken-text' : 'text-kraken-muted'}`}>
              {health?.gpu_name || '—'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-kraken-muted text-xs">Ускорение AI</span>
            <span className={`text-xs font-bold ${health?.gpu_available ? 'text-kraken-green' : 'text-kraken-yellow'}`}>
              {health?.gpu_available ? '✓ Активно' : health?.gpu_detected ? '○ CPU (стабильно)' : '✗ Нет GPU'}
            </span>
          </div>
          {health?.recognition_provider && (
            <div className="flex justify-between gap-3 items-start">
              <span className="text-kraken-muted text-xs flex-shrink-0 pt-0.5">Распознавание</span>
              <span className="text-kraken-purple text-xs text-right break-words max-w-[65%] leading-snug">
                {health.recognition_provider}
              </span>
            </div>
          )}
          {health?.gpu_providers && health.gpu_providers.length > 0 && (
            <div className="flex justify-between gap-2">
              <span className="text-kraken-muted text-xs">ONNX</span>
              <span className="text-kraken-muted text-xs font-mono text-right">
                {health.onnx_package || ''} {health.onnx_version ? `v${health.onnx_version}` : ''}
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-kraken-muted text-xs">Режим</span>
            <span className={`text-xs font-bold ${health?.gpu_available && gpuEnabled ? 'text-kraken-green' : 'text-kraken-muted'}`}>
              {health?.engine_mode || 'CPU'}
            </span>
          </div>
          {health?.setup_ok === false && (
            <div className="text-kraken-red text-xs pt-1 border-t border-kraken-hover">
              ⚠ Ошибка установки AI
              {(health.setup_errors || []).map((e, i) => (
                <div key={i} className="mt-0.5 opacity-90">{e}</div>
              ))}
            </div>
          )}
        </div>

        {/* Детектор оборудования и авто-выбор */}
        <div className="mb-4">
          <label className="block text-kraken-muted text-[10px] font-semibold mb-2 uppercase tracking-wider">
            Детектор оборудования & Провайдер ускорения
          </label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: 'nvidia', label: 'NVIDIA (CUDA)', icon: '🟢' },
              { id: 'amd', label: 'AMD (DirectML)', icon: '🔴' },
              { id: 'intel', label: 'Intel (DirectML)', icon: '🔵' },
              { id: 'cpu', label: 'CPU (Байпас GPU)', icon: '⚙️' },
            ].map((vendor) => (
              <button
                key={vendor.id}
                onClick={() => handleSimulatedGpuChange(vendor.id)}
                className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all ${
                  simulatedGpu === vendor.id
                    ? 'border-kraken-green bg-kraken-green/10 text-kraken-green'
                    : 'border-kraken-border bg-kraken-hover text-kraken-text hover:bg-kraken-base'
                }`}
              >
                <span className="text-base leading-none">{vendor.icon}</span>
                <div className="flex flex-col leading-none">
                  <span className="text-xs font-bold">{vendor.label}</span>
                  <span className="text-[9px] text-kraken-disabled mt-0.5">
                    {vendor.id === 'cpu' ? 'Авто-байпас' : 'Аппаратный'}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Переключатель симуляции событий */}
        <div className="flex items-center justify-between mb-4 pb-4 border-b border-kraken-border/50">
          <div>
            <div className="text-kraken-text text-sm font-medium">Симуляция видеопотоков и детекции лиц</div>
            <div className="text-kraken-disabled text-xs mt-0.5">
              Включает симуляцию лиц и ложных срабатываний VIP/черного списка для демонстрации
            </div>
          </div>
          <button
            onClick={() => handleToggleSimulation(!simulationEnabled)}
            className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${
              simulationEnabled ? 'bg-kraken-green' : 'bg-kraken-hover'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 bg-white w-5 h-5 rounded-full shadow transition-transform ${
                simulationEnabled ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Переключатель */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-kraken-text text-sm font-medium">Использовать GPU для AI</div>
            <div className="text-kraken-disabled text-xs mt-0.5">
              {health?.gpu_available
                ? 'Распознавание на GPU (DirectML), детекция на CPU (ограничение ONNX)'
                : health?.gpu_detected
                  ? 'Стабильный CPU-режим для вашей видеокарты'
                  : 'Только CPU — видеокарта не обнаружена'}
            </div>
          </div>
          <button
            onClick={() => handleToggleGpu(!gpuEnabled)}
            disabled={gpuSaving || !health?.gpu_available}
            className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${
              gpuEnabled && health?.gpu_available
                ? 'bg-kraken-green'
                : 'bg-kraken-hover'
            } ${(!health?.gpu_available) ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              gpuEnabled && health?.gpu_available ? 'translate-x-6' : 'translate-x-0.5'
            }`} />
          </button>
        </div>

        {/* ── GPU Policy: DirectML for AMD/Intel ── */}
        {health?.gpu_vendor && ['amd', 'intel'].includes(health.gpu_vendor) && (
          <div className="mb-4 border border-kraken-border rounded-xl p-4 bg-kraken-hover">
            <div className="flex items-center gap-2 mb-2">
              <Zap size={14} className={health?.gpu_available ? 'text-kraken-green' : 'text-yellow-400'} />
              <span className="text-kraken-text text-sm font-semibold">
                {health?.gpu_available ? 'GPU ускорение (DirectML)' : 'GPU-ускорение доступно'}
              </span>
            </div>

            {!health?.gpu_available && (
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-xs text-yellow-400/90 leading-relaxed mb-3">
                <div className="font-bold mb-1">⚡ Для AMD/Intel GPU используется DirectML</div>
                <div>
                  Ваша видеокарта {health.gpu_name} поддерживает GPU-ускорение (~3x быстрее).
                  Нажмите <strong>«Переустановить AI под это железо»</strong> ниже, затем перезапустите Kraken.
                </div>
              </div>
            )}

            {health?.gpu_available && (
              <div className="bg-kraken-green/10 border border-kraken-green/20 rounded-lg p-3 text-xs text-kraken-green leading-relaxed">
                <div className="font-bold mb-1">✅ DirectML активно</div>
                <div className="break-words">
                  Оптимальный режим для AMD: детекция на CPU, распознавание на {health.gpu_name}.
                  SCRFD не поддерживает DirectML (ограничение ONNX Runtime).
                  До 2 AI-воркеров параллельно (~3× быстрее чистого CPU).
                </div>
              </div>
            )}
          </div>
        )}

        {health?.setup_recommendation && (
          <div className="bg-kraken-hover rounded-lg p-3 mb-3 text-xs text-kraken-muted leading-relaxed break-words">
            {health.setup_recommendation}
          </div>
        )}

        {(health?.setup_warnings || []).length > 0 && (
          <div className="bg-yellow-500/10 rounded-lg p-3 mb-3 text-xs text-yellow-400/90 leading-relaxed">
            {(health.setup_warnings || []).map((w, i) => (
              <div key={i}>{w}</div>
            ))}
          </div>
        )}

        <button
          onClick={handleRerunSetup}
          disabled={setupRunning}
          className="w-full mb-3 py-2 px-3 rounded-lg bg-kraken-hover hover:bg-kraken-purple/20 text-kraken-text text-xs font-medium transition-colors disabled:opacity-50"
        >
          {setupRunning ? 'Установка AI компонентов…' : '↻ Переустановить AI под это железо'}
        </button>

        {gpuMsg && (
          <div className={`text-xs p-2 rounded ${
            gpuMsg.startsWith('✅') ? 'text-kraken-green bg-kraken-green/10' : 'text-kraken-red bg-kraken-red/10'
          }`}>
            {gpuMsg}
          </div>
        )}
      </div>

      {/* ML Optimization */}
      <div className="panel p-5">
        <div className="flex items-center gap-2 mb-4">
          <Zap size={18} className="text-kraken-purple" />
          <span className="text-kraken-text font-semibold">ML Optimization</span>
        </div>
        <p className="text-kraken-muted text-sm mb-4">
          Кэш эмбеддингов, quality gate, адаптивный пропуск кадров и FAISS IVF для больших баз.
        </p>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-kraken-text text-sm">Кэш эмбеддингов (SQLite)</div>
              <div className="text-kraken-muted text-xs">Ускоряет повторный поиск по фото</div>
            </div>
            <button
              onClick={() => setEmbCacheEnabled(!embCacheEnabled)}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                embCacheEnabled ? 'bg-kraken-green' : 'bg-kraken-border'
              }`}
            >
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                embCacheEnabled ? 'translate-x-6' : 'translate-x-0.5'
              }`} />
            </button>
          </div>

          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-kraken-muted">TTL кэша (дней)</span>
              <span className="text-kraken-text font-bold">{embCacheTtl}</span>
            </div>
            <input
              type="range" min={1} max={90} step={1}
              value={embCacheTtl}
              onChange={e => setEmbCacheTtl(Number(e.target.value))}
              className="w-full accent-kraken-purple"
            />
          </div>

          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-kraken-muted">Мин. quality gate</span>
              <span className="text-kraken-text font-bold">{faceQualityMin.toFixed(2)}</span>
            </div>
            <input
              type="range" min={0.05} max={0.50} step={0.01}
              value={faceQualityMin}
              onChange={e => setFaceQualityMin(Number(e.target.value))}
              className="w-full accent-kraken-purple"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-kraken-text text-sm">Адаптивный пропуск кадров</div>
              <div className="text-kraken-muted text-xs">При перегрузке AI-очереди снижает нагрузку</div>
            </div>
            <button
              onClick={() => setAdaptiveFrameSkip(!adaptiveFrameSkip)}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                adaptiveFrameSkip ? 'bg-kraken-green' : 'bg-kraken-border'
              }`}
            >
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                adaptiveFrameSkip ? 'translate-x-6' : 'translate-x-0.5'
              }`} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-kraken-muted text-xs">FAISS IVF порог</label>
              <input
                type="number" min={100} max={50000} step={100}
                value={faissIvfThreshold}
                onChange={e => setFaissIvfThreshold(Number(e.target.value))}
                className="w-full mt-1 px-2 py-1.5 rounded bg-kraken-base border border-kraken-border text-kraken-text text-sm"
              />
            </div>
            <div>
              <label className="text-kraken-muted text-xs">FAISS nprobe</label>
              <input
                type="number" min={1} max={100} step={1}
                value={faissIvfNprobe}
                onChange={e => setFaissIvfNprobe(Number(e.target.value))}
                className="w-full mt-1 px-2 py-1.5 rounded bg-kraken-base border border-kraken-border text-kraken-text text-sm"
              />
            </div>
          </div>
          <p className="text-kraken-muted text-xs">
            IndexIVFFlat включается автоматически при превышении порога эмбеддингов. После смены порога — переиндексация.
          </p>

          {/* ── Camera Priority Weights ── */}
          {cameras.length > 0 && (
            <div className="border-t border-kraken-border pt-4 mt-2">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-kraken-text text-sm">Приоритеты камер</div>
                  <div className="text-kraken-muted text-xs">
                    Камеры с бо́льшим весом обрабатываются AI в первую очередь
                  </div>
                </div>
                <button
                  onClick={() => {
                    const next: Record<string, number> = {}
                    cameras.forEach(c => { next[String(c.id)] = 1.0 })
                    setCameraPriorityWeights(next)
                  }}
                  className="btn-ghost text-xs"
                >
                  Сбросить все
                </button>
              </div>
              <div className="space-y-2">
                {cameras.map(cam => {
                  const key = String(cam.id)
                  const weight = cameraPriorityWeights[key] ?? 1.0
                  return (
                    <div key={cam.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-kraken-hover">
                      <span className="text-kraken-text text-sm w-24 truncate" title={cam.name}>
                        {cam.name || `Камера ${cam.id}`}
                      </span>
                      <input
                        type="range" min={0.1} max={5.0} step={0.1}
                        value={weight}
                        onChange={e => {
                          const next = { ...cameraPriorityWeights }
                          next[key] = Number(e.target.value)
                          setCameraPriorityWeights(next)
                        }}
                        className="flex-1 accent-kraken-purple"
                      />
                      <span className="text-kraken-text font-bold text-sm w-10 text-right tabular-nums">
                        {weight.toFixed(1)}
                      </span>
                    </div>
                  )
                })}
              </div>
              <p className="text-kraken-muted text-xs mt-2">
                По умолчанию 1.0 для всех камер. Увеличьте вес для важных камер (например, вход — 2.0).
              </p>
            </div>
          )}
        </div>

        <button
          onClick={handleSaveMl}
          disabled={mlSaving}
          className="btn-primary mt-4 flex items-center gap-2"
        >
          <RefreshCw size={14} className={mlSaving ? 'animate-spin' : ''} />
          {mlSaving ? 'Сохраняю...' : 'Применить ML настройки'}
        </button>
        {mlMsg && (
          <div className={`mt-3 text-xs p-2 rounded ${
            mlMsg.startsWith('✅') ? 'text-kraken-green bg-kraken-green/10' : 'text-kraken-red bg-kraken-red/10'
          }`}>
            {mlMsg}
          </div>
        )}
      </div>

      {/* AI Models */}
      <div className="panel p-5">
        <div className="flex items-center gap-2 mb-4">
          <Activity size={18} className={health?.ai_ready ? 'text-kraken-green' : 'text-kraken-red'} />
          <span className="text-kraken-text font-semibold">AI — Распознавание лиц</span>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${health?.ai_ready ? 'bg-kraken-green/15 text-kraken-green' : 'bg-kraken-red/15 text-kraken-red'}`}>
            {health?.ai_ready ? 'ГОТОВ' : 'НЕ ГОТОВ'}
          </span>
        </div>
        {!health?.ai_ready && (
          <p className="text-kraken-muted text-sm mb-3">
            Модели InsightFace не загружены. Нажмите кнопку для скачивания (~200MB).
          </p>
        )}
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={handleDownloadModels}
            disabled={downloadingModels || health?.ai_ready}
            className="btn-primary flex items-center gap-2"
          >
            <Download size={14} />
            {downloadingModels ? 'Загрузка моделей...' : health?.ai_ready ? 'Модели загружены' : 'Скачать модели AI'}
          </button>
          {health?.ai_ready && (
            <button
              onClick={handleReindexAll}
              disabled={reindexing}
              className="btn-ghost flex items-center gap-2"
              title="Пересоздать эмбеддинги для всех людей с фото"
            >
              <RefreshCw size={14} className={reindexing ? 'animate-spin' : ''} />
              {reindexing ? 'Переиндексация...' : 'Переиндексировать всех'}
            </button>
          )}
        </div>
        {(modelsMsg || reindexMsg) && (
          <div className={`mt-3 text-xs p-2 rounded ${(modelsMsg || reindexMsg).startsWith('✅') ? 'text-kraken-green bg-kraken-green/10' : 'text-kraken-red bg-kraken-red/10'}`}>
            {modelsMsg || reindexMsg}
          </div>
        )}
      </div>

      {/* Camera sync */}
      <div className="panel p-5">
        <div className="flex items-center gap-2 mb-4">
          <Camera size={18} className="text-kraken-blue" />
          <span className="text-kraken-text font-semibold">Управление камерами</span>
        </div>
        <p className="text-kraken-muted text-sm mb-3">
          Синхронизирует запущенные потоки с базой данных. Останавливает лишние, запускает нужные.
          Используй если камера не показывается или показывается неправильная.
        </p>

        {/* Running streams vs DB */}
        {health && Object.keys(health.cameras).length > 0 && (
          <div className="mb-3 bg-kraken-base rounded-lg p-3">
            <div className="text-kraken-muted text-xs mb-2">Активные потоки:</div>
            {Object.entries(health.cameras).map(([id, info]) => (
              <div key={id} className="flex items-center justify-between text-xs py-1">
                <span className="text-kraken-text">Камера {id}</span>
                <span className={`font-bold ${
                  info.status === 'online' ? 'text-kraken-green' :
                  info.status === 'connecting' ? 'text-yellow-400' : 'text-kraken-red'
                }`}>
                  {info.status} · {info.fps} FPS
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-3 flex-wrap">
          <button
            onClick={handleSyncCameras}
            disabled={syncing}
            className="btn-primary flex items-center gap-2"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Синхронизация...' : 'Синхронизировать с БД'}
          </button>
        </div>

        {syncMsg && (
          <div className={`mt-3 text-xs p-2 rounded ${syncMsg.startsWith('✅') ? 'text-kraken-green bg-kraken-green/10' : 'text-kraken-red bg-kraken-red/10'}`}>
            {syncMsg}
          </div>
        )}

        <div className="mt-3 flex items-start gap-2 text-kraken-disabled text-xs">
          <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
          <span>Для добавления/удаления камер используй страницу <strong className="text-kraken-muted">Камеры</strong></span>
        </div>
      </div>

      {/* Database */}
      <div className="panel p-5">
        <div className="flex items-center gap-2 mb-4">
          <Database size={18} className="text-kraken-blue" />
          <span className="text-kraken-text font-semibold">База данных</span>
        </div>

        {/* Скачать полный бэкап */}
        <div className="mb-4">
          <div className="text-kraken-muted text-xs mb-1">Полный бэкап — БД + все фотографии + снимки</div>
          <div className="flex items-center gap-3 flex-wrap">
            <a
              href="/api/backup/full"
              className="btn-primary flex items-center gap-2 text-sm"
              title="Скачать ZIP архив со всеми данными"
            >
              <Download size={14} />
              Скачать бэкап (ZIP)
            </a>
            <button
              onClick={handleBackup}
              disabled={backingUp}
              className="btn-ghost flex items-center gap-2 text-sm"
              title="Сохранить копию БД на сервере в папку backups/"
            >
              <Download size={14} />
              {backingUp ? 'Сохранение...' : 'Копия БД на сервере'}
            </button>
          </div>
          <p className="text-kraken-disabled text-xs mt-2 leading-relaxed">
            ZIP содержит: <strong className="text-kraken-muted">kraken.db</strong> (база людей, события, камеры) +
            папку <strong className="text-kraken-muted">photos/</strong> (фото людей) +
            папку <strong className="text-kraken-muted">snapshots/</strong> (снимки с камер).
            Перенесите этот файл на другой ПК и восстановите ниже.
          </p>
        </div>

        {backupMsg && (
          <div className={`mb-4 text-xs p-2 rounded ${backupMsg.startsWith('✅') ? 'text-kraken-green bg-kraken-green/10' : 'text-kraken-red bg-kraken-red/10'}`}>
            {backupMsg}
          </div>
        )}

        {/* Разделитель */}
        <div className="border-t border-kraken-border my-4" />

        {/* Восстановление */}
        <div>
          <div className="text-kraken-muted text-xs mb-1">Восстановить из бэкапа</div>
          <p className="text-kraken-disabled text-xs mb-3 leading-relaxed">
            Загрузите ZIP файл бэкапа Kraken. База данных, фотографии и снимки будут восстановлены.
            Перед заменой БД автоматически создаётся резервная копия.
          </p>

          <label className={`flex items-center justify-center gap-2 w-full py-3 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
            restoring
              ? 'border-kraken-border text-kraken-disabled cursor-not-allowed'
              : 'border-kraken-border hover:border-kraken-purple text-kraken-muted hover:text-kraken-purple'
          }`}>
            <input
              type="file"
              accept=".zip"
              className="hidden"
              disabled={restoring}
              onChange={handleRestore}
            />
            {restoring ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                Восстановление...
              </>
            ) : (
              <>
                <Download size={14} className="rotate-180" />
                Выбрать ZIP файл бэкапа
              </>
            )}
          </label>

          {restoreMsg && (
            <div className={`mt-3 text-xs p-3 rounded-lg leading-relaxed ${
              restoreMsg.startsWith('✅')
                ? 'text-kraken-green bg-kraken-green/10'
                : 'text-kraken-red bg-kraken-red/10'
            }`}>
              {restoreMsg}
            </div>
          )}
        </div>
      </div>

      {/* Security */}
      <div className="panel p-5">
        <div className="flex items-center gap-2 mb-4">
          <Shield size={18} className="text-kraken-purple" />
          <span className="text-kraken-text font-semibold">Безопасность</span>
        </div>
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-kraken-muted">Срок токена</span>
            <span className="text-kraken-text">8 часов</span>
          </div>
          <div className="flex justify-between">
            <span className="text-kraken-muted">Watchdog</span>
            <span className="text-kraken-green">Активен (интервал 30с)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-kraken-muted">Авто-переподключение</span>
            <span className="text-kraken-green">Включено</span>
          </div>
        </div>
      </div>

      {/* Admin setup */}
      {/* Блок создания администратора скрыт — используется только при первом запуске через CLI */}

      {/* Reports */}
      <div className="panel p-5">
        <div className="flex items-center gap-2 mb-4">
          <FileText size={18} className="text-kraken-purple" />
          <span className="text-kraken-text font-semibold">Отчёты</span>
        </div>
        <div className="flex gap-3">
          <a
            href="/api/reports/excel?days=7"
            target="_blank"
            rel="noreferrer"
            className="btn-ghost flex items-center gap-2 text-sm"
          >
            <Download size={14} />
            Excel (7 дней)
          </a>
          <a
            href="/api/reports/pdf?days=7"
            target="_blank"
            rel="noreferrer"
            className="btn-ghost flex items-center gap-2 text-sm"
          >
            <FileText size={14} />
            PDF (7 дней)
          </a>
          <a
            href="/api/reports/excel?days=30"
            target="_blank"
            rel="noreferrer"
            className="btn-ghost flex items-center gap-2 text-sm"
          >
            <Download size={14} />
            Excel (30 дней)
          </a>
        </div>
        <p className="text-kraken-disabled text-xs mt-2">
          Excel и PDF включены в систему — дополнительная установка не требуется.
        </p>
      </div>

      {/* ── Звуки оповещений ── */}
      <div className="panel p-5">
        <div className="flex items-center gap-2 mb-4">
          <Volume2 size={18} className="text-kraken-purple" />
          <span className="text-kraken-text font-semibold">Звуки оповещений</span>
        </div>
        <p className="text-kraken-muted text-sm mb-4">
          Для каждой категории можно загрузить свой аудиофайл (MP3, WAV, OGG) или использовать встроенный сигнал.
        </p>
        <div className="space-y-3">
          {categories.map(cat => {
            const defaultCfg: import('../hooks/useAlertSounds').SoundConfig = { mode: 'builtin', volume: 0.7 }
            return (
              <SoundRow
                key={cat.code}
                category={cat.code as SoundCategory}
                label={cat.label}
                color="text-kraken-text"
                dot=""
                dotStyle={{ backgroundColor: cat.color }}
                config={soundConfigs[cat.code as SoundCategory] ?? defaultCfg}
                onChange={(cfg) => {
                  const next = { ...soundConfigs, [cat.code]: cfg }
                  setSoundConfigs(next)
                  saveSoundConfigs(next)
                }}
                onTest={() => { initAudio(); playAlertSound(cat.code as SoundCategory, soundConfigs) }}
              />
            )
          })}
        </div>
      </div>

      {/* Developer */}
      <a
        href="https://veles-voyage.ru"
        target="_blank"
        rel="noreferrer"
        className="block group"
      >
        <div className="panel p-5 overflow-hidden relative transition-all duration-300 hover:border-kraken-purple/50 hover:shadow-glow-purple cursor-pointer">
          {/* Фоновый градиент */}
          <div className="absolute inset-0 bg-gradient-to-br from-kraken-purple/5 via-transparent to-kraken-blue/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

          <div className="relative flex items-center gap-4">
            {/* Логотип Veles */}
            <div className="w-16 h-16 flex-shrink-0 group-hover:scale-105 transition-transform duration-300">
              <img
                src={velesLogo}
                alt="Veles Voyage"
                className="w-full h-full object-cover rounded-full border border-kraken-border/40"
                referrerPolicy="no-referrer"
              />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-kraken-text font-bold text-base">Велес Вояж</span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-kraken-purple/20 text-kraken-purple border border-kraken-purple/30 tracking-wider uppercase">
                  Разработчик
                </span>
              </div>
              <p className="text-kraken-muted text-xs mt-0.5 italic">
                Путешествуй с правильной компанией
              </p>
              <p className="text-kraken-disabled text-[11px] mt-1 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-kraken-green animate-pulse inline-block" />
                veles-voyage.ru
              </p>
            </div>

            {/* Стрелка */}
            <div className="text-kraken-disabled group-hover:text-kraken-purple transition-colors duration-300 flex-shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 17L17 7M17 7H7M17 7v10"/>
              </svg>
            </div>
          </div>

          {/* Нижняя строка */}
          <div className="relative mt-4 pt-3 border-t border-kraken-border/50 flex items-center justify-between">
            <div className="flex items-center gap-3 text-[11px] text-kraken-disabled">
              <span>🏆 Лицензия РТА 0035678</span>
              <span>·</span>
              <span>🌍 200+ направлений</span>
              <span>·</span>
              <span>🎧 Поддержка 24/7</span>
            </div>
            <span className="text-kraken-disabled text-[10px]">© 2026</span>
          </div>
        </div>
      </a>

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
    </div>
  )
}

// ── Строка настройки звука для одной категории ────────────────────────────────

interface SoundRowProps {
  category: SoundCategory
  label: string
  color: string
  dot: string
  dotStyle?: React.CSSProperties
  config: SoundConfig | undefined
  onChange: (cfg: SoundConfig) => void
  onTest: () => void
}

function SoundRow({ label, color, dot, dotStyle, config: configProp, onChange, onTest }: SoundRowProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  // Защита от undefined — дефолтный конфиг для новых категорий
  const config = configProp ?? { mode: 'builtin' as const, volume: 0.7 }

  const handleFile = (file: File | null) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      // dataUrl = "data:audio/mpeg;base64,..."
      const [header, data] = dataUrl.split(',')
      const mimeMatch = header.match(/data:([^;]+)/)
      const mime = mimeMatch ? mimeMatch[1] : 'audio/mpeg'
      onChange({
        ...config,
        mode: 'custom',
        customName: file.name,
        customData: data,
        customType: mime,
      })
    }
    reader.readAsDataURL(file)
  }

  const setMode = (mode: SoundConfig['mode']) => onChange({ ...config, mode })
  const setVolume = (v: number) => onChange({ ...config, volume: v })
  const clearCustom = () => onChange({ ...config, mode: 'builtin', customName: undefined, customData: undefined, customType: undefined })

  return (
    <div className="bg-kraken-hover rounded-xl p-3">
      <div className="flex items-center gap-3 mb-2.5">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} style={dotStyle} />
        <span className={`text-sm font-semibold ${color}`}>{label}</span>

        {/* Режим */}
        <div className="flex gap-1 ml-auto">
          {(['builtin', 'custom', 'off'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                config.mode === m
                  ? 'bg-kraken-purple text-white'
                  : 'bg-kraken-base text-kraken-muted hover:text-kraken-text'
              }`}>
              {m === 'builtin' ? 'Встроенный' : m === 'custom' ? 'Свой файл' : 'Выкл'}
            </button>
          ))}
        </div>
      </div>

      {config.mode !== 'off' && (
        <div className="flex items-center gap-3 flex-wrap">
          {/* Громкость */}
          <div className="flex items-center gap-2 flex-1 min-w-[140px]">
            <VolumeX size={12} className="text-kraken-disabled flex-shrink-0" />
            <input type="range" min={0} max={1} step={0.05}
              value={config.volume}
              onChange={e => setVolume(Number(e.target.value))}
              className="flex-1 accent-purple-500 h-1"
            />
            <Volume2 size={12} className="text-kraken-muted flex-shrink-0" />
            <span className="text-kraken-disabled text-[10px] w-8 text-right">
              {Math.round(config.volume * 100)}%
            </span>
          </div>

          {/* Кастомный файл */}
          {config.mode === 'custom' && (
            <div className="flex items-center gap-2">
              {config.customName ? (
                <div className="flex items-center gap-1.5 bg-kraken-base px-2 py-1 rounded-lg">
                  <span className="text-kraken-green text-[10px] truncate max-w-[120px]">{config.customName}</span>
                  <button onClick={clearCustom} className="text-kraken-disabled hover:text-kraken-red transition-colors">
                    <span className="text-[10px]">✕</span>
                  </button>
                </div>
              ) : (
                <label className="flex items-center gap-1 bg-kraken-base hover:bg-kraken-border text-kraken-muted hover:text-kraken-text text-[10px] px-2 py-1 rounded-lg transition-colors cursor-pointer">
                  <Upload size={10} /> Выбрать файл
                  <input type="file" accept="audio/*" className="hidden"
                    onChange={e => handleFile(e.target.files?.[0] ?? null)} />
                </label>
              )}
              <input ref={fileRef} type="file" accept="audio/*" className="hidden"
                onChange={e => handleFile(e.target.files?.[0] ?? null)} />
            </div>
          )}

          {/* Тест */}
          <button onClick={onTest}
            className="flex items-center gap-1 bg-kraken-base hover:bg-kraken-border text-kraken-muted hover:text-kraken-text text-[10px] px-2 py-1 rounded-lg transition-colors flex-shrink-0">
            <Play size={10} /> Тест
          </button>
        </div>
      )}

      {config.mode === 'custom' && !config.customName && (
        <p className="text-kraken-disabled text-[10px] mt-1.5">
          Поддерживаются: MP3, WAV, OGG, M4A. Файл хранится в браузере.
        </p>
      )}
    </div>
  )
}
