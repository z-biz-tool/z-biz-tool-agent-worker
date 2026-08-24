// Small HTTP helpers shared by handlers. Built on Node's http module so we
// don't pull Express for what amounts to four routes.

import type { IncomingMessage, ServerResponse } from 'http';

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(text);
}

export function sendError(res: ServerResponse, status: number, message: string): void;
export function sendError(res: ServerResponse, status: number, body: unknown): void;
export function sendError(res: ServerResponse, status: number, body: unknown): void {
  if (typeof body === 'string') {
    sendJson(res, status, { error: body });
  } else {
    sendJson(res, status, body);
  }
}

export function setCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, OPTIONS'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Session-Id, X-Agent-Id, X-CLI-Type'
  );
}

/** If the request is an OPTIONS preflight, send 204 and return true. */
export function handleCors(req: IncomingMessage, res: ServerResponse): boolean {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

export function headerString(req: IncomingMessage, name: string): string | null {
  const v = req.headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}
