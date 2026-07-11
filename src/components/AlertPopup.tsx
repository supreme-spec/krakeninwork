import { useEffect, useState } from 'react'
import { X, AlertTriangle, Star, User, Siren, Shield } from 'lucide-react'
import type { AlertMessage } from '../types'
import { PHOTO_BASE } from '../api/client'

interface Props {
  alert: AlertMessage | null
  onDismiss: () => void
}

// Remap ArcFace cosine similarity [0.28..0.85] → [0%..100%]
function cosineToPercent(cosine: number): number {
  const clamped = Math.max(0.28, Math.min(0.85, cosine))
  return Math.round(((clamped - 0.28) / (0.85 - 0.28)) * 100)
}

export default function AlertPopup({ alert, onDismiss }: Props) {
  const [visible, setVisible] = useState(false)
  const [snapshotFailed, setSnapshotFailed] = useState(false)
  const [photoFailed, setPhotoFailed] = useState(false)

  useEffect(() => {
    if (alert) {
      setVisible(true)
      setSnapshotFailed(false)
      setPhotoFailed(false)
      if (alert.category === 'VIP') {
        const t = setTimeout(() => {
          setVisible(false)
          setTimeout(onDismiss, 300)
        }, 5000)
        return () => clearTimeout(t)
      }
      // RESPONSE — автозакрытие через 8 секунд
      if (alert.category === 'RESPONSE') {
        const t = setTimeout(() => {
          setVisible(false)
          setTimeout(onDismiss, 300)
        }, 8000)
        return () => clearTimeout(t)
      }
    } else {
      setVisible(false)
    }
  }, [alert, onDismiss])

  if (!alert) return null

  const isBlacklist = alert.category === 'BLACKLIST'
  const isResponse  = alert.category === 'RESPONSE'
  const isVip       = alert.category === 'VIP'
  const isSecurity  = alert.category === 'SECURITY'

  let photoUrl: string | null = null
  if (!snapshotFailed && alert.snapshot_path) {
    photoUrl = `${PHOTO_BASE}/${alert.snapshot_path}`
  } else if (!photoFailed && alert.photo_path) {
    photoUrl = `${PHOTO_BASE}/${alert.photo_path}`
  }

  const borderClass = isBlacklist ? 'border-kraken-red shadow-glow-red'
    : isResponse  ? 'border-kraken-orange shadow-glow-orange'
    : isSecurity  ? 'border-kraken-gold'
    : 'border-kraken-green shadow-glow-green'

  const bgStyle = isBlacklist ? 'rgba(32, 15, 20, 0.75)'
    : isResponse  ? 'rgba(32, 21, 15, 0.75)'
    : isSecurity  ? 'rgba(20, 18, 15, 0.75)'
    : 'rgba(11, 24, 20, 0.75)'

  const titleColor = isBlacklist ? 'text-kraken-red'
    : isResponse  ? 'text-kraken-orange'
    : isSecurity  ? 'text-kraken-gold'
    : 'text-kraken-green'

  const titleText = isBlacklist ? '⚠ ЧЁРНЫЙ СПИСОК'
    : isResponse  ? '🚨 РЕАГИРОВАНИЕ'
    : isSecurity  ? '🛡 ОХРАНА'
    : '⭐ VIP Прибыл'

  const Icon = isBlacklist ? AlertTriangle : isResponse ? Siren : isSecurity ? Shield : Star
  const iconColor = isBlacklist ? 'text-kraken-red' : isResponse ? 'text-kraken-orange' : isSecurity ? 'text-kraken-gold' : 'text-kraken-green'

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-300 backdrop-blur-sm ${
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      style={{ backgroundColor: bgStyle }}
      onClick={isVip ? onDismiss : undefined}
    >
      <div
        className={`relative panel p-6 max-w-sm w-full mx-4 animate-slide-in ${borderClass}`}
        onClick={e => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onDismiss}
          className="absolute top-3 right-3 text-kraken-muted hover:text-kraken-text"
        >
          <X size={16} />
        </button>

        {/* Icon + title */}
        <div className="flex items-center gap-3 mb-4">
          <Icon size={28} className={`${iconColor} flex-shrink-0`} />
          <div>
            <div className={`font-bold text-lg ${titleColor}`}>{titleText}</div>
            <div className="text-kraken-muted text-xs">Камера {alert.camera_id}</div>
          </div>
        </div>

        {/* Person info */}
        <div className="flex items-center gap-3">
          <div className="w-16 h-16 rounded-lg overflow-hidden border border-kraken-border flex-shrink-0 bg-kraken-hover flex items-center justify-center">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt={alert.person_name}
                className="w-full h-full object-cover"
                onError={() => {
                  if (!snapshotFailed && alert.snapshot_path) {
                    setSnapshotFailed(true)
                  } else {
                    setPhotoFailed(true)
                  }
                }}
              />
            ) : (
              <User size={28} className="text-kraken-disabled" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="text-kraken-text font-bold text-base truncate">{alert.person_name}</div>
            <div className="text-kraken-muted text-sm">
              Совпадение: {cosineToPercent(alert.confidence)}%
            </div>
            <div className="text-kraken-disabled text-xs mt-1">
              {new Date(alert.timestamp).toLocaleTimeString('ru-RU')}
            </div>
          </div>
        </div>

        {/* Action button for BLACKLIST and RESPONSE */}
        {(isBlacklist || isResponse) && (
          <button
            onClick={onDismiss}
            className={`mt-4 w-full text-center px-4 py-2 rounded-lg font-medium transition-colors text-white ${
              isBlacklist
                ? 'bg-kraken-red hover:bg-kraken-red-active'
                : 'bg-kraken-orange hover:bg-kraken-orange-hover'
            }`}
          >
            Принято
          </button>
        )}
      </div>
    </div>
  )
}
