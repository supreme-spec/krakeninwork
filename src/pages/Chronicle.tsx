/**
 * Chronicle — Фотохроника посетителей
 * Камеры + папка «Мои фото» (S/Ы): moi_foto/YYYY-MM/YYYY-MM-DD/
 * Хранение: 90 дней, без повторов за день, по камерам
 */
import { useState, useEffect, useCallback } from 'react'
import { ChevronRight, Camera, Calendar, Users, Download, Trash2, RefreshCw, Image, X, AlertTriangle, ImagePlus } from 'lucide-react'
import { apiFetch } from '../api/client'
import ConfirmModal, { AlertModal } from '../components/ConfirmModal'

// ── Типы ──────────────────────────────────────────────────────────────────────

interface CameraInfo {
  camera_id: number
  name: string
  total_photos: number
  total_days: number
  last_day: string | null
  last_day_label: string | null
}

interface MonthInfo {
  month: string
  label: string
  days_count: number
  photos_count: number
}

interface DayInfo {
  date: string
  label: string
  count: number
}

interface Visitor {
  filename: string
  person_id: number | null
  person_name: string
  time: string
  photo_url: string
  size_kb: number
}

interface DayData {
  camera_id: number
  date: string
  label: string
  count: number
  visitors: Visitor[]
}

interface Stats {
  total_photos: number
  total_days: number
  cameras: number
  retention_days: number
  oldest_date: string
}

// ── Компонент ─────────────────────────────────────────────────────────────────

// ── Вспомогательный компонент для изображений с фоллбеком ─────────────────────
function ChronicleImage({ src, alt }: { src: string; alt: string }) {
  const [error, setError] = useState(false)
  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center text-3xl text-kraken-disabled bg-kraken-hover select-none">
        👤
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={alt}
      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
      loading="lazy"
      onError={() => setError(true)}
    />
  )
}

/** Виртуальная папка ручных снимков S/Ы в списке камер */
const MY_PHOTOS_CAMERA_ID = 0

export default function Chronicle() {
  const [cameras, setCameras]           = useState<CameraInfo[]>([])
  const [myPhotosFolder, setMyPhotosFolder] = useState<CameraInfo | null>(null)
  const [selectedCam, setSelectedCam]   = useState<CameraInfo | null>(null)
  const [viewMyPhotos, setViewMyPhotos] = useState(false)
  const [months, setMonths]             = useState<MonthInfo[]>([])
  const [selectedMonth, setSelectedMonth] = useState<MonthInfo | null>(null)
  const [days, setDays]                 = useState<DayInfo[]>([])
  const [selectedDay, setSelectedDay]   = useState<DayInfo | null>(null)
  const [dayData, setDayData]           = useState<DayData | null>(null)
  const [stats, setStats]               = useState<Stats | null>(null)
  const [loading, setLoading]           = useState(false)
  const [lightbox, setLightbox]         = useState<Visitor | null>(null)
  const [cleaning, setCleaning]         = useState(false)
  const [deletingPhoto, setDeletingPhoto] = useState<string | null>(null)
  const [showCleanModal, setShowCleanModal] = useState(false)
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

  const isMyPhotos = viewMyPhotos

  const selectCamera = (cam: CameraInfo) => {
    setViewMyPhotos(false)
    setSelectedCam(cam)
  }

  const selectMyPhotos = () => {
    setViewMyPhotos(true)
    setSelectedCam(null)
  }

  // Загрузка камер и статистики
  const loadCameras = useCallback(async () => {
    setLoading(true)
    try {
      const [camsRes, statsRes] = await Promise.all([
        apiFetch<{ cameras: CameraInfo[]; my_photos: CameraInfo }>('/chronicle/cameras'),
        apiFetch<Stats>('/chronicle/stats'),
      ])
      setCameras(camsRes.cameras)
      setMyPhotosFolder(camsRes.my_photos)
      setStats(statsRes)
      if (!viewMyPhotos && camsRes.cameras.length > 0 && !selectedCam) {
        setSelectedCam(camsRes.cameras[0])
      }
    } catch {}
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadCameras() }, [loadCameras])


  const activeCameraId = isMyPhotos ? MY_PHOTOS_CAMERA_ID : selectedCam?.camera_id

  // Загрузка месяцев при выборе камеры или «Мои фото»
  useEffect(() => {
    if (activeCameraId === undefined) return
    setSelectedMonth(null); setDays([]); setSelectedDay(null); setDayData(null)
    apiFetch<{ months: MonthInfo[] }>(`/chronicle/camera/${activeCameraId}/months`)
      .then(r => {
        setMonths(r.months)
        if (r.months.length > 0) setSelectedMonth(r.months[0])
      }).catch(() => {})
  }, [activeCameraId])

  // Загрузка дней при выборе месяца
  useEffect(() => {
    if (activeCameraId === undefined || !selectedMonth) return
    setSelectedDay(null); setDayData(null)
    apiFetch<{ days: DayInfo[] }>(`/chronicle/camera/${activeCameraId}/days/${selectedMonth.month}`)
      .then(r => {
        setDays(r.days)
        if (r.days.length > 0) setSelectedDay(r.days[0])
      }).catch(() => {})
  }, [activeCameraId, selectedMonth])

  // Загрузка посетителей при выборе дня
  useEffect(() => {
    if (activeCameraId === undefined || !selectedDay) return
    apiFetch<DayData>(`/chronicle/camera/${activeCameraId}/day/${selectedDay.date}`)
      .then(setDayData).catch(() => {})
  }, [activeCameraId, selectedDay])

  const handleDeletePhoto = (visitor: Visitor) => {
    if (activeCameraId === undefined || !selectedDay) return
    setConfirmState({
      isOpen: true,
      title: 'Удалить фото',
      message: `Удалить фото "${visitor.person_name}"?`,
      isDamage: true,
      onConfirm: async () => {
        setConfirmState(null)
        setDeletingPhoto(visitor.filename)
        try {
          await apiFetch(
            `/chronicle/camera/${activeCameraId}/day/${selectedDay.date}/photo/${encodeURIComponent(visitor.filename)}`,
            { method: 'DELETE' }
          )
          setDayData(prev => prev ? {
            ...prev,
            visitors: prev.visitors.filter(v => v.filename !== visitor.filename),
            count: prev.count - 1,
          } : null)
          if (lightbox?.filename === visitor.filename) setLightbox(null)
        } catch (e: any) {
          setAlertState({ isOpen: true, title: 'Ошибка', message: 'Ошибка удаления: ' + e.message })
        } finally {
          setDeletingPhoto(null)
        }
      }
    })
  }

  const handleCleanup = () => {
    setConfirmState({
      isOpen: true,
      title: 'Удалить старые записи',
      message: 'Удалить все записи старше 90 дней?',
      isDamage: true,
      onConfirm: async () => {
        setConfirmState(null)
        setCleaning(true)
        try {
          const res = await apiFetch<{ removed_dirs: number }>('/chronicle/cleanup', { method: 'POST' })
          setAlertState({ isOpen: true, title: 'Очистка завершена', message: `Удалено папок: ${res.removed_dirs}` })
          loadCameras()
        } catch (e: any) {
          setAlertState({ isOpen: true, title: 'Ошибка', message: 'Ошибка: ' + e.message })
        } finally {
          setCleaning(false)
        }
      }
    })
  }

  const handleDeleteDay = () => {
    if (activeCameraId === undefined || !selectedDay) return
    setConfirmState({
      isOpen: true,
      title: 'Удалить все фото за день',
      message: `Удалить ВСЕ фото за ${selectedDay.date} (${selectedDay.count} шт.)?`,
      isDamage: true,
      onConfirm: async () => {
        setConfirmState(null)
        setCleaning(true)
        try {
          await apiFetch(
            `/chronicle/camera/${activeCameraId}/day/${selectedDay.date}`,
            { method: 'DELETE' }
          )
          setDayData(null); setSelectedDay(null)
          if (selectedMonth) {
            const r = await apiFetch<{ days: DayInfo[] }>(`/chronicle/camera/${activeCameraId}/days/${selectedMonth.month}`)
            setDays(r.days)
            if (r.days.length > 0) setSelectedDay(r.days[0])
          }
          loadCameras()
        } catch (e: any) {
          setAlertState({ isOpen: true, title: 'Ошибка', message: 'Ошибка: ' + e.message })
        } finally {
          setCleaning(false)
        }
      }
    })
  }

  const handleDeleteMonth = () => {
    if (activeCameraId === undefined || !selectedMonth) return
    setConfirmState({
      isOpen: true,
      title: 'Удалить все фото за месяц',
      message: `Удалить ВСЕ фото за ${selectedMonth.label} (${selectedMonth.photos_count} шт.)?`,
      isDamage: true,
      onConfirm: async () => {
        setConfirmState(null)
        setCleaning(true)
        try {
          await apiFetch(
            `/chronicle/camera/${activeCameraId}/month/${selectedMonth.month}`,
            { method: 'DELETE' }
          )
          setDayData(null); setSelectedDay(null); setDays([])
          const r = await apiFetch<{ months: MonthInfo[] }>(`/chronicle/camera/${activeCameraId}/months`)
          setMonths(r.months)
          if (r.months.length > 0) setSelectedMonth(r.months[0])
          loadCameras()
        } catch (e: any) {
          setAlertState({ isOpen: true, title: 'Ошибка', message: 'Ошибка: ' + e.message })
        } finally {
          setCleaning(false)
        }
      }
    })
  }

  // Скачать все фото дня как ZIP (через браузер — просто открываем каждое)
  const downloadDay = () => {
    if (!dayData) return
    dayData.visitors.forEach((v, i) => {
      setTimeout(() => {
        const a = document.createElement('a')
        a.href = v.photo_url
        a.download = v.filename
        a.click()
      }, i * 200)
    })
  }

  return (
    <div className="h-full flex flex-col gap-0 overflow-hidden">

      {/* ── Заголовок ── */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div>
          <h1 className="text-kraken-text text-xl font-bold">Фотохроника</h1>
          {stats && (
            <p className="text-kraken-muted text-xs mt-0.5">
              {stats.total_photos} фото · {stats.total_days} дней · {stats.cameras} камер · хранение {stats.retention_days} дней
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadCameras} className="btn-ghost flex items-center gap-1.5 text-xs py-1.5 px-3">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Обновить
          </button>
          <button onClick={handleCleanup} disabled={cleaning}
            className="btn-ghost flex items-center gap-1.5 text-xs py-1.5 px-3 text-amber-400 hover:text-amber-400">
            <Trash2 size={12} />
            {cleaning ? 'Очистка...' : 'Старше 90 дней'}
          </button>
          <button onClick={() => setShowCleanModal(true)} disabled={cleaning}
            className="btn-ghost flex items-center gap-1.5 text-xs py-1.5 px-3 text-kraken-red hover:text-kraken-red">
            <AlertTriangle size={12} />
            Очистить...
          </button>
        </div>
      </div>

      {cameras.length === 0 && !myPhotosFolder && !loading && (
        <div className="flex-1 flex flex-col items-center justify-center text-kraken-disabled gap-3">
          <Image size={48} className="opacity-20" />
          <p className="text-sm">Фотохроника пуста</p>
          <p className="text-xs text-center max-w-xs">
            Снимки появятся автоматически когда система распознает посетителей.
          </p>
        </div>
      )}

      {(cameras.length > 0 || myPhotosFolder) && (
        <div className="flex gap-3 flex-1 min-h-0 overflow-hidden">

          {/* ── Левая панель: навигация ── */}
          <div className="w-56 flex-shrink-0 flex flex-col gap-2 overflow-y-auto">

            {/* Камеры */}
            <div className="panel overflow-hidden">
              <div className="px-3 py-2 border-b border-kraken-border">
                <span className="text-kraken-disabled text-[10px] uppercase tracking-widest">Камеры</span>
              </div>
              {cameras.map(cam => (
                <button key={cam.camera_id}
                  onClick={() => selectCamera(cam)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors border-b border-kraken-border last:border-0 ${
                    !viewMyPhotos && selectedCam?.camera_id === cam.camera_id
                      ? 'bg-kraken-purple/10 text-kraken-text'
                      : 'text-kraken-muted hover:bg-kraken-hover hover:text-kraken-text'
                  }`}>
                  <Camera size={14} className={!viewMyPhotos && selectedCam?.camera_id === cam.camera_id ? 'text-kraken-purple' : ''} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{cam.name}</div>
                    <div className="text-[10px] text-kraken-disabled">
                      {cam.total_photos} фото · {cam.total_days} дней
                    </div>
                  </div>
                  {!viewMyPhotos && selectedCam?.camera_id === cam.camera_id && (
                    <ChevronRight size={12} className="text-kraken-purple flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>

            {/* Мои фото — отдельная папка под камерами (как «Мои записи» в умной съёмке) */}
            {myPhotosFolder && (
              <div className="panel overflow-hidden">
                <div className="px-3 py-2 border-b border-kraken-border">
                  <span className="text-kraken-disabled text-[10px] uppercase tracking-widest">Мои фото</span>
                </div>
                <button
                  onClick={selectMyPhotos}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                    viewMyPhotos
                      ? 'bg-kraken-purple/10 text-kraken-text'
                      : 'text-kraken-muted hover:bg-kraken-hover hover:text-kraken-text'
                  }`}>
                  <ImagePlus size={14} className={viewMyPhotos ? 'text-kraken-purple' : ''} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{myPhotosFolder.name}</div>
                    <div className="text-[10px] text-kraken-disabled">
                      {myPhotosFolder.total_photos} фото · {myPhotosFolder.total_days} дней
                    </div>
                  </div>
                  {viewMyPhotos && (
                    <ChevronRight size={12} className="text-kraken-purple flex-shrink-0" />
                  )}
                </button>
              </div>
            )}

            {/* Месяцы */}
            {months.length > 0 && (
              <div className="panel overflow-hidden">
                <div className="px-3 py-2 border-b border-kraken-border">
                  <span className="text-kraken-disabled text-[10px] uppercase tracking-widest">Месяц</span>
                </div>
                {months.map(m => (
                  <button key={m.month}
                    onClick={() => setSelectedMonth(m)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors border-b border-kraken-border last:border-0 ${
                      selectedMonth?.month === m.month
                        ? 'bg-kraken-purple/10 text-kraken-text'
                        : 'text-kraken-muted hover:bg-kraken-hover hover:text-kraken-text'
                    }`}>
                    <Calendar size={13} className={selectedMonth?.month === m.month ? 'text-kraken-purple' : ''} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium">{m.label}</div>
                      <div className="text-[10px] text-kraken-disabled">{m.photos_count} фото</div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Дни */}
            {days.length > 0 && (
              <div className="panel overflow-hidden flex-1 min-h-0 flex flex-col">
                <div className="px-3 py-2 border-b border-kraken-border flex-shrink-0">
                  <span className="text-kraken-disabled text-[10px] uppercase tracking-widest">Дни</span>
                </div>
                <div className="overflow-y-auto flex-1">
                  {days.map(d => (
                    <button key={d.date}
                      onClick={() => setSelectedDay(d)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors border-b border-kraken-border last:border-0 ${
                        selectedDay?.date === d.date
                          ? 'bg-kraken-purple/10 text-kraken-text'
                          : 'text-kraken-muted hover:bg-kraken-hover hover:text-kraken-text'
                      }`}>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium">{d.label}</div>
                        <div className="text-[10px] text-kraken-disabled">{d.date}</div>
                      </div>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                        selectedDay?.date === d.date
                          ? 'bg-kraken-purple text-white'
                          : 'bg-kraken-hover text-kraken-muted'
                      }`}>
                        {d.count}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Правая панель: фото посетителей ── */}
          <div className="flex-1 min-w-0 panel flex flex-col overflow-hidden">
            {dayData ? (
              <>
                <div className="px-4 py-3 border-b border-kraken-border flex items-center justify-between flex-shrink-0">
                  <div>
                    <div className="text-kraken-text font-semibold">
                      {dayData.label}
                      <span className="text-kraken-muted font-normal text-sm ml-2">{dayData.date}</span>
                    </div>
                    <div className="text-kraken-disabled text-xs mt-0.5 flex items-center gap-1.5">
                      {isMyPhotos ? (
                        <><ImagePlus size={11} />{dayData.count} ручных снимков</>
                      ) : (
                        <><Users size={11} />{dayData.count} уникальных посетителей · Камера {dayData.camera_id}</>
                      )}
                    </div>
                  </div>
                  {dayData.count > 0 && (
                    <button onClick={downloadDay}
                      className="btn-ghost flex items-center gap-1.5 text-xs py-1.5 px-3">
                      <Download size={12} />
                      Скачать все
                    </button>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto p-4">
                  {dayData.visitors.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-kraken-disabled gap-2">
                      <Image size={32} className="opacity-20" />
                      <p className="text-sm">Нет посетителей за этот день</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                      {dayData.visitors.map((v, i) => (
                        <div key={i}
                          className="group relative cursor-pointer rounded-xl overflow-hidden border border-kraken-border hover:border-kraken-purple transition-all duration-200 hover:shadow-glow-purple">
                          <div className="aspect-square bg-kraken-hover" onClick={() => setLightbox(v)}>
                            <ChronicleImage src={v.photo_url} alt={v.person_name} />
                          </div>
                          <div className="px-2 py-1.5 bg-kraken-panel" onClick={() => setLightbox(v)}>
                            <div className="text-kraken-text text-xs font-medium truncate">{v.person_name}</div>
                            <div className="text-kraken-disabled text-[10px]">{v.time}</div>
                          </div>
                          <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <a href={v.photo_url} download={v.filename}
                              onClick={e => e.stopPropagation()}
                              className="p-1 rounded-lg bg-black/60 text-white hover:bg-black/80 transition-colors" title="Скачать">
                              <Download size={11} />
                            </a>
                            <button onClick={e => { e.stopPropagation(); handleDeletePhoto(v) }}
                              disabled={deletingPhoto === v.filename}
                              className="p-1 rounded-lg bg-black/60 text-white hover:bg-kraken-red transition-colors disabled:opacity-50" title="Удалить фото">
                              {deletingPhoto === v.filename ? <RefreshCw size={11} className="animate-spin" /> : <X size={11} />}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-kraken-disabled gap-2 px-4 text-center">
                {isMyPhotos ? (
                  <>
                    <ImagePlus size={32} className="opacity-20" />
                    <p className="text-sm">Мои фото пусты</p>
                    <p className="text-xs max-w-xs">
                      На LiveMonitor нажмите <kbd className="px-1 py-0.5 bg-kraken-hover rounded font-bold">S</kbd> / <kbd className="px-1 py-0.5 bg-kraken-hover rounded font-bold">Ы</kbd> для снимка с выбранной камеры.
                    </p>
                  </>
                ) : (
                  <>
                    <Calendar size={32} className="opacity-20" />
                    <p className="text-sm">Выберите день для просмотра</p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Лайтбокс ── */}
      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setLightbox(null)}>
          <div className="relative max-w-xl max-h-[90vh] mx-4 animate-fade-in" onClick={e => e.stopPropagation()}>
            <img src={lightbox.photo_url} alt={lightbox.person_name}
              className="max-w-full max-h-[85vh] rounded-xl shadow-2xl" />
            <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
              <div className="text-white text-sm font-medium bg-black/50 px-3 py-1.5 rounded-lg">
                {lightbox.person_name} · {lightbox.time} · {lightbox.size_kb} KB
              </div>
              <div className="flex gap-2">
                <a href={lightbox.photo_url} download={lightbox.filename}
                  className="p-2 rounded-lg bg-black/50 text-white hover:bg-black/70 transition-colors" title="Скачать">
                  <Download size={16} />
                </a>
                <button onClick={() => setLightbox(null)}
                  className="p-2 rounded-lg bg-black/50 text-white hover:bg-kraken-red transition-colors" title="Закрыть">
                  <X size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Модалка очистки ── */}
      {showCleanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setShowCleanModal(false)}>
          <div className="panel p-6 w-full max-w-sm mx-4 animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-kraken-red/10 flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={20} className="text-kraken-red" />
              </div>
              <div>
                <h2 className="text-kraken-text font-bold">Очистить фотохронику</h2>
                <p className="text-kraken-muted text-xs mt-0.5">Выберите что удалить</p>
              </div>
            </div>
            <div className="space-y-2">
              <button onClick={() => { handleDeleteDay(); setShowCleanModal(false) }}
                disabled={!selectedDay}
                className="w-full text-left px-3 py-2 rounded-lg bg-kraken-hover hover:bg-kraken-hover text-sm disabled:opacity-40 text-kraken-text">
                {selectedDay
                  ? `🗑️ Удалить день ${selectedDay.date} (${selectedDay.count} фото)`
                  : 'Сначала выберите день'}
              </button>
              <button onClick={() => { handleDeleteMonth(); setShowCleanModal(false) }}
                disabled={!selectedMonth}
                className="w-full text-left px-3 py-2 rounded-lg bg-kraken-hover hover:bg-kraken-hover text-sm disabled:opacity-40 text-amber-400">
                {selectedMonth
                  ? `📅 Удалить месяц ${selectedMonth.label} (${selectedMonth.photos_count} фото)`
                  : 'Сначала выберите месяц'}
              </button>
            </div>
            <button onClick={() => setShowCleanModal(false)}
              className="w-full mt-4 btn-ghost text-sm">Отмена</button>
          </div>
        </div>
      )}

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
