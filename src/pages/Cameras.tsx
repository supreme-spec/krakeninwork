import { useState, useEffect, useCallback } from 'react'
import { Plus, Play, Square, Trash2, Search, X, Wifi, WifiOff, RefreshCw, ScanLine, Edit2, Video } from 'lucide-react'
import type { Camera } from '../types'
import { apiFetch } from '../api/client'
import RoiEditor from '../components/RoiEditor'
import ConfirmModal, { AlertModal } from '../components/ConfirmModal'

interface FoundUsb { index: number; source: string; name: string }
interface FoundIp { ip: string; port: number; source: string; rtsp_base?: string; common_paths?: string[]; type: string }

export default function Cameras() {
  const [cameras, setCameras] = useState<Camera[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [prefillSource, setPrefillSource] = useState('')
  const [prefillType, setPrefillType] = useState('USB')
  const [prefillName, setPrefillName] = useState('')

  const [scanning, setScanning] = useState(false)
  const [usbFound, setUsbFound] = useState<FoundUsb[]>([])

  const [onvifScanning, setOnvifScanning] = useState(false)
  const [onvifFound, setOnvifFound] = useState<FoundIp[]>([])
  const [onvifNetwork, setOnvifNetwork] = useState('192.168.1')

  // ROI editor state
  const [roiCamera, setRoiCamera] = useState<Camera | null>(null)

  // Edit camera state
  const [editCamera, setEditCamera] = useState<Camera | null>(null)

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

  const fetchCameras = useCallback(async () => {
    try {
      const data = await apiFetch<Camera[]>('/cameras')
      setCameras(data)
    } catch {}
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    fetchCameras()
    const t = setInterval(() => {
      if (!document.hidden) fetchCameras()
    }, 3000)
    return () => clearInterval(t)
  }, [fetchCameras])

  const handleStart = async (id: number) => {
    await apiFetch(`/cameras/${id}/start`, { method: 'POST' })
    fetchCameras()
  }

  const handleStop = async (id: number) => {
    await apiFetch(`/cameras/${id}/stop`, { method: 'POST' })
    fetchCameras()
  }

  const handleDelete = (id: number) => {
    setConfirmState({
      isOpen: true,
      title: 'Удалить камеру',
      message: 'Удалить эту камеру?',
      isDamage: true,
      onConfirm: async () => {
        setConfirmState(null)
        try {
          await apiFetch(`/cameras/${id}`, { method: 'DELETE' })
          fetchCameras()
        } catch (e: any) {
          setAlertState({ isOpen: true, title: 'Ошибка', message: 'Ошибка удаления: ' + e.message })
        }
      }
    })
  }

  const handleRecord = async (id: number) => {
    try {
      await apiFetch(`/recordings/start/${id}`, { method: 'POST' })
      setAlertState({ isOpen: true, title: 'Запись запущена', message: 'Запись запущена на 15 секунд' })
    } catch (e: any) {
      setAlertState({ isOpen: true, title: 'Ошибка записи', message: e.message })
    }
  }

  const handleScanUSB = async () => {
    setScanning(true)
    setUsbFound([])
    try {
      const res = await apiFetch<{ cameras: FoundUsb[] }>('/cameras/scan/usb')
      setUsbFound(res.cameras)
    } catch {}
    finally { setScanning(false) }
  }

  const handleScanONVIF = async () => {
    setOnvifScanning(true)
    setOnvifFound([])
    try {
      const res = await apiFetch<{ cameras: FoundIp[] }>(`/cameras/scan/onvif?network=${onvifNetwork}`)
      setOnvifFound(res.cameras)
    } catch {}
    finally { setOnvifScanning(false) }
  }

  const openAddWithPreset = (source: string, type: string, name: string) => {
    setPrefillSource(source)
    setPrefillType(type)
    setPrefillName(name)
    setShowAdd(true)
  }

  const statusColor = (s: string) => {
    if (s === 'online') return 'text-kraken-green'
    if (s === 'connecting' || s === 'reconnecting') return 'text-yellow-400'
    return 'text-kraken-disabled'
  }

  const statusLabel = (s: string) => ({
    online: 'ОНЛАЙН', offline: 'ОФЛАЙН',
    connecting: 'ПОДКЛЮЧЕНИЕ', reconnecting: 'ПЕРЕПОДКЛЮЧЕНИЕ',
  }[s] ?? s.toUpperCase())

  return (
    <div className="h-full flex flex-col gap-4 overflow-y-auto">

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={handleScanUSB} disabled={scanning} className="btn-ghost flex items-center gap-2">
          <Search size={14} />
          {scanning ? 'Сканирование USB...' : 'Найти USB'}
        </button>

        <div className="flex items-center gap-2">
          <button onClick={handleScanONVIF} disabled={onvifScanning} className="btn-ghost flex items-center gap-2">
            <Wifi size={14} />
            {onvifScanning ? 'Сканирование сети...' : 'Найти IP/ONVIF'}
          </button>
          <input
            type="text"
            value={onvifNetwork}
            onChange={e => setOnvifNetwork(e.target.value)}
            placeholder="192.168.1"
            className="w-28 bg-kraken-hover border border-kraken-border text-kraken-text text-xs px-2 py-1.5 rounded-lg focus:outline-none focus:border-kraken-purple"
            title="Подсеть для сканирования (например 192.168.0)"
          />
        </div>

        <button
          onClick={() => { setPrefillSource(''); setPrefillType('USB'); setPrefillName(''); setShowAdd(true) }}
          className="btn-primary flex items-center gap-2 ml-auto"
        >
          <Plus size={16} />
          Добавить камеру
        </button>
      </div>

      {/* ── USB scan results ── */}
      {usbFound.length > 0 && (
        <div className="panel p-3">
          <div className="text-kraken-muted text-xs uppercase tracking-widest mb-2">Найдены USB камеры</div>
          <div className="flex flex-wrap gap-2">
            {usbFound.map(c => (
              <button
                key={c.source}
                onClick={() => openAddWithPreset(c.source, 'USB', `USB Camera ${c.index}`)}
                className="flex items-center gap-2 bg-kraken-hover hover:bg-kraken-purple/20 border border-kraken-border hover:border-kraken-purple px-3 py-1.5 rounded-lg text-sm transition-colors"
              >
                <span className="text-kraken-green">●</span>
                <span className="text-kraken-text">{c.name}</span>
                <span className="text-kraken-muted text-xs">index {c.source}</span>
                <Plus size={12} className="text-kraken-purple" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── ONVIF/IP scan results ── */}
      {onvifFound.length > 0 && (
        <div className="panel p-3">
          <div className="text-kraken-muted text-xs uppercase tracking-widest mb-2">
            Найдены IP камеры ({onvifFound.length})
          </div>
          <div className="flex flex-col gap-2">
            {onvifFound.map((c, i) => (
              <div key={i} className="flex items-center gap-3 bg-kraken-hover rounded-lg px-3 py-2">
                <div className="flex-1">
                  <div className="text-kraken-text text-sm font-medium">{c.ip}:{c.port}</div>
                  <div className="text-kraken-muted text-xs font-mono">{c.source}</div>
                  {c.common_paths && (
                    <div className="text-kraken-disabled text-xs mt-0.5">
                      Попробуйте пути: {c.common_paths.slice(0, 2).join(', ')}
                    </div>
                  )}
                </div>
                <span className="text-xs bg-kraken-blue/20 text-kraken-blue px-2 py-0.5 rounded">
                  {c.type}
                </span>
                <button
                  onClick={() => openAddWithPreset(c.source, 'RTSP', `IP Camera ${c.ip}`)}
                  className="flex items-center gap-1 bg-kraken-purple hover:bg-kraken-purple-hover text-white text-xs px-2 py-1 rounded-lg transition-colors"
                >
                  <Plus size={12} />
                  Добавить
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Camera grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading && (
          <div className="col-span-3 text-center py-8 text-kraken-disabled">Загрузка...</div>
        )}
        {!loading && cameras.length === 0 && (
          <div className="col-span-3 text-center py-8 text-kraken-disabled">
            Камеры не добавлены. Нажмите "Найти USB" или "Добавить камеру".
          </div>
        )}
        {cameras.map(cam => (
          <div key={cam.id} className="panel p-4 flex flex-col gap-3">
            {/* Header: name + status */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-kraken-text font-semibold truncate">{cam.name}</div>
                {/* Source path — full text, wraps, monospace */}
                <div
                  className="text-kraken-muted text-xs mt-0.5 font-mono break-all leading-relaxed"
                  title={cam.source}
                >
                  {cam.source}
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {cam.status === 'online'
                  ? <Wifi size={14} className="text-kraken-green" />
                  : cam.status === 'connecting' || cam.status === 'reconnecting'
                    ? <RefreshCw size={14} className="text-yellow-400 animate-spin" />
                    : <WifiOff size={14} className="text-kraken-disabled" />
                }
                <span className={`text-xs font-bold ${statusColor(cam.status)}`}>
                  {statusLabel(cam.status)}
                </span>
              </div>
            </div>

            {/* Badges */}
            <div className="flex items-center gap-2 flex-wrap text-xs text-kraken-muted">
              <span className="bg-kraken-hover px-2 py-0.5 rounded">{cam.camera_type}</span>
              {cam.brand && <span className="bg-kraken-blue/10 text-kraken-blue px-2 py-0.5 rounded">{cam.brand}</span>}
              {cam.model_name && <span className="bg-kraken-hover px-2 py-0.5 rounded text-kraken-text">{cam.model_name}</span>}
              {cam.zone && <span className="bg-kraken-hover px-2 py-0.5 rounded">{cam.zone}</span>}
              {cam.status === 'online' && cam.fps != null && (
                <span className="bg-kraken-hover px-2 py-0.5 rounded text-kraken-green font-mono">
                  {cam.fps} fps
                </span>
              )}
              {cam.status === 'online' && cam.ping_ms != null && (
                <span className={`px-2 py-0.5 rounded font-mono ${
                  cam.ping_ms < 50  ? 'bg-kraken-green/10 text-kraken-green' :
                  cam.ping_ms < 150 ? 'bg-yellow-400/10 text-yellow-400' :
                                      'bg-kraken-red/10 text-kraken-red'
                }`}>
                  {cam.ping_ms} ms
                </span>
              )}
              {cam.roi_zones && cam.roi_zones.length > 0 && (
                <span
                  className="bg-kraken-purple/20 text-kraken-purple px-2 py-0.5 rounded cursor-pointer hover:bg-kraken-purple/30 transition-colors"
                  onClick={() => setRoiCamera(cam)}
                  title="Настроить зоны детектирования"
                >
                  {cam.roi_zones.length} {cam.roi_zones.length === 1 ? 'зона' : cam.roi_zones.length < 5 ? 'зоны' : 'зон'}
                </span>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 mt-1">
              {cam.status !== 'online' ? (
                <button
                  onClick={() => handleStart(cam.id)}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-kraken-green/10 hover:bg-kraken-green/20 text-kraken-green text-sm py-1.5 rounded-lg transition-colors"
                >
                  <Play size={13} />
                  Запустить
                </button>
              ) : (
                <>
                  <button
                    onClick={() => handleStop(cam.id)}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-kraken-red/10 hover:bg-kraken-red/20 text-kraken-red text-sm py-1.5 rounded-lg transition-colors"
                  >
                    <Square size={13} />
                    Остановить
                  </button>
                  <button
                    onClick={() => handleRecord(cam.id)}
                    className="flex items-center justify-center gap-1.5 bg-kraken-purple/10 hover:bg-kraken-purple/20 text-kraken-purple text-sm py-1.5 px-3 rounded-lg transition-colors"
                    title="Записать 15 секунд (умная съёмка)"
                  >
                    <Video size={13} />
                  </button>
                </>
              )}
              <button
                onClick={() => setEditCamera(cam)}
                className="p-1.5 rounded-lg hover:bg-kraken-hover text-kraken-muted hover:text-kraken-blue transition-colors"
                title="Редактировать"
              >
                <Edit2 size={14} />
              </button>
              <button
                onClick={() => setRoiCamera(cam)}
                className="p-1.5 rounded-lg hover:bg-kraken-hover text-kraken-muted hover:text-kraken-purple transition-colors"
                title="Зоны детектирования"
              >
                <ScanLine size={14} />
              </button>
              <button
                onClick={() => handleDelete(cam.id)}
                className="p-1.5 rounded-lg hover:bg-kraken-hover text-kraken-muted hover:text-kraken-red transition-colors"
                title="Удалить"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ── Add camera modal ── */}
      {showAdd && (
        <AddCameraModal
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); fetchCameras() }}
          usbFound={usbFound}
          initialSource={prefillSource}
          initialType={prefillType}
          initialName={prefillName}
        />
      )}

      {/* ── Edit camera modal ── */}
      {editCamera && (
        <EditCameraModal
          camera={editCamera}
          onClose={() => setEditCamera(null)}
          onSaved={() => { setEditCamera(null); fetchCameras() }}
        />
      )}

      {/* ── ROI zone editor ── */}
      {roiCamera && (
        <RoiEditor
          cameraId={roiCamera.id}
          cameraName={roiCamera.name}
          onClose={() => { setRoiCamera(null); fetchCameras() }}
        />
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

// ── Edit Camera Modal ─────────────────────────────────────────────────────────

interface EditModalProps {
  camera: Camera
  onClose: () => void
  onSaved: () => void
}

function EditCameraModal({ camera, onClose, onSaved }: EditModalProps) {
  const [name, setName] = useState(camera.name)
  const [source, setSource] = useState(camera.source)
  const [zone, setZone] = useState(camera.zone ?? '')
  const [smartRec, setSmartRec] = useState(camera.is_smart_recording)
  const [chronicle, setChronicle] = useState(camera.is_chronicle)
  const [ipAddress, setIpAddress] = useState(camera.ip_address ?? '')
  const [ipPort, setIpPort] = useState(camera.ip_port?.toString() ?? '80')
  const [username, setUsername] = useState(camera.username ?? '')
  const [password, setPassword] = useState(camera.password ?? '')
  const [useAnalytics, setUseAnalytics] = useState(camera.use_camera_analytics ?? false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!name.trim()) { setError('Название обязательно'); return }
    if (!source.trim()) { setError('Источник обязателен'); return }
    setSaving(true)
    setError('')
    try {
      await apiFetch(`/cameras/${camera.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: name.trim(),
          source: source.trim(),
          zone: zone.trim() || null,
          is_smart_recording: smartRec,
          is_chronicle: chronicle,
          ip_address: ipAddress.trim() || null,
          ip_port: ipPort ? parseInt(ipPort) : null,
          username: username.trim() || null,
          password: password || null,
          use_camera_analytics: useAnalytics,
        }),
      })
      onSaved()
    } catch (e: any) {
      setError(e.message || 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await apiFetch<{ connected: boolean; brand?: string; model?: string; driver_type?: string }>(
        `/cameras/${camera.id}/test-connection`, { method: 'POST' }
      )
      setTestResult(res.connected
        ? `✓ ${res.brand || ''} ${res.model || ''} (${res.driver_type})`
        : '✗ Не удалось подключиться')
    } catch (e: any) {
      setTestResult(`✗ ${e.message || 'Ошибка'}`)
    } finally {
      setTesting(false)
    }
  }

  const isRtsp = camera.camera_type === 'RTSP' || camera.camera_type === 'IP'

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="panel p-6 w-full max-w-xl mx-4 animate-fade-in max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-kraken-text font-bold text-lg">Редактировать камеру</h2>
            <p className="text-kraken-muted text-xs mt-0.5">{camera.camera_type} · ID {camera.id}</p>
          </div>
          <button onClick={onClose} className="text-kraken-muted hover:text-kraken-text">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          {/* Name */}
          <div>
            <label className="text-kraken-muted text-xs mb-1 block">Название *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple"
            />
          </div>

          {/* Source — textarea для длинных RTSP путей */}
          <div>
            <label className="text-kraken-muted text-xs mb-1 block">
              {isRtsp ? 'RTSP URL' : 'Индекс камеры'}
            </label>
            {isRtsp ? (
              <textarea
                value={source}
                onChange={e => setSource(e.target.value)}
                rows={3}
                spellCheck={false}
                className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple font-mono resize-none leading-relaxed"
                placeholder="rtsp://admin:password@192.168.1.100:554/stream"
              />
            ) : (
              <input
                type="text"
                value={source}
                onChange={e => setSource(e.target.value)}
                className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple font-mono"
                placeholder="0"
              />
            )}
            {/* Full path display for reference */}
            {source && (
              <div className="mt-1.5 bg-kraken-base border border-kraken-border rounded-lg px-3 py-2">
                <div className="text-kraken-disabled text-[10px] uppercase tracking-wider mb-1">Полный путь</div>
                <div className="text-kraken-muted text-xs font-mono break-all select-all">{source}</div>
              </div>
            )}
          </div>

          {/* Zone label */}
          <div>
            <label className="text-kraken-muted text-xs mb-1 block">Зона (необязательно)</label>
            <input
              type="text"
              value={zone}
              onChange={e => setZone(e.target.value)}
              placeholder="Главный вход, Парковка..."
              className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple"
            />
          </div>

          {/* IP Camera settings */}
          <div className="border border-kraken-border rounded-xl p-3 space-y-3">
            <div className="text-kraken-muted text-xs uppercase tracking-widest">IP камера (необязательно)</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-kraken-muted text-[10px] mb-0.5 block">IP адрес</label>
                <input type="text" value={ipAddress} onChange={e => setIpAddress(e.target.value)}
                  placeholder="192.168.1.100"
                  className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-xs px-2 py-1.5 rounded-lg focus:outline-none focus:border-kraken-purple font-mono" />
              </div>
              <div>
                <label className="text-kraken-muted text-[10px] mb-0.5 block">Порт</label>
                <input type="text" value={ipPort} onChange={e => setIpPort(e.target.value)}
                  placeholder="80"
                  className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-xs px-2 py-1.5 rounded-lg focus:outline-none focus:border-kraken-purple font-mono" />
              </div>
              <div>
                <label className="text-kraken-muted text-[10px] mb-0.5 block">Логин</label>
                <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                  placeholder="admin"
                  className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-xs px-2 py-1.5 rounded-lg focus:outline-none focus:border-kraken-purple" />
              </div>
              <div>
                <label className="text-kraken-muted text-[10px] mb-0.5 block">Пароль</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••"
                  className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-xs px-2 py-1.5 rounded-lg focus:outline-none focus:border-kraken-purple" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={useAnalytics} onChange={e => setUseAnalytics(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-kraken-border text-kraken-purple focus:ring-kraken-purple" />
                <div className="flex flex-col">
                  <span className="text-kraken-text text-[10px] font-semibold">Аналитика камеры</span>
                  <span className="text-[9px] text-kraken-disabled">Использовать AI камеры (Hikvision/UNV)</span>
                </div>
              </label>
              {camera.ip_address && (
                <button onClick={handleTestConnection} disabled={testing}
                  className="text-xs px-2 py-1 rounded-lg bg-kraken-blue/10 text-kraken-blue hover:bg-kraken-blue/20 disabled:opacity-50 transition-colors">
                  {testing ? 'Проверка...' : 'Тест'}
                </button>
              )}
            </div>
            {testResult && (
              <div className={`text-xs px-2 py-1.5 rounded-lg ${testResult.startsWith('✓') ? 'bg-kraken-green/10 text-kraken-green' : 'bg-kraken-red/10 text-kraken-red'}`}>
                {testResult}
              </div>
            )}
          </div>

          <div className="flex gap-4 p-3 bg-kraken-base rounded-xl border border-kraken-border">
            <label className="flex-1 flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={smartRec}
                onChange={e => setSmartRec(e.target.checked)}
                className="w-4 h-4 rounded border-kraken-border text-kraken-purple focus:ring-kraken-purple"
              />
              <div className="flex flex-col">
                <span className="text-kraken-text text-xs font-semibold group-hover:text-kraken-purple transition-colors">Умная съёмка</span>
                <span className="text-[10px] text-kraken-disabled">Запись 15с при обнаружении</span>
              </div>
            </label>
            <div className="w-px bg-kraken-border h-8 self-center" />
            <label className="flex-1 flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={chronicle}
                onChange={e => setChronicle(e.target.checked)}
                className="w-4 h-4 rounded border-kraken-border text-kraken-purple focus:ring-kraken-purple"
              />
              <div className="flex flex-col">
                <span className="text-kraken-text text-xs font-semibold group-hover:text-kraken-purple transition-colors">Фотохроника</span>
                <span className="text-[10px] text-kraken-disabled">Снимок посетителя в день</span>
              </div>
            </label>
          </div>

          {error && (
            <div className="text-kraken-red text-sm bg-kraken-red/10 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          <div className="flex gap-3 mt-1">
            <button onClick={onClose} className="btn-ghost flex-1">Отмена</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Add Camera Modal ──────────────────────────────────────────────────────────

interface AddModalProps {
  onClose: () => void
  onSaved: () => void
  usbFound: FoundUsb[]
  initialSource?: string
  initialType?: string
  initialName?: string
}

function AddCameraModal({ onClose, onSaved, usbFound, initialSource = '', initialType = 'USB', initialName = '' }: AddModalProps) {
  const [name, setName] = useState(initialName)
  const [source, setSource] = useState(initialSource)
  const [type, setType] = useState(initialType)
  const [zone, setZone] = useState('')
  const [smartRec, setSmartRec] = useState(false)
  const [chronicle, setChronicle] = useState(true)
  const [ipAddress, setIpAddress] = useState('')
  const [ipPort, setIpPort] = useState('80')
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [useAnalytics, setUseAnalytics] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const validateSource = () => {
    if (!source.trim()) return 'Источник обязателен'
    // Для USB-камер принимаем как числовые индексы (0,1,2), так и пути к устройствам (/dev/video0)
    if (type === 'USB') {
      const trimmed = source.trim()
      // Разрешаем: только цифры, или путь вида /dev/video*, или любой другой путь
      const isValid = /^\d+$/.test(trimmed) || /^\/dev\/video\d+$/.test(trimmed) || trimmed.includes('/') || trimmed.includes('\\')
      if (!isValid) {
        return 'USB источник должен быть числом (0, 1, 2...) или путем к устройству (/dev/video0)'
      }
    }
    return null
  }

  const handleSave = async () => {
    if (!name.trim()) { setError('Название обязательно'); return }
    const srcError = validateSource()
    if (srcError) { setError(srcError); return }

    setSaving(true)
    setError('')
    try {
      await apiFetch('/cameras', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          source: source.trim(),
          camera_type: type,
          driver_type: type === 'UNV' ? 'unv' : type === 'Hikvision' ? 'hikvision' : type === 'ONVIF' ? 'onvif' : null,
          zone: zone.trim(),
          is_smart_recording: smartRec,
          is_chronicle: chronicle,
          ip_address: ipAddress.trim() || null,
          ip_port: ipPort ? parseInt(ipPort) : null,
          username: username.trim() || null,
          password: password || null,
          use_camera_analytics: useAnalytics,
        }),
      })
      onSaved()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="panel p-6 w-full max-w-md mx-4 animate-fade-in max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-kraken-text font-bold text-lg">Добавить камеру</h2>
          <button onClick={onClose} className="text-kraken-muted hover:text-kraken-text">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <label className="text-kraken-muted text-xs mb-1 block">Название *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Главный вход"
              className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple"
            />
          </div>

          <div>
            <label className="text-kraken-muted text-xs mb-1 block">Тип</label>
            <select
              value={type}
              onChange={e => { setType(e.target.value); setSource('') }}
              className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple"
            >
              <option value="USB">USB (встроенная / USB камера)</option>
              <option value="RTSP">RTSP (IP камера)</option>
              <option value="IP">IP (HTTP поток)</option>
              <option value="Hikvision">Hikvision (ISAPI)</option>
              <option value="UNV">UNV (Uniview LAPI)</option>
              <option value="ONVIF">ONVIF (универсальный)</option>
            </select>
          </div>

          <div>
            <label className="text-kraken-muted text-xs mb-1 block">
              {type === 'USB' ? 'Индекс камеры (0, 1, 2...)' : 'RTSP URL'}
            </label>
            {usbFound.length > 0 && type === 'USB' ? (
              <select
                value={source}
                onChange={e => setSource(e.target.value)}
                className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple"
              >
                <option value="">Выберите камеру</option>
                {usbFound.map(c => (
                  <option key={c.index} value={c.source}>{c.name} (index {c.source})</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={source}
                onChange={e => setSource(e.target.value)}
                placeholder={type === 'USB' ? '0' : 'rtsp://admin:password@192.168.1.100:554/stream'}
                className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple font-mono"
              />
            )}
            {(type === 'RTSP' || type === 'IP') && (
              <div className="mt-1.5 text-kraken-disabled text-xs space-y-0.5">
                <div>Примеры RTSP путей:</div>
                <div className="font-mono">rtsp://admin:pass@192.168.1.100:554/stream</div>
                <div className="font-mono">rtsp://192.168.1.100:554/Streaming/Channels/101 (Hikvision)</div>
                <div className="font-mono">rtsp://192.168.1.100:554/cam/realmonitor?channel=1 (Dahua)</div>
              </div>
            )}
          </div>

          <div>
            <label className="text-kraken-muted text-xs mb-1 block">Зона (необязательно)</label>
            <input
              type="text"
              value={zone}
              onChange={e => setZone(e.target.value)}
              placeholder="Главный вход, Парковка..."
              className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-kraken-purple"
            />
          </div>

          {/* IP Camera fields — shown for non-USB types */}
          {type !== 'USB' && (
            <div className="border border-kraken-border rounded-xl p-3 space-y-3">
              <div className="text-kraken-muted text-xs uppercase tracking-widest">IP камера</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-kraken-muted text-[10px] mb-0.5 block">IP адрес</label>
                  <input type="text" value={ipAddress} onChange={e => setIpAddress(e.target.value)}
                    placeholder="192.168.1.100"
                    className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-xs px-2 py-1.5 rounded-lg focus:outline-none focus:border-kraken-purple font-mono" />
                </div>
                <div>
                  <label className="text-kraken-muted text-[10px] mb-0.5 block">Порт</label>
                  <input type="text" value={ipPort} onChange={e => setIpPort(e.target.value)}
                    placeholder="80"
                    className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-xs px-2 py-1.5 rounded-lg focus:outline-none focus:border-kraken-purple font-mono" />
                </div>
                <div>
                  <label className="text-kraken-muted text-[10px] mb-0.5 block">Логин</label>
                  <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                    placeholder="admin"
                    className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-xs px-2 py-1.5 rounded-lg focus:outline-none focus:border-kraken-purple" />
                </div>
                <div>
                  <label className="text-kraken-muted text-[10px] mb-0.5 block">Пароль</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="••••••"
                    className="w-full bg-kraken-hover border border-kraken-border text-kraken-text text-xs px-2 py-1.5 rounded-lg focus:outline-none focus:border-kraken-purple" />
                </div>
              </div>
              {(type === 'Hikvision' || type === 'UNV') && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={useAnalytics} onChange={e => setUseAnalytics(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-kraken-border text-kraken-purple focus:ring-kraken-purple" />
                  <div className="flex flex-col">
                    <span className="text-kraken-text text-[10px] font-semibold">Аналитика камеры</span>
                    <span className="text-[9px] text-kraken-disabled">Использовать AI камеры вместо Kraken AI</span>
                  </div>
                </label>
              )}
            </div>
          )}

          <div className="flex gap-4 p-3 bg-kraken-base rounded-xl border border-kraken-border">
            <label className="flex-1 flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={smartRec}
                onChange={e => setSmartRec(e.target.checked)}
                className="w-4 h-4 rounded border-kraken-border text-kraken-purple focus:ring-kraken-purple"
              />
              <div className="flex flex-col">
                <span className="text-kraken-text text-xs font-semibold group-hover:text-kraken-purple transition-colors">Умная съёмка</span>
                <span className="text-[10px] text-kraken-disabled">Запись 15с при обнаружении</span>
              </div>
            </label>
            <div className="w-px bg-kraken-border h-8 self-center" />
            <label className="flex-1 flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={chronicle}
                onChange={e => setChronicle(e.target.checked)}
                className="w-4 h-4 rounded border-kraken-border text-kraken-purple focus:ring-kraken-purple"
              />
              <div className="flex flex-col">
                <span className="text-kraken-text text-xs font-semibold group-hover:text-kraken-purple transition-colors">Фотохроника</span>
                <span className="text-[10px] text-kraken-disabled">Снимок посетителя в день</span>
              </div>
            </label>
          </div>

          {error && <div className="text-kraken-red text-sm bg-kraken-red/10 px-3 py-2 rounded-lg">{error}</div>}

          <div className="flex gap-3 mt-2">
            <button onClick={onClose} className="btn-ghost flex-1">Отмена</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
              {saving ? 'Добавление...' : 'Добавить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
