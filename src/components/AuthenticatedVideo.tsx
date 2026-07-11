/**
 * AuthenticatedVideo — загружает видео через fetch с JWT токеном,
 * создаёт Blob URL и передаёт в <video>.
 *
 * Решает проблему: <video src="..."> не отправляет Authorization header,
 * поэтому защищённые видео не воспроизводятся.
 */
import { useEffect, useRef, useState } from 'react'

interface Props {
  src: string
  className?: string
  style?: React.CSSProperties
  controls?: boolean
  muted?: boolean
  preload?: string
  autoPlay?: boolean
  onLoadedMetadata?: (e: React.SyntheticEvent<HTMLVideoElement>) => void
  onError?: (err: string) => void
  onClick?: () => void
}

export default function AuthenticatedVideo({
  src,
  className,
  style,
  controls = true,
  muted = false,
  preload = 'metadata',
  autoPlay = false,
  onLoadedMetadata,
  onError,
  onClick,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const token = localStorage.getItem('kraken_token')
        const res = await fetch(src, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`)
        }
        const blob = await res.blob()
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setBlobUrl(objectUrl)
      } catch (e: any) {
        if (!cancelled) {
          const msg = e.message || 'Failed to load video'
          setError(msg)
          onError?.(msg)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    if (src) {
      load()
    }

    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [src, onError])

  if (error) {
    return (
      <div
        className={`flex items-center justify-center bg-black text-kraken-red text-xs ${className || ''}`}
        style={style}
      >
        <span>Ошибка загрузки видео</span>
      </div>
    )
  }

  return (
    <>
      {loading && (
        <div
          className={`flex items-center justify-center bg-black text-kraken-muted text-xs ${className || ''}`}
          style={style}
        >
          <span className="animate-pulse">Загрузка видео...</span>
        </div>
      )}
      {blobUrl && (
        <video
          ref={videoRef}
          src={blobUrl}
          className={className}
          style={style}
          controls={controls}
          muted={muted ?? true}
          preload={preload}
          autoPlay={autoPlay}
          onLoadedMetadata={onLoadedMetadata}
          onClick={onClick}
          playsInline
        />
      )}
    </>
  )
}
