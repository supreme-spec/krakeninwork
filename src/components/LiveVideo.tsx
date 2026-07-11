import { useEffect, useRef, useState } from 'react'
import type { FaceDetection } from '../types'
import { WS_BASE } from '../api/client'

interface Props {
  cameraId: number | null
  onFaceDetected?: (face: FaceDetection) => void
  onFrameReceived?: (faces: FaceDetection[]) => void
}

const CATEGORY_COLORS: Record<string, string> = {
  VIP:      '#00FF94',
  BLACKLIST: '#FF3B3B',
  STAFF:    '#3BA4FF',
  CLIENT:   '#9AA6B2',
  RESPONSE: '#FF8C00',
  SECURITY: '#F5C518',
  UNKNOWN:  '#5B6570',
}

// RTSP камеры через FFmpeg pipe стартуют до 20-25 секунд (определение кодека + первый keyframe).
// USB камеры — быстрее (~2 сек), но таймаут общий для обоих типов.
// Ставим 45 сек: достаточно для любой RTSP, не мешает быстрым USB.
const CONNECT_TIMEOUT_MS = 45000

function cosineToPercent(cosine: number): number {
  const clamped = Math.max(0.28, Math.min(0.85, cosine))
  return Math.round(((clamped - 0.28) / (0.85 - 0.28)) * 100)
}

// ── Audio ─────────────────────────────────────────────────────────────────────
let _audioCtx: AudioContext | null = null
function getAudioCtx(): AudioContext | null {
  try {
    if (!_audioCtx || _audioCtx.state === 'closed') _audioCtx = new AudioContext()
    if (_audioCtx.state === 'suspended') _audioCtx.resume()
    return _audioCtx
  } catch { return null }
}

function playDetectionSound(category: string) {
  const ctx = getAudioCtx()
  if (!ctx) return
  const t = ctx.currentTime
  if (category === 'BLACKLIST') {
    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator(); const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = 'sawtooth'; osc.frequency.value = i % 2 === 0 ? 440 : 330
      const s = t + i * 0.18
      gain.gain.setValueAtTime(0.35, s); gain.gain.exponentialRampToValueAtTime(0.001, s + 0.16)
      osc.start(s); osc.stop(s + 0.17)
    }
  } else if (category === 'VIP') {
    ;[523, 659, 784, 1047].forEach((freq, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = 'sine'; osc.frequency.value = freq
      const s = t + i * 0.1
      gain.gain.setValueAtTime(0, s); gain.gain.linearRampToValueAtTime(0.2, s + 0.04)
      gain.gain.exponentialRampToValueAtTime(0.001, s + 0.25)
      osc.start(s); osc.stop(s + 0.26)
    })
  } else if (category === 'RESPONSE') {
    ;[660, 880, 660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = 'triangle'; osc.frequency.value = freq
      const s = t + i * 0.14
      gain.gain.setValueAtTime(0, s); gain.gain.linearRampToValueAtTime(0.28, s + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.001, s + 0.13)
      osc.start(s); osc.stop(s + 0.14)
    })
  } else if (category === 'SECURITY') {
    ;[440, 550].forEach((freq, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = 'sine'; osc.frequency.value = freq
      const s = t + i * 0.15
      gain.gain.setValueAtTime(0, s); gain.gain.linearRampToValueAtTime(0.12, s + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.001, s + 0.18)
      osc.start(s); osc.stop(s + 0.19)
    })
  } else {
    ;[880, 1100].forEach((freq, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = 'sine'; osc.frequency.value = freq
      const s = t + i * 0.12
      gain.gain.setValueAtTime(0, s); gain.gain.linearRampToValueAtTime(0.15, s + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.001, s + 0.12)
      osc.start(s); osc.stop(s + 0.13)
    })
  }
}

// ── Draw boxes ────────────────────────────────────────────────────────────────
function drawBoxes(ctx: CanvasRenderingContext2D, faces: FaceDetection[]) {
  if (!faces || !Array.isArray(faces)) return

  faces.forEach(face => {
    if (!face || !face.bbox || face.bbox.length < 4) return
    const [x1, y1, x2, y2] = face.bbox
    if (typeof x1 !== 'number' || typeof y1 !== 'number' || typeof x2 !== 'number' || typeof y2 !== 'number') return
    if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) return

    const color = CATEGORY_COLORS[face.category ?? 'UNKNOWN'] ?? '#9AA6B2'
    const bw = x2 - x1
    const bh = y2 - y1
    if (bw <= 0 || bh <= 0) return

    const cs = Math.min(bw, bh) * 0.18

    // 1. Draw boundary box
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.strokeRect(x1, y1, bw, bh)

    // 2. Draw stylish corners
    ctx.lineWidth = 3
    ctx.strokeStyle = color

    ctx.beginPath()
    ctx.moveTo(x1, y1 + cs)
    ctx.lineTo(x1, y1)
    ctx.lineTo(x1 + cs, y1)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(x2 - cs, y1)
    ctx.lineTo(x2, y1)
    ctx.lineTo(x2, y1 + cs)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(x1, y2 - cs)
    ctx.lineTo(x1, y2)
    ctx.lineTo(x1 + cs, y2)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(x2 - cs, y2)
    ctx.lineTo(x2, y2)
    ctx.lineTo(x2, y2 - cs)
    ctx.stroke()

    // 3. Draw text label
    const label = face.person_name
      ? `${face.person_name}  ${cosineToPercent(face.confidence ?? 0)}%`
      : 'Unknown'
    
    ctx.font = 'bold 13px Inter, monospace'
    const textW = ctx.measureText(label).width
    const badgeW = textW + 14

    // Clamp horizontally to stay inside canvas
    let lx = x1
    if (lx < 4) lx = 4
    if (lx + badgeW > ctx.canvas.width - 4) {
      lx = ctx.canvas.width - badgeW - 4
    }

    // Position label box vertically, with safety clamps
    let ly = y1 > 28 ? y1 - 28 : y2 + 4
    if (ly < 4) ly = 4
    if (ly + 22 > ctx.canvas.height - 4) {
      ly = ctx.canvas.height - 26
    }

    ctx.fillStyle = color
    ctx.beginPath()
    if (typeof (ctx as any).roundRect === 'function') {
      ;(ctx as any).roundRect(lx, ly, badgeW, 22, 4)
    } else {
      ctx.rect(lx, ly, badgeW, 22)
    }
    ctx.fill()

    ctx.fillStyle = (face.category === 'VIP' || face.category === 'CLIENT') ? '#000' : '#fff'
    ctx.fillText(label, lx + 7, ly + 15)
  })
}

function b64ToUint8Array(b64: string): Uint8Array {
  const binStr = atob(b64)
  const len = binStr.length
  const arr = new Uint8Array(len)
  let i = 0
  for (; i < len - 7; i += 8) {
    arr[i]   = binStr.charCodeAt(i)
    arr[i+1] = binStr.charCodeAt(i+1)
    arr[i+2] = binStr.charCodeAt(i+2)
    arr[i+3] = binStr.charCodeAt(i+3)
    arr[i+4] = binStr.charCodeAt(i+4)
    arr[i+5] = binStr.charCodeAt(i+5)
    arr[i+6] = binStr.charCodeAt(i+6)
    arr[i+7] = binStr.charCodeAt(i+7)
  }
  for (; i < len; i++) arr[i] = binStr.charCodeAt(i)
  return arr
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function LiveVideo({ cameraId, onFaceDetected, onFrameReceived }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [streamState, setStreamState] = useState<'idle' | 'connecting' | 'streaming' | 'error'>('idle')
  const [hasFrame, setHasFrame] = useState(false)
  const [faceCount, setFaceCount] = useState(0)
  const [errorHint, setErrorHint] = useState('')

  const latestBitmapRef = useRef<ImageBitmap | null>(null)
  const latestFacesRef  = useRef<FaceDetection[]>([])
  const rafRef          = useRef<number>(0)
  const dirtyRef        = useRef(false)

  const onFaceDetectedRef  = useRef(onFaceDetected)
  const onFrameReceivedRef = useRef(onFrameReceived)
  useEffect(() => { onFaceDetectedRef.current = onFaceDetected }, [onFaceDetected])
  useEffect(() => { onFrameReceivedRef.current = onFrameReceived }, [onFrameReceived])

  const lastSoundIdRef   = useRef<number | null>(null)
  const lastSoundTimeRef = useRef<number>(0)
  const pendingDecodeRef = useRef(false)

  useEffect(() => {
    if (!cameraId) {
      setStreamState('idle')
      setHasFrame(false)
      setErrorHint('')
      return
    }

    setStreamState('connecting')
    setErrorHint('')
    let canvasW = 0, canvasH = 0
    let destroyed = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let connectTimeout: ReturnType<typeof setTimeout> | null = null
    let currentWs: WebSocket | null = null
    let pingInterval: ReturnType<typeof setInterval> | null = null
    let gotFrame = false

    const renderLoop = () => {
      rafRef.current = requestAnimationFrame(renderLoop)
      if (!dirtyRef.current) return
      dirtyRef.current = false
      const bitmap = latestBitmapRef.current
      const canvas = canvasRef.current
      if (!bitmap || !canvas) return
      const ctx = canvas.getContext('2d', { alpha: false })
      if (!ctx) return
      if (canvasW !== bitmap.width || canvasH !== bitmap.height) {
        canvasW = bitmap.width; canvasH = bitmap.height
        canvas.width = canvasW; canvas.height = canvasH
      }
      ctx.drawImage(bitmap, 0, 0)
      drawBoxes(ctx, latestFacesRef.current)
    }
    rafRef.current = requestAnimationFrame(renderLoop)

    const scheduleConnectTimeout = () => {
      if (connectTimeout) clearTimeout(connectTimeout)
      // Не ставим таймаут если уже получили хотя бы один кадр —
      // в этом случае это переподключение после обрыва, не первый старт.
      // Таймаут нужен только для первого подключения.
      if (gotFrame) return
      connectTimeout = setTimeout(() => {
        if (destroyed || gotFrame) return
        // Не показываем error — просто продолжаем ждать с индикатором.
        // RTSP камеры могут стартовать 20-30 сек, это нормально.
        // Только меняем текст подсказки чтобы пользователь знал что идёт подключение.
        setErrorHint('Камера подключается... RTSP поток может стартовать до 30 секунд.')
        // Не вызываем setStreamState('error') — оставляем 'connecting'
      }, CONNECT_TIMEOUT_MS)
    }

    const connect = () => {
      if (destroyed) return
      setStreamState('connecting')
      scheduleConnectTimeout()

      const ws = new WebSocket(`${WS_BASE}/ws/camera/${cameraId}`)
      ws.binaryType = 'arraybuffer'
      currentWs = ws

      if (pingInterval) clearInterval(pingInterval)
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('ping')
      }, 5000)

      ws.onopen = () => {
        if (destroyed) return
        setStreamState('connecting')
      }

      ws.onclose = () => {
        if (destroyed) return
        if (!gotFrame) setStreamState('connecting')
        if (pingInterval) { clearInterval(pingInterval); pingInterval = null }
        reconnectTimer = setTimeout(() => { if (!destroyed) connect() }, 2000)
      }

      ws.onerror = () => {
        if (destroyed) return
        if (!gotFrame) {
          setStreamState('error')
          setErrorHint('Ошибка WebSocket. Перезапустите Kraken или обновите страницу.')
        }
      }

      let lastFrameTime = 0
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string)
          if (msg.type !== 'FRAME') return

          const now = Date.now()
          if (now - lastFrameTime < 38) return
          lastFrameTime = now

          const faces: FaceDetection[] = msg.faces ?? []
          latestFacesRef.current = faces
          setFaceCount(faces.length)
          onFrameReceivedRef.current?.(faces)

          if (faces.length > 0 && onFaceDetectedRef.current) {
            const best = faces.find(f => f.person_id) ?? faces[0]
            onFaceDetectedRef.current(best)
          } else if (faces.length === 0 && onFaceDetectedRef.current) {
            onFaceDetectedRef.current({ track_id: -1, bbox: [0,0,0,0], person_id: undefined })
          }

          const recognized = faces.find(f => f.person_id)
          if (recognized?.person_id) {
            const isNew = recognized.person_id !== lastSoundIdRef.current
            const cooldown = now - lastSoundTimeRef.current > 8000
            if (isNew || cooldown) {
              lastSoundIdRef.current = recognized.person_id
              lastSoundTimeRef.current = now
              playDetectionSound(recognized.category ?? 'UNKNOWN')
            }
          } else if (faces.length === 0 && now - lastSoundTimeRef.current > 5000) {
            lastSoundIdRef.current = null
          }

          if (pendingDecodeRef.current) return
          pendingDecodeRef.current = true

          const arr = b64ToUint8Array(msg.frame as string)
          const blob = new Blob([arr.buffer as ArrayBuffer], { type: 'image/jpeg' })
          createImageBitmap(blob).then(bitmap => {
            if (destroyed) {
              bitmap.close()
              return
            }
            gotFrame = true
            if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null }
            const prev = latestBitmapRef.current
            latestBitmapRef.current = bitmap
            dirtyRef.current = true
            prev?.close()
            setHasFrame(true)
            setStreamState('streaming')
            setErrorHint('')
          }).catch(() => {
            if (!destroyed && !gotFrame) {
              setStreamState('error')
              setErrorHint('Не удалось декодировать кадр с камеры.')
            }
          }).finally(() => { pendingDecodeRef.current = false })
        } catch { /* ignore */ }
      }
    }

    connect()

    return () => {
      destroyed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (connectTimeout) clearTimeout(connectTimeout)
      if (pingInterval) clearInterval(pingInterval)
      cancelAnimationFrame(rafRef.current)
      currentWs?.close()
      latestBitmapRef.current?.close()
      latestBitmapRef.current = null
      dirtyRef.current = false
      pendingDecodeRef.current = false
      canvasW = 0; canvasH = 0
    }
  }, [cameraId])

  const showOverlay = !hasFrame || streamState === 'connecting' || streamState === 'error' || streamState === 'idle'

  return (
    <div
      className="relative w-full h-full bg-kraken-hover rounded-xl overflow-hidden border border-kraken-border"
      onClick={() => getAudioCtx()}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full object-contain bg-black"
        style={{ opacity: hasFrame ? 1 : 0 }}
      />

      {showOverlay && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-kraken-base/95 px-4 text-center">
          <div className="text-5xl opacity-20">📷</div>
          <div className="text-kraken-muted text-sm">
            {streamState === 'idle' && 'Выберите камеру'}
            {streamState === 'connecting' && (hasFrame ? 'Переподключение...' : 'Подключение к камере...')}
            {streamState === 'error' && 'Нет видеопотока'}
          </div>
          {errorHint && (
            <p className="text-kraken-disabled text-xs max-w-xs leading-relaxed">{errorHint}</p>
          )}
          {streamState === 'connecting' && (
            <div className="w-6 h-6 border-2 border-kraken-purple border-t-transparent rounded-full animate-spin" />
          )}
        </div>
      )}

      {hasFrame && streamState === 'streaming' && (
        <>
          <div className="absolute top-3 left-3 text-kraken-text text-xs bg-black/50 px-2 py-1 rounded">
            {new Date().toLocaleTimeString('ru-RU')}
          </div>
          {faceCount > 0 && (
            <div className="absolute top-3 right-3 text-kraken-green text-xs bg-black/50 px-2 py-1 rounded font-bold">
              {faceCount} {faceCount === 1 ? 'лицо' : faceCount < 5 ? 'лица' : 'лиц'}
            </div>
          )}
        </>
      )}
    </div>
  )
}
