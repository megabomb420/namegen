/**
 * Direct DeepSeek Chat Completions client. This module owns the provider
 * request shape and response envelope parsing; it never leaks provider objects
 * upward. No SDK, no retries: a single fetch per submitted operation, aborted
 * at the configured upstream deadline.
 */
import { PROVIDER } from './config';
import { SYSTEM_PROMPT } from './runtime-prompt';

export interface DeepSeekUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type ProviderResult =
  | { kind: 'ok'; content: string; finishReason: string | null; usage: DeepSeekUsage | null; latencyMs: number }
  | { kind: 'http'; status: number; latencyMs: number }
  | { kind: 'timeout'; latencyMs: number }
  | { kind: 'network'; latencyMs: number }
  | { kind: 'bad-envelope'; latencyMs: number };

export interface ProviderDeps {
  fetchImpl: typeof fetch;
  apiKey: string;
  now?: () => number;
  timeoutMs?: number;
  url?: string;
}

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

interface ChatBody {
  model: string;
  messages: ChatMessage[];
  /** Per-request: 'disabled' for naming (spec §6), 'enabled' for the alias op. */
  thinking: { type: 'enabled' | 'disabled' };
  response_format: { type: 'json_object' };
  max_tokens: number;
  stream: false;
}

export interface ProviderOverrides {
  /** System prompt override (e.g. the alias persona). Defaults to [RUNTIME]. */
  systemPrompt?: string;
  /** Thinking mode. Naming requests default to disabled (spec §6). */
  thinking?: 'enabled' | 'disabled';
  /** Token ceiling override (alias runs with thinking and needs headroom). */
  maxTokens?: number;
  reasoningEffort?: 'low' | 'high' | 'max';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseEnvelope(
  body: unknown,
): { content: string; finishReason: string | null; usage: DeepSeekUsage | null } | null {
  if (!isRecord(body)) return null;
  const { choices, usage: usageField } = body;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!isRecord(first)) return null;
  const { message, finish_reason } = first;
  if (!isRecord(message)) return null;
  const content = message['content'];
  if (typeof content !== 'string') return null;

  let usage: DeepSeekUsage | null = null;
  if (isRecord(usageField)) {
    const { prompt_tokens, completion_tokens, total_tokens } = usageField as Record<string, unknown>;
    if (
      typeof prompt_tokens === 'number' &&
      typeof completion_tokens === 'number' &&
      typeof total_tokens === 'number'
    ) {
      usage = { promptTokens: prompt_tokens, completionTokens: completion_tokens, totalTokens: total_tokens };
    }
  }
  return {
    content,
    finishReason: typeof finish_reason === 'string' ? finish_reason : null,
    usage,
  };
}

/**
 * One upstream request per submitted operation. The caller (naming service)
 * owns counts and the request payload; this module only talks to the provider.
 * The upstream deadline aborts the in-flight fetch.
 */
export async function callChatCompletions(
  payload: unknown,
  deps: ProviderDeps,
  overrides: ProviderOverrides = {},
): Promise<ProviderResult> {
  const {
    fetchImpl,
    apiKey,
    now = Date.now,
    timeoutMs = PROVIDER.timeoutMs,
    url = PROVIDER.url,
  } = deps;
  const startedAt = now();
  const thinkingType = overrides.thinking ?? 'disabled';

  const body: ChatBody = {
    model: PROVIDER.model,
    messages: [
      { role: 'system', content: overrides.systemPrompt ?? SYSTEM_PROMPT },
      // Changing inputs travel as structured JSON in the user message; the
      // system prompt is stable across requests.
      { role: 'user', content: JSON.stringify(payload) },
    ],
    thinking: { type: thinkingType },
    ...(overrides.reasoningEffort !== undefined && thinkingType === 'enabled'
      ? { reasoning_effort: overrides.reasoningEffort }
      : {}),
    response_format: { type: 'json_object' },
    max_tokens: overrides.maxTokens ?? PROVIDER.maxOutputTokens,
    stream: false,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const latencyMs = now() - startedAt;
    if (!response.ok) return { kind: 'http', status: response.status, latencyMs };

    let envelope: unknown;
    try {
      envelope = await response.json();
    } catch {
      return { kind: 'bad-envelope', latencyMs };
    }
    const parsed = parseEnvelope(envelope);
    if (parsed === null) return { kind: 'bad-envelope', latencyMs };
    return { kind: 'ok', content: parsed.content, finishReason: parsed.finishReason, usage: parsed.usage, latencyMs };
  } catch (error) {
    const latencyMs = now() - startedAt;
    if (controller.signal.aborted) return { kind: 'timeout', latencyMs };
    if (error instanceof Error && error.name === 'AbortError') return { kind: 'timeout', latencyMs };
    return { kind: 'network', latencyMs };
  } finally {
    clearTimeout(timer);
  }
}
