// Provider adapter. Speaks the OpenAI-compatible wire format as the Interchange bootstrap.
//
// Paper: steps 3, 4 and 6.
// Spec: draft-flores-airp-provenance-00 §3.8.
//
// Deferral is fully blocking here: nothing streams to the user before evaluation completes.
// The provisional discloses pipelined evaluation against a stream as an alternative
// embodiment; the reference implementation takes the latency instead, because a reference
// implementation should show the primary claim rather than the optimization.
//
// Non-streamed sealed content is the decompressed body (after content coding removal, before
// parsing). fetch already hands back decompressed bytes.

import type { AttestationPackage, Message, ProviderConfig, ProviderResponse } from '../types.js';
import {
  computeRequestDigest,
  generateExchangeId,
} from '../crypto/seal.js';
import {
  AIDP_VERSION,
  HEADER_ATTESTATIONS,
  HEADER_EXCHANGE_ID,
  HEADER_VERSION,
  encodeAttestations,
  selectSealHeader,
  type ChatCompletionResponse,
} from './wire.js';
import { DuplicateJsonMemberError, parseJsonNoDuplicates } from './json-strict.js';
import type { ProvenanceSeal } from '../types.js';

function tryDecodeSeal(value: string): {
  seal?: ProvenanceSeal;
  duplicateMember: boolean;
  failed: boolean;
} {
  try {
    const text = Buffer.from(value, 'base64url').toString('utf8');
    const parsed = parseJsonNoDuplicates(text) as ProvenanceSeal;
    if (!parsed || typeof parsed !== 'object') return { failed: true, duplicateMember: false };
    if (typeof parsed.signature !== 'string' || parsed.alg !== 'ed25519') {
      return { failed: true, duplicateMember: false };
    }
    return { seal: parsed, failed: false, duplicateMember: false };
  } catch (err) {
    if (err instanceof DuplicateJsonMemberError) {
      return { failed: true, duplicateMember: true };
    }
    return { failed: true, duplicateMember: false };
  }
}

export interface SendOptions {
  messages: Message[];
  attestations?: AttestationPackage;
  signal?: AbortSignal;
  /** Injected in tests and by the demo so the pipe can be exercised without a network. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /**
   * When set, reuse this exchange id instead of generating one. Retries must not pass the
   * prior value: a retry is a new exchange. Spec §3.8.1.
   */
  exchangeId?: string;
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

  const exchangeId = opts.exchangeId ?? generateExchangeId();
  const bodyText = JSON.stringify({ model: provider.model, messages: opts.messages, stream: false });
  const bodyBytes = new TextEncoder().encode(bodyText);
  const requestDigest = computeRequestDigest(bodyBytes);

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    [HEADER_VERSION]: AIDP_VERSION,
    [HEADER_EXCHANGE_ID]: exchangeId,
    'cache-control': 'no-store',
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
      body: bodyText,
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

  // Decompressed body octets. Spec §3.8.2: seal covers these, not extracted text.
  const sealedContent = new Uint8Array(await res.arrayBuffer());
  let json: ChatCompletionResponse;
  try {
    json = JSON.parse(new TextDecoder().decode(sealedContent)) as ChatCompletionResponse;
  } catch {
    throw new ProviderError(`provider ${provider.id} returned a non-JSON body`);
  }
  const content = json.choices?.[0]?.message?.content ?? '';

  const selected = selectSealHeader(res.headers);
  const decoded = selected.value ? tryDecodeSeal(selected.value) : undefined;

  const response: ProviderResponse = {
    providerId: provider.id,
    content,
    sealedContent,
    exchangeId,
    requestDigest,
    servedFrom: url,
    receivedAt: new Date().toISOString(),
    latencyMs: Date.now() - started,
  };
  if (selected.multipleAirpSeals) response.multipleSeals = true;
  if (decoded?.seal && selected.fieldName) {
    response.seal = decoded.seal;
    response.sealFieldName = selected.fieldName;
  } else if (decoded?.failed) {
    response.sealDecodeFailed = true;
    if (decoded.duplicateMember) response.sealDuplicateMember = true;
    if (selected.fieldName) response.sealFieldName = selected.fieldName;
  }
  if (json.model) response.reportedModel = json.model;
  return response;
}
