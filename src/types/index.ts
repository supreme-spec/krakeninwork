export type Category = string  // динамические категории из БД

export interface PersonCategory {
  code: string
  label: string
  color: string
  bg_color: string
  is_alert: boolean
  alert_sound: string
  alert_volume: number
  detect_enabled: boolean
  sort_order: number
  is_system: boolean
}

export interface PersonPhoto {
  id: number
  photo_path: string
  is_primary: boolean
  created_at: string
}

export interface Person {
  id: number
  name: string
  category: Category
  position?: string | null
  comment?: string | null
  phone?: string | null
  email?: string | null
  birth_date?: string | null
  address?: string | null
  organization?: string | null
  extra_info?: string | null
  photo_path?: string | null
  photos: PersonPhoto[]
  is_active: boolean
  created_at: string
  last_seen_at?: string | null
  visit_count: number
  embedding_count: number
}

export interface RoiZone {
  x1: number
  y1: number
  x2: number
  y2: number
  label: string
}

export interface Camera {
  id: number
  name: string
  source: string
  camera_type: 'USB' | 'RTSP' | 'IP' | 'ONVIF' | 'Hikvision' | 'UNV'
  zone?: string
  is_active: boolean
  created_at: string
  status: 'online' | 'offline' | 'connecting' | 'reconnecting'
  roi_zones?: RoiZone[] | null
  fps?: number | null
  ping_ms?: number | null
  is_smart_recording: boolean
  is_chronicle: boolean
  // IP Camera fields
  driver_type?: string | null
  ip_address?: string | null
  ip_port?: number | null
  username?: string | null
  password?: string | null
  use_camera_analytics?: boolean
  brand?: string | null
  model_name?: string | null
}

export interface KrakenEvent {
  id: number
  camera_id?: number
  camera_name?: string
  person_id?: number
  event_type: 'RECOGNIZED' | 'UNKNOWN' | 'BLACKLIST_ALERT' | 'VIP_ARRIVAL' | 'RESPONSE_ALERT'
  confidence?: number
  snapshot_path?: string | null
  person_name?: string
  person_category?: Category
  person_photo_path?: string   // registered photo from DB
  created_at: string
  needs_operator_confirmation?: boolean
  confirmation_status?: 'pending' | 'confirmed' | 'rejected'
}

export interface FaceDetection {
  track_id: number
  bbox: [number, number, number, number]
  person_id?: number
  person_name?: string
  category?: Category
  confidence?: number
  comment?: string
  photo_path?: string
}

export interface FrameMessage {
  type: 'FRAME'
  camera_id: number
  timestamp: number
  frame: string  // base64 JPEG
  faces: FaceDetection[]
}

export interface AlertMessage {
  type: 'ALERT'
  category: 'BLACKLIST' | 'VIP' | 'RESPONSE' | 'SECURITY'
  person_id: number
  person_name: string
  camera_id: number
  confidence: number
  snapshot_path?: string
  photo_path?: string   // person's registered photo (fallback when snapshot missing)
  timestamp: string
}
