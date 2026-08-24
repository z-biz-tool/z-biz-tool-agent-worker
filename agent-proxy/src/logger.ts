// Lightweight timestamped logger. Stdout for info, stderr for warn/error.

const TS = () => new Date().toISOString();

function emit(level: string, args: unknown[]) {
  const line = `[${TS()}] [${level}] ${args
    .map((a) => (typeof a === 'string' ? a : safeStringify(a)))
    .join(' ')}\n`;
  if (level === 'ERROR' || level === 'WARN') {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

function safeStringify(v: unknown): string {
  try {
    if (v instanceof Error) return v.stack || `${v.name}: ${v.message}`;
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const logger = {
  info: (...args: unknown[]) => emit('INFO', args),
  warn: (...args: unknown[]) => emit('WARN', args),
  error: (...args: unknown[]) => emit('ERROR', args),
  debug: (...args: unknown[]) => {
    if (process.env.AGENT_PROXY_DEBUG === '1') emit('DEBUG', args);
  },
};
