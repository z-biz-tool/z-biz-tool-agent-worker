// GET /health — minimal liveness probe.

import type { IncomingMessage, ServerResponse } from 'http';
import { sendJson, setCors } from './common';

export function handleHealth(req: IncomingMessage, res: ServerResponse): void {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  sendJson(res, 200, { status: 'ok' });
}
