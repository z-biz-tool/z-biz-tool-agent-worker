// Hermes wrapper: POST to the local hermes gateway (127.0.0.1:8642), which
// itself fronts an OpenAI-compatible /v1/chat/completions endpoint. The gateway
// supports true SSE streaming, so we read its stream line-by-line and forward
// deltas to the client. Per-session message history is kept in memory; if the
// caller didn't bind a session, we just send the request as-is.

import * as http from 'http';
import { logger } from '../logger';
import { config as appConfig } from '../config';
import { escapeJson, readFileOrNull } from '../utils';
import { extractDelta } from '../streamParser';
import { newCompletionId, sseChunk, sseDone, sseError } from '../sse';
import type { ChatCompletionRequest, ChatMessage, CliAgentConfig } from '../types';
import type { CliAgentWrapper, SseWriter } from './types';

const sessionHistories = new Map<string, ChatMessage[]>();

export class HermesProcessWrapper implements CliAgentWrapper {
  supports(type: string): boolean {
    return type === 'hermes';
  }

  async streamChat(
    cfg: CliAgentConfig,
    req: ChatCompletionRequest,
    sse: SseWriter
  ): Promise<string> {
    const completionId = newCompletionId();
    const created = Math.floor(Date.now() / 1000);
    const model = cfg.type;
    const full = await this.consumeGateway(
      req,
      true,
      (delta) => {
        sse.write(sseChunk(completionId, model, created, delta));
      },
      (errMsg) => sse.write(sseError(errMsg))
    );
    sse.write(sseDone());
    return full;
  }

  async syncChat(
    cfg: CliAgentConfig,
    req: ChatCompletionRequest
  ): Promise<string> {
    return this.consumeGateway(req, false, () => undefined, (msg) => {
      throw new Error(msg);
    });
  }

  // ──────────── internals ────────────

  /** Append this request's messages to the session's history and send the full
   *  history to the gateway. Streamed or aggregated depending on `stream`. */
  private async consumeGateway(
    req: ChatCompletionRequest,
    stream: boolean,
    onDelta: (d: string) => void,
    onError: (msg: string) => void
  ): Promise<string> {
    const messages = this.resolveSessionMessages(req);
    const apiKey = readApiKey();
    if (!apiKey) {
      onError('Hermes gateway API key not found at ' + appConfig.hermesApiKeyFile);
      return '';
    }

    let full = '';
    let lastError: string | null = null;
    try {
      await new Promise<void>((resolve, reject) => {
        const url = new URL(appConfig.hermesGatewayUrl);
        const body = buildGatewayBody(messages, stream);
        const req2 = http.request(
          {
            hostname: url.hostname,
            port: url.port || 80,
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
              Authorization: 'Bearer ' + apiKey,
            },
          },
          (res) => {
            const code = res.statusCode || 0;
            if (code !== 200) {
              const err = readAllText(res).then((txt) => {
                reject(new Error(`Hermes gateway returned HTTP ${code}: ${txt}`));
              });
              return err;
            }
            res.setEncoding('utf-8');
            let buffer = '';
            res.on('data', (chunk: string) => {
              buffer += chunk;
              let idx;
              while ((idx = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, idx).trim();
                buffer = buffer.slice(idx + 1);
                if (!line.startsWith('data:')) continue;
                const payload = line.slice(5).trim();
                if (payload === '[DONE]') {
                  res.destroy();
                  resolve();
                  return;
                }
                const delta = extractDelta(payload);
                if (delta) {
                  full += delta;
                  onDelta(delta);
                }
              }
            });
            res.on('end', () => resolve());
            res.on('error', (e) => reject(e));
          }
        );
        req2.on('error', (e) => reject(e));
        req2.write(body);
        req2.end();
      });
    } catch (e: any) {
      lastError = e?.message || String(e);
      logger.warn('Hermes gateway error:', lastError);
      if (full.length === 0) onError('Gateway error: ' + lastError);
    }
    if (lastError && full.length > 0) logger.warn('Hermes partial reply despite error:', lastError);
    return full;
  }

  private resolveSessionMessages(req: ChatCompletionRequest): ChatMessage[] {
    const sessionId = req.sessionId;
    if (!sessionId) return req.messages || [];
    const hist = sessionHistories.get(sessionId) || [];
    if (req.messages && req.messages.length > 0) hist.push(...req.messages);
    sessionHistories.set(sessionId, hist);
    logger.info(`Session ${sessionId} message history: ${hist.length} messages`);
    return hist;
  }
}

function readApiKey(): string | null {
  const raw = readFileOrNull(appConfig.hermesApiKeyFile);
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildGatewayBody(messages: ChatMessage[], stream: boolean): string {
  const msgsJson = (messages || [])
    .map((m) => ({
      role: m.role || 'user',
      content: m.content || '',
    }));
  // Avoid hand-rolled JSON; use JSON.stringify + a custom replacer would be
  // tidier but the wrapper used to do it manually; staying literal for parity.
  const parts: string[] = [];
  for (const m of msgsJson) {
    parts.push(`{"role":"${escapeJson(m.role)}","content":"${escapeJson(m.content)}"}`);
  }
  return `{"messages":[${parts.join(',')}],"stream":${stream}}`;
}

function readAllText(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve) => {
    let buf = '';
    stream.setEncoding('utf-8');
    stream.on('data', (c) => (buf += c));
    stream.on('end', () => resolve(buf));
    stream.on('error', () => resolve(buf));
  });
}
