// Provider adapter. Speaks the OpenAI-compatible wire format as the Interchange bootstrap.
//
// Paper: steps 3, 4 and 6.
//
// Deferral is fully blocking here: nothing streams to the user before evaluation completes.
// The provisional discloses pipelined evaluation against a stream as an alternative
// embodiment; the reference implementation takes the latency instead, because a reference
// implementation should show the primary claim rather than the optimization.

import type { AttestationPackage, Message, ProviderConfig, ProviderResponse } from '../types.js';
import {
  AIDP_VERSION,
  HEADER_ATTESTATIONS,
  HEADER_SEAL,
  HEADER_SEAL_DEPRECATED,
  HEADER_VERSION,
  decodeSeal,
  encodeAttestations,
  type ChatCompletionResponse,
} from './wire.js';

export interface SendOptions {
  messages: Message[];
  attestations?: AttestationPackage;
  signal?: AbortSignal;
  /** Injected in tests and by the demo so the pipe can be exercised without a network. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class ProviderError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
  }
}

export function resolveApiKey(provider: ProviderConfig, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (provider.apiKeyEnv) return env[provider.apiKeyEnv];
  return provider.apiKey;
}

export async function send(provider: ProviderConfig, opts: SendOptions): Promise<ProviderResponse> {
  const doFetch = opts.fetchImpl ?? fetch;
  const url = provider.baseUrl.replace(/\/$/, '') + '/chat/completions';
  const key = resolveApiKey(provider);

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    [HEADER_VERSION]: AIDP_VERSION,
    ...(provider.headers ?? {}),
  };
  if (key) headers['authorization'] = `Bearer ${key}`;
  // Step 2: the attestation package rides with the request. Attributes, never identity.
  if (opts.attestations) headers[HEADER_ATTESTATIONS] = encodeAttestations(opts.attestations);

  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  if (opts.signal) opts.signal.addEventListener('abort', () => controller.abort(), { once: true });

  let res: Response;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: provider.model, messages: opts.messages, stream: false }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new ProviderError(`transport failure contacting ${provider.id}: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ProviderError(`provider ${provider.id} returned ${res.status}: ${body.slice(0, 400)}`, res.status);
  }

  const json = (await res.json()) as ChatCompletionResponse;
  const content = json.choices?.[0]?.message?.content ?? '';

  // Registered name first. Where both are present the registered one wins, which is what
  // draft-flores-aidp-provenance Section 6.1 requires of a verifier.
  const headerSeal = res.headers.get(HEADER_SEAL) ?? res.headers.get(HEADER_SEAL_DEPRECATED);
  const seal = headerSeal ? decodeSeal(headerSeal) : json.aidp_seal;

  const response: ProviderResponse = {
    providerId: provider.id,
    content,
    servedFrom: url,
    receivedAt: new Date().toISOString(),
    latencyMs: Date.now() - started,
  };
  if (seal) response.seal = seal;
  if (json.model) response.reportedModel = json.model;
  return response;
}
