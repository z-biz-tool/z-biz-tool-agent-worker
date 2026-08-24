// SSE chunk builders — OpenAI-compatible wire format. Mirrors the static
// helpers on Java ChatCompletionResponse.

import * as crypto from 'crypto';

export function sseChunk(
  completionId: string,
  model: string,
  created: number,
  deltaContent: string
): string {
  const body = {
    id: completionId,
    object: 'chat.completion.chunk',
    created,
    model: model || 'future-team-local',
    choices: [
      {
        index: 0,
        delta: { content: deltaContent },
      },
    ],
  };
  return `data: ${JSON.stringify(body)}\n\n`;
}

export function sseDone(): string {
  return 'data: [DONE]\n\n';
}

export function sseError(message: string): string {
  return `data: ${JSON.stringify({ error: message })}\n\n`;
}

export function newCompletionId(): string {
  return `chatcmpl-cli-${crypto.randomBytes(12).toString('hex')}`;
}

export function buildChatCompletionSyncResponse(
  model: string,
  content: string
): string {
  return JSON.stringify({
    id: `chatcmpl-local-${crypto.randomBytes(12).toString('hex')}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model || 'future-team-local',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: content || '' },
      },
    ],
  });
}
