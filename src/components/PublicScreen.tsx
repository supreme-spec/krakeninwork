import { useEffect, useRef, useState } from 'react'
import { WS_BASE } from '../api/client'

interface Props {
  cameraId: number | null
}

export default function PublicScreen({ cameraId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(new Image())
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!cameraId) return

    const ws = new WebSocket(`${WS_BASE}/ws/camera/${cameraId}`)

    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'FRAME') {
          const canvas = canvasRef.current
          if (!canvas) return
          const ctx = canvas.getContext('2d')
          if (!ctx) return

          imgRef.current.onload = () => {
            canvas.width = imgRef.current.width
            canvas.height = imgRef.current.height
            ctx.drawImage(imgRef.current, 0, 0)
            // Public screen: only show green boxes, NO names/categories
            msg.faces.forEach((face: { bbox: number[] }) => {
              const [x1, y1, x2, y2] = face.bbox
              ctx.strokeStyle = '#00FF94'
              ctx.lineWidth = 2
              ctx.strokeRect(x1, y1, x2 - x1, y2 - y1)
            })
          }
          imgRef.current.src = `data:image/jpeg;base64,${msg.frame}`
        }
      } catch {}
    }

    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('ping')
    }, 5000)

    return () => {
      clearInterval(ping)
      ws.close()
    }
  }, [cameraId])

  return (
    <div className="relative w-full h-full bg-kraken-base rounded-xl overflow-hidden border border-kraken-border">
      <canvas
        ref={canvasRef}
        className="w-full h-full object-contain"
        style={{ display: connected ? 'block' : 'none' }}
      />
      {!connected && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <div className="text-4xl opacity-20">🎥</div>
          <div className="text-kraken-disabled text-xs">Public Screen</div>
        </div>
      )}
      {/* Watermark */}
      <div className="absolute bottom-2 right-2 text-kraken-disabled text-xs opacity-50">
        Kraken
      </div>
    </div>
  )
}
