import express from "express";
import path from "path";
import { platform } from "os";
import fs from "fs";
import http from "http";
import multer from "multer";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import { spawn, exec, ChildProcessWithoutNullStreams } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
import axios from "axios";
import sharp from "sharp";
import iconv from "iconv-lite";
import { ZipArchive } from "archiver";
import * as unzipper from "unzipper";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import AdmZip from "adm-zip";
import {
  initFaceEngine,
  initFaceEngineWithDB,
  detectFaces,
  detectFacesFast,
  getEmbedding,
  extractEmbedding,
  registerPerson as registerFacePerson,
  registerPersonFromDescriptor,
  unregisterPerson as unregisterFacePerson,
  searchByPhoto,
  rebuildDescriptorIndex,
  getEngineStatus,
  assessPhotoQuality,
  searchByDescriptor,
  addEmbeddingToPerson,
} from "./face-engine.js";
import { prisma } from "./db.js";
import logger, { logInfo, logError, logWarn, logDebug } from "./src/lib/logger.js";

// ─── GLOBAL ERROR HANDLERS (catch unhandled rejections/exceptions) ─────────────
let isHandlingError = false;
process.on("uncaughtException", (err) => {
  if (isHandlingError) {
    // Предотвращаем бесконечный цикл: EPIPE → uncaughtException → logError → EPIPE → ...
    process.stderr.write(`[FATAL] Recursive error: ${err.message}\n`);
    return;
  }
  isHandlingError = true;
  logError(err as Error, { context: "uncaughtException" });
  isHandlingError = false;
});
process.on("unhandledRejection", (reason: any) => {
  if (isHandlingError) return;
  isHandlingError = true;
  logError(new Error(String(reason)), { context: "unhandledRejection" });
  isHandlingError = false;
});

// ── __filename / __dirname ────────────────────────────────────────────────────
// tsx запускает файл как ESM-модуль → используем import.meta.url напрямую.
// esbuild при сборке в CJS заменяет import.meta.url на require-аналог автоматически.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// NODE_ENV
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = __dirname.includes("dist") ? "production" : "development";
}

const app = express();
const server = http.createServer(app);
const PORT = parseInt(process.env.PORT || "3000", 10);
// Привязка: по умолчанию 0.0.0.0 (доступно в локальной сети для камер/операторов).
// Для чисто локального use-case задайте HOST=127.0.0.1. БЕЗОПАСНОСТЬ: при публикации порта
// обязательно задайте API_KEY, иначе API и WS будут открыты для сети.
const HOST = process.env.HOST || "0.0.0.0";
// Опциональный API-ключ. Если задан — сервер требует его на всех /api и /ws.
// Если не задан — сервер работает открыто (dev), но выводит предупреждение.
const API_KEY = process.env.API_KEY || "";
const DEBUG_CAMERA_IDS = new Set(
  (process.env.DEBUG_CAMERA_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

app.use(express.json());

// Middleware для логирования запросов
app.use((req, res, next) => {
  const start = Date.now();
  const sensitiveParams = ["api_key", "password", "token", "secret", "Authorization"];
  let logUrl = req.url;
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    sensitiveParams.forEach(param => {
      if (url.searchParams.has(param)) {
        url.searchParams.set(param, "[REDACTED]");
      }
    });
    logUrl = url.pathname + url.search;
  } catch {
    const lower = req.url.toLowerCase();
    sensitiveParams.forEach(param => {
      const regex = new RegExp(`(${param}=)[^&]*`, "gi");
      logUrl = lower.replace(regex, "$1[REDACTED]");
    });
  }
  // Пропускаем шумные polling-эндпоинты
  const isPolling = /^\/api\/(cameras|events|health|persons\/?$|diagnose)/.test(req.path);
  
  if (!isPolling) {
    logInfo(`${req.method} ${logUrl}`, { ip: req.ip });
  }

  res.on("finish", () => {
    const duration = Date.now() - start;
    // Для polling логируем только ошибки (не 2xx/3xx)
    if (!isPolling || res.statusCode >= 400) {
      logInfo(`${req.method} ${logUrl} ${res.statusCode}`, { duration: `${duration}ms` });
    }
  });

  next();
});

function safeParseInt(value: any, fallback = 0): number {
  const n = typeof value === "string" ? parseInt(value, 10) : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// API-key аутентификация (включается только если задан API_KEY в .env)
function apiKeyAuth(req: any, res: any, next: any) {
  if (!API_KEY) return next();
  const auth = req.headers["authorization"] || "";
  const headerKey = req.headers["x-api-key"];
  const token = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token === API_KEY || headerKey === API_KEY) return next();
  return res.status(401).json({ detail: "Unauthorized: требуется API_KEY" });
}

function getCameraConfig(ip: string): any | null {
  const cleanIp = ip.replace(/^::ffff:/i, "");
  const cam = cameras.find((c) => {
    const camIp = c.ip_address || new URL(c.source).hostname;
    return camIp === cleanIp;
  });

  if (!cam) return null;

  const brand =
    cam.camera_type === "Hikvision"
      ? "hikvision"
      : cam.camera_type === "UNV"
        ? "uniview"
        : "uniview";
  const parsedSource = cam.source ? new URL(cam.source) : null;

  return {
    id: String(cam.id),
    ip: cam.ip_address || parsedSource?.hostname || cleanIp,
    username: cam.username || "admin",
    password: cam.password || "",
    brand,
  };
}

const ALLOWED_CAMERA_IPS = new Set<string>([
  '192.168.10.197',
  '192.168.100.155',
]);

const webhookCooldown = new Map<string, number>();
const COOLDOWN_MS = 3000;

const SNAPSHOT_PATHS = {
  hikvision: '/ISAPI/Streaming/channels/101/picture',
  uniview: '/images/snapshot.jpg',
};

const TRIGGER_KEYWORDS = ['face', 'human', 'vmd', 'regionentrance', 'linedetection', 'intelligent', 'alarm'];

app.post(
  ["/webhooks/camera", "/webhooks/camera/"],
  express.text({ type: ["application/xml", "application/json", "text/plain"] }),
  async (req, res) => {
    try {
      const clientIp = (req.ip || req.socket.remoteAddress || "").replace(/^::ffff:/i, "");

      if (!ALLOWED_CAMERA_IPS.has(clientIp)) {
        logWarn(`[Webhook] Отклонен запрос с неизвестного IP: ${clientIp}`);
        return res.status(403).send("Forbidden");
      }

      const now = Date.now();
      const lastTime = webhookCooldown.get(clientIp) || 0;
      if (now - lastTime < COOLDOWN_MS) {
        return res.status(200).send("OK");
      }

      const payload = typeof req.body === "string" ? req.body.toLowerCase() : JSON.stringify(req.body).toLowerCase();
      const isTrigger = TRIGGER_KEYWORDS.some((keyword) => payload.includes(keyword));
      if (!isTrigger) {
        return res.status(200).send("OK");
      }

      const camera = cameras.find((c) => c.ip_address === clientIp);
      if (!camera) {
        logWarn(`[Webhook] Камера с IP ${clientIp} не найдена в базе`);
        return res.status(404).send("Camera not found");
      }

      webhookCooldown.set(clientIp, now);
      logInfo(`[Webhook] Детекция от ${camera.camera_type} камеры ${camera.name} (${clientIp})`);

      const snapshotBuffer = await fetchSnapshotFromCamera(camera);
      if (!snapshotBuffer) {
        logError(new Error(`Не удалось получить снимок с камеры ${clientIp}`), { context: "webhook-pull" });
        return res.status(200).send("OK");
      }

      res.status(200).send("OK");

      processRecognitionInBackground(camera, snapshotBuffer).catch((err) => {
        logError(err, { context: "Background recognition processing" });
      });
    } catch (err) {
      logError(err as Error, { context: "universal camera webhook" });
      return res.status(200).send("OK");
    }
  }
);

async function fetchSnapshotFromCamera(camera: any): Promise<Buffer | null> {
  const brand = (camera.camera_type || "").toLowerCase().includes("unv") ? "uniview" : "hikvision";
  const snapshotPath = SNAPSHOT_PATHS[brand];
  const auth = camera.username && camera.password ? { username: camera.username, password: camera.password } : undefined;

  try {
    const url = `http://${camera.ip_address}${snapshotPath}`;
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      auth,
      timeout: 2500,
      maxRedirects: 0,
    } as any);

    const buffer = Buffer.from(response.data as ArrayBuffer);
    if (buffer.length > 2 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      logDebug(`[Snapshot] Успешно получен с ${camera.ip_address} по пути ${snapshotPath}`);
      return buffer;
    }
  } catch (err) {
    // ignore
  }
  return null;
}

async function processRecognitionInBackground(camera: any, snapshotBuffer: Buffer) {
  try {
    const FormDataCtor = (globalThis as any).FormData;
    if (!FormDataCtor) {
      throw new Error("FormData is not available in this environment");
    }

    const form = new FormDataCtor();
    form.append("image", snapshotBuffer, { filename: "snapshot.jpg", contentType: "image/jpeg" });
    form.append("camera_id", String(camera.id));

    const faceServerUrl = process.env.FACE_SERVER_URL || "http://localhost:8001";
    const recognitionRes = await axios.post(`${faceServerUrl}/recognize`, form, {
      headers: (form as any).getHeaders ? (form as any).getHeaders() : {},
      timeout: 3000,
    });

    const result: any = recognitionRes.data;

    if (result.status === "ok" && result.matches && result.matches.length > 0) {
      const bestMatch = result.matches[0];
      logInfo(`✅ Распознан: ${bestMatch.person_name} (${(bestMatch.similarity * 100).toFixed(1)}%) на ${camera.name}`);

      const targetFilename = `${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`;
      const targetPath = path.join(snapshotsDir, targetFilename);
      await fs.promises.writeFile(targetPath, snapshotBuffer);
      const savedSnapshotPath = `snapshots/${targetFilename}`;

      const metaFilename = `${path.basename(targetFilename, '.jpg')}.json`;
      const metaPath = path.join(snapshotsDir, metaFilename);
      await fs.promises.writeFile(metaPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        camera_id: camera.id,
        camera_name: camera.name,
        person_id: bestMatch.person_id ?? null,
        person_name: bestMatch.person_name,
        category: bestMatch.category,
        confidence: bestMatch.similarity,
        face_bbox: result.face_bbox || null,
        sharpness: result.sharpness ?? null,
        quality_score: result.quality_score ?? null,
        snapshot_path: savedSnapshotPath,
      }, null, 2));

      let matchedPerson: any = null;
      if (bestMatch.person_id) {
        matchedPerson = await prisma.person.findUnique({ where: { id: bestMatch.person_id } });
      }

      if (matchedPerson) {
        await prisma.person.update({
          where: { id: matchedPerson.id },
          data: { visit_count: { increment: 1 }, last_seen_at: new Date() },
        });

        let event_type = "RECOGNIZED";
        if (matchedPerson.category === "VIP") event_type = "VIP_ARRIVAL";
        else if (matchedPerson.category === "BLACKLIST") event_type = "BLACKLIST_ALERT";
        else if (matchedPerson.category === "RESPONSE") event_type = "RESPONSE_ALERT";

        await prisma.event.create({
          data: {
            camera_id: camera.id,
            camera_name: camera.name,
            person_id: matchedPerson.id,
            event_type,
            confidence: bestMatch.similarity,
            snapshot_path: savedSnapshotPath,
            person_name: matchedPerson.name,
            person_category: matchedPerson.category,
            person_photo_path: matchedPerson.photo_path,
          },
        });

        broadcastSecurity({
          type: "ALERT",
          category: matchedPerson.category,
          person_id: matchedPerson.id,
          person_name: matchedPerson.name,
          camera_id: camera.id,
          confidence: bestMatch.similarity,
          snapshot_path: savedSnapshotPath,
          timestamp: new Date().toISOString(),
        });
        broadcastSecurity({ type: "EVENT" });
      }
    } else {
      logInfo(`⚠️ Лицо обнаружено, но не распознано на ${camera.name}`);
    }
  } catch (err: any) {
    logError(err, { context: "Background recognition processing" });
  }
}


app.use("/api", apiKeyAuth);

// ── ENSURE DIRECTORIES & ASSETS EXIST ──
const FALLBACK_JPEG = "/9j/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCADwAUADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAME/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AnIDSiAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//9k=";

const publicDir = path.join(process.cwd(), "public");
const photosDir = path.join(publicDir, "photos");
const snapshotsDir = path.join(publicDir, "snapshots");
const recordingsDir = path.join(publicDir, "recordings");

function initDirectories() {
  for (const d of [publicDir, photosDir, snapshotsDir, recordingsDir]) {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
    }
  }

  // Copy rus.jpg and logo.jpg to photos and snapshots directories
  const rusSrc = path.join(process.cwd(), "src", "assets", "rus.jpg");
  const logoSrc = path.join(process.cwd(), "src", "assets", "logo.jpg");

  const mockPhotos = ["pushkin.jpg", "tolstoy.jpg", "johndoe.jpg", "kuznetsova.jpg"];
  const mockSnapshots = ["ev1.jpg", "ev2.jpg", "ev3.jpg", "alert_johndoe.jpg"];

  for (const name of mockPhotos) {
    const dest = path.join(photosDir, name);
    if (!fs.existsSync(dest)) {
      if (fs.existsSync(rusSrc)) {
        fs.copyFileSync(rusSrc, dest);
      } else if (fs.existsSync(logoSrc)) {
        fs.copyFileSync(logoSrc, dest);
      } else {
        fs.writeFileSync(dest, Buffer.from(FALLBACK_JPEG, "base64"));
      }
    }
  }

  for (const name of mockSnapshots) {
    const dest = path.join(snapshotsDir, name);
    if (!fs.existsSync(dest)) {
      if (fs.existsSync(rusSrc)) {
        fs.copyFileSync(rusSrc, dest);
      } else {
        fs.writeFileSync(dest, Buffer.from(FALLBACK_JPEG, "base64"));
      }
    }
  }
}
initDirectories();

function parseRoiZones(cam: any): any[] {
  try {
    if (!cam.roi_zones) return [];
    const parsed = JSON.parse(cam.roi_zones);
    if (!Array.isArray(parsed)) return [];
    
    // Масштабируем ROI под выходное разрешение FFmpeg (может отличаться от потока)
    const out = getStreamResolution(cam);
    const roiW = cam.roi_width || 0;
    const roiH = cam.roi_height || 0;
    
    if (roiW && roiH && (out.width !== roiW || out.height !== roiH)) {
      const scaleX = out.width / roiW;
      const scaleY = out.height / roiH;
      return parsed.map((z: any) => ({
        ...z,
        x1: Math.round((Number(z.x1 ?? z.x ?? 0)) * scaleX),
        y1: Math.round((Number(z.y1 ?? z.y ?? 0)) * scaleY),
        x2: Math.round((Number(z.x2 ?? ((z.x ?? 0) + (z.width ?? 0)))) * scaleX),
        y2: Math.round((Number(z.y2 ?? ((z.y ?? 0) + (z.height ?? 0)))) * scaleY),
      }));
    }
    
    return parsed;
  } catch {
    return [];
  }
}

function isPointInRoi(x: number, y: number, zones: any[]): boolean {
  if (!zones.length) return true;
  for (const zone of zones) {
    const zoneX = Number(zone.x ?? zone.x1 ?? 0);
    const zoneY = Number(zone.y ?? zone.y1 ?? 0);
    const zoneW = Number(zone.width ?? ((zone.x2 ?? 0) - zoneX));
    const zoneH = Number(zone.height ?? ((zone.y2 ?? 0) - zoneY));
    const x1 = zoneX;
    const y1 = zoneY;
    const x2 = zoneX + zoneW;
    const y2 = zoneY + zoneH;
    if (x >= x1 && x <= x2 && y >= y1 && y <= y2) return true;
  }
  return false;
}

function filterFacesByRoi(faces: any[], roiZones: any[]): any[] {
  if (!roiZones.length) return faces;
  return faces.filter((f) => {
    const box = f.box || {};
    const cx = (box.x || 0) + (box.width || 0) / 2;
    const cy = (box.y || 0) + (box.height || 0) / 2;
    return isPointInRoi(cx, cy, roiZones);
  });
}

// Serve the uploaded photos, snapshots, and recordings statically with API-key protection
app.use("/photos", apiKeyAuth, express.static(photosDir));
app.use("/snapshots", apiKeyAuth, express.static(snapshotsDir));
app.use("/recordings", apiKeyAuth, express.static(recordingsDir));

// Multer upload setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, photosDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    const uniqueName = `upload_${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
    cb(null, uniqueName);
  },
});
const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/bmp"]);
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 500,
  },
  fileFilter: (_req, _file, cb) => cb(null, true),
  // КРИТИЧНО: заставляем busboy/multer читать имена файлов как UTF-8,
  // а не Latin-1 (по умолчанию). Без этого кириллица в именах файлов
  // превращается в кракозябры.
  defParamCharset: "utf8",
});

// ── Кириллица: исправление кракозябр ─────────────────────────────────────────

function fixDoubleEncodedCyrillic(value: string): string {
  if (typeof value !== 'string') return value
  if (!value) return value
  
  // Если уже содержит кириллицу — возвращаем как есть
  if (/[а-яА-ЯёЁ]/.test(value)) return value
  
  // Вариант 1: Прямое декодирование из Latin-1 в UTF-8 (работает для типичных кракозябр)
  try {
    const latin1Bytes = Buffer.from(value, 'latin1')
    const decoded = iconv.decode(latin1Bytes, 'utf8')
    if (decoded && /[а-яА-ЯёЁ]/.test(decoded)) {
      return decoded
    }
  } catch {}
  
  // Вариант 2: Двойное декодирование (если кракозябры двойные)
  try {
    const latin1Bytes = Buffer.from(value, 'latin1')
    const decoded1 = iconv.decode(latin1Bytes, 'utf8')
    if (decoded1 && /[а-яА-ЯёЁ]/.test(decoded1)) {
      const latin1Bytes2 = Buffer.from(decoded1, 'latin1')
      const decoded2 = iconv.decode(latin1Bytes2, 'utf8')
      if (decoded2 && /[а-яА-ЯёЁ]/.test(decoded2)) {
        return decoded2
      }
    }
  } catch {}
  
  // Вариант 3: Windows-1251 → UTF-8
  try {
    const decoded = iconv.decode(Buffer.from(value, 'utf8'), 'windows-1251')
    if (decoded && /[а-яА-ЯёЁ]/.test(decoded)) {
      return decoded
    }
  } catch {}
  
  // Если ничего не помогло — возвращаем как есть
  return value
}

/** Нормализует ФИО: убирает лишние пробелы, каждое слово с заглавной */
function normalizePersonName(name: string): string {
  if (!name) return name
  
  // Убираем (*) — маркеры из имени файла
  name = name.replace(/\s*\([^)]*\)\s*/g, ' ').trim()
  
  // Убираем все лишние пробелы (более 1 подряд → 1)
  let normalized = name.replace(/\s+/g, ' ').trim()
  
  // Убираем ведущие/конечные пробелы и спецсимволы
  normalized = normalized.replace(/^[\s\-_]+|[\s\-_]+$/g, '')
  
  // Приводим к формату: каждое слово с заглавной буквы (включая части после дефиса)
  normalized = normalized.split(' ').map(w => {
    if (!w) return ''
    // Если слово полностью цифрами — оставляем как есть
    if (/^\d+$/.test(w)) return w
    // Обрабатываем дефис: каждая часть с заглавной
    if (w.includes('-')) {
      return w.split('-').map(part => {
        if (!part) return ''
        if (/^\d+$/.test(part)) return part
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
      }).join('-')
    }
    // Иначе: первая заглавная, остальные строчные
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  }).join(' ')
  
  return normalized
}

/** Нормализует должность: только 1-е слово с заглавной, все остальные строчные */
function normalizePositionName(pos: string): string {
  if (!pos) return pos
  
  // Убираем (*) — маркеры из имени файла
  pos = pos.replace(/\s*\([^)]*\)\s*/g, ' ').trim()
  
  // Убираем все лишние пробелы
  let normalized = pos.replace(/\s+/g, ' ').trim()
  
  const words = normalized.split(' ').filter(w => w)
  if (words.length === 0) return pos
  
  // Только первое слово с заглавной, остальные — строчные
  const result = words.map((w, i) => {
    if (!w) return ''
    if (/^\d+$/.test(w)) return w
    if (i === 0) return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    return w.toLowerCase()
  })
  
  return result.join(' ')
}

/** Создаёт ключ для поиска дубликатов (без пробелов, нижний регистр) */
function getDuplicateKey(name: string): string {
  if (!name) return ''
  return name
    .replace(/\s+/g, '')      // убираем все пробелы
    .toLowerCase()             // нижний регистр
}

// Middleware: исправляем кириллицу в body (для JSON-запросов)
// NOTE: для multipart-запросов body и files заполняются multer ВНУТРИ route handler,
// поэтому фиксы файлов делаются через fixFilesEncoding() в самих обработчиках.
app.use((req: express.Request, _res, next) => {
  if (req.body && typeof req.body === 'object' && !(req.body instanceof Buffer)) {
    for (const key of Object.keys(req.body)) {
      const raw = req.body[key]
      if (typeof raw === 'string') {
        req.body[key] = fixDoubleEncodedCyrillic(raw)
      }
    }
  }
  next()
});

/** Исправляет кириллицу в именах файлов ПОСЛЕ multer */
function fixFilesEncoding(files: Express.Multer.File[]): void {
  if (!files || !Array.isArray(files)) return
  for (const file of files) {
    if (file && typeof file.originalname === 'string') {
      file.originalname = fixDoubleEncodedCyrillic(file.originalname)
    }
  }
}


// Multer error middleware — перехватывает ошибки multer ДО стандартного error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.code === 'LIMIT_FILE_COUNT') {
    return res.status(413).json({ detail: `Слишком много файлов. Максимум: 500` });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ detail: 'Файл слишком большой. Максимум: 10 МБ' });
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ detail: `Неожиданный файл: ${err.field}` });
  }
  next(err);
});

// ── STATEFUL IN-MEMORY DATABASES ──
// NOTE: cameras и persons используются как кэш из Prisma (синхронизируются при старте и мутациях).
// Всё персистентное хранение — через Prisma/SQLite.
let cameras: any[] = [];
let persons: any[] = [];

// Дефолтные категории — используются только для первичного сида БД
let categories: any[] = [
  { code: "BLACKLIST", label: "Чёрный список", color: "#ef4444", bg_color: "#450a0a", is_alert: true,  alert_sound: "builtin", alert_volume: 1.0, detect_enabled: true,  sort_order: 1, is_system: true  },
  { code: "RESPONSE",  label: "Реагирование",  color: "#f97316", bg_color: "#431407", is_alert: true,  alert_sound: "builtin", alert_volume: 0.9, detect_enabled: true,  sort_order: 2, is_system: true  },
  { code: "VIP",       label: "VIP",            color: "#a855f7", bg_color: "#2e1065", is_alert: true,  alert_sound: "builtin", alert_volume: 0.7, detect_enabled: true,  sort_order: 3, is_system: false },
  { code: "SECURITY",  label: "Охрана",         color: "#3b82f6", bg_color: "#172554", is_alert: false, alert_sound: "off",     alert_volume: 0.5, detect_enabled: true,  sort_order: 4, is_system: false },
  { code: "STAFF",     label: "Персонал",       color: "#22c55e", bg_color: "#052e16", is_alert: false, alert_sound: "off",     alert_volume: 0.5, detect_enabled: true,  sort_order: 5, is_system: false },
  { code: "CLIENT",    label: "Клиент",         color: "#6b7280", bg_color: "#111827", is_alert: false, alert_sound: "off",     alert_volume: 0.5, detect_enabled: true,  sort_order: 6, is_system: false },
];

const DEFAULT_INCIDENT_TYPES = {
  verbal_conflict: "Словесный конфликт",
  theft_attempt: "Попытка кражи",
  theft_confirmed: "Подтвержденная кража",
  property_damage: "Порча имущества",
  alcohol_intoxication: "Алкогольное опьянение",
  hooliganism: "Хулиганство",
  other: "Другое"
};

const DEFAULT_TAG_TYPES = {
  regular_customer: "Постоянный клиент",
  polite: "Вежливый",
  big_spender: "Крупный покупатель",
  friendly: "Дружелюбный",
  promoter: "Промоутер бренда"
};

// ── SETTINGS STATE (синхронизируются с БД через Settings table) ──
let active_categories: string[] = ["BLACKLIST", "RESPONSE", "VIP"];
let recognition_threshold_pct = 45;
// Банд подтверждения оператора: между low и confirmation — «возможно, это person».
let confirmation_threshold_pct = 55; // >= → авто-распознано (подтверждение не нужно)
let low_threshold_pct = 40;          // <  → неизвестный (без подтверждения)
let verification_threshold_pct = 60;
let embedding_cache_enabled = true;
let embedding_cache_ttl_days = 30;
let face_quality_min_threshold = 0.10;
let ai_adaptive_frame_skip = true;
let auto_create_unknown_persons = true;
let faiss_ivf_threshold = 1000;
let faiss_ivf_nprobe = 10;
let camera_priority_weights: Record<string, number> = {};
let max_photos_per_person = 20;

// Chronicle и recordings — хранятся в памяти (файловый архив, не критичные данные)
interface Visitor {
  filename: string;
  person_id: number | null | undefined;
  person_name: string;
  time: string;
  photo_url: string;
  size_kb: number;
}
let chronicleData: Record<number, Record<string, Visitor[]>> = {};
let recordingsData: Record<number, Record<string, any[]>> = {};

// ── REST API ROUTES ──

// Убирает секреты (username/password) из объекта камеры перед отдачей клиенту.
// In-memory массив cameras при этом сохраняет creds для ffmpeg.
function sanitizeCamera(cam: any): any {
  if (!cam) return cam;
  const { username, password, ...safe } = cam;
  return safe;
}

// CAMERAS API
app.get(["/api/cameras", "/api/cameras/"], async (req, res) => {
  try {
    const camsFromDB = await prisma.camera.findMany({ orderBy: { id: "asc" } });
    // Sync in-memory array for WebSocket & FFmpeg use
    cameras = camsFromDB.map((c: any) => ({ ...c, status: c.status || "offline" }));
    res.json(cameras.map(sanitizeCamera));
  } catch (err) {
    logError(err as Error, { path: "/api/cameras", method: "GET" });
    res.status(500).json({ detail: "Internal server error" });
  }
});

app.get(["/api/cameras/scan/usb", "/api/cameras/scan/usb/"], async (req, res) => {
  // Попытка реального сканирования dshow-устройств через ffmpeg
  try {
    const ffmpegPath = getFfmpegPath();
    const proc = spawn(ffmpegPath, [
      "-hide_banner", "-loglevel", "quiet",
      "-f", "dshow",
      "-list_devices", "true",
      "-i", "dummy"
    ]);

    let output = "";
    proc.stdout.on("data", (d: Buffer) => { output += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { output += d.toString(); });

    await new Promise<void>((resolve) => {
      proc.on("close", () => resolve());
      // Таймаут 3 секунды
      setTimeout(resolve, 3000);
    });

    // Парсим вывод ffmpeg — ищем строки с "directshow" и именами устройств
    const devices: Array<{ index: number; source: string; name: string }> = [];
    const lines = output.split("\n");
    let inDirectShow = false;

    for (const line of lines) {
      if (line.toLowerCase().includes("directshow")) {
        inDirectShow = true;
        continue;
      }
      if (inDirectShow && line.trim().startsWith("video=")) {
        const name = line.replace("video=", "").trim();
        if (name && name !== "dummy") {
          devices.push({
            index: devices.length,
            source: name,
            name: name,
          });
        }
      }
      // Конец блока устройств
      if (inDirectShow && line.trim() === "" && devices.length > 0) {
        break;
      }
    }

    if (devices.length > 0) {
      logInfo(`Найдено ${devices.length} dshow устройств`, { devices: devices.map(d => d.name) });
      res.json({ cameras: devices, scanned: true });
    } else {
      // Fallback — типичные имена
      logWarn("Не удалось автоматически обнаружить dshow устройства, показываем подсказки");
      res.json({
        cameras: [
          { index: 0, source: "USB Video Device", name: "USB Video Device (встроенная / первая)" },
          { index: 1, source: "USB Video Device #2", name: "USB Video Device #2 (вторая)" }
        ],
        scanned: false,
        hint: "USB-камеры не обнаружены. Проверьте подключение. Показаны типичные имена."
      });
    }
  } catch (err) {
    logWarn(`Не удалось просканировать USB-устройства: ${(err as Error).message}`);
    res.json({
      cameras: [
        { index: 0, source: "USB Video Device", name: "USB Video Device (встроенная / первая)" },
        { index: 1, source: "USB Video Device #2", name: "USB Video Device #2 (вторая)" }
      ],
      scanned: false,
      hint: "Ошибка сканирования: " + (err as Error).message
    });
  }
});

app.get(["/api/cameras/scan/onvif", "/api/cameras/scan/onvif/"], (req, res) => {
  const onvifNetwork = req.query.network as string || "192.168.1";
  res.json({
    cameras: [
      { ip: `${onvifNetwork}.120`, port: 80, source: `rtsp://${onvifNetwork}.120:554/live/main`, type: "ONVIF (Hikvision)" },
      { ip: `${onvifNetwork}.155`, port: 8899, source: `rtsp://${onvifNetwork}.155:554/stream1`, type: "ONVIF (Dahua)" }
    ]
  });
});

app.post(["/api/cameras/:id/start", "/api/cameras/:id/start/"], async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const updated = await prisma.camera.update({
      where: { id },
      data: { is_active: true, status: "online" },
    });
    const index = cameras.findIndex((c) => c.id === id);
    if (index >= 0) { cameras[index].is_active = true; cameras[index].status = "online"; }

    // Проверяем источник камеры на типичные проблемы
    const sourceHint = getCameraSourceHint(updated);
    const warnings: string[] = [];
    if (sourceHint) warnings.push(sourceHint);
    if (!updated.source || !updated.source.trim()) warnings.push("Источник не указан — камера не будет работать");
    if (updated.camera_type === "USB" && !updated.source?.includes("USB Video")) {
      warnings.push("Для USB-камер на Windows используйте имя: 'USB Video Device'");
    }

    res.json({
      success: true,
      status: "online",
      camera: sanitizeCamera(updated),
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (err) {
    res.status(404).json({ detail: "Camera not found" });
  }
});

app.post(["/api/cameras/:id/stop", "/api/cameras/:id/stop/"], async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const updated = await prisma.camera.update({
      where: { id },
      data: { is_active: false, status: "offline" },
    });
    const index = cameras.findIndex((c) => c.id === id);
    if (index >= 0) { cameras[index].is_active = false; cameras[index].status = "offline"; }

    // Terminate existing WebSocket streaming sessions for this camera immediately
    const streams = cameraStreams.get(id);
    if (streams) {
      for (const ws of streams) {
        try { ws.close(); } catch {}
      }
      cameraStreams.delete(id);
    }

    res.json({ success: true, status: "offline", camera: sanitizeCamera(updated) });
  } catch (err) {
    res.status(404).json({ detail: "Camera not found" });
  }
});

function findNameAndSimilarity(obj: any, depth = 0, visited = new Set<object>()): { name?: string, similarity?: number } {
  if (!obj || typeof obj !== 'object' || depth > 10) return {};
  if (visited.has(obj)) return {};
  visited.add(obj);
  let name: string | undefined;
  let similarity: number | undefined;

  if (typeof obj.Name === 'string') name = obj.Name;
  else if (typeof obj.name === 'string') name = obj.name;
  else if (typeof obj.MemberName === 'string') name = obj.MemberName;
  else if (typeof obj.userName === 'string') name = obj.userName;
  else if (typeof obj.StaffName === 'string') name = obj.StaffName;
  else if (typeof obj.PersonName === 'string') name = obj.PersonName;

  if (typeof obj.MatchRate === 'number') similarity = obj.MatchRate / 100;
  else if (typeof obj.MatchRate === 'string') similarity = parseFloat(obj.MatchRate) / 100;
  else if (typeof obj.MatchPercent === 'number') similarity = obj.MatchPercent / 100;
  else if (typeof obj.similarity === 'number') similarity = obj.similarity;
  else if (typeof obj.Similarity === 'number') similarity = obj.Similarity;
  else if (typeof obj.score === 'number') similarity = obj.score;
  else if (typeof obj.Score === 'number') similarity = obj.Score;

  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      const sub = findNameAndSimilarity(obj[key], depth + 1, visited);
      if (sub.name && !name) name = sub.name;
      if (sub.similarity !== undefined && similarity === undefined) similarity = sub.similarity;
    }
  }
  return { name, similarity };
}

app.post(["/api/cameras/:id/test-connection", "/api/cameras/:id/test-connection/"], async (req, res) => {
  const id = safeParseInt(req.params.id, 0);
  const cam = cameras.find((c) => c.id === id);
  if (!cam) {
    return res.status(404).json({ connected: false, detail: "Camera not found" });
  }

  const hasSource = Boolean(cam.source && cam.source.trim().length > 0);
  const isActive = cam.is_active !== false;
  const connected = hasSource && isActive;

  if (cam.camera_type === "UNV") {
    res.json({
      connected,
      brand: "Uniview",
      model: "IPC3238EA LAPI (Face Recognition Series)",
      driver_type: cam.use_camera_analytics
        ? "UNV LAPI Push Webhook"
        : "Direct RTSP / Лучше включить аналитику камеры",
      resolution: "3840x2160 (4K UHD)",
      codec: "H.265 / Smart Face Stream",
      status_info: cam.use_camera_analytics
        ? "Ожидание HTTP POST от камеры. Канал связи активен."
        : "RTSP-канал настроен. Для снижения нагрузки включите use_camera_analytics.",
    });
    return;
  }

  if (cam.camera_type === "Hikvision") {
    res.json({
      connected,
      brand: "Hikvision",
      model: "DS-2CD2442FWD-I",
      driver_type: "Hikvision ISAPI / RTSP",
      resolution: "2560x1440 (4MP)",
      codec: "H.265 / ISAPI JSON Event stream",
      status_info: connected
        ? "RTSP-канал настроен. Проверьте доступность камеры в локальной сети."
        : "Нет источника/камера выключена.",
    });
    return;
  }

  res.json({
    connected,
    brand: cam.camera_type || "Generic",
    model: "Network Camera",
    driver_type: "Direct FFmpeg/RTSP Grabber",
    resolution: "1920x1080",
    codec: "H.264",
    status_info: connected
      ? "Источник настроен. Доступность зависит от сети."
      : "Нет источника/камера выключена.",
  });
});

app.post(["/api/recordings/start/:id", "/api/recordings/start/:id/"], async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const camera = cameras.find(c => c.id === id);
    if (!camera) return res.status(404).json({ detail: "Camera not found" });

    // Реальная запись через ffmpeg (непрерывно до stop)
    const outputPath = await startFileRecording(camera);
    if (!outputPath) {
      return res.status(500).json({ detail: "Не удалось запустить запись (нет камеры/ffmpeg)" });
    }
    res.json({ success: true, status: "recording", camera_id: id, output_path: `recordings/${path.basename(outputPath)}` });
  } catch (err) {
    logError(err as Error, { path: "/api/recordings/start/:id" });
    res.status(500).json({ detail: "Internal server error" });
  }
});

app.post(["/api/cameras", "/api/cameras/"], async (req, res) => {
  try {
    const body = req.body || {};
    
    // Валидация источника
    const source = body.source || "0";
    const camType = body.camera_type || "USB";
    const warnings: string[] = [];
    
    if (camType === "USB") {
      if (/^\/dev\/video/.test(source)) {
        warnings.push(`Путь ${source} — Linux-формат. На Windows используйте: "USB Video Device"`);
      }
      if (!source || source === "0") {
        warnings.push("Источник '0' — заглушка. Укажите реальное устройство.");
      }
    }

    const newCam = await prisma.camera.create({
      data: {
        name: body.name || "Новая камера",
        source: source,
        camera_type: camType,
        zone: body.zone || "Основная зона",
        is_active: body.is_active !== false,
        status: "online",
        roi_zones: body.roi_zones || null,
        fps: 25,
        ping_ms: 0,
        is_smart_recording: body.is_smart_recording || false,
        is_chronicle: body.is_chronicle !== false,
        driver_type: body.driver_type || null,
        ip_address: body.ip_address || null,
        ip_port: body.ip_port ? parseInt(body.ip_port) : null,
        username: body.username || null,
        password: body.password || null,
        use_camera_analytics: body.use_camera_analytics || false,
      },
    });
    // Sync in-memory
    cameras.push({ ...newCam });
    
    const resp: any = sanitizeCamera(newCam);
    if (warnings.length > 0) resp.warnings = warnings;
    res.status(201).json(resp);
  } catch (err) {
    logError(err as Error, { path: "/api/cameras", method: "POST" });
    res.status(500).json({ detail: "Internal server error" });
  }
});

app.put("/api/cameras/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const allowedFields = [
      "name", "source", "camera_type", "zone", "is_active", "status",
      "roi_zones", "fps", "ping_ms", "is_smart_recording", "is_chronicle",
      "driver_type", "ip_address", "ip_port", "username", "password",
      "use_camera_analytics", "snapshot_path",
      "stream_width", "stream_height", "stream_codec", "stream_fps",
      "roi_width", "roi_height"
    ];
    const updateData: any = {};
    for (const key of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        updateData[key] = req.body[key];
      }
    }

    // Валидация при изменении source
    const currentCam = cameras.find(c => c.id === id);
    const warnings: string[] = [];
    const newSource = updateData.source || currentCam?.source;
    const newType = updateData.camera_type || currentCam?.camera_type;
    
    if (newType === "USB" && currentCam && newSource !== currentCam.source) {
      if (/^\/dev\/video/.test(newSource)) {
        warnings.push(`Путь ${newSource} — Linux-формат. На Windows используйте: "USB Video Device"`);
      }
    }

    const updated = await prisma.camera.update({
      where: { id },
      data: updateData,
    });
    const index = cameras.findIndex((c) => c.id === id);
    if (index >= 0) cameras[index] = { ...cameras[index], ...updated };
    
    const resp: any = sanitizeCamera(updated);
    if (warnings.length > 0) resp.warnings = warnings;
    res.json(resp);
  } catch (err) {
    logError(err as Error, { path: "/api/cameras/:id", method: "PUT" });
    res.status(404).json({ detail: "Camera not found" });
  }
});

// ─── ROI Zones ────────────────────────────────────────────────────────────────

app.get("/api/cameras/:id/roi", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const camera = await prisma.camera.findUnique({ where: { id } });
    if (!camera) {
      return res.status(404).json({ detail: "Camera not found" });
    }
    let zones: any[] = [];
    if (camera.roi_zones) {
      try {
        zones = JSON.parse(camera.roi_zones);
      } catch {
        zones = [];
      }
    }
    res.json({ zones });
  } catch (err) {
    logError(err as Error, { path: "/api/cameras/:id/roi", method: "GET" });
    res.status(500).json({ detail: "Internal server error" });
  }
});

app.put("/api/cameras/:id/roi", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { zones, width, height } = req.body;
    const cam = cameras.find(c => c.id === id);
    // Сохраняем разрешение, при котором нарисованы зоны (текущее разрешение потока)
    const roiW = width || cam?.stream_width || 1920;
    const roiH = height || cam?.stream_height || 1080;
    const updated = await prisma.camera.update({
      where: { id },
      data: { 
        roi_zones: JSON.stringify(zones),
        roi_width: roiW,
        roi_height: roiH,
      },
    });
    // Sync in-memory
    const index = cameras.findIndex((c) => c.id === id);
    if (index >= 0) cameras[index] = { ...cameras[index], ...updated };
    res.json({ success: true, zones });
  } catch (err) {
    logError(err as Error, { path: "/api/cameras/:id/roi", method: "PUT" });
    res.status(404).json({ detail: "Camera not found" });
  }
});

app.delete(["/api/cameras/:id", "/api/cameras/:id/"], async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.camera.delete({ where: { id } });
    cameras = cameras.filter((c) => c.id !== id);
    res.json({ success: true });
  } catch (err) {
    logError(err as Error, { path: "/api/cameras/:id", method: "DELETE" });
    res.status(404).json({ detail: "Camera not found" });
  }
});

// Автоопределение параметров потока камеры (разрешение, кодек, FPS)
app.post(["/api/cameras/:id/probe", "/api/cameras/:id/probe/"], async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const cam = cameras.find(c => c.id === id);
    if (!cam) return res.status(404).json({ detail: "Camera not found" });

    // Сбрасываем кэш, чтобы форсировать новый проб
    streamProbeCache.delete(id);
    // Очищаем сохранённые данные, чтобы probeStreamParams сделал реальный проб
    cam.stream_width = null;
    cam.stream_height = null;
    cam.stream_codec = null;
    cam.stream_fps = null;
    await prisma.camera.update({
      where: { id },
      data: { stream_width: null, stream_height: null, stream_codec: null, stream_fps: null }
    });

    const probed = await probeStreamParams(cam);
    if (!probed) {
      return res.json({ success: false, detail: "Не удалось определить параметры потока. Проверьте, что камера доступна." });
    }

    res.json({
      success: true,
      width: probed.width,
      height: probed.height,
      codec: probed.codec,
      fps: probed.fps,
    });
  } catch (err) {
    logError(err as Error, { path: "/api/cameras/:id/probe" });
    res.status(500).json({ detail: "Internal server error" });
  }
});

app.get("/api/cameras/:id/snapshot", (req, res) => {
  const id = parseInt(req.params.id);
  const rusSrc = path.join(process.cwd(), "src", "assets", "rus.jpg");
  const logoSrc = path.join(process.cwd(), "src", "assets", "logo.jpg");

  let imageBuffer: Buffer;

  try {
    const cam = cameras.find(c => c.id === id);
    if (!cam || !cam.is_active) {
      imageBuffer = Buffer.from(FALLBACK_JPEG, "base64");
    } else if (cameraFrames.has(id)) {
      const shared = cameraFrames.get(id);
      const frame = shared?.frame;
      if (frame && frame !== getFallbackFrame()) {
        imageBuffer = Buffer.from(frame, "base64");
      } else {
        imageBuffer = Buffer.from(FALLBACK_JPEG, "base64");
      }
    } else if (cam && cam.snapshot_path) {
      const fullPath = path.join(process.cwd(), "public", cam.snapshot_path);
      if (fs.existsSync(fullPath)) {
        const candidate = fs.readFileSync(fullPath);
        if (candidate.length > 2 && candidate[0] === 0xFF && candidate[1] === 0xD8) {
          imageBuffer = candidate;
        } else {
          imageBuffer = Buffer.from(FALLBACK_JPEG, "base64");
        }
      } else {
        imageBuffer = Buffer.from(FALLBACK_JPEG, "base64");
      }
    } else if (cam) {
      const pattern = path.join(snapshotsDir, `cam${id}_*.jpg`);
      try {
        const matches = fs.readdirSync(snapshotsDir).filter(f => f.startsWith(`cam${id}_`) && f.endsWith('.jpg'));
        if (matches.length > 0) {
          const latest = matches.sort().pop()!;
          const candidate = fs.readFileSync(path.join(snapshotsDir, latest));
          if (candidate.length > 2 && candidate[0] === 0xFF && candidate[1] === 0xD8) {
            imageBuffer = candidate;
          } else {
            imageBuffer = Buffer.from(FALLBACK_JPEG, "base64");
          }
        } else {
          imageBuffer = Buffer.from(FALLBACK_JPEG, "base64");
        }
      } catch {
        imageBuffer = Buffer.from(FALLBACK_JPEG, "base64");
      }
    } else {
      imageBuffer = Buffer.from(FALLBACK_JPEG, "base64");
    }
  } catch (err) {
    logError(err as Error, { path: "/api/cameras/:id/snapshot" });
    imageBuffer = Buffer.from(FALLBACK_JPEG, "base64");
  }

  res.setHeader("Cache-Control", "no-store");
  res.json({
    image: imageBuffer.toString("base64"),
    content_type: "image/jpeg",
  });
});

app.post("/api/cameras/:id/capture", (req, res) => {
  // Capture manual snapshot and register
  res.json({ success: true, photo_path: "snapshots/ev1.jpg" });
});

app.post("/api/cameras/:id/recording/start", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.camera.update({ where: { id }, data: { is_smart_recording: true } });
    const index = cameras.findIndex((c) => c.id === id);
    if (index >= 0) cameras[index].is_smart_recording = true;
    // Запускаем непрерывную запись через ffmpeg
    const outputPath = await startFileRecording(cameras[index] || { id, name: `Camera ${id}` });
    res.json({ success: true, status: "recording", output_path: outputPath ? `recordings/${path.basename(outputPath)}` : null });
  } catch (err) {
    res.status(404).json({ detail: "Camera not found" });
  }
});

app.post("/api/cameras/:id/recording/stop", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.camera.update({ where: { id }, data: { is_smart_recording: false } });
    const index = cameras.findIndex((c) => c.id === id);
    if (index >= 0) cameras[index].is_smart_recording = false;

    // Останавливаем реальную запись; финализация (строка в БД) произойдёт в обработчике close ffmpeg
    const stopped = stopFileRecording(id);
    if (stopped) {
      // Даём ffmpeg короткое время на запись трейлера и создание строки
      await new Promise((r) => setTimeout(r, 800));
      const session = activeRecordings.get(id);
      if (session) {
        // Если процесс ещё не завершился — принудительно завершаем
        try { session.proc.kill("SIGKILL"); } catch { /* ignore */ }
        activeRecordings.delete(id);
      }
    }
    const lastRec = await prisma.recording.findFirst({ where: { camera_id: id }, orderBy: { start_time: "desc" } });
    res.json({ success: true, status: "stopped", recording: lastRec || null });
  } catch (err) {
    logError(err as Error, { path: "/api/cameras/:id/recording/stop" });
    res.status(404).json({ detail: "Camera not found" });
  }
});

// CATEGORIES API
app.get(["/api/categories", "/api/categories/"], async (req, res) => {
  try {
    const categoriesFromDB = await prisma.category.findMany({
      orderBy: { sort_order: "asc" },
    });
    res.json(categoriesFromDB);
  } catch (err) {
    logError(err as Error, { path: "/api/categories", method: "GET" });
    res.status(500).json({ detail: "Internal server error" });
  }
});

app.post(["/api/categories", "/api/categories/"], async (req, res) => {
  try {
    const code = (req.body.code || "").toUpperCase().trim();
    if (!code) {
      return res.status(400).json({ detail: "Code is required" });
    }
    
    const existingCat = await prisma.category.findUnique({ where: { code } });
    if (existingCat) {
      return res.status(400).json({ detail: "Category already exists" });
    }
    
    const newCat = await prisma.category.create({
      data: {
        code,
        label: req.body.label || code,
        color: req.body.color || "#6b7280",
        bg_color: req.body.bg_color || "#1f2937",
        is_alert: req.body.is_alert || false,
        alert_sound: req.body.alert_sound || "off",
        alert_volume: req.body.alert_volume || 0.5,
        detect_enabled: req.body.detect_enabled !== false,
        sort_order: req.body.sort_order || 100,
        is_system: false,
      },
    });
    res.status(201).json(newCat);
  } catch (err) {
    logError(err as Error, { path: "/api/categories", method: "POST" });
    res.status(500).json({ detail: "Internal server error" });
  }
});

app.put("/api/categories/:code", async (req, res) => {
  try {
    const code = req.params.code.toUpperCase().trim();
    
    const updatedCat = await prisma.category.update({
      where: { code },
      data: req.body,
    });
    res.json(updatedCat);
  } catch (err) {
    logError(err as Error, { path: "/api/categories/:code", method: "PUT" });
    res.status(404).json({ detail: "Category not found" });
  }
});

app.delete(["/api/categories/:code", "/api/categories/:code/"], async (req, res) => {
  try {
    const code = req.params.code.toUpperCase().trim();
    await prisma.category.delete({ where: { code } });
    res.json({ success: true });
  } catch (err) {
    logError(err as Error, { path: "/api/categories/:code", method: "DELETE" });
    res.status(404).json({ detail: "Category not found" });
  }
});

// PERSONS API
app.get(["/api/persons", "/api/persons/"], async (req, res) => {
  try {
    const search = (req.query.search as string || "").trim();
    const category = req.query.category as string || "";
    // Whitelist сортировки — защита от 500-й на произвольном поле из клиента (#11)
    const ALLOWED_SORT = new Set(["created_at", "name", "visit_count", "category", "last_seen_at", "embedding_count"]);
    const sort_by = ALLOWED_SORT.has(req.query.sort_by as string) ? (req.query.sort_by as string) : "created_at";
    const sort_dir: "asc" | "desc" = req.query.sort_dir === "asc" ? "asc" : "desc";

    const where: any = {};
    const nameContains = (req.query.name_contains as string || "").trim();
    if (nameContains) {
      where.name = { contains: nameContains };
    } else {
      if (category) where.category = category;
      if (search) {
        where.OR = [
          { name: { contains: search } },
          { comment: { contains: search } },
          { organization: { contains: search } },
        ];
      }
    }

const personsFromDB = await prisma.person.findMany({
      where,
      include: { photos: true },
      orderBy: { [sort_by]: sort_dir }
    });

    res.json(personsFromDB);
  } catch (err) {
    logError(err as Error, { path: "/api/persons", method: "GET" });
    res.status(500).json({ detail: "Internal server error" });
  }
});

app.get(["/api/persons/check_duplicate", "/api/persons/check_duplicate/"], async (req, res) => {
  try {
    const name = (req.query.name as string || "").trim().toLowerCase();
    if (!name) {
      return res.json({ duplicate: false, matches: [] });
    }

      const matches = await prisma.person.findMany({
        where: {
          name: { contains: name }
        },
        select: {
          id: true,
          name: true,
          category: true
        },
        take: 20
      });

    res.json({
      duplicate: matches.length > 0,
      matches,
      message: matches.length > 0 ? `Найдены совпадения с похожим именем` : undefined
    });
  } catch (err) {
    logError(err as Error, { path: "/api/persons/check_duplicate", method: "GET" });
    res.status(500).json({ detail: "Internal server error" });
  }
});

app.delete(["/api/persons/by_category/:category", "/api/persons/by_category/:category/"], async (req, res) => {
  try {
    const category = req.params.category.toUpperCase().trim();
    if (!category) {
      return res.status(400).json({ detail: "Category is required" });
    }
    const protectedCategories = ["SYSTEM", "DEFAULT"];
    if (protectedCategories.includes(category)) {
      return res.status(403).json({ detail: "Cannot delete system categories" });
    }
    const count = await prisma.person.count({ where: { category } });
    if (count > 100) {
      return res.status(413).json({ detail: `Too many persons to delete at once (${count}). Use bulk delete with IDs instead.` });
    }
    const deleted = await prisma.person.deleteMany({
      where: { category }
    });
    persons = persons.filter((p) => p.category !== category);
    res.json({ ok: true, deleted: deleted.count });
  } catch (err) {
    logError(err as Error, { path: "/api/persons/by_category/:category", method: "DELETE" });
    res.status(500).json({ detail: "Internal server error" });
  }
});

app.get("/api/persons/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const person = await prisma.person.findUnique({
      where: { id },
      include: { photos: true }
    });

    if (person) {
      res.json(person);
    } else {
      res.status(404).json({ detail: "Person not found" });
    }
  } catch (err) {
    logError(err as Error, { path: "/api/persons/:id", method: "GET" });
    res.status(500).json({ detail: "Internal server error" });
  }
});

app.post(["/api/persons", "/api/persons/"], upload.any(), async (req, res) => {
  try {
    let files: Express.Multer.File[] = [];
    if (req.file) files.push(req.file);
    if (req.files && Array.isArray(req.files)) files = files.concat(req.files as Express.Multer.File[]);

    // Исправляем кириллицу в именах файлов и body ПОСЛЕ multer
    fixFilesEncoding(files);
    if (req.body && typeof req.body === 'object') {
      for (const key of Object.keys(req.body)) {
        if (typeof req.body[key] === 'string') {
          req.body[key] = fixDoubleEncodedCyrillic(req.body[key])
        }
      }
    }

    let name = normalizePersonName(req.body.name || "Новый посетитель");
    let position = req.body.position ? normalizePositionName(req.body.position) : null;

    if (files.length > 0 && (!req.body.name || req.body.name === "Новый посетитель" || req.body.name === "Новый человек")) {
      const originalName = files[0].originalname;
      const ext = path.extname(originalName);
      const baseName = path.basename(originalName, ext).trim();
      const normalized = baseName.replace(/_/g, ' ').replace(/\s+/g, ' ');
      const words = normalized.split(' ').filter(w => w); // Убираем пустые

      if (words.length >= 4) {
        // 4+ слов: первые 3 = ФИО, остальное = должность
        name = normalizePersonName(words.slice(0, 3).join(' '));
        position = normalizePositionName(words.slice(3).join(' '));
      } else {
        // 1-3 слов: всё — это ФИО (Фамилия Имя Отчество)
        name = normalizePersonName(normalized);
      }
    }

    // Проверяем дубликат по нормализованному ключу
    const dupKey = getDuplicateKey(name);
    const category = (req.body.category || "CLIENT").toUpperCase();
    const existingPersons = await prisma.person.findMany({
      where: { category },
      select: { id: true, name: true, category: true }
    });
    
    const existingMatch = existingPersons.find(p => getDuplicateKey(p.name) === dupKey);
    if (existingMatch) {
      return res.status(409).json({
        detail: "Дубликат",
        person_id: existingMatch.id,
        person_name: existingMatch.name,
        message: `Уже существует: "${existingMatch.name}"`
      });
    }

    const photosList = [];
    let embedding_count = 0;

    // Сначала создаем персону в БД
    const newPerson = await prisma.person.create({
      data: {
        name,
        category,
        position,
        comment: req.body.comment || null,
        phone: req.body.phone || null,
        email: req.body.email || null,
        birth_date: req.body.birth_date || null,
        address: req.body.address || null,
        organization: req.body.organization || null,
        extra_info: req.body.extra_info || null,
        is_active: req.body.is_active !== false,
        visit_count: 0,
        embedding_count: 0
      }
    });

    // Теперь обрабатываем фотографии
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const photo_path = `photos/${f.filename}`;
      const fullPath = path.join(publicDir, photo_path);

      const regResult = await enrollPhotoWithGate(newPerson.id, name, category, photo_path, fullPath);

      const personPhoto = await prisma.personPhoto.create({
        data: {
          person_id: newPerson.id,
          photo_path,
          is_primary: i === 0,
          has_embedding: regResult.hasEmbedding,
        }
      });

      photosList.push(personPhoto);

      if (regResult.hasEmbedding) embedding_count++;
    }

    // Обновляем персону с photo_path и embedding_count
    const primaryPhoto = photosList.find(p => p.is_primary);
    await prisma.person.update({
      where: { id: newPerson.id },
      data: {
        photo_path: primaryPhoto ? primaryPhoto.photo_path : null,
        embedding_count
      }
    });

    // Возвращаем персону с фото
    const createdPerson = await prisma.person.findUnique({
      where: { id: newPerson.id },
      include: { photos: true }
    });

    res.status(201).json(createdPerson);
  } catch (err) {
    logError(err as Error, { path: "/api/persons", method: "POST" });
    res.status(500).json({ detail: "Internal server error" });
  }
});

app.put("/api/persons/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const allowedFields = [
      "name", "category", "position", "comment", "phone",
      "email", "birth_date", "address", "organization", "extra_info", "is_active"
    ];
    const updateData: any = {};
    for (const key of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        const val = req.body[key];
        if (typeof val === 'string') {
          if (key === "name") {
            updateData[key] = normalizePersonName(val);
          } else if (key === "position") {
            updateData[key] = normalizePositionName(val);
          } else if (key === "comment" || key === "address" || key === "organization" || key === "extra_info") {
            updateData[key] = val; // уже исправлено в middleware
          } else {
            updateData[key] = val;
          }
        } else {
          updateData[key] = val;
        }
      }
    }
    const updatedPerson = await prisma.person.update({
      where: { id },
      data: updateData,
      include: { photos: true }
    });

    res.json(updatedPerson);
  } catch (err) {
    logError(err as Error, { path: "/api/persons/:id", method: "PUT" });
    res.status(404).json({ detail: "Person not found" });
  }
});

app.delete(["/api/persons/:id", "/api/persons/:id/"], async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    // Удаляем дескрипторы
    await unregisterFacePerson(id);

    // Удаляем персону
    await prisma.person.delete({ where: { id } });

    // Sync in-memory
    persons = persons.filter((p) => p.id !== id);

    res.json({ success: true });
  } catch (err) {
    logError(err as Error, { path: "/api/persons/:id", method: "DELETE" });
    res.status(404).json({ detail: "Person not found" });
  }
});

app.post(["/api/persons/bulk_delete", "/api/persons/bulk_delete/"], async (req, res) => {
  try {
    const ids = req.body as number[];
    if (!Array.isArray(ids)) return res.status(400).json({ detail: "Invalid request body" });
    // Unregister face descriptors for each person (skip index sync during loop)
    await Promise.all(ids.map(id => unregisterFacePerson(id, true)));
    // Delete persons from DB
    const deleted = await prisma.person.deleteMany({ where: { id: { in: ids } } });
    // Sync in-memory
    persons = persons.filter((p) => !ids.includes(p.id));
    // Single index sync after all deletions
    await rebuildDescriptorIndex(persons);
    res.json({ success: true, count: deleted.count });
  } catch (err) {
    logError(err as Error, { path: "/api/persons/bulk_delete", method: "POST" });
    res.status(500).json({ detail: "Internal server error" });
  }
});

const importJobs: Record<string, any> = {};
const IMPORT_JOB_TTL_MS = 30 * 60 * 1000;

async function enforcePhotoLimit(personId: number, additionalCount: number): Promise<{ allowed: boolean; current: number; max: number }> {
  const total = await prisma.person.count();
  if (total < 100) {
    return { allowed: true, current: 0, max: 0 };
  }
  const current = await prisma.personPhoto.count({ where: { person_id: personId } });
  const max = max_photos_per_person || 20;
  return { allowed: current + additionalCount <= max, current, max };
}

setInterval(() => {
  const now = Date.now();
  for (const [jobId, job] of Object.entries(importJobs)) {
    if (now - (job.createdAt || now) > IMPORT_JOB_TTL_MS) {
      delete importJobs[jobId];
    }
  }
}, 5 * 60 * 1000);

app.post(["/api/persons/bulk_import", "/api/persons/bulk_import/"], async (req, res) => {
  let files: Express.Multer.File[] = [];
  try {
    // Multer файлы могут быть в req.files или req.file (в зависимости от upload.any())
    try {
      files = await new Promise<Express.Multer.File[]>((resolve, reject) => {
        upload.any()(req, res, (err: any) => {
          if (err) {
            reject(err);
          } else {
            const result: Express.Multer.File[] = [];
            if (req.file) result.push(req.file);
            if (req.files) {
              if (Array.isArray(req.files)) {
                result.push(...req.files as Express.Multer.File[]);
              } else if (typeof req.files === 'object') {
                Object.values(req.files).forEach((f: any) => {
                  if (Array.isArray(f)) result.push(...f);
                  else result.push(f);
                });
              }
            }
            resolve(result);
          }
        });
      });
    } catch (multerErr: any) {
      if (multerErr.code === 'LIMIT_FILE_COUNT') {
        return res.status(413).json({ detail: `Слишком много файлов. Максимум: 200` });
      }
      if (multerErr.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ detail: 'Файл слишком большой. Максимум: 10 МБ' });
      }
      throw multerErr;
    }

    // Исправляем кириллицу в именах файлов и body ПОСЛЕ multer
    fixFilesEncoding(files);
    if (req.body && typeof req.body === 'object') {
      for (const key of Object.keys(req.body)) {
        if (typeof req.body[key] === 'string') {
          req.body[key] = fixDoubleEncodedCyrillic(req.body[key])
        }
      }
    }
  } catch (err: any) {
    // Финальная обработка ошибок
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(413).json({ detail: `Слишком много файлов. Максимум: 200` });
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ detail: 'Файл слишком большой. Максимум: 10 МБ' });
    }
    throw err;
  }

  const category = (req.body.category || 'CLIENT').toUpperCase();
  const jobId = `job_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  importJobs[jobId] = {
    status: 'pending',
    progress: 0,
    created: [],
    failed: [],
    skipped: [],
    createdAt: Date.now(),
  };

  // Process files asynchronously
  setTimeout(async () => {
    const job = importJobs[jobId];
    if (!job) return;
job.status = 'processing';

    // Единый запрос к БД для всех файлов (N+1 → 1)
    const existingAll = await prisma.person.findMany({
      where: { category },
      select: { id: true, name: true, position: true, photos: true }
    });

    for (let index = 0; index < files.length; index++) {
      const f = files[index];
      try {
        const originalName = f.originalname;
        const ext = path.extname(originalName);
        const baseName = path.basename(originalName, ext);

        let rawName = baseName;
        let rawPosition: string | null = null;
        // Разделитель имени и должности — последний дефис в имени файла.
        // "Иванов-Петров Иван-Директор" → name="Иванов-Петров Иван", position="Директор"
        const lastDashIdx = baseName.lastIndexOf('-');
        if (lastDashIdx > 0) {
          rawName = baseName.substring(0, lastDashIdx).trim();
          rawPosition = baseName.substring(lastDashIdx + 1).trim();
        }

        const formattedName = rawName.replace(/_/g, ' ').trim();
        let name = normalizePersonName(formattedName) || "Новый посетитель";
        
        let position: string | null = null;
        if (rawPosition) {
          position = normalizePositionName(rawPosition.replace(/_/g, ' ').trim());
        }

        const photo_path = `photos/${f.filename}`;
        const fullPath = path.join(publicDir, photo_path);

        // Ищем существующую персону в кэше (по нормализованному ключу)
        const dupKey = getDuplicateKey(name);
        const existingPerson = existingAll.find(p => getDuplicateKey(p.name) === dupKey) || null;

        let personId: number;
        if (existingPerson) {
          personId = existingPerson.id;
          const regResult = await enrollPhotoWithGate(personId, name, category, photo_path, fullPath);
          const isPrimary = existingPerson.photos.length === 0;
          await prisma.personPhoto.create({
            data: { person_id: personId, photo_path, is_primary: isPrimary, has_embedding: regResult.hasEmbedding },
          });
          if (regResult.hasEmbedding) {
            await prisma.person.update({ where: { id: personId }, data: { embedding_count: { increment: 1 } } });
          }
          if (isPrimary) {
            await prisma.person.update({ where: { id: personId }, data: { photo_path } });
          }
          job.created.push({ name, position: existingPerson.position, embeddings: regResult.hasEmbedding ? 1 : 0, photos: 1, photos_without_embedding: regResult.hasEmbedding ? 0 : 1 });
        } else {
          const newPerson = await prisma.person.create({
            data: { name, category, position, is_active: true, visit_count: 0, embedding_count: 0 },
          });
          personId = newPerson.id;
          const regResult = await enrollPhotoWithGate(personId, name, category, photo_path, fullPath);
          await prisma.personPhoto.create({
            data: { person_id: personId, photo_path, is_primary: true, has_embedding: regResult.hasEmbedding },
          });
          await prisma.person.update({
            where: { id: personId },
            data: { photo_path, embedding_count: regResult.hasEmbedding ? 1 : 0 },
          });
          // Sync in-memory + обновляем кэш существующих персон,
          // чтобы последующие файлы того же человека нашли его в existingAll
          const created = await prisma.person.findUnique({ where: { id: personId }, include: { photos: true } });
          if (created) {
            persons.unshift({ ...created });
            existingAll.push(created);
          }
          job.created.push({ name, position, embeddings: regResult.hasEmbedding ? 1 : 0, photos: 1, photos_without_embedding: regResult.hasEmbedding ? 0 : 1 });
        }
      } catch (err: any) {
        job.failed.push({ file: f.originalname, error: err.message || 'Ошибка обработки' });
      }
      job.progress = index + 1;
    }

    // Агрегируем created по имени персоны (несколько фото → одна строка)
    const aggregated: Record<string, { name: string; position: string | null; embeddings: number; photos: number; photos_without_embedding: number }> = {};
    for (const c of job.created) {
      const key = `${c.name}__${c.position ?? ''}`;
      if (!aggregated[key]) {
        aggregated[key] = { name: c.name, position: c.position ?? null, embeddings: 0, photos: 0, photos_without_embedding: 0 };
      }
      aggregated[key].embeddings += c.embeddings;
      aggregated[key].photos += c.photos;
      aggregated[key].photos_without_embedding += c.photos_without_embedding;
    }
    job.created = Object.values(aggregated);

    job.status = 'done';
  }, 100);

  res.json({ job_id: jobId });
});

app.get(["/api/persons/bulk_import/:job_id", "/api/persons/bulk_import/:job_id/"], (req, res) => {
  const { job_id } = req.params;
  const job = importJobs[job_id];
  if (job) {
    res.json(job);
  } else {
    res.status(404).json({ detail: "Job not found" });
  }
});

// Photo upload to person
app.post(["/api/persons/:id/photos", "/api/persons/:id/photos/"], upload.any(), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const person = await prisma.person.findUnique({ where: { id }, include: { photos: true } });
    if (!person) return res.status(404).json({ detail: "Person not found" });

    let files: Express.Multer.File[] = [];
    if (req.file) files.push(req.file);
    if (req.files && Array.isArray(req.files)) files = files.concat(req.files as Express.Multer.File[]);
    if (files.length === 0) {
      return res.status(400).json({ detail: "No file uploaded", added_embeddings: 0, total_embeddings: person.photos.length });
    }

    const limitCheck = await enforcePhotoLimit(id, files.length);
    if (!limitCheck.allowed) {
      return res.status(413).json({ detail: `У персоны уже ${limitCheck.current} фото. Лимит: ${limitCheck.max}` });
    }

    let added_embeddings = 0;
    for (const f of files) {
      const photo_path = `photos/${f.filename}`;
      const fullPath = path.join(publicDir, photo_path);
      const regResult = await enrollPhotoWithGate(person.id, person.name, person.category, photo_path, fullPath);
      const isPrimary = person.photos.length === 0;
      await prisma.personPhoto.create({
        data: { person_id: id, photo_path, is_primary: isPrimary, has_embedding: regResult.hasEmbedding },
      });
      if (isPrimary) {
        await prisma.person.update({ where: { id }, data: { photo_path } });
      }
      if (regResult.hasEmbedding) added_embeddings++;
    }

    await prisma.person.update({
      where: { id },
      data: { embedding_count: { increment: added_embeddings } },
    });

    const updated = await prisma.person.findUnique({ where: { id }, include: { photos: true } });
    // Sync in-memory
    const idx = persons.findIndex((p) => p.id === id);
    if (idx >= 0) persons[idx] = { ...persons[idx], ...updated };

    res.json({ ...updated, added_embeddings, total_embeddings: updated?.photos.length });
  } catch (err) {
    logError(err as Error, { path: "/api/persons/:id/photos", method: "POST" });
    res.status(500).json({ detail: "Internal server error" });
  }
});

// Photo search — РЕАЛЬНЫЙ AI ПОИСК
app.post(["/api/persons/search_by_photo", "/api/persons/search_by_photo/"], upload.any(), async (req, res) => {
  let files: Express.Multer.File[] = [];
  if (req.file) files.push(req.file);
  if (req.files && Array.isArray(req.files)) files = files.concat(req.files as Express.Multer.File[]);

  const mode = (req.query.mode as string || "hybrid") as "cosine" | "euclidean" | "hybrid";
  if (files.length === 0) return res.status(400).json({ detail: "No file uploaded" });

  try {
    const filePath = path.join(photosDir, files[0].filename);
    const threshold = recognition_threshold_pct / 100;

    // Параллельно: оценка качества + поиск + лица
    const [qualityResult, matches, faces] = await Promise.all([
      assessPhotoQuality(filePath),
      searchByPhoto(filePath, threshold, 5),
      detectFaces(filePath),
    ]);

    // Обогащаем совпадения данными из БД
    const matchPersonIds = matches.map(m => m.personId);
    const personsFromDB = matchPersonIds.length > 0
      ? await prisma.person.findMany({ where: { id: { in: matchPersonIds } }, select: { id: true, name: true, category: true, photo_path: true } })
      : [];
    const personMap = new Map(personsFromDB.map(p => [p.id, p]));

    const formattedMatches = matches.map((m, idx) => {
      const person = personMap.get(m.personId) || { id: m.personId, name: m.personName, category: m.category, photo_path: m.photoPath };
      return {
        person,
        similarity: m.similarity,
        raw_similarity: m.similarity,
        similarity_pct: Math.round(m.similarity * 100),
        category: m.category,
        match_count: 1,
        gap: idx === 0 && matches.length > 1 ? Number((m.similarity - matches[1].similarity).toFixed(4)) : undefined,
        ambiguous: idx === 0 && matches.length > 1 && (m.similarity - matches[1].similarity) < 0.05,
      };
    });

    // Подсчёт персон по категориям из БД
    const categoryCountRows = await prisma.$queryRaw<{ category: string; count: number }[]>`
      SELECT category, COUNT(*) as count FROM Person GROUP BY category
    `;
    const total_searched: Record<string, number> = {};
    for (const row of categoryCountRows) {
      total_searched[row.category] = Number(row.count);
    }

    const engineStatus = getEngineStatus();

    res.json({
      matches: formattedMatches,
      face_detected: qualityResult.faceDetected,
      face_count: qualityResult.faceCount,
      det_score: qualityResult.details?.detScore || 0,
      quality_scores: qualityResult.details
        ? [
            {
              total: qualityResult.quality,
              size: qualityResult.details.detScore || 0,
              blur: qualityResult.details.sharpness || 0,
              angle: qualityResult.details.yaw || 0,
            },
          ]
        : [],
      faces: faces.map(f => ({ box: f.box, score: f.score })),
      message: formattedMatches.length > 0
        ? `Найдено совпадений: ${formattedMatches.length}`
        : qualityResult.faceDetected ? "Совпадений не обнаружено" : "Лицо не обнаружено на фото",
      total_searched,
      threshold_used: threshold,
      mode,
      model: "InsightFace (buffalo_l)",
      engine_descriptors: engineStatus.totalDescriptors,
      engine_persons: engineStatus.uniquePersons,
    });
  } catch (err: any) {
    logError(err as Error, { context: "search_by_photo" });
    res.status(500).json({ detail: "Ошибка AI обработки: " + err.message });
  }
});

app.delete(["/api/persons/:id/photos/:photoId", "/api/persons/:id/photos/:photoId/"], async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const photoId = parseInt(req.params.photoId);

    const photo = await prisma.personPhoto.findUnique({ where: { id: photoId } });
    if (!photo) return res.status(404).json({ detail: "Photo not found" });

    const photoPath = photo.photo_path;
    await prisma.personPhoto.delete({ where: { id: photoId } });

    try {
      const fullPath = path.join(photosDir, photoPath);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    } catch (e) {
      logError(e as Error, { context: "delete-person-photo-file", path: photoPath });
    }

    // Если удалили primary — назначаем первую оставшуюся
    if (photo.is_primary) {
      const remaining = await prisma.personPhoto.findFirst({ where: { person_id: id }, orderBy: { id: "asc" } });
      if (remaining) {
        await prisma.personPhoto.update({ where: { id: remaining.id }, data: { is_primary: true } });
        await prisma.person.update({ where: { id }, data: { photo_path: remaining.photo_path } });
      } else {
        await prisma.person.update({ where: { id }, data: { photo_path: null } });
      }
    }

    const updated = await prisma.person.findUnique({ where: { id }, include: { photos: true } });
    const idx = persons.findIndex((p) => p.id === id);
    if (idx >= 0) persons[idx] = { ...persons[idx], ...updated };
    res.json(updated);
  } catch (err) {
    logError(err as Error, { path: "/api/persons/:id/photos/:photoId", method: "DELETE" });
    res.status(500).json({ detail: "Internal server error" });
  }
});

app.post(["/api/persons/:id/photos/:photoId/set_primary", "/api/persons/:id/photos/:photoId/set_primary/"], async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const photoId = parseInt(req.params.photoId);

    // Clear all primaries for this person
    await prisma.personPhoto.updateMany({ where: { person_id: id }, data: { is_primary: false } });
    // Set new primary
    const photo = await prisma.personPhoto.update({ where: { id: photoId }, data: { is_primary: true } });
    // Update person's main photo_path
    await prisma.person.update({ where: { id }, data: { photo_path: photo.photo_path } });

    const updated = await prisma.person.findUnique({ where: { id }, include: { photos: true } });
    const idx = persons.findIndex((p) => p.id === id);
    if (idx >= 0) persons[idx] = { ...persons[idx], ...updated };
    res.json(updated);
  } catch (err) {
    logError(err as Error, { path: "/api/persons/:id/photos/:photoId/set_primary", method: "POST" });
    res.status(500).json({ detail: "Internal server error" });
  }
});

// ── FAILED EMBEDDINGS ──
// Коллектор «мусорных» кадров, отклонённых воротами качества при ЗАПИСИ
// референсного эмбеддинга (размытие / наклон головы / темнота / несколько лиц).
// Стартовые записи — демо-примеры категорий; реальные отказы добавляются
// функцией recordFailedEmbedding при загрузке/импорте фото.
let failedEmbeddings = [
  {
    id: 1,
    photo_path: "photos/fail_blur.jpg",
    reason: "Размытие в движении (Motion Blur)",
    detected_faces: 1,
    quality_score: 0.12,
    created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    filename: "cam_1_fail_blur_20260705.jpg",
    resolution: "640x480"
  },
  {
    id: 2,
    photo_path: "photos/fail_angle.jpg",
    reason: "Недопустимый угол поворота головы (Pitch > 35°)",
    detected_faces: 1,
    quality_score: 0.28,
    created_at: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    filename: "cam_2_fail_pitch_20260705.jpg",
    resolution: "1280x720"
  },
  {
    id: 3,
    photo_path: "photos/fail_dark.jpg",
    reason: "Недостаточная освещенность лица (< 15 Lux)",
    detected_faces: 0,
    quality_score: 0.05,
    created_at: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
    filename: "cam_1_fail_dark_20260704.jpg",
    resolution: "1920x1080"
  },
  {
    id: 4,
    photo_path: "photos/fail_multi.jpg",
    reason: "Обнаружено несколько лиц в кадре",
    detected_faces: 3,
    quality_score: 0.45,
    created_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    filename: "cam_2_fail_multi_20260704.jpg",
    resolution: "1280x720"
  }
];
let failedEmbeddingsNextId = 5;

/**
 * Регистрирует отклонённый кадр в коллекторе «мусорных снимков».
 * Используется, когда ворота качества (strict) отклонили фото при записи
 * референсного эмбеддинга — кадр НЕ попадает в БД, но попадает в панель
 * «Мусорные кадры» с реальной причиной (размытие / угол / темнота /多人).
 */
async function recordFailedEmbedding(opts: {
  photo_path: string;
  filename: string;
  reason: string;
  detected_faces?: number;
  quality_score?: number;
  resolution?: string;
}): Promise<void> {
  try {
    const resolution = opts.resolution || (await sharp(path.join(publicDir, opts.photo_path)).metadata()
      .then((m) => `${m.width ?? "?"}x${m.height ?? "?"}`).catch(() => "unknown"));
    failedEmbeddings.unshift({
      id: failedEmbeddingsNextId++,
      photo_path: opts.photo_path,
      filename: opts.filename,
      reason: opts.reason,
      detected_faces: opts.detected_faces ?? 1,
      quality_score: opts.quality_score ?? 0,
      resolution,
      created_at: new Date().toISOString(),
    });
    // Ограничиваем размер коллектора, чтобы не есть память (оставляем свежие 200).
    if (failedEmbeddings.length > 200) failedEmbeddings.length = 200;
    logInfo(`Мусорный кадр отклонён воротами: ${opts.reason} (${opts.filename})`);
  } catch (e) {
    logError(e as Error, { context: "recordFailedEmbedding", filename: opts.filename });
  }
}

/**
 * Записывает референсный эмбеддинг с ЖЁСТКИМ воротом качества.
 * Если кадр — мусор (размытие/наклон/темнота/несколько лиц) или лицо не
 * найдено, эмбеддинг НЕ сохраняется, а кадр попадает в коллектор failedEmbeddings.
 * Возвращает признак успешности, как registerPerson.
 */
async function enrollPhotoWithGate(
  personId: number,
  personName: string,
  category: string,
  photo_path: string,
  fullPath: string
): Promise<{ hasEmbedding: boolean; error?: string }> {
  const ext = await extractEmbedding(fullPath, { strict: true });

  if (!ext.passed || !ext.descriptor) {
    const q = ext.quality;
    await recordFailedEmbedding({
      photo_path,
      filename: path.basename(photo_path),
      reason: ext.issues.length ? ext.issues.join("; ") : (ext.error || "Лицо не обнаружено на фото"),
      detected_faces: q?.face_count ?? 0,
      quality_score: q?.score ?? 0,
    });
    return { hasEmbedding: false, error: ext.issues.join("; ") || ext.error };
  }

  const reg = await registerPersonFromDescriptor(personId, personName, category, photo_path, ext.descriptor);
  return { hasEmbedding: reg.hasEmbedding, error: reg.error };
}

app.get(["/api/failed_embeddings", "/api/failed_embeddings/"], (req, res) => {
  res.json(failedEmbeddings);
});

app.delete(["/api/failed_embeddings/:id", "/api/failed_embeddings/:id/"], (req, res) => {
  const id = parseInt(req.params.id);
  failedEmbeddings = failedEmbeddings.filter(f => f.id !== id);
  res.json({ ok: true, message: "Мусорный снимок успешно удалён" });
});

app.post(["/api/failed_embeddings/bulk_delete", "/api/failed_embeddings/bulk_delete/"], (req, res) => {
  const ids = req.body || [];
  failedEmbeddings = failedEmbeddings.filter(f => !ids.includes(f.id));
  res.json({ ok: true, message: `Успешно удалено ${ids.length} снимков` });
});

// ── OPERATOR CONFIRMATION (semi-supervised learning) ──────────────────────────

// Список ожидающих подтверждений
app.get(["/api/confirmations/pending", "/api/confirmations/pending/"], async (req, res) => {
  try {
    const confirmations = await prisma.faceConfirmation.findMany({
      where: { status: "PENDING" },
      include: {
        person: { select: { id: true, name: true, category: true, photo_path: true } },
      },
      orderBy: { created_at: "desc" },
      take: 50,
    });
    res.json(confirmations);
  } catch (err: any) {
    logError(err as Error, { path: "/api/confirmations/pending" });
    res.status(500).json({ detail: err.message });
  }
});

// Подтвердить: это тот же человек → добавить фото+эмбеддинг к существующей персоне
app.post(["/api/confirmations/:id/approve", "/api/confirmations/:id/approve/"], async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const operator_id = (req.body?.operator_id as string) || "system";
    const conf = await prisma.faceConfirmation.findUnique({ where: { id } });
    if (!conf) return res.status(404).json({ detail: "Confirmation not found" });
    if (conf.status !== "PENDING") return res.status(409).json({ detail: `Already ${conf.status}` });

    const tempFull = path.join(publicDir, conf.temp_photo_path);
    if (!fs.existsSync(tempFull)) return res.status(404).json({ detail: "Temp photo missing" });
    const buf = await fs.promises.readFile(tempFull);

    // Извлекаем эмбеддинг (строгий ворот; fallback на мягкий, если кадр «на грани»)
    let descriptor = (await extractEmbedding(buf, { strict: true })).descriptor;
    if (!descriptor) {
      const soft = await getEmbedding(buf);
      if (!soft) return res.status(422).json({ detail: "Не удалось извлечь эмбеддинг из фото подтверждения" });
      descriptor = soft;
    }

    const person = await prisma.person.findUnique({ where: { id: conf.person_id } });
    if (!person) return res.status(404).json({ detail: "Person not found" });

    const limitCheck = await enforcePhotoLimit(conf.person_id, 1);
    if (!limitCheck.allowed) {
      return res.status(413).json({ detail: `У персоны уже ${limitCheck.current} фото. Лимит: ${limitCheck.max}` });
    }

    const newName = `confirm_${conf.person_id}_${conf.id}_${Date.now()}.jpg`;
    const photo_path = `photos/${newName}`;
    await fs.promises.writeFile(path.join(publicDir, photo_path), buf);

    await prisma.personPhoto.create({
      data: {
        person_id: conf.person_id,
        photo_path,
        is_primary: false,
        has_embedding: true,
        source: "confirmation",
        confidence: conf.confidence,
      },
    });

    const reg = await addEmbeddingToPerson(conf.person_id, person.name, person.category, photo_path, descriptor);
    if (!reg.success) return res.status(500).json({ detail: reg.error || "Не удалось добавить дескриптор" });

    await prisma.faceConfirmation.update({
      where: { id },
      data: { status: "APPROVED", confirmed_at: new Date(), confirmed_by: operator_id },
    });

    // Закрываем связанное событие в ленте (снимаем ожидание подтверждения)
    await prisma.event.updateMany({
      where: { confirmation_id: id, confirmation_status: "pending" },
      data: { confirmation_status: "confirmed" },
    });

    // Временное фото уже скопировано в photos/ — удаляем оригинал из confirmations/
    try { await fs.promises.unlink(tempFull); } catch { /* ignore */ }

    const pIdx = persons.findIndex((p: any) => p.id === conf.person_id);
    if (pIdx >= 0) persons[pIdx].embedding_count = (persons[pIdx].embedding_count || 0) + 1;

    broadcastSecurity({ type: "CONFIRMATION_RESOLVED", confirmation_id: id, status: "APPROVED", person_id: conf.person_id });
    res.json({ success: true, message: "Фото добавлено, точность распознавания улучшена", person_id: conf.person_id });
  } catch (err: any) {
    logError(err as Error, { path: "/api/confirmations/:id/approve" });
    res.status(500).json({ detail: err.message });
  }
});

// Отклонить: это другой человек → создать нового «Неизвестного»
app.post(["/api/confirmations/:id/reject", "/api/confirmations/:id/reject/"], async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const operator_id = (req.body?.operator_id as string) || "system";
    const reason = (req.body?.reason as string) || "Не тот человек";
    const conf = await prisma.faceConfirmation.findUnique({ where: { id } });
    if (!conf) return res.status(404).json({ detail: "Confirmation not found" });
    if (conf.status !== "PENDING") return res.status(409).json({ detail: `Already ${conf.status}` });

    const tempFull = path.join(publicDir, conf.temp_photo_path);
    let newPersonId: number | null = null;

    if (fs.existsSync(tempFull)) {
      const buf = await fs.promises.readFile(tempFull);
      const newName = `unknown_conf_${id}_${Date.now()}.jpg`;
      const photo_path = `photos/${newName}`;
      await fs.promises.writeFile(path.join(publicDir, photo_path), buf);

      const newPerson = await prisma.person.create({
        data: { name: "Неизвестный", category: "CLIENT", is_active: true, visit_count: 0, embedding_count: 0 },
      });
      newPersonId = newPerson.id;

      const reg = await registerFacePerson(newPerson.id, "Неизвестный", "CLIENT", photo_path, path.join(publicDir, photo_path));
      await prisma.personPhoto.create({
        data: { person_id: newPerson.id, photo_path, is_primary: true, has_embedding: reg.hasEmbedding },
      });
      await prisma.person.update({
        where: { id: newPerson.id },
        data: { photo_path, embedding_count: reg.hasEmbedding ? 1 : 0 },
      });

      const created = await prisma.person.findUnique({ where: { id: newPerson.id }, include: { photos: true } });
      if (created) persons.unshift({ ...created });

      try { await fs.promises.unlink(tempFull); } catch { /* ignore */ }
    }

    await prisma.faceConfirmation.update({
      where: { id },
      data: { status: "REJECTED", rejected_reason: reason, confirmed_at: new Date(), confirmed_by: operator_id },
    });

    // Закрываем связанное событие в ленте (снимаем ожидание подтверждения)
    await prisma.event.updateMany({
      where: { confirmation_id: id, confirmation_status: "pending" },
      data: { confirmation_status: "rejected" },
    });

    broadcastSecurity({ type: "CONFIRMATION_RESOLVED", confirmation_id: id, status: "REJECTED", person_id: conf.person_id, new_person_id: newPersonId });
    res.json({ success: true, message: "Создана новая запись «Неизвестный»", new_person_id: newPersonId });
  } catch (err: any) {
    logError(err as Error, { path: "/api/confirmations/:id/reject" });
    res.status(500).json({ detail: err.message });
  }
});

// Статистика подтверждений
app.get(["/api/confirmations/stats", "/api/confirmations/stats/"], async (req, res) => {
  try {
    const [pending, approved, rejected] = await Promise.all([
      prisma.faceConfirmation.count({ where: { status: "PENDING" } }),
      prisma.faceConfirmation.count({ where: { status: "APPROVED" } }),
      prisma.faceConfirmation.count({ where: { status: "REJECTED" } }),
    ]);
    res.json({ pending, approved, rejected });
  } catch (err: any) {
    logError(err as Error, { path: "/api/confirmations/stats" });
    res.status(500).json({ detail: err.message });
  }
});

// EVENTS API
app.get(["/api/events", "/api/events/"], async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string || "50"), 200);
    const eventsFromDB = await prisma.event.findMany({
      orderBy: { created_at: "desc" },
      take: limit,
      include: { person: { select: { photo_path: true } } },
    });
    res.json(eventsFromDB);
  } catch (err) {
    logError(err as Error, { path: "/api/events", method: "GET" });
    res.status(500).json({ detail: "Internal server error" });
  }
});

app.delete(["/api/events/clear", "/api/events/clear/"], async (req, res) => {
  try {
    await prisma.event.deleteMany({});
    res.json({ success: true });
  } catch (err) {
    logError(err as Error, { path: "/api/events/clear", method: "DELETE" });
    res.status(500).json({ detail: "Internal server error" });
  }
});

app.post(["/api/events/:id/confirm", "/api/events/:id/confirm/"], async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const updated = await prisma.event.update({
      where: { id },
      data: { confirmation_status: "confirmed" },
    });
    broadcastSecurity({ type: "EVENT" });
    res.json({ ok: true, event: updated });
  } catch (err) {
    res.status(404).json({ detail: "Event not found" });
  }
});

app.post(["/api/events/:id/reject", "/api/events/:id/reject/"], async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) return res.status(404).json({ detail: "Event not found" });

    const linkedConfirmationId = event.confirmation_id ?? null;

    // Delete snapshot from disk
    if (event.snapshot_path) {
      const fullPath = path.join(publicDir, event.snapshot_path);
      try {
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      } catch (e) {
        logWarn("Не удалось удалить снапшот", { path: fullPath });
      }
    }

    await prisma.event.delete({ where: { id } });

    // Закрываем связанный запрос подтверждения, иначе он навсегда останется PENDING
    if (linkedConfirmationId) {
      await prisma.faceConfirmation.updateMany({
        where: { id: linkedConfirmationId, status: "PENDING" },
        data: { status: "REJECTED", rejected_reason: "Отклонено из ленты событий", confirmed_at: new Date() },
      });
    }

    broadcastSecurity({ type: "EVENT" });
    res.json({ ok: true, message: "Событие и снапшот удалены" });
  } catch (err) {
    logError(err as Error, { path: "/api/events/:id/reject", method: "POST" });
    res.status(500).json({ detail: "Internal server error" });
  }
});

// LOYALTY STATS
app.get(["/api/loyalty/:id", "/api/loyalty/:id/"], async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const person = await prisma.person.findUnique({ where: { id } });
    const incidents = await prisma.incident.findMany({ where: { person_id: id }, orderBy: { created_at: "desc" } });
    const tags = await prisma.tag.findMany({ where: { person_id: id } });

    let score = 50; let label = "Клиент"; let color = "#9AA6B2"; let risk = 0;
    if (person) {
      if (person.category === "VIP")       { score = 95; label = "Премиум VIP"; color = "#00FF94"; }
      else if (person.category === "BLACKLIST") { score = 0; label = "Высокий Риск"; color = "#FF3B3B"; risk = 100; }
      else if (person.category === "STAFF")     { score = 80; label = "Сотрудник"; color = "#3BA4FF"; }
    }

    res.json({
      loyalty: { score, label, label_color: color, activity: person?.visit_count || 1, activity_max: 20, reputation: Math.round(score / 10), reputation_max: 10, risk, recovery: 100 - risk },
      incidents,
      tags,
      incident_types: DEFAULT_INCIDENT_TYPES,
      tag_types: DEFAULT_TAG_TYPES,
    });
  } catch (err) {
    logError(err as Error, { path: "/api/loyalty/:id" });
    res.status(500).json({ detail: "Internal server error" });
  }
});

app.get(["/api/loyalty/:id/visits", "/api/loyalty/:id/visits/"], async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const person = await prisma.person.findUnique({ where: { id }, select: { visit_count: true, last_seen_at: true } });
    const monthNames = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
    const label = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
    res.json({ months: [{ month: monthStr, label, count: person?.visit_count || 0, visits: [] }] });
  } catch (err) {
    res.status(500).json({ detail: "Internal server error" });
  }
});

app.post(["/api/loyalty/:id/tags", "/api/loyalty/:id/tags/"], async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const newTag = await prisma.tag.create({ data: { person_id: id, tag: req.body.tag } });
    res.status(201).json(newTag);
  } catch (err) {
    res.status(500).json({ detail: "Internal server error" });
  }
});

app.delete(["/api/loyalty/:id/tags/:tagId", "/api/loyalty/:id/tags/:tagId/"], async (req, res) => {
  try {
    await prisma.tag.delete({ where: { id: parseInt(req.params.tagId) } });
    res.json({ success: true });
  } catch (err) {
    res.status(404).json({ detail: "Tag not found" });
  }
});

app.post(["/api/loyalty/:id/incidents", "/api/loyalty/:id/incidents/"], async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { incident_type, severity, comment } = req.body;
    const newIncident = await prisma.incident.create({
      data: { person_id: id, incident_type, severity, comment: comment || null, status: "open" },
    });
    // Auto-escalate to BLACKLIST on high severity
    if (severity === "high") {
      await prisma.person.update({ where: { id }, data: { category: "BLACKLIST" } });
      const idx = persons.findIndex((p) => p.id === id);
      if (idx >= 0) persons[idx].category = "BLACKLIST";
    }
    res.status(201).json(newIncident);
  } catch (err) {
    res.status(500).json({ detail: "Internal server error" });
  }
});

app.put(["/api/loyalty/:id/incidents/:incId", "/api/loyalty/:id/incidents/:incId/"], async (req, res) => {
  try {
    const updated = await prisma.incident.update({
      where: { id: parseInt(req.params.incId) },
      data: req.body,
    });
    res.json(updated);
  } catch (err) {
    res.status(404).json({ detail: "Incident not found" });
  }
});

app.delete(["/api/loyalty/:id/incidents/:incId", "/api/loyalty/:id/incidents/:incId/"], async (req, res) => {
  try {
    await prisma.incident.delete({ where: { id: parseInt(req.params.incId) } });
    res.json({ success: true });
  } catch (err) {
    res.status(404).json({ detail: "Incident not found" });
  }
});

// RECORDINGS
app.get(["/api/recordings", "/api/recordings/"], async (req, res) => {
  try {
    const recs = await prisma.recording.findMany({ orderBy: { start_time: "desc" }, take: 100 });
    res.json(recs);
  } catch (err) {
    logError(err as Error, { path: "/api/recordings" });
    res.status(500).json({ detail: "Internal server error" });
  }
});

// ── DIAGNOSTICS API ─────────────────────────────────────────────────────────
// Диагностика для оперативного выявления проблем

app.get("/api/diagnose", async (req, res) => {
  const issues: Array<{ severity: "error" | "warning" | "info"; message: string; detail?: string }> = [];
  const info: Record<string, any> = {};

  // 1. Python-сервер
  const pythonUrl = process.env.FACE_SERVER_URL || "http://localhost:8001";
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const resp = await fetch(`${pythonUrl}/health`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (resp.ok) {
      const data = await resp.json();
      info.python_server = { url: pythonUrl, healthy: true, initialized: data?.initialized };
    } else {
      issues.push({ severity: "error", message: "Python-сервер не отвечает корректно", detail: `HTTP ${resp.status}` });
      info.python_server = { url: pythonUrl, healthy: false, status: resp.status };
    }
  } catch (e) {
    issues.push({ severity: "error", message: "Python-сервер недоступен", detail: (e as Error).message });
    info.python_server = { url: pythonUrl, healthy: false, error: (e as Error).message };
  }

  // 2. FFmpeg
  try {
    const ffmpegPath = getFfmpegPath();
    const proc = spawn(ffmpegPath, ["-version"]);
    let version = "";
    proc.stdout.on("data", (d: Buffer) => { version = d.toString().split("\n")[0]; });
    await new Promise<void>((resolve) => {
      proc.on("close", () => resolve());
      setTimeout(resolve, 2000);
    });
    info.ffmpeg = { path: ffmpegPath, available: true, version: version.slice(0, 80) };
  } catch {
    issues.push({ severity: "warning", message: "FFmpeg не найден в expected путях" });
    info.ffmpeg = { available: false };
  }

  // 3. Камеры
  const dbCameras = await prisma.camera.findMany({ select: { id: true, name: true, source: true, camera_type: true, is_active: true } });
  info.cameras = dbCameras.map(c => ({
    ...c,
    source_hint: getCameraSourceHint(c),
  }));

  for (const cam of dbCameras) {
    if (cam.camera_type === "USB" && getCameraSourceHint(cam)) {
      issues.push({
        severity: "warning",
        message: `Камера "${cam.name}" (${cam.id}): некорректный путь на Windows`,
        detail: getCameraSourceHint(cam) || "",
      });
    }
  }

  // 4. Персоны
  const personCount = await prisma.person.count();
  const descriptorCount = await prisma.faceDescriptor.count();
  info.persons = { total: personCount, descriptors: descriptorCount };
  if (personCount > 0 && descriptorCount === 0) {
    issues.push({ severity: "warning", message: `Есть ${personCount} персон, но 0 дескрипторов. Распознавание не будет работать.` });
  }

  // 5. Диск
  try {
    const stats = fs.statSync(process.cwd());
    info.node_env = process.env.NODE_ENV || "not set";
    info.pid = process.pid;
  } catch {}

  res.json({
    timestamp: new Date().toISOString(),
    issues,
    info,
    summary: {
      errors: issues.filter(i => i.severity === "error").length,
      warnings: issues.filter(i => i.severity === "warning").length,
      total_cameras: dbCameras.length,
      active_cameras: dbCameras.filter(c => c.is_active).length,
      persons: personCount,
      descriptors: descriptorCount,
    },
  });
});

// ── HEALTH API (Full spec for Settings page) ──
app.get("/api/health", async (req, res) => {
  const engineStatus = getEngineStatus();
  let gpu_available = false;
  let gpu_detected = false;
  let gpu_name = "None";
  let gpu_vendor = "CPU";
  let gpu_providers = ["CPUExecutionProvider"];
  let recognition_provider = "onnxruntime (Pure CPU)";
  let onnx_package = "onnxruntime";
  let setup_recommendation = "Видеокарта не найдена. Система работает в CPU режиме.";

  // Запросим статус у Python-сервера (используем native fetch, не node-fetch)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const response = await fetch('http://localhost:8001/status', { signal: controller.signal });
    clearTimeout(timeoutId);
    if (response.ok) {
      const pythonStatus = await response.json() as any;
      const provider = pythonStatus.provider || "CPUExecutionProvider";
      recognition_provider = `onnxruntime (${provider})`;
      
      if (provider !== "CPUExecutionProvider") {
        gpu_available = true;
        gpu_detected = true;
        if (provider.includes("CUDA")) {
          gpu_name = "NVIDIA GPU";
          gpu_vendor = "NVIDIA";
        } else if (provider.includes("Dml")) {
          gpu_name = "DirectX GPU";
          gpu_vendor = "DirectML";
        } else if (provider.includes("OpenVINO")) {
          gpu_name = "Intel GPU/CPU";
          gpu_vendor = "Intel";
        } else if (provider.includes("ROCM")) {
          gpu_name = "AMD GPU";
          gpu_vendor = "AMD";
        }
        gpu_providers = [provider, "CPUExecutionProvider"];
        setup_recommendation = `Ускорение через ${provider} активно`;
      } else {
        setup_recommendation = "Python-сервер работает в CPU-режиме";
      }
    }
  } catch {
    // Python-сервер не доступен, оставляем значения по умолчанию
  }

  // Проверяем доступность камер
  const camStatus: Record<string, any> = {};
  for (const cam of cameras) {
    camStatus[String(cam.id)] = {
      name: cam.name,
      type: cam.camera_type,
      active: cam.is_active,
      status: cam.status,
      source: cam.source,
    };
  }

  res.json({
    status: "ok",
    version: "2.4.1",
    cameras: camStatus,
    faiss: {}, // Будет заполняться из БД
    faiss_index_types: {},
    ai_ready: engineStatus.initialized,
    recognition_threshold: 0.70,
    recognition_threshold_pct,
    gpu_enabled: gpu_available,
    gpu_policy: gpu_available ? "GPU_FIRST" : "CPU_ONLY",
    gpu_available,
    gpu_detected,
    gpu_name,
    gpu_vendor,
    gpu_providers,
    recognition_provider,
    engine_mode: gpu_available ? "Production (GPU)" : "Production (CPU)",
    setup_ok: true,
    setup_errors: [],
    setup_warnings: [],
    setup_recommendation,
    onnx_version: "1.16.3",
    onnx_package,
    face_engine: engineStatus,
  });
});

// ── SETTINGS API ──
// Helper: load a setting from DB with fallback to in-memory default
async function loadSetting(key: string, fallback: any): Promise<any> {
  try {
    const row = await prisma.settings.findUnique({ where: { key } });
    if (!row) return fallback;
    try { return JSON.parse(row.value); } catch { return row.value; }
  } catch { return fallback; }
}

async function saveSetting(key: string, value: any): Promise<void> {
  const strVal = typeof value === "string" ? value : JSON.stringify(value);
  await prisma.settings.upsert({
    where: { key },
    update: { value: strVal },
    create: { key, value: strVal },
  });
}

app.get(["/api/settings", "/api/settings/"], async (req, res) => {
  try {
    const [
      cacheEnabled, cacheTtl, qualityThreshold, adaptiveSkip,
      faissThreshold, faissNprobe, camWeights, verifyThreshold, autoCreateUnknown,
      confirmThreshold, lowThreshold, recognitionThreshold, maxPhotos
    ] = await Promise.all([
      loadSetting("embedding_cache_enabled", embedding_cache_enabled),
      loadSetting("embedding_cache_ttl_days", embedding_cache_ttl_days),
      loadSetting("face_quality_min_threshold", face_quality_min_threshold),
      loadSetting("ai_adaptive_frame_skip", ai_adaptive_frame_skip),
      loadSetting("faiss_ivf_threshold", faiss_ivf_threshold),
      loadSetting("faiss_ivf_nprobe", faiss_ivf_nprobe),
      loadSetting("camera_priority_weights", camera_priority_weights),
      loadSetting("verification_threshold_pct", verification_threshold_pct),
      loadSetting("auto_create_unknown_persons", auto_create_unknown_persons),
      loadSetting("confirmation_threshold_pct", confirmation_threshold_pct),
      loadSetting("low_threshold_pct", low_threshold_pct),
      loadSetting("recognition_threshold_pct", recognition_threshold_pct),
      loadSetting("max_photos_per_person", max_photos_per_person),
    ]);
    // Sync in-memory
    embedding_cache_enabled = cacheEnabled;
    embedding_cache_ttl_days = cacheTtl;
    face_quality_min_threshold = qualityThreshold;
    ai_adaptive_frame_skip = adaptiveSkip;
    faiss_ivf_threshold = faissThreshold;
    faiss_ivf_nprobe = faissNprobe;
    camera_priority_weights = camWeights;
    verification_threshold_pct = verifyThreshold;
    auto_create_unknown_persons = autoCreateUnknown;
    confirmation_threshold_pct = confirmThreshold;
    low_threshold_pct = lowThreshold;
    recognition_threshold_pct = recognitionThreshold;
    max_photos_per_person = maxPhotos;

    res.json({
      embedding_cache_enabled,
      embedding_cache_ttl_days,
      face_quality_min_threshold,
      ai_adaptive_frame_skip,
      faiss_ivf_threshold,
      faiss_ivf_nprobe,
      camera_priority_weights,
      verification_threshold_pct,
      auto_create_unknown_persons,
      confirmation_threshold_pct,
      low_threshold_pct,
      recognition_threshold_pct,
      max_photos_per_person,
    });
  } catch (err) {
    logError(err as Error, { path: "/api/settings", method: "GET" });
    res.status(500).json({ detail: "Internal server error" });
  }
});

app.post(["/api/settings", "/api/settings/"], async (req, res) => {
  try {
    const saves: Promise<void>[] = [];
    if (req.body.embedding_cache_enabled !== undefined) {
      embedding_cache_enabled = req.body.embedding_cache_enabled;
      saves.push(saveSetting("embedding_cache_enabled", embedding_cache_enabled));
    }
    if (req.body.embedding_cache_ttl_days !== undefined) {
      embedding_cache_ttl_days = req.body.embedding_cache_ttl_days;
      saves.push(saveSetting("embedding_cache_ttl_days", embedding_cache_ttl_days));
    }
    if (req.body.face_quality_min_threshold !== undefined) {
      face_quality_min_threshold = req.body.face_quality_min_threshold;
      saves.push(saveSetting("face_quality_min_threshold", face_quality_min_threshold));
    }
    if (req.body.ai_adaptive_frame_skip !== undefined) {
      ai_adaptive_frame_skip = req.body.ai_adaptive_frame_skip;
      saves.push(saveSetting("ai_adaptive_frame_skip", ai_adaptive_frame_skip));
    }
    if (req.body.faiss_ivf_threshold !== undefined) {
      faiss_ivf_threshold = req.body.faiss_ivf_threshold;
      saves.push(saveSetting("faiss_ivf_threshold", faiss_ivf_threshold));
    }
    if (req.body.faiss_ivf_nprobe !== undefined) {
      faiss_ivf_nprobe = req.body.faiss_ivf_nprobe;
      saves.push(saveSetting("faiss_ivf_nprobe", faiss_ivf_nprobe));
    }
    if (req.body.camera_priority_weights !== undefined) {
      camera_priority_weights = req.body.camera_priority_weights;
      saves.push(saveSetting("camera_priority_weights", camera_priority_weights));
    }
    if (req.body.verification_threshold_pct !== undefined) {
      verification_threshold_pct = req.body.verification_threshold_pct;
      saves.push(saveSetting("verification_threshold_pct", verification_threshold_pct));
    }
    if (req.body.auto_create_unknown_persons !== undefined) {
      auto_create_unknown_persons = !!req.body.auto_create_unknown_persons;
      saves.push(saveSetting("auto_create_unknown_persons", auto_create_unknown_persons));
    }
    if (req.body.confirmation_threshold_pct !== undefined) {
      confirmation_threshold_pct = req.body.confirmation_threshold_pct;
      saves.push(saveSetting("confirmation_threshold_pct", confirmation_threshold_pct));
    }
    if (req.body.low_threshold_pct !== undefined) {
      low_threshold_pct = req.body.low_threshold_pct;
      saves.push(saveSetting("low_threshold_pct", low_threshold_pct));
    }
    if (req.body.recognition_threshold_pct !== undefined) {
      recognition_threshold_pct = Number(req.body.recognition_threshold_pct);
      saves.push(saveSetting("recognition_threshold_pct", recognition_threshold_pct));

      low_threshold_pct = recognition_threshold_pct;
      saves.push(saveSetting("low_threshold_pct", low_threshold_pct));
    }
    if (req.body.max_photos_per_person !== undefined) {
      max_photos_per_person = Math.max(1, Number(req.body.max_photos_per_person));
      saves.push(saveSetting("max_photos_per_person", max_photos_per_person));
    }
    await Promise.all(saves);
    res.json({ ok: true, updated: Object.keys(req.body), message: "Настройки успешно сохранены" });
  } catch (err) {
    logError(err as Error, { path: "/api/settings", method: "POST" });
    res.status(500).json({ detail: "Internal server error" });
  }
});

app.get(["/api/settings/categories", "/api/settings/categories/"], async (req, res) => {
  try {
    active_categories = await loadSetting("active_categories", active_categories);
    res.json({ active_categories });
  } catch (err) {
    res.status(500).json({ detail: "Internal server error" });
  }
});

app.post(["/api/settings/categories", "/api/settings/categories/"], async (req, res) => {
  try {
    if (Array.isArray(req.body)) {
      active_categories = req.body;
      await saveSetting("active_categories", active_categories);
    }
    res.json({ ok: true, active_categories });
  } catch (err) {
    res.status(500).json({ detail: "Internal server error" });
  }
});

app.post(["/api/settings/threshold", "/api/settings/threshold/"], async (req, res) => {
  try {
    const pct = parseInt(req.query.threshold_pct as string || "30");
    recognition_threshold_pct = pct;
    await saveSetting("recognition_threshold_pct", pct);
    res.json({ ok: true, threshold_pct: pct, threshold_cosine: 1 - pct / 100 });
  } catch (err) {
    res.status(500).json({ detail: "Internal server error" });
  }
});

// ── CHRONICLE API ──
app.get("/api/chronicle/cameras", (req, res) => {
  const list: any[] = [];
  for (const [camIdStr, daysData] of Object.entries(chronicleData)) {
    const camId = parseInt(camIdStr);
    if (camId === 0) continue;
    const camObj = cameras.find(c => c.id === camId);
    const name = camObj ? camObj.name : `Камера ${camId}`;
    let totalPhotos = 0;
    const dates = Object.keys(daysData);
    for (const visitors of Object.values(daysData)) {
      totalPhotos += visitors.length;
    }
    const lastDay = dates.length > 0 ? dates.sort().reverse()[0] : null;
    list.push({
      camera_id: camId,
      name,
      total_photos: totalPhotos,
      total_days: dates.length,
      last_day: lastDay,
      last_day_label: lastDay ? new Date(lastDay).toLocaleDateString('ru-RU') : null,
    });
  }

  const myPhotosDays = chronicleData[0] || {};
  const myPhotosDates = Object.keys(myPhotosDays);
  let myPhotosTotal = 0;
  for (const visitors of Object.values(myPhotosDays)) {
    myPhotosTotal += visitors.length;
  }
  const myPhotosLastDay = myPhotosDates.length > 0 ? myPhotosDates.sort().reverse()[0] : null;

  const myPhotos = {
    camera_id: 0,
    name: "Мои фото",
    total_photos: myPhotosTotal,
    total_days: myPhotosDates.length,
    last_day: myPhotosLastDay,
    last_day_label: myPhotosLastDay ? new Date(myPhotosLastDay).toLocaleDateString('ru-RU') : null,
  };

  res.json({
    cameras: list,
    my_photos: myPhotos,
  });
});

app.get("/api/chronicle/stats", (req, res) => {
  let total_photos = 0;
  const allDates = new Set<string>();
  const activeCams = new Set<number>();
  for (const [camIdStr, daysData] of Object.entries(chronicleData)) {
    const camId = parseInt(camIdStr);
    if (camId !== 0) activeCams.add(camId);
    for (const [date, visitors] of Object.entries(daysData)) {
      allDates.add(date);
      total_photos += visitors.length;
    }
  }
  const oldest_date = allDates.size > 0 ? Array.from(allDates).sort()[0] : new Date().toISOString().slice(0, 10);
  res.json({
    total_photos,
    total_days: allDates.size,
    cameras: activeCams.size,
    retention_days: 90,
    oldest_date,
  });
});

app.get("/api/chronicle/camera/:activeCameraId/months", (req, res) => {
  const camId = parseInt(req.params.activeCameraId);
  const daysData = chronicleData[camId] || {};
  const monthsMap = new Map<string, { days: Set<string>; count: number }>();

  for (const [date, visitors] of Object.entries(daysData)) {
    const month = date.slice(0, 7);
    if (!monthsMap.has(month)) {
      monthsMap.set(month, { days: new Set(), count: 0 });
    }
    const m = monthsMap.get(month)!;
    m.days.add(date);
    m.count += visitors.length;
  }

  const monthsList = Array.from(monthsMap.entries()).map(([month, data]) => {
    const [year, mStr] = month.split("-");
    const monthNames = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
    const label = `${monthNames[parseInt(mStr) - 1]} ${year}`;
    return {
      month,
      label,
      days_count: data.days.size,
      photos_count: data.count,
    };
  });

  res.json({ months: monthsList });
});

app.get("/api/chronicle/camera/:activeCameraId/days/:month", (req, res) => {
  const camId = parseInt(req.params.activeCameraId);
  const month = req.params.month;
  const daysData = chronicleData[camId] || {};
  const daysList: any[] = [];

  for (const [date, visitors] of Object.entries(daysData)) {
    if (date.startsWith(month)) {
      const d = new Date(date);
      daysList.push({
        date,
        label: d.toLocaleDateString('ru-RU', { weekday: 'short', day: '2-digit', month: '2-digit' }),
        count: visitors.length,
      });
    }
  }

  daysList.sort((a, b) => b.date.localeCompare(a.date));
  res.json({ days: daysList });
});

app.get("/api/chronicle/camera/:activeCameraId/day/:date", (req, res) => {
  const camId = parseInt(req.params.activeCameraId);
  const date = req.params.date;
  const visitors = (chronicleData[camId] || {})[date] || [];
  const d = new Date(date);
  res.json({
    camera_id: camId,
    date,
    label: d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    count: visitors.length,
    visitors,
  });
});

app.delete("/api/chronicle/camera/:activeCameraId/day/:date/photo/:filename", (req, res) => {
  const camId = parseInt(req.params.activeCameraId);
  const date = req.params.date;
  const filename = req.params.filename;

  if (chronicleData[camId] && chronicleData[camId][date]) {
    chronicleData[camId][date] = chronicleData[camId][date].filter(v => v.filename !== filename);
  }

  try {
    const fullPath = path.join(snapshotsDir, filename);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  } catch (e) {
    logError(e as Error, { context: "delete-chronicle-photo-file", filename });
  }

  res.json({ success: true });
});

app.delete("/api/chronicle/camera/:activeCameraId/day/:date", (req, res) => {
  const camId = parseInt(req.params.activeCameraId);
  const date = req.params.date;
  const files = chronicleData[camId]?.[date] || [];
  if (chronicleData[camId]) {
    delete chronicleData[camId][date];
  }

  try {
    for (const item of files) {
      const fullPath = path.join(snapshotsDir, item.filename);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
  } catch (e) {
    logError(e as Error, { context: "delete-chronicle-day", camId, date });
  }

  res.json({ success: true });
});

app.delete("/api/chronicle/camera/:activeCameraId/month/:month", (req, res) => {
  const camId = parseInt(req.params.activeCameraId);
  const month = req.params.month;
  const removed: string[] = [];
  if (chronicleData[camId]) {
    for (const date of Object.keys(chronicleData[camId])) {
      if (date.startsWith(month)) {
        removed.push(...chronicleData[camId][date].map(v => v.filename));
        delete chronicleData[camId][date];
      }
    }
  }

  try {
    for (const filename of removed) {
      const fullPath = path.join(snapshotsDir, filename);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
  } catch (e) {
    logError(e as Error, { context: "delete-chronicle-month", camId, month });
  }

  res.json({ success: true });
});

app.post("/api/chronicle/cleanup", (req, res) => {
  res.json({ removed_dirs: 0 });
});

// ── SMART RECORDINGS API ──
app.get("/api/recordings/cameras", (req, res) => {
  const list: any[] = [];
  for (const [camIdStr, daysData] of Object.entries(recordingsData)) {
    const camId = parseInt(camIdStr);
    if (camId === 999999) continue;
    const camObj = cameras.find(c => c.id === camId);
    const name = camObj ? camObj.name : `Камера ${camId}`;
    let totalRecordings = 0;
    const dates = Object.keys(daysData);
    for (const recs of Object.values(daysData)) {
      totalRecordings += recs.length;
    }
    const lastDay = dates.length > 0 ? dates.sort().reverse()[0] : null;
    list.push({
      camera_id: camId,
      name,
      total_recordings: totalRecordings,
      total_days: dates.length,
      last_day: lastDay,
      last_day_label: lastDay ? new Date(lastDay).toLocaleDateString('ru-RU') : null,
    });
  }

  const myRecsDays = recordingsData[999999] || {};
  const myRecsDates = Object.keys(myRecsDays);
  let myRecsTotal = 0;
  for (const recs of Object.values(myRecsDays)) {
    myRecsTotal += recs.length;
  }
  const myRecsLastDay = myRecsDates.length > 0 ? myRecsDates.sort().reverse()[0] : null;

  const myRecordings = {
    camera_id: 999999,
    name: "Мои записи",
    total_recordings: myRecsTotal,
    total_days: myRecsDates.length,
    last_day: myRecsLastDay,
    last_day_label: myRecsLastDay ? new Date(myRecsLastDay).toLocaleDateString('ru-RU') : null,
  };

  res.json({
    cameras: list,
    my_recordings: myRecordings,
  });
});

app.get("/api/recordings/camera/:activeCameraId/months", (req, res) => {
  const camId = parseInt(req.params.activeCameraId);
  const daysData = recordingsData[camId] || {};
  const monthsMap = new Map<string, { days: Set<string>; count: number }>();

  for (const [date, recs] of Object.entries(daysData)) {
    const month = date.slice(0, 7);
    if (!monthsMap.has(month)) {
      monthsMap.set(month, { days: new Set(), count: 0 });
    }
    const m = monthsMap.get(month)!;
    m.days.add(date);
    m.count += recs.length;
  }

  const monthsList = Array.from(monthsMap.entries()).map(([month, data]) => {
    const [year, mStr] = month.split("-");
    const monthNames = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
    const label = `${monthNames[parseInt(mStr) - 1]} ${year}`;
    return {
      month,
      label,
      days_count: data.days.size,
      recordings_count: data.count,
    };
  });

  res.json({ months: monthsList });
});

app.get("/api/recordings/camera/:activeCameraId/days/:month", (req, res) => {
  const camId = parseInt(req.params.activeCameraId);
  const month = req.params.month;
  const daysData = recordingsData[camId] || {};
  const daysList: any[] = [];

  for (const [date, recs] of Object.entries(daysData)) {
    if (date.startsWith(month)) {
      const d = new Date(date);
      daysList.push({
        date,
        label: d.toLocaleDateString('ru-RU', { weekday: 'short', day: '2-digit', month: '2-digit' }),
        count: recs.length,
      });
    }
  }

  daysList.sort((a, b) => b.date.localeCompare(a.date));
  res.json({ days: daysList });
});

app.get("/api/recordings/camera/:activeCameraId/day/:date", (req, res) => {
  const camId = parseInt(req.params.activeCameraId);
  const date = req.params.date;
  const recs = (recordingsData[camId] || {})[date] || [];
  const d = new Date(date);
  res.json({
    camera_id: camId,
    date,
    label: d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    count: recs.length,
    recordings: recs,
  });
});

app.delete("/api/recordings/camera/:activeCameraId/day/:date/video/:filename", (req, res) => {
  const camId = parseInt(req.params.activeCameraId);
  const date = req.params.date;
  const filename = req.params.filename;

  if (recordingsData[camId] && recordingsData[camId][date]) {
    recordingsData[camId][date] = recordingsData[camId][date].filter(v => v.filename !== filename);
  }

  try {
    const fullPath = path.join(recordingsDir, filename);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  } catch (e) {
    logError(e as Error, { context: "delete-recording-file", filename });
  }

  res.json({ success: true });
});

app.delete("/api/recordings/camera/:activeCameraId/day/:date", (req, res) => {
  const camId = parseInt(req.params.activeCameraId);
  const date = req.params.date;
  const files = recordingsData[camId]?.[date] || [];
  recordingsData[camId] = recordingsData[camId] || {};
  delete recordingsData[camId][date];

  try {
    for (const item of files) {
      const fullPath = path.join(recordingsDir, item.filename);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
  } catch (e) {
    logError(e as Error, { context: "delete-recordings-day", camId, date });
  }

  res.json({ success: true });
});

app.post("/api/recordings/cleanup", (req, res) => {
  res.json({ removed_dirs: 0 });
});

// ── WEBSOCKET SERVERS ──

const wssSecurity = new WebSocketServer({ noServer: true });
const wssCamera = new WebSocketServer({ noServer: true });

// Security websocket client storage
const securityClients = new Set<WebSocket>();

wssSecurity.on("connection", (ws) => {
  securityClients.add(ws);
  logDebug(`Security client connected. Total: ${securityClients.size}`);

  ws.on("message", (msg) => {
    if (msg.toString() === "ping") {
      ws.send("pong");
    }
  });

  ws.on("close", () => {
    securityClients.delete(ws);
    logDebug(`Security client disconnected. Total: ${securityClients.size}`);
  });
});

function broadcastSecurity(data: any) {
  const payload = JSON.stringify(data);
  for (const client of securityClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

// ── FFmpeg helpers (shared by live stream + file recording) ────────────────────
function getFfmpegPath(): string {
  const projectBinPath = path.join(process.cwd(), "bin", "ffmpeg.exe");
  if (fs.existsSync(projectBinPath)) return projectBinPath;
  const extractedPath = path.join(process.cwd(), "bin", "ffmpeg-master-latest-win64-gpl", "bin", "ffmpeg.exe");
  if (fs.existsSync(extractedPath)) return extractedPath;
  return "ffmpeg";
}

/** Возвращает аргументы ffmpeg ДО спецификации выходного файла (всё, что идёт до -i уже включено). */
function buildFfmpegInputArgs(cam: any): string[] {
  const isUsb = cam.camera_type === "USB" || /^\d+$/.test((cam.source || "").trim());
  if (isUsb) {
    let inputSource = (cam.source || "").trim();
    const m = inputSource.match(/^\/dev\/video(\d+)$/);
    if (m) {
      const idx = parseInt(m[1], 10);
      inputSource = idx === 0 ? "USB Video Device" : `USB Video Device #${idx + 1}`;
    }
    const clean = inputSource.replace(/^video=/i, "");
    // Для Windows dshow: добавляем -list_devices для диагностики
    return ["-hide_banner", "-loglevel", "error", "-f", "dshow", "-i", `video=${clean}`];
  }
  // RTSP / IP / Hikvision / UNV: подставляем сохранённые учётные данные в URL, если их нет в source
  let source = (cam.source || "").trim();
  if (cam.username && cam.password && source && !/:\/\/[^@]+@/.test(source)) {
    try {
      const u = new URL(source);
      u.username = encodeURIComponent(cam.username);
      u.password = encodeURIComponent(cam.password);
      source = u.toString();
    } catch {
      // не URL — оставляем как есть
    }
  }
  // Для Hikvision/UNV/ONVIF полезно добавить таймауты и снизить буфер,
  // чтобы поток стабильнее держался и быстрее падал при потере камеры.
  const extraRtspFlags = cam.camera_type === "Hikvision"
    ? ["-fflags", "+nobuffer+discardcorrupt"]
    : [];
  // Для H.265/HEVC добавляем явный выбор декодера
  const codecFlags = (cam.stream_codec || "").toLowerCase().includes("hevc") || (cam.stream_codec || "").toLowerCase().includes("h265")
    ? ["-c:v", "hevc"]
    : [];
  // -hide_banner + -loglevel error: не засоряем логи баннером версии/конфигурации на каждом (пере)запуске
  return [
    "-hide_banner", "-loglevel", "error",
    "-rtsp_transport", "tcp", "-rtsp_flags", "prefer_tcp",
    ...extraRtspFlags,
    ...codecFlags,
    "-timeout", "5000000",
    "-i", source,
  ];
}

/**
 * Проверяет, является ли путь камеры Linux-путем (/dev/video*) на Windows.
 * Возвращает подсказку для пользователя, если проблема обнаружена.
 */
export function getCameraSourceHint(cam: any): string | null {
  if (cam.camera_type !== "USB") return null;
  
  const source = (cam.source || "").trim();
  const isLinuxPath = /^\/dev\/video\d+$/.test(source);
  const isNumeric = /^\d+$/.test(source);
  
  if (!isLinuxPath && !isNumeric) return null;
  
  // На Windows dshow устройства имеют другие имена
  return `Камера использует путь ${source}. На Windows dshow требует имя устройства. Используйте: "USB Video Device" или выполните ffmpeg -list_devices true -f dshow -i dummy для списка`;
}

// Активные записи видео: cameraId -> сессия
interface RecordingSession {
  proc: ChildProcessWithoutNullStreams;
  outputPath: string;
  startedAt: number;
  camera: any;
}
const activeRecordings = new Map<number, RecordingSession>();

/** Пишет запись в in-memory архив (календарь «Видеозаписи»). */
function recordToChronicle(rec: any) {
  const start = new Date(rec.start_time);
  const dateStr = start.toISOString().slice(0, 10);
  const entry = {
    id: rec.id,
    camera_id: rec.camera_id,
    filename: path.basename(rec.video_path),
    // Абсолютный URL для <video>/fetch (раздаётся статикой /recordings).
    // Без него фронтенд получал undefined и видео не открывалось.
    video_url: '/' + rec.video_path,
    date: dateStr,
    time: start.toISOString().slice(11, 19),
    duration: rec.duration,
    size_mb: rec.size_mb,
    video_path: rec.video_path,
    person_name: "Видеозапись",
  };
  if (!recordingsData[rec.camera_id]) recordingsData[rec.camera_id] = {};
  if (!recordingsData[rec.camera_id][dateStr]) recordingsData[rec.camera_id][dateStr] = [];
  recordingsData[rec.camera_id][dateStr].push(entry);
}

/** Добавляет посетителя в in-memory «Хронику» (вкладка Архив фото). */
function recordVisitor(cameraId: number, person_id: number | null | undefined, person_name: string, snapshot_path: string) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const time = now.toISOString().slice(11, 19);
  const filename = path.basename(snapshot_path);
  let size_kb = 0;
  try {
    const stat = fs.statSync(path.join(publicDir, snapshot_path));
    size_kb = Math.round(stat.size / 1024);
  } catch { /* ignore */ }
  const visitor: Visitor = {
    filename,
    person_id,
    person_name,
    time,
    photo_url: snapshot_path,
    size_kb,
  };
  if (!chronicleData[cameraId]) chronicleData[cameraId] = {};
  if (!chronicleData[cameraId][dateStr]) chronicleData[cameraId][dateStr] = [];
  chronicleData[cameraId][dateStr].unshift(visitor);
}

/** Запускает запись видео с камеры в файл. durationSec=undefined → непрерывно до stop. */
async function startFileRecording(cam: any, durationSec?: number): Promise<string | null> {
  try {
    if (activeRecordings.has(cam.id)) return activeRecordings.get(cam.id)!.outputPath;
    const ffmpegPath = getFfmpegPath();
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const outputPath = path.join(recordingsDir, `cam${cam.id}_${ts}.mp4`);
    const args = [...buildFfmpegInputArgs(cam)];
  // Автоопределение параметров потока при первом запуске
  if (!cam.stream_width || !cam.stream_height) {
    logInfo(`Автоопределение параметров потока камеры ${cam.id} (${cam.name})...`);
    const probed = await probeStreamParams(cam);
    if (probed) {
      cam.stream_width = probed.width;
      cam.stream_height = probed.height;
      cam.stream_codec = probed.codec;
      cam.stream_fps = probed.fps;
      const idx = cameras.findIndex(c => c.id === cam.id);
      if (idx >= 0) {
        cameras[idx].stream_width = probed.width;
        cameras[idx].stream_height = probed.height;
        cameras[idx].stream_codec = probed.codec;
        cameras[idx].stream_fps = probed.fps;
      }
    }
  }

  const { width, height } = getStreamResolution(cam);
  // FPS захвата: не выше реального FPS потока и не выше 15 (для производительности)
  const streamFps = cam.stream_fps || cam.fps || 25;
  const captureFps = Math.min(streamFps, 15);
    args.push("-y");
    if (durationSec) args.push("-t", String(durationSec));
    args.push("-r", "10", "-s", `${width}x${height}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast", "-movflags", "+faststart", outputPath);

    logInfo(`FFmpeg запись старт для камеры ${cam.id} (${cam.name}) → ${outputPath}`, { durationSec });
    const proc = spawn(ffmpegPath, args);
    proc.stderr.on("data", (d) => logDebug(`FFmpeg(rec ${cam.id}): ${d.toString().trim()}`));
    proc.on("error", (err) => logError(`Ошибка FFmpeg записи камеры ${cam.id}: ${err.message}`));
    proc.on("close", async (code) => {
      const session = activeRecordings.get(cam.id);
      activeRecordings.delete(cam.id);
      try {
        const startedAt = session ? session.startedAt : Date.now() - (durationSec || 0) * 1000;
        const end = Date.now();
        const duration = Math.max(1, Math.round((end - startedAt) / 1000));
        const stat = fs.existsSync(outputPath) ? fs.statSync(outputPath) : null;
        const size_mb = stat ? Number((stat.size / 1024 / 1024).toFixed(1)) : 0;
        const rec = await prisma.recording.create({
          data: {
            camera_id: cam.id,
            camera_name: cam.name,
            start_time: new Date(startedAt),
            end_time: new Date(end),
            duration,
            size_mb,
            video_path: `recordings/${path.basename(outputPath)}`,
            is_favorite: false,
          },
        });
        recordToChronicle(rec);
        logInfo(`Запись сохранена: камера ${cam.id}, ${rec.video_path} (${duration}s, ${size_mb}MB)`);
      } catch (err) {
        logError(err as Error, { context: "finalize recording" });
      }
    });

    activeRecordings.set(cam.id, { proc, outputPath, startedAt: Date.now(), camera: cam });
    return outputPath;
  } catch (e: any) {
    logError(`startFileRecording failed: ${e.message}`);
    return null;
  }
}

/** Останавливает активную запись (корректно завершает файл через SIGINT). */
function stopFileRecording(camId: number): boolean {
  const session = activeRecordings.get(camId);
  if (!session) return false;
  try {
    session.proc.kill("SIGINT");
  } catch {
    try { session.proc.kill("SIGKILL"); } catch { /* ignore */ }
  }
  return true;
}

// ── Сохранение снимков и событий распознавания (живой поток) ──────────────────
const RECOGNIZED_DEBOUNCE_MS = 15_000;
const UNKNOWN_DEBOUNCE_MS = 20_000;
const UNKNOWN_PERSON_COOLDOWN_MS = 60_000;
// cameraId:personKey -> последнее время события (чтобы не спамить БД)
const lastEventAt = new Map<string, number>();
// cameraId -> последнее время создания персоны из неизвестного (защита от дублей)
const lastUnknownPersonAt = new Map<string, number>();

function saveSnapshotFromFrame(frameBase64: string, cameraId: number, label?: string): string {
  try {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const dateStr = `${pad(now.getDate())}${pad(now.getMonth() + 1)}${now.getFullYear()}`;
    const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const safeLabel = label ? label.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 30) : "";
    const name = safeLabel
      ? `cam${cameraId}_${dateStr}_${timeStr}_${safeLabel}.jpg`
      : `cam${cameraId}_${dateStr}_${timeStr}_Неизвестный.jpg`;
    const target = path.join(snapshotsDir, name);
    fs.writeFileSync(target, Buffer.from(frameBase64, "base64"));
    return `snapshots/${name}`;
  } catch (e) {
    logError(e as Error, { context: "saveSnapshotFromFrame" });
    return "snapshots/ev1.jpg";
  }
}

async function persistAndBroadcastEvent(e: {
  cameraId: number;
  cameraName: string;
  personId?: number | null;
  event_type: string;
  confidence: number;
  snapshot_path: string;
  person_name?: string;
  person_category?: string;
  person_photo_path?: string;
  needs_operator_confirmation?: boolean;
  confirmation_status?: string | null;
  confirmationId?: number;
}) {
   try {
    await prisma.event.create({
      data: {
        camera_id: e.cameraId,
        camera_name: e.cameraName,
        person_id: e.personId,
        event_type: e.event_type,
        confidence: e.confidence,
        snapshot_path: e.snapshot_path,
        person_name: e.person_name,
        person_category: e.person_category,
        person_photo_path: e.person_photo_path,
        needs_operator_confirmation: e.needs_operator_confirmation ?? false,
        confirmation_status: e.confirmation_status ?? null,
        confirmation_id: e.confirmationId ?? null,
      },
    });
  } catch (err: any) {
    if (err.code === "P2003") {
      logWarn(`[Event] FK violation: camera_id=${e.cameraId} person_id=${e.personId} — event skipped`);
      return;
    }
    logError(err as Error, { context: "persist recognition event" });
    return;
  }

  broadcastSecurity({
    type: "ALERT",
    category: (e.person_category as any) || "UNKNOWN",
    person_id: e.personId ?? 0,
    person_name: e.person_name || "Неизвестный",
    camera_id: e.cameraId,
    confidence: e.confidence,
    snapshot_path: e.snapshot_path,
    timestamp: new Date().toISOString(),
  });
  broadcastSecurity({ type: "EVENT" });
}

/** Запускает ограниченную запись (клип) при срабатывании события, если включена умная запись. */
function triggerSmartRecording(cam: any) {
  if (!cam.is_smart_recording) return;
  if (activeRecordings.has(cam.id)) return; // уже пишется
  startFileRecording(cam, 15).catch(() => {});
}

async function handleRecognizedEvent(cam: any, match: any, frameBase64: string) {
  if (isIgnoredCategory(match.category)) {
    logDebug(`[Камера ${cam.id}] Игнорируем ${match.category}: ${match.personName}`);
    return;
  }

  if (isPersonInCurrentVisitWindow(match.personId)) {
    logDebug(`[Камера ${cam.id}] ${match.personName} уже был в этом окне визита (с 21:00), событие не создаётся`);
    return;
  }

  let event_type = "RECOGNIZED";
  if (match.category === "VIP") event_type = "VIP_ARRIVAL";
  else if (match.category === "BLACKLIST") event_type = "BLACKLIST_ALERT";
  else if (match.category === "RESPONSE") event_type = "RESPONSE_ALERT";

  const confidence = match.similarity;
  const meetsVerification = confidence * 100 >= verification_threshold_pct;
  const snapshot_path = saveSnapshotFromFrame(frameBase64, cam.id, match.personName);
  recordVisitor(cam.id, match.personId, match.personName, snapshot_path);

  try {
    await prisma.person.update({
      where: { id: match.personId },
      data: { visit_count: { increment: 1 }, last_seen_at: new Date() },
    });
  } catch { /* ignore */ }
  const idx = persons.findIndex((p: any) => p.id === match.personId);
  if (idx >= 0) {
    persons[idx].visit_count = (persons[idx].visit_count || 0) + 1;
    persons[idx].last_seen_at = new Date().toISOString();
  }
  const person = idx >= 0 ? persons[idx] : undefined;

  await persistAndBroadcastEvent({
    cameraId: cam.id,
    cameraName: cam.name,
    personId: match.personId,
    event_type,
    confidence,
    snapshot_path,
    person_name: match.personName,
    person_category: match.category,
    person_photo_path: person?.photo_path,
    needs_operator_confirmation: !meetsVerification,
    confirmation_status: meetsVerification ? null : "pending",
  });

  triggerSmartRecording(cam);
}

/**
 * Вырезает лицо из кадра по детектированному боксу с запасом по краям.
 * Кадр с «крупным планом» лица даёт стабильный эмбеддинг (без ошибки
 * «лицо не обнаружено»), в отличие от сохранения всего кадра целиком.
 */
async function cropFaceFromFrame(frameBase64: string, box: any): Promise<Buffer | null> {
  try {
    const buf = Buffer.from(frameBase64, "base64");
    if (!buf || buf.length === 0) {
      logWarn("[Crop] Empty frame buffer received. Skipping crop.");
      return null;
    }
    const meta = await sharp(buf).metadata();
    const iw = meta.width || 640;
    const ih = meta.height || 480;
    const x = Math.round(box.x || 0);
    const y = Math.round(box.y || 0);
    const w = Math.round(box.width || 0);
    const h = Math.round(box.height || 0);
    if (w < 6 || h < 6) return null;
    const padX = Math.round(w * 0.3);
    const padY = Math.round(h * 0.3);
    const left = Math.max(0, x - padX);
    const top = Math.max(0, y - padY);
    const right = Math.min(iw, x + w + padX);
    const bottom = Math.min(ih, y + h + padY);
    const cw = right - left;
    const ch = bottom - top;
    if (cw <= 0 || ch <= 0) return null;
    return await sharp(buf)
      .extract({ left, top, width: cw, height: ch })
      .jpeg({ quality: 92 })
      .toBuffer();
  } catch (e) {
    logError(e as Error, { context: "cropFaceFromFrame" });
    return null;
  }
}

/**
 * Автоматически заносит неизвестного в базу людей: вырезает лицо из кадра,
 * создаёт персону, регистрирует эмбеддинг. Если лицо уже есть в базе —
 * просто привязывает событие к существующей персоне (дедуп).
 */
async function createUnknownPersonFromFace(
  cam: any,
  frameBase64: string,
  face: any
): Promise<{ id: number; name: string; category: string } | null> {
  // Используем дескриптор, УЖЕ вычисленный детектором (face.descriptor) — он надёжен.
  // Повторное вырезание лица + re-детект (старый код) проваливался на quality gate
  // Python-сервера ("Лицо не обнаружено на фото"), поэтому эмбеддинг не сохранялся
  // и персона была неопознаваемой → плодились дубликаты "Неизвестный".
  const descriptorArr: number[] | null =
    face?.descriptor && Array.isArray(face.descriptor) && face.descriptor.length
      ? (face.descriptor as number[])
      : null;

  // Дедуп: не плодим дубликаты одного и того же лица (по уже готовому дескриптору)
  if (descriptorArr && descriptorArr.length) {
    try {
      const existing = await searchByDescriptor(new Float32Array(descriptorArr), recognition_threshold_pct / 100, 1);
      if (existing.length && existing[0].personId) {
        const pid = existing[0].personId as number;
        await prisma.person
          .update({ where: { id: pid }, data: { visit_count: { increment: 1 }, last_seen_at: new Date() } })
          .catch(() => {});
        const p = persons.find((x: any) => x.id === pid);
        return { id: pid, name: existing[0].personName, category: existing[0].category || (p?.category ?? "CLIENT") };
      }
    } catch (e) {
      logDebug(`Дедуп неизвестного не удался: ${(e as Error).message}`);
    }
  }

  // Сохраняем снимок лица для истории (обрезка по боксу, fallback — весь кадр)
  let photoBuffer: Buffer | null = face?.box ? await cropFaceFromFrame(frameBase64, face.box) : null;
  if (!photoBuffer) photoBuffer = Buffer.from(frameBase64, "base64");
  const filename = `unknown_${cam.id}_${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`;
  const fullPath = path.join(photosDir, filename);
  // Асинхронная запись: функция вызывается из тика детекции (setInterval 500ms),
  // синхронный writeFileSync блокировал бы event loop (разбор кадров и WS-рассылку).
  await fs.promises.writeFile(fullPath, photoBuffer);
  const photo_path = `photos/${filename}`;

  const newPerson = await prisma.person.create({
    data: {
      name: "Неизвестный",
      category: "CLIENT",
      is_active: true,
      visit_count: 1,
      embedding_count: 0,
    },
  });

  let hasEmbedding = false;
  if (descriptorArr && descriptorArr.length) {
    // Основной путь: регистрируем по уже вычисленному дескриптору
    const reg = await registerPersonFromDescriptor(newPerson.id, "Неизвестный", "CLIENT", photo_path, descriptorArr);
    hasEmbedding = reg.hasEmbedding;
  } else {
    // Fallback: пытаемся извлечь из обрезанного кадра (может не сработать на мелких лицах)
    const reg = await registerFacePerson(newPerson.id, "Неизвестный", "CLIENT", photo_path, fullPath);
    hasEmbedding = reg.hasEmbedding;
  }

  await prisma.personPhoto.create({
    data: { person_id: newPerson.id, photo_path, is_primary: true, has_embedding: hasEmbedding },
  });

  await prisma.person.update({
    where: { id: newPerson.id },
    data: { photo_path, embedding_count: hasEmbedding ? 1 : 0 },
  });

  const created = await prisma.person.findUnique({ where: { id: newPerson.id }, include: { photos: true } });
  if (created) persons.unshift({ ...created });

  if (!hasEmbedding) {
    // Без эмбеддинга персона бесполезна для распознавания и только засоряет БД → удаляем.
    logWarn(`Не удалось получить эмбеддинг для неизвестного (ID ${newPerson.id}) — персона не создаётся`);
    try {
      await prisma.personPhoto.deleteMany({ where: { person_id: newPerson.id } });
      await prisma.person.delete({ where: { id: newPerson.id } });
      persons = persons.filter((x: any) => x.id !== newPerson.id);
      if (fs.existsSync(fullPath)) await fs.promises.unlink(fullPath);
    } catch (e) {
      logError(e as Error, { context: "cleanup broken unknown person", personId: newPerson.id });
    }
    return null;
  }

  return { id: newPerson.id, name: "Неизвестный", category: "CLIENT" };
}

async function handleUnknownEvent(cam: any, frameBase64: string, face?: any) {
  if (face && face.descriptor && Array.isArray(face.descriptor)) {
    try {
      const faceHash = require('crypto')
        .createHash('md5')
        .update(JSON.stringify(face.descriptor.slice(0, 10)))
        .digest('hex');
      const lastSeen = unknownFaceCooldowns.get(faceHash);
      if (lastSeen && (Date.now() - lastSeen) < UNKNOWN_COOLDOWN_MS) {
        logDebug(`[Камера ${cam.id}] Дубликат неизвестного лица (хэш ${faceHash.slice(0, 8)}), пропуск события`);
        return;
      }
      unknownFaceCooldowns.set(faceHash, Date.now());
    } catch { /* ignore hash errors */ }
  }

  const snapshot_path = saveSnapshotFromFrame(frameBase64, cam.id);

  let personId: number | undefined = undefined;
  let personName: string | null = null;
  let personCategory = "CLIENT";
  let personPhotoPath: string | undefined;

  if (auto_create_unknown_persons) {
    const key = `${cam.id}:unknown-create`;
    const now = Date.now();
    if (now - (lastUnknownPersonAt.get(key) || 0) > UNKNOWN_PERSON_COOLDOWN_MS) {
      try {
        const created = await createUnknownPersonFromFace(cam, frameBase64, face);
        if (created) {
          personId = created.id;
          personName = created.name;
          personCategory = created.category;
          lastUnknownPersonAt.set(key, now);
          const p = persons.find((x: any) => x.id === created.id);
          personPhotoPath = p?.photo_path;
        }
      } catch (e) {
        logError(e as Error, { context: "auto-create unknown person" });
      }
    }
  }

  // Пишем посетителя в хронику ПОСЛЕ разрешения личности: если дедуп нашёл
  // существующего человека, запись привяжется к нему, а не к абстрактному «Неизвестный».
  recordVisitor(cam.id, personId || null, personName || "Неизвестный", snapshot_path);

  await persistAndBroadcastEvent({
    cameraId: cam.id,
    cameraName: cam.name,
    personId,
    event_type: "UNKNOWN",
    confidence: 0,
    snapshot_path,
    person_name: personName || "Неизвестный",
    person_category: personCategory,
    person_photo_path: personPhotoPath,
  });
  triggerSmartRecording(cam);
}

// ─── Face tracking across frames ───────────────────────────────────────────────

interface TrackedFace {
  trackId: string;
  descriptor: number[];
  bbox: [number, number, number, number];
  lastSeen: number;
  personId?: number;
}

const trackedFacesByCamera = new Map<number, Map<string, TrackedFace>>();
const TRACK_TIMEOUT = 5000;
const TRACK_SIM_THRESHOLD = 0.65;

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 1e-12 ? dot / denom : 0;
}

function pruneStaleTracks(cameraId: number): void {
  const tracks = trackedFacesByCamera.get(cameraId);
  if (!tracks) return;
  const now = Date.now();
  for (const [id, track] of tracks.entries()) {
    if (now - track.lastSeen > TRACK_TIMEOUT) {
      tracks.delete(id);
    }
  }
}

function findOrCreateTrack(
  cameraId: number,
  descriptor: number[],
  bbox: [number, number, number, number],
  match: any
): { trackId: string; isNew: boolean } {
  let tracks = trackedFacesByCamera.get(cameraId);
  if (!tracks) {
    tracks = new Map();
    trackedFacesByCamera.set(cameraId, tracks);
  }
  pruneStaleTracks(cameraId);

  let bestTrackId: string | null = null;
  let bestSim = TRACK_SIM_THRESHOLD;
  for (const [id, track] of tracks.entries()) {
    const sim = cosineSimilarity(descriptor, track.descriptor);
    if (sim > bestSim) {
      bestSim = sim;
      bestTrackId = id;
    }
  }

  if (bestTrackId) {
    const track = tracks.get(bestTrackId)!;
    track.lastSeen = Date.now();
    track.bbox = bbox;
    if (match && match.personId) track.personId = match.personId;
    return { trackId: bestTrackId, isNew: false };
  }

  const trackId = `track_${cameraId}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  tracks.set(trackId, {
    trackId,
    descriptor,
    bbox,
    lastSeen: Date.now(),
    personId: match?.personId,
  });
  return { trackId, isNew: true };
}

/** Детект → распознавание → обогащение кадра + (debounced) события в БД. */
async function processDetectedFaces(cam: any, frameBase64: string, faces: any[], debug = false): Promise<any[]> {
  const roiZones = debug ? [] : parseRoiZones(cam);
  const filtered = debug ? faces : filterFacesByRoi(faces, roiZones);
  if (!debug && roiZones.length && filtered.length < faces.length) {
    const outside = faces.filter(f => {
      const box = f.box || {};
      const cx = (box.x || 0) + (box.width || 0) / 2;
      const cy = (box.y || 0) + (box.height || 0) / 2;
      return !isPointInRoi(cx, cy, roiZones);
    });
    const coords = outside.map(f => {
      const b = f.box || {};
      return `(${(b.x||0)+Math.round((b.width||0)/2)},${(b.y||0)+Math.round((b.height||0)/2)})`;
    }).join(' ');
    const zoneInfo = roiZones.map(z => `(${z.x1},${z.y1})-(${z.x2},${z.y2})`).join(' ');
    logDebug(`ROI filter camera ${cam.id}: ${faces.length} faces → ${filtered.length} inside zones | zones: ${zoneInfo} | outside: ${coords}`);
  }

  const minThreshold = debug ? 0.05 : Math.max(low_threshold_pct, recognition_threshold_pct) / 100;
  const confirmT = debug ? 0.10 : confirmation_threshold_pct / 100;
  const enriched: any[] = [];
  for (let i = 0; i < filtered.length; i++) {
    const f = filtered[i];
    const box = f.box || {};
    const x = box.x || 0;
    const y = box.y || 0;
    const w = box.width || 0;
    const h = box.height || 0;
    const bbox: [number, number, number, number] = [x, y, x + w, y + h];

    if (!debug && h < VISIT_MIN_FACE_SIZE_PX) continue;

    const desc = f.descriptor;
    let trackMeta = { trackId: String(i + 1), isNew: true };
    if (desc && desc.length) {
      const normalizedDesc = Array.isArray(desc) ? desc : Array.from(desc);
      trackMeta = findOrCreateTrack(cam.id, normalizedDesc, bbox, null);
    }

    let match: any = null;
    if (desc && desc.length) {
      const matches = await searchByDescriptor(desc, minThreshold, 1);
      if (matches.length) match = matches[0];
    }
    const sim = match ? match.similarity : 0;

    if (match && sim >= confirmT) {
      if (isIgnoredCategory(match.category)) {
        enriched.push({
          track_id: trackMeta.trackId,
          bbox,
          person_id: match.personId,
          person_name: match.personName,
          category: match.category,
          confidence: sim,
          box: f.box,
          is_ignored: true,
        });
        continue;
      }

      if (!debug && isPersonInCurrentVisitWindow(match.personId)) {
        enriched.push({
          track_id: trackMeta.trackId,
          bbox,
          person_id: match.personId,
          person_name: match.personName,
          category: match.category,
          confidence: sim,
          box: f.box,
          is_cooldown: true,
        });
        continue;
      }

      await maybeRecordVisit(cam, match.personId, match, frameBase64);

      enriched.push({
        track_id: trackMeta.trackId,
        bbox,
        person_id: match.personId,
        person_name: match.personName,
        category: match.category,
        confidence: sim,
        box: f.box,
      });
    } else if (match && sim >= minThreshold) {
      if (isIgnoredCategory(match.category)) {
        enriched.push({
          track_id: trackMeta.trackId,
          bbox,
          person_id: match.personId,
          person_name: match.personName,
          category: match.category,
          confidence: sim,
          box: f.box,
          needs_confirmation: true,
          is_ignored: true,
        });
        continue;
      }

      enriched.push({
        track_id: trackMeta.trackId,
        bbox,
        person_id: match.personId,
        person_name: match.personName,
        category: match.category,
        confidence: sim,
        box: f.box,
        needs_confirmation: true,
      });
      const key = `${cam.id}:conf${match.personId}`;
      if (debug || trackMeta.isNew || Date.now() - (lastEventAt.get(key) || 0) > UNKNOWN_DEBOUNCE_MS) {
        lastEventAt.set(key, Date.now());
        await handleConfirmationEvent(cam, match, frameBase64, f);
      }
    } else {
      const faceHash = Buffer.from(JSON.stringify(f.descriptor || [])).toString("base64").slice(0, 64);
      const now = Date.now();
      const isDuplicateUnknown = !debug && unknownFaceCooldowns.has(faceHash) && now - (unknownFaceCooldowns.get(faceHash) || 0) < UNKNOWN_COOLDOWN_MS;
      enriched.push({
        track_id: trackMeta.trackId,
        bbox,
        person_id: undefined,
        category: "UNKNOWN",
        confidence: 0,
        detection_score: f.score,
        box: f.box,
        is_duplicate_unknown: isDuplicateUnknown || !trackMeta.isNew,
      });
      if (isDuplicateUnknown) continue;
      const key = `${cam.id}:unknown`;
      if (debug || trackMeta.isNew || Date.now() - (lastEventAt.get(key) || 0) > UNKNOWN_DEBOUNCE_MS) {
        lastEventAt.set(key, Date.now());
        unknownFaceCooldowns.set(faceHash, now);
        await handleUnknownEvent(cam, frameBase64, f);
      }
    }
  }
  return enriched;
}

function isIgnoredCategory(category: string | undefined): boolean {
  if (!category) return false;
  const ignored = ['SECURITY', 'ОХРАНА', 'PERSONNEL', 'GUARD'];
  return ignored.includes(category.toUpperCase());
}

// Подтверждения оператора: дебаунс создания pending-записей + папка временных фото
const lastConfirmationAt = new Map<string, number>();
const CONFIRMATION_COOLDOWN_MS = 30_000;
const confirmationsDir = path.join(publicDir, "confirmations");

/**
 * Создаёт запрос на подтверждение оператора, когда лицо похоже на известного
 * (band low..confirmation). Сохраняет кадр, пишет FaceConfirmation (PENDING),
 * шлёт событие и WS-уведомление. Дедуп по паре камера-персона.
 */
async function handleConfirmationEvent(cam: any, match: any, frameBase64: string, face: any) {
  const personId = match.personId;
  const key = `${cam.id}:conf${personId}`;
  // Дебаунс: не плодим подтверждения для одной пары камера-персона подряд
  if (Date.now() - (lastConfirmationAt.get(key) || 0) < CONFIRMATION_COOLDOWN_MS) return;
  lastConfirmationAt.set(key, Date.now());

  try {
    if (!fs.existsSync(confirmationsDir)) fs.mkdirSync(confirmationsDir, { recursive: true });
    const filename = `confirm_${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`;
    const tempFull = path.join(confirmationsDir, filename);
    await fs.promises.writeFile(tempFull, Buffer.from(frameBase64, "base64"));
    const temp_photo_path = `confirmations/${filename}`;

    const candidate = persons.find((p: any) => p.id === personId);
    const existing_photo_path = candidate?.photo_path || null;

    const confirmation = await prisma.faceConfirmation.create({
      data: {
        person_id: personId,
        confidence: match.similarity,
        temp_photo_path,
        existing_photo_path,
        person_name: match.personName,
        category: match.category,
        status: "PENDING",
      },
    });

    // Событие в ленту (оператор видит в «Событиях»)
    const snapshot_path = saveSnapshotFromFrame(frameBase64, cam.id, match.personName);
    recordVisitor(cam.id, personId, match.personName, snapshot_path);
    await persistAndBroadcastEvent({
      cameraId: cam.id,
      cameraName: cam.name,
      personId,
      event_type: "CONFIRMATION",
      confidence: match.similarity,
      snapshot_path,
      person_name: match.personName,
      person_category: match.category,
      person_photo_path: existing_photo_path,
      needs_operator_confirmation: true,
      confirmation_status: "pending",
      confirmationId: confirmation.id,
    });

    // Уведомление оператору через Security WebSocket
    broadcastSecurity({
      type: "CONFIRMATION",
      confirmation_id: confirmation.id,
      person_id: personId,
      person_name: match.personName,
      category: match.category,
      confidence: match.similarity,
      temp_photo: `/${temp_photo_path}`,
      existing_photo: existing_photo_path ? `/${existing_photo_path}` : null,
    });

    triggerSmartRecording(cam);
  } catch (e) {
    logError(e as Error, { context: "handleConfirmationEvent", personId });
  }
}

// Camera feed websocket client storage
const cameraStreams = new Map<number, Set<WebSocket>>();
const activeFfmpegProcesses = new Map<number, ChildProcessWithoutNullStreams>();
// Общий последний кадр + распознанные лица на камеру (читается всеми WS-клиентами этой камеры)
const cameraFrames = new Map<number, { frame: string; faces: any[] }>();
// Единый таймер детекции/распознавания на камеру (запускается один раз, а не на каждого клиента)
const cameraDetectionTimers = new Map<number, NodeJS.Timeout>();
const cameraLastFrameHash = new Map<number, string>();
// Счётчик неудачных запусков FFmpeg на камеру (для экспоненциального backoff при недоступной камере)
const cameraFfmpegRetries = new Map<number, number>();
const cameraFfmpegFailCount = new Map<number, number>();
const cameraWebhookFallback = new Map<number, boolean>();
// Отложенные таймеры перезапуска FFmpeg (чтобы их можно было отменить при остановке пайплайна)
const cameraRestartTimers = new Map<number, NodeJS.Timeout>();

// Visit-day: 24-часовое окно с 21:00 до 21:00
const VISIT_DAY_START_HOUR = 21;
const personLastVisitWindow = new Map<number, number>();
const unknownFaceCooldowns = new Map<string, number>();
const UNKNOWN_COOLDOWN_MS = 3 * 60 * 60 * 1000;
const VISIT_MIN_FACE_SIZE_PX = 120;

function getVisitWindowStart(now: Date): number {
  const windowStart = new Date(now);
  if (now.getHours() >= VISIT_DAY_START_HOUR) {
    windowStart.setHours(VISIT_DAY_START_HOUR, 0, 0, 0);
  } else {
    windowStart.setDate(now.getDate() - 1);
    windowStart.setHours(VISIT_DAY_START_HOUR, 0, 0, 0);
  }
  return windowStart.getTime();
}

function isPersonInCurrentVisitWindow(personId: number): boolean {
  const lastWindowStart = personLastVisitWindow.get(personId);
  if (lastWindowStart === undefined) return false;
  return lastWindowStart === getVisitWindowStart(new Date());
}

async function maybeRecordVisit(cam: any, personId: number, match: any, frameBase64?: string): Promise<void> {
  if (isPersonInCurrentVisitWindow(personId)) return;
  const windowStart = getVisitWindowStart(new Date());
  personLastVisitWindow.set(personId, windowStart);

  const snapshot_path = frameBase64 ? saveSnapshotFromFrame(frameBase64, cam.id, match.personName) : "";

  await persistAndBroadcastEvent({
    cameraId: cam.id,
    cameraName: cam.name,
    personId,
    event_type: "VISIT",
    confidence: match.similarity,
    snapshot_path,
    person_name: match.personName,
    person_category: match.category,
    person_photo_path: match.photoPath,
  });

  logInfo(`[Камера ${cam.id}] НОВЫЙ ВИЗИТ: ${match.personName} (окно с ${new Date(windowStart).toLocaleString('ru-RU')})`);
}

wssCamera.on("connection", (ws, req) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const match = url.pathname.match(/\/ws\/camera\/(\d+)/);
  if (!match) {
    ws.close();
    return;
  }
  const cameraId = parseInt(match[1]);
  const initialCam = cameras.find(c => c.id === cameraId);
  if (!initialCam || !initialCam.is_active) {
    ws.close();
    return;
  }

  if (!cameraStreams.has(cameraId)) {
    cameraStreams.set(cameraId, new Set());
  }
  cameraStreams.get(cameraId)!.add(ws);

  // Кадр-заглушка, если реального потока ещё нет
  const fallbackFrame = getFallbackFrame();

  // Запускаем FFmpeg + детекцию, если это первый клиент для этой камеры
  if (!activeFfmpegProcesses.has(cameraId) && !initialCam.use_camera_analytics) {
    startCameraPipeline(initialCam, fallbackFrame);
  }

  // Отправляем клиенту общий кадр камеры (обновляется единым конвейером)
  const intervalId = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      clearInterval(intervalId);
      return;
    }
    const currentCam = cameras.find(c => c.id === cameraId);
    if (!currentCam || !currentCam.is_active) {
      ws.close();
      clearInterval(intervalId);
      return;
    }
    const shared = cameraFrames.get(cameraId);
    const frame = shared ? shared.frame : fallbackFrame;
    const faces = shared ? shared.faces : [];
    ws.send(
      JSON.stringify({
        type: "FRAME",
        camera_id: cameraId,
        timestamp: Date.now(),
        frame,
        faces,
      })
    );
  }, 100);

  ws.on("message", (msg) => {
    if (msg.toString() === "ping") {
      ws.send("pong");
    }
  });

  ws.on("close", () => {
    clearInterval(intervalId);
    const streams = cameraStreams.get(cameraId);
    if (streams) {
      streams.delete(ws);
      // Если больше нет клиентов — останавливаем FFmpeg и цикл детекции
      if (streams.size === 0) {
        stopCameraPipeline(cameraId);
      }
    }
  });
});

// ── Общий конвейер камеры: один FFmpeg + один цикл детекции на всех клиентов ──
const SOI = Buffer.from([0xFF, 0xD8]);
const EOI = Buffer.from([0xFF, 0xD9]);

function getFallbackFrame(): string {
  const assetsDir = path.join(__dirname, process.env.NODE_ENV === "production" ? "../public/assets" : "public/assets");
  const rusSrc = path.join(assetsDir, "rus.jpg");
  const logoSrc = path.join(assetsDir, "logo.jpg");
  if (fs.existsSync(rusSrc)) return fs.readFileSync(rusSrc).toString("base64");
  if (fs.existsSync(logoSrc)) return fs.readFileSync(logoSrc).toString("base64");
  return FALLBACK_JPEG;
}

// Кэш автоопределённых параметров потока: camId → { width, height, codec, fps, probedAt }
const streamProbeCache = new Map<number, { width: number; height: number; codec: string; fps: number; probedAt: number }>();
const STREAM_PROBE_TTL_MS = 5 * 60 * 1000; // 5 минут

/**
 * Пробует RTSP-поток камеры через FFmpeg и определяет реальные параметры:
 * разрешение, кодек, FPS. Результат кэшируется и сохраняется в БД.
 */
async function probeStreamParams(cam: any): Promise<{ width: number; height: number; codec: string; fps: number } | null> {
  const cached = streamProbeCache.get(cam.id);
  if (cached && Date.now() - cached.probedAt < STREAM_PROBE_TTL_MS) {
    return { width: cached.width, height: cached.height, codec: cached.codec, fps: cached.fps };
  }

  // Используем данные из БД если они есть (сохранённый результат предыдущего проба)
  if (cam.stream_width && cam.stream_height) {
    const result = { width: cam.stream_width, height: cam.stream_height, codec: cam.stream_codec || "h264", fps: cam.stream_fps || 25 };
    streamProbeCache.set(cam.id, { ...result, probedAt: Date.now() });
    return result;
  }

  // Пробуем RTSP-поток
  try {
    // Для пробы нужен loglevel info (не error), чтобы увидеть параметры потока
    const probeArgs = buildFfmpegInputArgs(cam).map(a => a === "error" ? "info" : a);
    const args = [
      ...probeArgs,
      "-frames:v", "1",
      "-f", "null", "-"
    ];
    const proc = spawn(getFfmpegPath(), args);
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        try { proc.kill("SIGKILL"); } catch {}
        resolve(null);
      }, 10000);

      proc.on("close", () => {
        clearTimeout(timeout);
        // Парсим stderr: "Stream #0:0: Video: hevc (Main), yuvj420p(pc, bt709), 2688x1520, 20 fps"
        // Pixel format может содержать запятые: yuv420p(tv, bt709, progressive)
        // Поэтому ищем кодек в начале, а разрешение — первое \d+x\d+ после "Video:"
        const codecMatch = stderr.match(/Video:\s+(\w+)/);
        const resMatch = stderr.match(/Video:.*?(\d{2,5})x(\d{2,5})(?:,\s+(\d+)\s+fps)?/);
        if (codecMatch && resMatch) {
          const codec = codecMatch[1].toLowerCase();
          const width = parseInt(resMatch[1], 10);
          const height = parseInt(resMatch[2], 10);
          const fps = resMatch[3] ? parseInt(resMatch[3], 10) : 25;
          const result = { width, height, codec, fps };
          streamProbeCache.set(cam.id, { ...result, probedAt: Date.now() });
          logInfo(`Probe камеры ${cam.id}: ${codec} ${width}x${height} @ ${fps}fps`);
          // Сохраняем в БД
          prisma.camera.update({
            where: { id: cam.id },
            data: { stream_width: width, stream_height: height, stream_codec: codec, stream_fps: fps }
          }).catch(() => {});
          resolve(result);
        } else {
          logWarn(`Probe камеры ${cam.id}: не удалось распарсить вывод FFmpeg. stderr (first 500): ${stderr.substring(0, 500)}`);
          resolve(null);
        }
      });
      proc.on("error", () => { clearTimeout(timeout); resolve(null); });
    });
  } catch {
    return null;
  }
}

function getStreamResolution(cam: any): { width: number; height: number } {
  const isIp = cam.camera_type === "Hikvision" || cam.camera_type === "UNV" || cam.camera_type === "ONVIF" || cam.camera_type === "RTSP" || cam.camera_type === "IP";
  if (!isIp) {
    return { width: 640, height: 480 };
  }
  // Приоритет: данные из БД (автоопределённые) → env → default 1920x1080
  // Но ограничиваем выход FFmpeg до 1920x1080 для производительности (CPU/GPU)
  const MAX_OUTPUT_DIM = 1920;
  if (cam.stream_width && cam.stream_height) {
    const maxDim = Math.max(cam.stream_width, cam.stream_height);
    if (maxDim <= MAX_OUTPUT_DIM) {
      return { width: cam.stream_width, height: cam.stream_height };
    }
    const scale = MAX_OUTPUT_DIM / maxDim;
    return { 
      width: Math.round(cam.stream_width * scale), 
      height: Math.round(cam.stream_height * scale) 
    };
  }
  const key = cam.camera_type || "RTSP";
  const w = parseInt(process.env[`${key}_STREAM_WIDTH`] || process.env["STREAM_WIDTH"] || "1920", 10);
  const h = parseInt(process.env[`${key}_STREAM_HEIGHT`] || process.env["STREAM_HEIGHT"] || "1080", 10);
  return { width: w, height: h };
}

function startCameraPipeline(cam: any, fallbackFrame: string) {
  if (!cam.source) return;
  if (cameraWebhookFallback.get(cam.id)) {
    logWarn(`Камера ${cam.id} (${cam.name}) сейчас работает в fallback-режиме по вебхукам — FFmpeg не запускается`);
    return;
  }

  // Автоопределение параметров потока при первом запуске (async, но не блокируем старт)
  if (!cam.stream_width || !cam.stream_height) {
    probeStreamParams(cam).then((probed) => {
      if (probed) {
        cam.stream_width = probed.width;
        cam.stream_height = probed.height;
        cam.stream_codec = probed.codec;
        cam.stream_fps = probed.fps;
        const idx = cameras.findIndex(c => c.id === cam.id);
        if (idx >= 0) {
          cameras[idx].stream_width = probed.width;
          cameras[idx].stream_height = probed.height;
          cameras[idx].stream_codec = probed.codec;
          cameras[idx].stream_fps = probed.fps;
        }
        logInfo(`Камера ${cam.id}: определено ${probed.codec} ${probed.width}x${probed.height} @ ${probed.fps}fps — при следующем рестарте применится`);
      }
    }).catch(() => {});
  }

  const { width, height } = getStreamResolution(cam);
  // FPS захвата: не выше реального FPS потока и не выше 15 (для производительности)
  const streamFps = cam.stream_fps || cam.fps || 25;
  const captureFps = Math.min(streamFps, 15);
  const args = [
    ...buildFfmpegInputArgs(cam),
    "-f", "mjpeg",
    "-pix_fmt", "yuvj422p",
    "-q:v", "3",
    "-r", String(captureFps),
    "-s", `${width}x${height}`,
    "-"
  ];
  logInfo(`FFmpeg запущен для камеры ${cam.id} (${cam.name}) @ ${width}x${height} ${captureFps}fps${cam.stream_codec ? ` [${cam.stream_codec}]` : ''}`, { source: cam.source, path: getFfmpegPath() });

  try {
    const ffmpegPath = getFfmpegPath();
    const proc = spawn(ffmpegPath, args);
    activeFfmpegProcesses.set(cam.id, proc);
    // Эффективный разбор MJPEG: один растущий буфер + indexOf (без побайтовых аллокаций)
    let acc: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let headerFound = false;

    proc.stdout.on("data", (chunk: Buffer) => {
      if (acc.length) {
        acc = Buffer.concat([acc, chunk]);
      } else {
        acc = chunk as Buffer<ArrayBufferLike>;
      }

      // Ограничиваем размер буфера, чтобы не съесть память при сбоях потока
      if (acc.length > 8 * 1024 * 1024) acc = acc.slice(acc.length - 64);

      while (true) {
        if (!headerFound) {
          const s = acc.indexOf(SOI);
          if (s < 0) {
            // SOI ещё не пришёл — оставляем хвост (макс. 4 байта на случай разрыва SOI между чанками)
            acc = acc.length > 4 ? acc.slice(acc.length - 4) : acc;
            break;
          }
          acc = acc.slice(s); // отбрасываем мусор до начала кадра
          headerFound = true;
        }
        const e = acc.indexOf(EOI, 1);
        if (e < 0) {
          // Кадр ещё не закончился — ждём следующий чанк
          break;
        }
        const jpeg = acc.slice(0, e + 2);
        const shared = cameraFrames.get(cam.id) || { frame: fallbackFrame, faces: [] };
        shared.frame = jpeg.toString("base64");
        cameraFrames.set(cam.id, shared);
        if (!(cam as any).snapshot_path || !fs.existsSync(path.join(snapshotsDir, path.basename((cam as any).snapshot_path)))) {
          const snapName = `snapshots/cam${cam.id}_auto.jpg`;
          const snapPath = path.join(snapshotsDir, `cam${cam.id}_auto.jpg`);
          try {
            fs.writeFileSync(snapPath, jpeg);
            const idx = cameras.findIndex((c) => c.id === cam.id);
            if (idx >= 0) cameras[idx].snapshot_path = snapName;
          } catch (e) {
            logError(e as Error, { context: `auto-save snapshot camera ${cam.id}` });
          }
        }
        // Пошёл реальный поток — сбрасываем счётчик неудач, чтобы backoff обнулился
        if (cameraFfmpegRetries.has(cam.id)) cameraFfmpegRetries.delete(cam.id);
        if (cameraFfmpegFailCount.has(cam.id)) cameraFfmpegFailCount.delete(cam.id);
        if (cameraWebhookFallback.has(cam.id)) {
          cameraWebhookFallback.delete(cam.id);
          logInfo(`Камера ${cam.id} (${cam.name}) восстановила RTSP, fallback-режим отключён`);
        }
        acc = acc.slice(e + 2);
        headerFound = false;
      }
    });

    proc.stderr.on("data", (d) => logDebug(`FFmpeg (${cam.id}): ${d.toString().trim()}`));

    proc.on("error", (err) => logError(`Ошибка FFmpeg для камеры ${cam.id}: ${err.message}`));

    proc.on("close", (code) => {
      logInfo(`FFmpeg завершил работу для камеры ${cam.id}, код: ${code}`);
      activeFfmpegProcesses.delete(cam.id);
      cameraFrames.delete(cam.id);

      const currentCam = cameras.find(c => c.id === cam.id);
      if (!currentCam || !currentCam.is_active) {
        cameraFfmpegRetries.delete(cam.id);
        return;
      }

      const hasClients = (cameraStreams.get(cam.id)?.size ?? 0) > 0;
      if (!hasClients) {
        logInfo(`Камера ${cam.id} (${cam.name}) остановлена: нет подключенных клиентов`);
        cameraFfmpegRetries.delete(cam.id);
        return;
      }

      // Подсказка при типичных ошибках
      const sourceHint = getCameraSourceHint(currentCam);
      if (sourceHint && (cameraFfmpegFailCount.get(cam.id) || 0) === 1) {
        logWarn(`Камера ${cam.id}: ${sourceHint}`);
      }
      if (code === 1 || code === 23) {
        logWarn(`Камера ${cam.id}: FFmpeg завершился с ошибкой (код ${code}) — проверьте источник "${currentCam.source}"`);
      }

      const attempts = (cameraFfmpegRetries.get(cam.id) || 0) + 1;
      cameraFfmpegRetries.set(cam.id, attempts);
      if (!cameraFfmpegFailCount.has(cam.id)) cameraFfmpegFailCount.set(cam.id, 0);
      cameraFfmpegFailCount.set(cam.id, (cameraFfmpegFailCount.get(cam.id) || 0) + 1);
      const delay = Math.min(30000, 3000 * 2 ** Math.min(attempts - 1, 4));
      if (attempts === 1 || attempts % 5 === 0) {
        logWarn(`Камера ${cam.id} (${cam.name}) недоступна, попытка №${attempts}, следующий повтор через ${delay / 1000}с`);
      }

      // USB-камеры: после 3 неудач прекращаем попытки (устройство физически отсутствует)
      const isUsb = currentCam.camera_type === "USB" || /^\d+$/.test((currentCam.source || "").trim()) || (currentCam.source || "").startsWith("video=");
      if (isUsb && attempts >= 3) {
        logWarn(`Камера ${cam.id} (${cam.name}): USB-устройство не найдено после ${attempts} попыток, остановка`);
        prisma.camera.update({ where: { id: cam.id }, data: { is_active: false } }).catch(() => {});
        const idx = cameras.findIndex(c => c.id === cam.id);
        if (idx >= 0) cameras[idx].is_active = false;
        cameraFfmpegRetries.delete(cam.id);
        cameraFfmpegFailCount.delete(cam.id);
        return;
      }

      if (currentCam.camera_type === "UNV" && (cameraFfmpegFailCount.get(cam.id) || 0) >= 5) {
        cameraWebhookFallback.set(cam.id, true);
        cameraRestartTimers.get(cam.id) && clearTimeout(cameraRestartTimers.get(cam.id)!);
        cameraRestartTimers.delete(cam.id);
        cameraFfmpegRetries.delete(cam.id);
        cameraFfmpegFailCount.delete(cam.id);
        logWarn(`Камера ${cam.id} (${cam.name}) переключена в fallback-режим UNV webhook после нескольких неудач RTSP`);
        return;
      }

      const restartTimer = setTimeout(() => {
        cameraRestartTimers.delete(cam.id);
        const latestCam = cameras.find(c => c.id === cam.id);
        if (latestCam && latestCam.is_active && !latestCam.use_camera_analytics && !activeFfmpegProcesses.has(cam.id)) {
          startCameraPipeline(latestCam, fallbackFrame);
        }
      }, delay);
      cameraRestartTimers.set(cam.id, restartTimer);
    });

    startCameraDetection(cam, fallbackFrame);
  } catch (e: any) {
    logError(`Не удалось запустить FFmpeg: ${e.message}`);
  }
}

function startCameraDetection(cam: any, fallbackFrame: string) {
  if (cameraDetectionTimers.has(cam.id)) return;

  let detectionInProgress = false;
  let currentInterval = 1000;
  let consecutiveSuccesses = 0;
  let consecutiveFailures = 0;
  let lastDetectionTime = 0;

  const minInterval = 500;
  const maxInterval = 3000;

  function getAdjustedInterval(base: number): number {
    const priority = camera_priority_weights[cam.id] || camera_priority_weights[cam.camera_type] || 1.0;
    if (priority <= 0) return maxInterval;
    return Math.max(minInterval, Math.round(base / priority));
  }

  function shouldRunBySchedule(): boolean {
    if (!ai_adaptive_frame_skip) return true;
    const hour = new Date().getHours();
    const camSchedule = cam.schedule || "always";
    if (camSchedule === "night") {
      return hour >= 0 && hour < 6;
    } else if (camSchedule === "day") {
      return hour >= 6 && hour < 22;
    } else if (camSchedule === "always") {
      if (hour >= 0 && hour < 6) {
        return Math.random() > 0.7;
      }
    }
    return true;
  }

  function hasMotion(frameBase64: string): boolean {
    if (!ai_adaptive_frame_skip) return true;
    // Хешируем байты из середины и конца кадра (начало всегда одинаковое — JPEG-заголовок)
    const buf = Buffer.from(frameBase64, "base64");
    const len = buf.length;
    if (len < 100) return true;
    const samples = [
      buf[Math.floor(len * 0.25)],
      buf[Math.floor(len * 0.50)],
      buf[Math.floor(len * 0.75)],
      buf[len - 1],
    ].join(",");
    const hash = `${len}_${samples}`;
    const prev = cameraLastFrameHash.get(cam.id);
    cameraLastFrameHash.set(cam.id, hash);
    if (!prev) return true;
    return hash !== prev;
  }

  async function runDetection() {
    if (!activeFfmpegProcesses.has(cam.id)) return;

    const shared = cameraFrames.get(cam.id);
    const frameBase64 = shared ? shared.frame : fallbackFrame;
    if (!frameBase64 || frameBase64 === fallbackFrame) return;

    if (!hasMotion(frameBase64)) {
      return;
    }

    const now = Date.now();
    if (now - lastDetectionTime < currentInterval) return;

    detectionInProgress = true;
    const startTime = Date.now();

    try {
      const buf = Buffer.from(frameBase64, "base64");
      const faces = await detectFaces(buf);
      const debug = DEBUG_CAMERA_IDS.has(String(cam.id));
      if (debug) logWarn(`DEBUG MODE включён для камеры ${cam.id}: ROI отключён, пороги снижены, кулдауны отключены`);
      const enriched = await processDetectedFaces(cam, frameBase64, faces, debug);
      const cur = cameraFrames.get(cam.id) || { frame: frameBase64, faces: [] };
      cur.faces = enriched;
      cameraFrames.set(cam.id, cur);

      const duration = Date.now() - startTime;
      consecutiveSuccesses++;
      consecutiveFailures = 0;
      lastDetectionTime = now;

      if (duration < 200 && consecutiveSuccesses >= 10 && currentInterval > minInterval) {
        currentInterval = getAdjustedInterval(Math.max(minInterval, currentInterval - 100));
      }
    } catch (e) {
      logError(e as Error, { cameraId: cam.id });
      consecutiveFailures++;
      consecutiveSuccesses = 0;

      if (consecutiveFailures >= 2 && currentInterval < maxInterval) {
        currentInterval = getAdjustedInterval(Math.min(maxInterval, currentInterval + 500));
      }
    } finally {
      detectionInProgress = false;
    }
  }

  const timer = setInterval(async () => {
    if (!activeFfmpegProcesses.has(cam.id)) return;
    if (!shouldRunBySchedule()) return;
    try {
      await runDetection();
    } catch (e) {
      logError(e as Error, { cameraId: cam.id, context: "camera detection interval" });
    }
  }, 500);

  cameraDetectionTimers.set(cam.id, timer);
}

function stopCameraPipeline(cameraId: number) {
  const proc = activeFfmpegProcesses.get(cameraId);
  if (proc) {
    try { proc.kill("SIGKILL"); } catch { /* ignore */ }
    activeFfmpegProcesses.delete(cameraId);
  }
  const timer = cameraDetectionTimers.get(cameraId);
  if (timer) {
    clearInterval(timer);
    cameraDetectionTimers.delete(cameraId);
  }
  // Отменяем отложенный перезапуск и сбрасываем backoff-счётчик
  const restartTimer = cameraRestartTimers.get(cameraId);
  if (restartTimer) {
    clearTimeout(restartTimer);
    cameraRestartTimers.delete(cameraId);
  }
  cameraFfmpegRetries.delete(cameraId);
  cameraFrames.delete(cameraId);
  cameraLastFrameHash.delete(cameraId);
}

// Upgrade handling for websockets
server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "", `http://${request.headers.host}`);
  const pathname = url.pathname;
  logInfo(`WebSocket upgrade request: ${pathname}`);

  // API-key защита WS (если задан API_KEY)
  if (API_KEY) {
    const qk = url.searchParams.get("api_key");
    const hk = request.headers["x-api-key"] as string | undefined;
    const auth = request.headers["authorization"] as string | undefined;
    const token = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (qk !== API_KEY && hk !== API_KEY && token !== API_KEY) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\n\r\n{\"detail\":\"Unauthorized: требуется api_key\"}");
      socket.destroy();
      return;
    }
  }

  if (pathname === "/ws/security") {
    wssSecurity.handleUpgrade(request, socket, head, (ws) => {
      wssSecurity.emit("connection", ws, request);
    });
  } else if (pathname.startsWith("/ws/camera/")) {
    wssCamera.handleUpgrade(request, socket, head, (ws) => {
      wssCamera.emit("connection", ws, request);
    });
  } else {
    logWarn(`Unknown WebSocket path: ${pathname}`);
    socket.destroy();
  }
});

// ── AI ENGINE ENDPOINTS ──

// Переиндексация всех персон — пересоздаёт эмбеддинги из фото в БД
app.post(["/api/persons/reindex_all", "/api/persons/reindex_all/"], async (req, res) => {
  try {
    const allPersons = await prisma.person.findMany({
      include: { photos: true },
    });

    const success: string[] = [];
    const failed: { name: string; error: string }[] = [];
    const no_photo: string[] = [];

    for (const person of allPersons) {
      const photos = person.photos.filter((p: any) => p.photo_path);
      if (photos.length === 0) {
        no_photo.push(person.name);
        continue;
      }
      try {
        // Удаляем старые дескрипторы
        await prisma.faceDescriptor.deleteMany({ where: { person_id: person.id } });
        await unregisterFacePerson(person.id);

        let registered = 0;
        for (const photo of photos) {
          const fullPath = path.join(publicDir, photo.photo_path);
          if (!fs.existsSync(fullPath)) continue;
          const result = await registerFacePerson(
            person.id, person.name, person.category, photo.photo_path, fullPath
          );
          if (result.hasEmbedding) registered++;
        }

        await prisma.person.update({
          where: { id: person.id },
          data: { embedding_count: registered },
        });

        success.push(person.name);
      } catch (e: any) {
        failed.push({ name: person.name, error: e.message });
      }
    }

    logInfo(`Reindex complete: ${success.length} OK, ${failed.length} failed, ${no_photo.length} no_photo`);
    res.json({ success, failed, no_photo });
  } catch (err) {
    logError(err as Error, { path: "/api/persons/reindex_all" });
    res.status(500).json({ detail: "Internal server error" });
  }
});

// Заглушка для скачивания моделей (модели уже в папке models/)
app.post(["/api/ai/download_models", "/api/ai/download_models/"], async (req, res) => {
  try {
    const modelsDir = path.join(process.cwd(), "models", "buffalo_l");
    const required = ["det_10g.onnx", "w600k_r50.onnx", "1k3d68.onnx", "2d106det.onnx", "genderage.onnx"];
    const missing = required.filter(f => !fs.existsSync(path.join(modelsDir, f)));
    if (missing.length > 0) {
      return res.json({
        ok: false,
        ai_ready: false,
        message: `Отсутствуют модели: ${missing.join(", ")}. Запустите download_models.py`,
      });
    }
    const engineStatus = getEngineStatus();
    res.json({ ok: true, ai_ready: engineStatus.initialized, message: "Все модели на месте" });
  } catch (err) {
    logError(err as Error, { path: "/api/ai/download_models" });
    res.status(500).json({ detail: "Internal server error" });
  }
});

// Статус AI движка
app.get(["/api/face-engine/status", "/api/face-engine/status/"], (req, res) => {
  const status = getEngineStatus();
  res.json(status);
});

// ── SETUP / GPU ──
app.post(["/api/settings/setup/rerun", "/api/settings/setup/rerun/"], async (req, res) => {
  try {
    // Форсируем health check Python-сервера и перечитываем GPU статус
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    let gpuProvider = "CPUExecutionProvider";
    try {
      const r = await (await import("node-fetch")).default(
        `${process.env.FACE_SERVER_URL || "http://localhost:8001"}/status`,
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);
      if (r.ok) {
        const s = await r.json() as any;
        gpuProvider = s.provider || "CPUExecutionProvider";
      }
    } catch { clearTimeout(timeoutId); }
    res.json({
      ok: true,
      message: gpuProvider !== "CPUExecutionProvider"
        ? `GPU активен: ${gpuProvider}`
        : "CPU режим активен",
      setup: { errors: [] },
    });
  } catch (err) {
    logError(err as Error, { path: "/api/settings/setup/rerun" });
    res.status(500).json({ detail: "Internal server error" });
  }
});

// ── CAMERAS SYNC ──
app.post(["/api/cameras/sync", "/api/cameras/sync/"], async (req, res) => {
  try {
    const dbCams = await prisma.camera.findMany({ where: { is_active: true } });
    // Sync in-memory cache
    cameras = await prisma.camera.findMany({ orderBy: { id: "asc" } }) as any[];
    const running = dbCams.map(c => c.id);
    res.json({
      ok: true,
      started: [],
      stopped: [],
      already_running: running,
      running_now: running,
    });
  } catch (err) {
    logError(err as Error, { path: "/api/cameras/sync" });
    res.status(500).json({ detail: "Internal server error" });
  }
});

// ── BACKUP & RESTORE ──
const backupsDir = path.join(process.cwd(), "backups");

app.post(["/api/backup", "/api/backup/"], async (req, res) => {
  try {
    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const backupName = `backup_${timestamp}.zip`;
    const backupPath = path.join(backupsDir, backupName);

    // Создаём ZIP архив с БД и медиафайлами
    const output = fs.createWriteStream(backupPath);
    const archive = new ZipArchive({ zlib: { level: 6 } });

    await new Promise<void>((resolve, reject) => {
      output.on("close", resolve);
      archive.on("error", reject);
      archive.pipe(output);
      // БД
      const dbPath = path.join(process.cwd(), "prisma", "dev.db");
      if (fs.existsSync(dbPath)) archive.file(dbPath, { name: "dev.db" });
      // Фото и снапшоты
      if (fs.existsSync(photosDir)) archive.directory(photosDir, "photos");
      if (fs.existsSync(snapshotsDir)) archive.directory(snapshotsDir, "snapshots");
      archive.finalize();
    });

    logInfo(`Backup created: ${backupName}`);
    res.json({ ok: true, backup: backupName });
  } catch (err: any) {
    logError(err as Error, { path: "/api/backup" });
    res.json({ ok: false, error: err.message });
  }
});

app.post(["/api/backup/restore", "/api/backup/restore/"], upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, message: "Файл не загружен" });

    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

    // Сохраняем текущую БД как pre-restore backup
    const dbPath = path.join(process.cwd(), "prisma", "dev.db");
    if (fs.existsSync(dbPath)) {
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      fs.copyFileSync(dbPath, path.join(backupsDir, `pre_restore_${ts}.db`));
    }

    const zipPath = req.file.path;
    const errors: string[] = [];
    const writePromises: Promise<void>[] = [];

    await fs.createReadStream(zipPath)
      .pipe(unzipper.Parse())
      .on("entry", (entry: any) => {
        const fileName: string = entry.path;
        if (fileName === "dev.db") {
          const writeStream = fs.createWriteStream(dbPath);
          writePromises.push(new Promise(resolve => writeStream.on("finish", resolve)));
          entry.pipe(writeStream);
        } else if (fileName.startsWith("photos/")) {
          const dest = path.join(photosDir, path.basename(fileName));
          const writeStream = fs.createWriteStream(dest);
          writePromises.push(new Promise(resolve => writeStream.on("finish", resolve)));
          entry.pipe(writeStream);
        } else if (fileName.startsWith("snapshots/")) {
          const dest = path.join(snapshotsDir, path.basename(fileName));
          const writeStream = fs.createWriteStream(dest);
          writePromises.push(new Promise(resolve => writeStream.on("finish", resolve)));
          entry.pipe(writeStream);
        } else {
          entry.autodrain();
        }
      })
      .promise();

    await Promise.all(writePromises);

    fs.unlinkSync(zipPath);

    logInfo("Backup restored successfully");
    res.json({ ok: true, message: "Резервная копия восстановлена. Перезагрузите приложение.", errors });
  } catch (err: any) {
    logError(err as Error, { path: "/api/backup/restore" });
    res.json({ ok: false, message: err.message, errors: [err.message] });
  }
});

// Инициализация / переинициализация движка
app.post(["/api/face-engine/init", "/api/face-engine/init/"], async (req, res) => {
  try {
    const ok = await initFaceEngine();
    res.json({ success: ok, status: getEngineStatus() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Перестроение индекса дескрипторов из текущей базы персон
app.post(["/api/face-engine/rebuild-index", "/api/face-engine/rebuild-index/"], async (req, res) => {
  try {
    const result = await rebuildDescriptorIndex(persons);
    res.json({ success: true, ...result, status: getEngineStatus() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Детекция лиц на изображении
app.post(["/api/face-engine/detect", "/api/face-engine/detect/"], upload.any(), async (req, res) => {
  let files: Express.Multer.File[] = [];
  if (req.file) files.push(req.file);
  if (req.files && Array.isArray(req.files)) files = files.concat(req.files as Express.Multer.File[]);

  if (files.length === 0) {
    return res.status(400).json({ detail: "No file uploaded" });
  }

  try {
    const filePath = path.join(photosDir, files[0].filename);
    const fast = req.query.fast === "true";
    const faces = fast
      ? await detectFacesFast(filePath)
      : await detectFaces(filePath);

    res.json({
      face_count: faces.length,
      faces: faces.map(f => ({
        box: f.box,
        score: f.score,
        age: undefined,
        gender: undefined,
        genderProbability: undefined,
        expression: undefined,
        expressionProbability: undefined,
        landmarks_count: 0,
        has_descriptor: !!f.descriptor,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// Оценка качества фото для эмбеддинга
app.post(["/api/face-engine/quality", "/api/face-engine/quality/"], upload.any(), async (req, res) => {
  let files: Express.Multer.File[] = [];
  if (req.file) files.push(req.file);
  if (req.files && Array.isArray(req.files)) files = files.concat(req.files as Express.Multer.File[]);

  if (files.length === 0) {
    return res.status(400).json({ detail: "No file uploaded" });
  }

  try {
    const filePath = path.join(photosDir, files[0].filename);
    const quality = await assessPhotoQuality(filePath);
    res.json(quality);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// Debug: детекция/распознавание на uploaded-файле с обходом ROI и низкими порогами
app.post(["/api/debug/detect", "/api/debug/detect/"], upload.any(), async (req, res) => {
  let files: Express.Multer.File[] = [];
  if (req.file) files.push(req.file);
  if (req.files && Array.isArray(req.files)) files = files.concat(req.files as Express.Multer.File[]);

  if (files.length === 0) {
    return res.status(400).json({ detail: "No file uploaded" });
  }

  try {
    const filePath = path.join(photosDir, files[0].filename);
    const faces = await detectFaces(filePath);

    const enriched = await processDetectedFaces(
      { id: 0, name: "DEBUG", roi_zones: null } as any,
      "",
      faces,
      true
    );

    res.json({
      face_count: faces.length,
      faces: enriched.map((f: any) => ({
        box: f.box,
        score: f.detection_score || f.score,
        descriptor_hash: !!f.descriptor,
        person_id: f.person_id,
        person_name: f.person_name,
        category: f.category,
        confidence: f.confidence,
        needs_confirmation: f.needs_confirmation,
        is_cooldown: f.is_cooldown,
        is_duplicate_unknown: f.is_duplicate_unknown,
        is_ignored: f.is_ignored,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// ── DOWNLOAD FULL BACKUP (GET) ──
app.get("/api/backup/full", async (req, res) => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const backupName = `kraken_backup_${timestamp}.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${backupName}"`);

    const zip = new AdmZip();
    const dbPath = path.join(process.cwd(), "prisma", "dev.db");
    if (fs.existsSync(dbPath)) {
      zip.addLocalFile(dbPath, "kraken.db");
    }
    if (fs.existsSync(photosDir)) zip.addLocalFolder(photosDir, "photos");
    if (fs.existsSync(snapshotsDir)) zip.addLocalFolder(snapshotsDir, "snapshots");

    const buffer = zip.toBuffer();
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
    logInfo(`Backup downloaded: ${backupName}`);
  } catch (err: any) {
    logError(err as Error, { path: "/api/backup/full" });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── REPORTS: EXCEL ──
app.get("/api/reports/excel", async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const events = await prisma.event.findMany({
      where: { created_at: { gte: startDate } },
      include: { person: true, camera: true },
      orderBy: { created_at: "desc" },
      take: 5000,
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(`Отчёт за ${days} дней`);

    worksheet.columns = [
      { header: "Дата и время", key: "date", width: 20 },
      { header: "Камера", key: "camera", width: 20 },
      { header: "Имя", key: "name", width: 25 },
      { header: "Категория", key: "category", width: 15 },
      { header: "Уверенность", key: "confidence", width: 15 },
      { header: "Тип события", key: "type", width: 15 },
    ];

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E0E0" } };

    events.forEach((event) => {
      worksheet.addRow({
        date: new Date(event.created_at).toLocaleString("ru-RU"),
        camera: event.camera_name || "Неизвестно",
        name: event.person_name || "Неизвестный",
        category: event.person_category || "-",
        confidence: event.confidence ? `${(event.confidence * 100).toFixed(1)}%` : "-",
        type: event.event_type || "recognition",
      });
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="report_${days}days.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err: any) {
    logError(err as Error, { path: "/api/reports/excel" });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Шрифт с поддержкой кириллицы (стандартный шрифт pdfkit НЕ поддерживает русские буквы) ──
function resolveFontPath(name: string): string | undefined {
  const candidates = [
    path.join(process.cwd(), "server", "fonts", name),
    path.join(__dirname, "server", "fonts", name),
    path.join(__dirname, "fonts", name),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

// ── REPORTS: PDF ──
app.get("/api/reports/pdf", async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const events = await prisma.event.findMany({
      where: { created_at: { gte: startDate } },
      include: { person: true, camera: true },
      orderBy: { created_at: "desc" },
      take: 1000,
    });

    const doc = new PDFDocument({ margin: 50, size: "A4", layout: "landscape" });

    // Кириллица: регистрируем Ttf-шрифт из проекта (server/fonts/arial*.ttf)
    const fontRegular = resolveFontPath("arial.ttf");
    const fontBold = resolveFontPath("arialbd.ttf");
    if (fontRegular) {
      doc.registerFont("Regular", fontRegular);
      if (fontBold) doc.registerFont("Bold", fontBold);
    } else {
      logError(new Error("Шрифт с кириллицей не найден: server/fonts/arial.ttf"), { path: "/api/reports/pdf" });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="report_${days}days.pdf"`);
    doc.pipe(res);

    if (fontBold) doc.font("Bold");
    doc.fontSize(16).text(`Отчёт о событиях за последние ${days} дней`, { align: "center" });
    doc.moveDown();
    if (fontRegular) doc.font("Regular");
    doc.fontSize(9);

    const tableTop = 100;
    const headers = ["Дата", "Камера", "Имя", "Категория", "Событие"];
    let xPos = 50;

    headers.forEach((h) => { doc.text(h, xPos, tableTop); xPos += 140; });

    let yPos = tableTop + 20;
    events.forEach((event) => {
      if (yPos > 500) { doc.addPage(); yPos = 50; }
      xPos = 50;

      doc.text(new Date(event.created_at).toLocaleString("ru-RU"), xPos, yPos);
      doc.text(event.camera_name || "N/A", xPos + 140, yPos);
      doc.text(event.person_name || "Неизвестный", xPos + 280, yPos);
      doc.text(event.person_category || "-", xPos + 420, yPos);
      doc.text(event.event_type || "recognition", xPos + 560, yPos);
      yPos += 20;
    });

    doc.end();
  } catch (err: any) {
    logError(err as Error, { path: "/api/reports/pdf" });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── VITE MIDDLEWARE OR STATIC SERVER ──
async function seedDatabase() {
  // Seed default categories if DB is empty
  const catCount = await prisma.category.count();
  if (catCount === 0) {
    logInfo("База данных пуста. Заполнение базовых категорий...");
    for (const cat of categories) {
      await prisma.category.create({
        data: {
          code: cat.code, label: cat.label, color: cat.color, bg_color: cat.bg_color,
          is_alert: cat.is_alert, alert_sound: cat.alert_sound, alert_volume: cat.alert_volume,
          detect_enabled: cat.detect_enabled, sort_order: cat.sort_order, is_system: cat.is_system,
        }
      });
    }
  }

  // Sync in-memory categories from DB
  const categoriesFromDB = await prisma.category.findMany({ orderBy: { sort_order: "asc" } });
  categories = categoriesFromDB as any[];

  // Seed default camera if none exist
  const camCount = await prisma.camera.count();
  if (camCount === 0) {
    logInfo("Камеры не найдены. Создаём дефолтную USB-камеру...");
    await prisma.camera.create({
      data: {
        name: "Входная группа (Основная)",
        source: "/dev/video0",
        camera_type: "USB",
        zone: "Вход",
        is_active: true,
        status: "online",
        fps: 25,
        ping_ms: 0,
        is_smart_recording: false,
        is_chronicle: true,
      },
    });
  }

  // Load cameras from DB into in-memory array
  const camsFromDB = await prisma.camera.findMany({ orderBy: { id: "asc" } });
  cameras = camsFromDB as any[];

  // Автозапуск FFmpeg + детекции для всех активных камер, чтобы камеры работали
  // сразу после старта сервера, без ожидания WebSocket-клиента в браузере.
  const fallbackFrame = getFallbackFrame();
  for (const cam of cameras) {
    if (cam.is_active && !activeFfmpegProcesses.has(cam.id) && !cam.use_camera_analytics) {
      try {
        startCameraPipeline(cam, fallbackFrame);
        logInfo(`Автозапуск камеры ${cam.id} (${cam.name}) при старте сервера`);
      } catch (e) {
        logError(e as Error, { context: `auto-start camera ${cam.id}` });
      }
    }
  }

  // Load persons from DB into in-memory array
  const personsFromDB = await prisma.person.findMany({ include: { photos: true }, orderBy: { created_at: "desc" } });
  persons = personsFromDB as any[];

  // Load persisted settings
  recognition_threshold_pct = await loadSetting("recognition_threshold_pct", recognition_threshold_pct);
  verification_threshold_pct = await loadSetting("verification_threshold_pct", verification_threshold_pct);
  confirmation_threshold_pct = await loadSetting("confirmation_threshold_pct", confirmation_threshold_pct);
  low_threshold_pct = await loadSetting("low_threshold_pct", low_threshold_pct);
  active_categories = await loadSetting("active_categories", active_categories);

  logInfo(`Загружено: ${categories.length} категорий, ${persons.length} персон, ${cameras.length} камер`);
}

// Middleware для обработки ошибок
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logError(err, { url: req.url, method: req.method });
  
  res.status(err.status || 500).json({
    detail: err.message || "Внутренняя ошибка сервера",
    error: process.env.NODE_ENV === "development" ? err : undefined,
  });
});

/**
 * Освобождает порт перед запуском: завершает процесс, который его занимает.
 * Это гарантирует чистый старт даже если остался висеть старый инстанс
 * (например, упавший сервер или предыдущий запуск).
 * Порт Python-движка (8001) отсюда НЕ освобождаем — его поднимает отдельный
 * процесс (dev:face) параллельно через concurrently, и глушить его отсюда
 * значило бы убить лицевой сервер на старте. Его освобождает скрипт kill-ports.js
 * на этапе predev/prestart, до запуска всех процессов.
 */
async function freePort(port: number): Promise<void> {
  const os = platform();
  try {
    if (os === "win32") {
      const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
      const pids = new Set<string>();
      for (const line of stdout.split("\n")) {
        if (!line.includes("LISTENING")) continue;
        const parts = line.trim().split(/\s+/);
        // parts[1] — локальный адрес (0.0.0.0:3000, [::]:3000). Сверяем порт ТОЧНО:
        // findstr :3000 подстрочно матчит и :30000..:30009, иначе можно убить чужой процесс.
        const localAddr = parts[1] || "";
        if (!localAddr.endsWith(`:${port}`)) continue;
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid)) pids.add(pid);
      }
      for (const pid of pids) {
        try {
          await execAsync(`taskkill /F /PID ${pid}`);
          logWarn(`Освобождён порт ${port}: завершён процесс PID ${pid}`);
        } catch {
          // процесс уже ушёл
        }
      }
    } else {
      try {
        await execAsync(`lsof -ti :${port} | xargs -r kill -9`);
      } catch {
        // нет процесса на порту
      }
    }
  } catch {
    // порт свободен или netstat недоступен — ничего не делаем
  }
}

async function start() {
  // Инициализация базы данных
  await seedDatabase();

  // Подгружаем существующие записи в in-memory архив (календарь «Видеозаписи»)
  try {
    const existingRecs = await prisma.recording.findMany();
    for (const rec of existingRecs) recordToChronicle(rec);
    if (existingRecs.length) logInfo(`Загружено в архив записей: ${existingRecs.length}`);
  } catch (e) {
    logError(e as Error, { context: "load recordings to chronicle" });
  }

  // Инициализация AI движка при старте с загрузкой дескрипторов из БД
  logInfo("Инициализация AI Face Engine с загрузкой из БД...");
  
  await initFaceEngineWithDB();
  
  const engineStatus = getEngineStatus();
  if (engineStatus.initialized) {
    logInfo("AI Face Engine инициализирован и дескрипторы загружены");
  } else {
    logWarn("AI Face Engine не удалось инициализировать — работаем в mock-режиме");
  }

  // В dev фронтенд (SPA + HMR) отдаётся автономным Vite на :5173 (см. vite.config.ts,
  // который проксирует /api и /ws на :3000). Это стабильный HMR, независимый от
  // event-loop бэкенда (FFmpeg/WebSocket), и исключает конфликт двух Vite-инстансов,
  // из-за которого браузер постоянно перезагружался. Здесь на :3000 отдаём только
  // статику собранного билда (продакшн).
  if (process.env.NODE_ENV === "production") {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    // В dev UI живёт на Vite (:5173), а :3000 — только API/WS. Чтобы открытие
    // http://localhost:3000 в браузере не отдавало 404, перенаправляем обычную
    // навигацию на Vite. /api и /ws обрабатываются выше и сюда не попадают.
    const VITE_DEV_URL = process.env.VITE_DEV_URL || `http://localhost:5173`;
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api") || req.path.startsWith("/ws")) return next();
      res.redirect(302, VITE_DEV_URL + req.originalUrl);
    });
  }

  if (!API_KEY) {
    logWarn("SECURITY: API_KEY не задан — API и WebSocket доступны в сети БЕЗ аутентификации. " +
      "Задайте API_KEY в .env (и VITE_API_KEY на клиенте) перед публикацией/доступом извне.");
  } else {
    logInfo("API-key аутентификация ВКЛЮЧЕНА (требуется на всех /api и /ws).");
  }

  // Перед привязкой освобождаем порт от возможных «висячих» процессов,
  // чтобы старт гарантированно прошёл (порт сперва убивается, потом запуск).
  await freePort(PORT);

  server.listen(PORT, HOST, () => {
    logInfo(`Server running on http://${HOST}:${PORT}`);
  });
}

start();
