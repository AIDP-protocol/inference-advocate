// Provider adapter. Speaks the OpenAI-compatible wire format as the Interchange bootstrap.
//
// Paper: steps 3, 4 and 6.
// Spec: draft-flores-airp-provenance-00 §3.8.
//
// Deferral is still fully blocking. The transport streams; the gate does not. Accumulated
// octets stay inside this module until the deterministic pass, the semantic pass and delivery
// policy have finished, and the only thing that leaves during a stream is the arrival scalar
// in arrival.ts, which has no content in it. The provisional discloses pipelined evaluation
// against a stream as an alternative embodiment; the reference implementation takes the
// latency instead, because a reference implementation should show the primary claim rather
// than the optimization.
//
// Two transport modes, both first class, both permanently supported, both tested. The
// non-streamed path is not a fallback for providers that ignore the flag and it is not legacy
// code on its way out. It is the stronger of the two wherever the party subject to the
// delivery policy is not the party who set it, because plaintext does not exist on the device
// until the whole response has arrived. Streamed transport buys the arrival indicator and
// costs a window in which accumulated content sits in this process while the gate holds it.
// Neither answer is right everywhere, so do not delete the branch you are not using.
//
// The response content-type decides which path runs, never the flag that was sent. A provider
// that ignores stream:true still has to work.
//
// Non-streamed sealed content is the decompressed body (after content coding removal, before
// parsing). fetch already hands back decompressed bytes. Streamed sealed content is the
// binding-extracted octets in served order, and a stream is requested with
// accept-encoding: identity, because a compressed event stream would have to be decoded before
// the binding could see it and nothing here decompresses anything by hand.

import type {
  AttestationPackage,
  Message,
  ProviderConfig,
  ProviderResponse,
  TransportMode,
} from '../types.js';
import {
  computeRequestDigest,
  generateExchangeId,
} from '../crypto/seal.js';
import {
  AIRP_VERSION,
  HEADER_ATTESTATIONS,
  HEADER_EXCHANGE_ID,
  HEADER_VERSION,
  encodeAttestations,
  selectSealHeader,
  type ChatCompletionResponse,
} from './wire.js';
import { DuplicateJsonMemberError, parseJsonNoDuplicates } from './json-strict.js';
import {
  SseStreamParser,
  accumulateStream,
  type ContentBinding,
  type StreamSealEvent,
} from '../monitor/content-bindings.js';
import { ARRIVAL_SAMPLE_MS, ArrivalActivity } from './arrival.js';
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
  /**
   * Transport mode, defaulting to streamed. Configuration rather than a constant, because the
   * right answer depends on who set the delivery policy. See the note at the top of this file.
   */
  transport?: TransportMode;
  /**
   * The binding the selected register entry names, resolved by the caller. Required to request
   * a stream and refused when absent: without it the octets a seal covers cannot be
   * reconstructed, and substituting some other extraction would be exactly the default
   * fallback §3.8.3 does not allow.
   */
  contentBinding?: ContentBinding;
  /**
   * Arrival signal for the delivery indicator, streamed path only. Receives a decaying
   * activity scalar in [0, 1] and nothing else. There is no content, no count and no offset in
   * this callback, which is a property of the type rather than a promise about the caller.
   */
  onArrival?: (activity: number) => void;
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

  const requested: TransportMode = opts.transport ?? 'streamed';
  if (requested === 'streamed' && !opts.contentBinding) {
    throw new ProviderError(
      'streamed transport requires the content binding the register entry names; refusing to guess one',
    );
  }

  const exchangeId = opts.exchangeId ?? generateExchangeId();
  // The digest covers the body as sent, which includes whichever transport was asked for.
  const bodyText = JSON.stringify({
    model: provider.model,
    messages: opts.messages,
    stream: requested === 'streamed',
  });
  const bodyBytes = new TextEncoder().encode(bodyText);
  const requestDigest = computeRequestDigest(bodyBytes);

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    [HEADER_VERSION]: AIRP_VERSION,
    [HEADER_EXCHANGE_ID]: exchangeId,
    'cache-control': 'no-store',
    ...(requested === 'streamed'
      ? { accept: 'text/event-stream', 'accept-encoding': 'identity' }
      : {}),
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

  // The content-type decides the path, not the flag that was sent. Spec §3.8.3 / §3.8.2.
  const streamed = (res.headers.get('content-type') ?? '').includes('text/event-stream');

  const base = {
    providerId: provider.id,
    exchangeId,
    requestDigest,
    servedFrom: url,
  };

  if (streamed) {
    const binding = opts.contentBinding;
    if (!binding) {
      throw new ProviderError(
        `provider ${provider.id} served an event stream and no content binding was supplied`,
      );
    }
    const events = await readSseEvents(res, provider.id, opts.onArrival);
    const accumulated = accumulateStream(binding, events);
    // Sealed content is the accumulated binding output, and the delivered text is those same
    // octets decoded. Bytes the seal does not cover are never the bytes the user is shown.
    const content = new TextDecoder().decode(accumulated.sealedContent);
    const decoded = accumulated.terminalSealValue
      ? tryDecodeSeal(accumulated.terminalSealValue)
      : undefined;

    const response: ProviderResponse = {
      ...base,
      content,
      sealedContent: accumulated.sealedContent,
      receivedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      transport: 'streamed',
    };
    if (accumulated.multipleTerminalSeals) response.multipleSeals = true;
    if (accumulated.contentAfterTerminalSeal) response.contentAfterTerminalSeal = true;
    if (decoded?.seal) {
      response.seal = decoded.seal;
      response.sealFieldName = 'airp-seal';
    } else if (decoded?.failed) {
      response.sealDecodeFailed = true;
      if (decoded.duplicateMember) response.sealDuplicateMember = true;
      response.sealFieldName = 'airp-seal';
    }
    const reported = reportedModelFromStream(events);
    if (reported) response.reportedModel = reported;
    return response;
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
    ...base,
    content,
    sealedContent,
    receivedAt: new Date().toISOString(),
    latencyMs: Date.now() - started,
    transport: 'non_streamed',
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

/**
 * Read an event stream as it arrives and return the parsed events.
 *
 * Nothing leaves the accumulator here. The only thing this reports outward while the body is
 * in flight is the arrival scalar, and it is reported on a timer rather than once per chunk so
 * that a consumer cannot recover chunk boundaries from the callback either.
 */
async function readSseEvents(
  res: Response,
  providerId: string,
  onArrival?: (activity: number) => void,
): Promise<StreamSealEvent[]> {
  if (!res.body) throw new ProviderError(`provider ${providerId} served an event stream with no body`);

  const parser = new SseStreamParser();
  const decoder = new TextDecoder();
  const events: StreamSealEvent[] = [];
  const activity = new ArrivalActivity();
  const reader = res.body.getReader();
  const sampler = onArrival
    ? setInterval(() => onArrival(activity.value()), ARRIVAL_SAMPLE_MS)
    : undefined;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        activity.observe();
        // Streaming decode: a multi-byte character split across chunks must not be mangled,
        // and nothing here decodes a content coding by hand.
        events.push(...parser.push(decoder.decode(value, { stream: true })));
      }
    }
    events.push(...parser.push(decoder.decode()));
    events.push(...parser.flush());
  } finally {
    if (sampler !== undefined) clearInterval(sampler);
  }
  // Flow has stopped. Say so once, so an indicator settles rather than fading on its own clock.
  if (onArrival) onArrival(0);
  return events;
}

/** The model the stream reported, for the unsigned-field comparison at step 7. */
function reportedModelFromStream(events: StreamSealEvent[]): string | undefined {
  for (const event of events) {
    if (event.kind !== 'data') continue;
    const data = event.data;
    if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
      const model = (data as Record<string, unknown>)['model'];
      if (typeof model === 'string' && model.length > 0) return model;
    }
  }
  return undefined;
}
