/**
 * Логирование для клиентской части (React)
 */

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  meta?: any;
}

const MAX_LOGS = 100;
let logs: LogEntry[] = [];

function addLog(level: LogLevel, message: string, meta?: any) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    meta,
  };
  
  logs.push(entry);
  
  // Ограничиваем количество логов
  if (logs.length > MAX_LOGS) {
    logs = logs.slice(-MAX_LOGS);
  }
  
  // Выводим в консоль
  const prefix = `[${level.toUpperCase()}]`;
  switch (level) {
    case 'error':
      console.error(prefix, message, meta || '');
      break;
    case 'warn':
      console.warn(prefix, message, meta || '');
      break;
    case 'info':
      console.info(prefix, message, meta || '');
      break;
    case 'debug':
      console.debug(prefix, message, meta || '');
      break;
  }
}

export const clientLogger = {
  info: (message: string, meta?: any) => addLog('info', message, meta),
  warn: (message: string, meta?: any) => addLog('warn', message, meta),
  error: (error: Error | string, meta?: any) => {
    const message = error instanceof Error ? error.message : error;
    const stack = error instanceof Error ? error.stack : undefined;
    addLog('error', message, { ...meta, stack });
  },
  debug: (message: string, meta?: any) => addLog('debug', message, meta),
  
  getLogs: () => [...logs],
  clearLogs: () => { logs = []; },
};

// Глобальный обработчик ошибок
if (typeof window !== 'undefined') {
  window.onerror = (message, source, lineno, colno, error) => {
    clientLogger.error(error || String(message), { source, lineno, colno });
    return false;
  };
  
  window.addEventListener('unhandledrejection', (event) => {
    clientLogger.error(event.reason, { type: 'unhandledrejection' });
  });
}

export default clientLogger;
