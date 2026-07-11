/**
 * useAlertSounds — управление звуками оповещений.
 *
 * Для каждой категории (BLACKLIST, VIP, RESPONSE, UNKNOWN) можно:
 * - Использовать встроенный синтезированный звук (по умолчанию)
 * - Загрузить свой MP3/WAV/OGG файл
 * - Отключить звук
 * - Настроить громкость
 *
 * Настройки хранятся в localStorage.
 * Файлы хранятся как base64 в localStorage (до ~5MB на файл).
 */

export type SoundCategory = 'BLACKLIST' | 'VIP' | 'RESPONSE' | 'SECURITY' | 'UNKNOWN'

export interface SoundConfig {
  mode: 'builtin' | 'custom' | 'off'
  customName?: string
  customData?: string
  customType?: string
  volume: number
}

const STORAGE_KEY = 'kraken_alert_sounds'

const DEFAULTS: Record<SoundCategory, SoundConfig> = {
  BLACKLIST: { mode: 'builtin', volume: 1.0 },
  VIP:       { mode: 'builtin', volume: 0.8 },
  RESPONSE:  { mode: 'builtin', volume: 0.9 },
  SECURITY:  { mode: 'builtin', volume: 0.5 },
  UNKNOWN:   { mode: 'builtin', volume: 0.5 },
}

export function loadSoundConfigs(): Record<SoundCategory, SoundConfig> {
  try {
    const s = localStorage.getItem(STORAGE_KEY)
    if (s) {
      const parsed = JSON.parse(s)
      return { ...DEFAULTS, ...parsed }
    }
  } catch {}
  return { ...DEFAULTS }
}

export function saveSoundConfigs(configs: Record<SoundCategory, SoundConfig>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configs))
  } catch (e) {
    console.warn('Could not save sound configs (storage full?):', e)
  }
}

// ── Воспроизведение ───────────────────────────────────────────────────────────

let _audioCtx: AudioContext | null = null

function getCtx(): AudioContext | null {
  try {
    if (!_audioCtx || _audioCtx.state === 'closed') _audioCtx = new AudioContext()
    if (_audioCtx.state === 'suspended') _audioCtx.resume()
    return _audioCtx
  } catch { return null }
}

// Кэш декодированных буферов чтобы не декодировать каждый раз
const _bufferCache: Map<string, AudioBuffer> = new Map()

async function playCustomSound(config: SoundConfig): Promise<void> {
  if (!config.customData || !config.customType) return
  const ctx = getCtx()
  if (!ctx) return

  try {
    let buffer = _bufferCache.get(config.customData.slice(0, 50))
    if (!buffer) {
      const binStr = atob(config.customData)
      const arr = new Uint8Array(binStr.length)
      for (let i = 0; i < binStr.length; i++) arr[i] = binStr.charCodeAt(i)
      buffer = await ctx.decodeAudioData(arr.buffer)
      _bufferCache.set(config.customData.slice(0, 50), buffer)
    }

    const source = ctx.createBufferSource()
    const gainNode = ctx.createGain()
    source.buffer = buffer
    source.connect(gainNode)
    gainNode.connect(ctx.destination)
    gainNode.gain.value = config.volume
    source.start()
  } catch (e) {
    console.warn('Custom sound playback error:', e)
  }
}

function playBuiltinBlacklist(volume: number) {
  const ctx = getCtx(); if (!ctx) return
  const t = ctx.currentTime
  for (let i = 0; i < 4; i++) {
    const osc = ctx.createOscillator(); const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.type = 'sawtooth'; osc.frequency.value = i % 2 === 0 ? 440 : 330
    const s = t + i * 0.18
    gain.gain.setValueAtTime(0.35 * volume, s)
    gain.gain.exponentialRampToValueAtTime(0.001, s + 0.16)
    osc.start(s); osc.stop(s + 0.17)
  }
}

function playBuiltinVip(volume: number) {
  const ctx = getCtx(); if (!ctx) return
  const t = ctx.currentTime
  ;[523, 659, 784, 1047].forEach((freq, i) => {
    const osc = ctx.createOscillator(); const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.type = 'sine'; osc.frequency.value = freq
    const s = t + i * 0.1
    gain.gain.setValueAtTime(0, s)
    gain.gain.linearRampToValueAtTime(0.2 * volume, s + 0.04)
    gain.gain.exponentialRampToValueAtTime(0.001, s + 0.25)
    osc.start(s); osc.stop(s + 0.26)
  })
}

function playBuiltinResponse(volume: number) {
  const ctx = getCtx(); if (!ctx) return
  const t = ctx.currentTime
  ;[660, 880, 660, 880].forEach((freq, i) => {
    const osc = ctx.createOscillator(); const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.type = 'triangle'; osc.frequency.value = freq
    const s = t + i * 0.14
    gain.gain.setValueAtTime(0, s)
    gain.gain.linearRampToValueAtTime(0.28 * volume, s + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.001, s + 0.13)
    osc.start(s); osc.stop(s + 0.14)
  })
}

function playBuiltinSecurity(volume: number) {
  const ctx = getCtx(); if (!ctx) return
  const t = ctx.currentTime
  ;[440, 550].forEach((freq, i) => {
    const osc = ctx.createOscillator(); const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.type = 'sine'; osc.frequency.value = freq
    const s = t + i * 0.15
    gain.gain.setValueAtTime(0, s)
    gain.gain.linearRampToValueAtTime(0.12 * volume, s + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.001, s + 0.18)
    osc.start(s); osc.stop(s + 0.19)
  })
}

function playBuiltinUnknown(volume: number) {
  const ctx = getCtx(); if (!ctx) return
  const t = ctx.currentTime
  ;[880, 1100].forEach((freq, i) => {
    const osc = ctx.createOscillator(); const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.type = 'sine'; osc.frequency.value = freq
    const s = t + i * 0.12
    gain.gain.setValueAtTime(0, s)
    gain.gain.linearRampToValueAtTime(0.15 * volume, s + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.001, s + 0.12)
    osc.start(s); osc.stop(s + 0.13)
  })
}

export async function playAlertSound(
  category: SoundCategory,
  configs: Record<SoundCategory, SoundConfig>,
): Promise<void> {
  const config = configs[category] ?? DEFAULTS[category]
  if (config.mode === 'off') return

  if (config.mode === 'custom' && config.customData) {
    await playCustomSound(config)
    return
  }

  // Builtin
  const vol = config.volume
  switch (category) {
    case 'BLACKLIST': playBuiltinBlacklist(vol); break
    case 'VIP':       playBuiltinVip(vol);       break
    case 'RESPONSE':  playBuiltinResponse(vol);  break
    case 'SECURITY':  playBuiltinSecurity(vol);  break
    case 'UNKNOWN':   playBuiltinUnknown(vol);   break
  }
}

// Инициализация AudioContext по клику пользователя
export function initAudio() {
  getCtx()
}
