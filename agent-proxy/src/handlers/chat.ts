// POST /v1/chat/completions — OpenAI-compatible chat. Routes to one of the
// registered wrappers based on session / header / model inference, then
// streams SSE or returns JSON.

import * as crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { logger } from '../logger';
import { buildChatCompletionSyncResponse, sseChunk, sseDone, sseError } from '../sse';
import {
  handleCors,
  headerString,
  readBody,
  sendError,
  setCors,
} from './common';
import type { AgentRegistry } from '../agentRegistry';
import type { CliAgentConfig } from '../types';
import type { ChatCompletionRequest } from '../types';
import type { CliChatExecutor } from '../executor';
import type { SessionRegistry } from '../sessionRegistry';
import { HttpSseWriter } from '../wrappers/types';

const DEFAULT_TYPE = 'claude-code';

export function makeChatHandler(
  registry: AgentRegistry,
  executor: CliChatExecutor,
  sessionRegistry: SessionRegistry
) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (handleCors(req, res)) return;
    if (req.method !== 'POST') {
      sendError(res, 405, `Method not allowed: ${req.method}`);
      return;
    }

    let body: ChatCompletionRequest;
    try {
      const raw = await readBody(req);
      body = raw ? JSON.parse(raw) : {};
    } catch (e: any) {
      sendError(res, 400, 'invalid JSON body: ' + (e?.message || String(e)));
      return;
    }

    if (!body.messages || body.messages.length === 0) {
      sendError(res, 400, 'messages is required');
      return;
    }

    // Session id: header first, otherwise generate
    let sessionId = headerString(req, 'x-session-id') || headerString(req, 'X-Session-Id');
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      logger.info(`Generated new session: ${sessionId}`);
    }
    body.sessionId = sessionId;

    const cfg = resolveConfig(req, body, registry, sessionRegistry);
    logger.info(
      `Routing to CLI: type=${cfg.type} command=${cfg.command} stream=${!!body.stream} session=${sessionId}`
    );

    if (body.stream) {
      // SSE response. We need to flush headers first.
      setCors(res);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Session-Id', sessionId);
      res.writeHead(200);
      const writer = new HttpSseWriter(res);
      try {
        await executor.executeStream(cfg, body, writer);
      } catch (e: any) {
        logger.warn('Stream execution error:', e);
        res.write(sseError('Execution error: ' + (e?.message || String(e))));
      } finally {
        res.end();
      }
    } else {
      try {
        const reply = await executor.executeSync(cfg, body);
        setCors(res);
        res.setHeader('X-Session-Id', sessionId);
        const json = buildChatCompletionSyncResponse(cfg.type, reply);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(json);
      } catch (e: any) {
        logger.warn('Sync execution error:', e);
        sendError(res, 500, 'Execution error: ' + (e?.message || String(e)));
      }
    }
  };
}

// ──────────── routing helpers ────────────

/** Three-level priority: session-bound agentId -> session-bound cliType ->
 *  X-Agent-Id header -> X-CLI-Type / model inference -> default config. */
function resolveConfig(
  req: IncomingMessage,
  body: ChatCompletionRequest,
  registry: AgentRegistry,
  sessionRegistry: SessionRegistry
): CliAgentConfig {
  const sessionId = body.sessionId || null;

  // 1. session-bound agentId
  if (sessionId) {
    const boundAgentId = sessionRegistry.getAgentId(sessionId);
    if (boundAgentId) {
      const cfg = registry.get(boundAgentId);
      if (cfg) {
        logger.info(`Resolved by session-bound agentId: ${boundAgentId}`);
        return cfg;
      }
      logger.warn(`Session-bound agentId not found in registry: ${boundAgentId}`);
    }
  }

  // 2. session-bound cliType
  if (sessionId) {
    const boundType = sessionRegistry.getCliType(sessionId);
    if (boundType) {
      const cfg = registry.findByType(boundType);
      if (cfg) {
        logger.info(`Resolved by session-bound cliType: ${boundType}`);
        return cfg;
      }
      logger.info(`Session-bound cliType=${boundType} not in registry, using default config`);
      return buildDefaultConfig(boundType);
    }
  }

  // 3. X-Agent-Id header
  const agentId = headerString(req, 'x-agent-id');
  if (agentId) {
    const cfg = registry.get(agentId);
    if (cfg) {
      logger.info(`Resolved by X-Agent-Id: ${agentId}`);
      return cfg;
    }
    logger.warn(`X-Agent-Id not found in registry: ${agentId}, falling through`);
  }

  // 4. X-CLI-Type or model-field inference
  const type = inferType(req, body);
  const byType = registry.findByType(type);
  if (byType) {
    logger.info(`Resolved by type from registry: ${type}`);
    return byType;
  }
  logger.info(`No registered agent for type=${type}, using default config`);
  return buildDefaultConfig(type);
}

function inferType(req: IncomingMessage, body: ChatCompletionRequest): string {
  const cliType = headerString(req, 'x-cli-type');
  if (cliType) {
    logger.info(`Inferred type from X-CLI-Type: ${cliType}`);
    return cliType;
  }
  const model = (body.model || '').toLowerCase();
  if (model) {
    if (model.includes('hermes')) return 'hermes';
    if (model.includes('opencode')) return 'opencode';
    if (model.includes('claude')) return 'claude-code';
  }
  return DEFAULT_TYPE;
}

function buildDefaultConfig(type: string): CliAgentConfig {
  let command = type;
  let args: string[] = [];
  if (type === 'claude-code') {
    command = 'claude';
    args = [
      '-p', '{prompt}',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
    ];
  } else if (type === 'hermes') {
    command = 'hermes';
    args = ['chat', '-q', '{prompt}', '-Q'];
  } else if (type === 'opencode') {
    command = 'opencode';
    args = ['run', '{prompt}'];
  }
  return {
    id: `default-${type}`,
    name: `default-${type}`,
    type,
    command,
    args,
    workingDir: null,
  };
}
