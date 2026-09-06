/**
 * Browser API client for the single application endpoint. Keeps the wire
 * contract independent of provider objects: the server's JSON envelopes are
 * decoded here into typed outcomes, and transport failures become a distinct
 * client-side error (the browser can report offline while the network is
 * actually down).
 */
import type { NamingRequest } from '../../shared/contracts';

export type WireOutcome =
  | { ok: true; names: string[]; partial: boolean }
  | { ok: false; code: string; message: string; retryable: boolean };

/**
 * Base for API calls. Empty string = same origin (the Cloudflare Worker that
 * also serves this build). A Pages/static-host build sets VITE_API_BASE to the
 * Worker URL at build time; nothing else differs.
 */
const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');
const API_ENDPOINT = `${API_BASE}/api/generate`;

function serverFailure(status: number, raw: unknown): WireOutcome {
  const fallbackMessage =
    status === 429
      ? 'Too many requests from this network. Wait about a minute, then try again.'
      : 'The naming service had a problem. Try again.';
  if (typeof raw === 'object' && raw !== null) {
    const { error } = raw as Record<string, unknown>;
    if (typeof error === 'object' && error !== null) {
      const { code, message, retryable } = error as Record<string, unknown>;
      return {
        ok: false,
        code: typeof code === 'string' ? code : 'SERVICE_UNAVAILABLE',
        message: typeof message === 'string' && message !== '' ? message : fallbackMessage,
        retryable: typeof retryable === 'boolean' ? retryable : false,
      };
    }
  }
  return { ok: false, code: 'SERVICE_UNAVAILABLE', message: fallbackMessage, retryable: false };
}

export async function submitNaming(
  request: NamingRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<WireOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(API_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      cache: 'no-store',
    });
  } catch {
    // The browser can claim to be online while the fetch still fails; treat
    // any transport failure as a connectivity problem with retry guidance.
    return {
      ok: false,
      code: 'NETWORK',
      message: "Couldn't reach the naming service. Check your connection, then try again.",
      retryable: true,
    };
  }

  let raw: unknown = null;
  try {
    raw = await response.json();
  } catch {
    // Ignore: serverFailure falls back to a generic message.
  }

  if (!response.ok) return serverFailure(response.status, raw);

  if (typeof raw === 'object' && raw !== null) {
    const { names, partial } = raw as Record<string, unknown>;
    if (Array.isArray(names) && typeof partial === 'boolean' && names.every((n) => typeof n === 'string')) {
      return { ok: true, names: names as string[], partial };
    }
  }
  return { ok: false, code: 'UNUSABLE_OUTPUT', message: 'The naming service returned an unreadable response.', retryable: true };
}
