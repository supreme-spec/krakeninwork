/**
 * Логирование ошибок и событий
 */
import fs from "fs";
import path from "path";

const LOGS_DIR = path.join(process.cwd(), "logs");
const ERROR_LOG_PATH = path.join(LOGS_DIR, "errors.log");
const APP_LOG_PATH = path.join(LOGS_DIR, "app.log");

// Убеждаемся, что директория для логов существует
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function getTimestamp(): string {
  return new Date().toISOString();
}

function formatLog(level: string, message: string, meta?: any): string {
  const logEntry = {
    timestamp: getTimestamp(),
    level,
    message,
    meta: meta || undefined,
  };
  return JSON.stringify(logEntry) + "\n";
}

export function logInfo(message: string, meta?: any): void {
  const log = formatLog("INFO", message, meta);
  try {
    console.info(`[INFO] ${message}`, meta || "");
  } catch {
    // ignore broken pipe on console
  }
  try {
    fs.appendFileSync(APP_LOG_PATH, log);
  } catch {
    // ignore broken pipe on log file
  }
}

export function logWarn(message: string, meta?: any): void {
  const log = formatLog("WARN", message, meta);
  try {
    console.warn(`[WARN] ${message}`, meta || "");
  } catch {
    // ignore broken pipe on console
  }
  try {
    fs.appendFileSync(APP_LOG_PATH, log);
  } catch {
    // ignore broken pipe on log file
  }
}

export function logError(error: Error | string, meta?: any): void {
  const errorMessage = error instanceof Error ? error.message : error;
  const errorStack = error instanceof Error ? error.stack : undefined;
  const log = formatLog("ERROR", errorMessage, {
    ...meta,
    stack: errorStack,
  });
  try {
    console.error(`[ERROR] ${errorMessage}`, meta || "", errorStack || "");
  } catch {
    // ignore broken pipe on console
  }
  try {
    fs.appendFileSync(ERROR_LOG_PATH, log);
  } catch {
    // ignore broken pipe on log file
  }
}

export function logDebug(message: string, meta?: any): void {
  if (process.env.NODE_ENV === "development") {
    const log = formatLog("DEBUG", message, meta);
    try {
      console.debug(`[DEBUG] ${message}`, meta || "");
    } catch {
      // ignore broken pipe on console
    }
    try {
      fs.appendFileSync(APP_LOG_PATH, log);
    } catch {
      // ignore broken pipe on log file
    }
  }
}

export default {
  info: logInfo,
  warn: logWarn,
  error: logError,
  debug: logDebug,
};
