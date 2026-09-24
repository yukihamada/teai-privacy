import { MAX_BYTES, PrivacyError, protectChat } from './core.js';

/** No telemetry or implicit network calls. Only complete() sends the inspected snapshot. */
export function createPrivacyClient({ baseURL, apiKey, terms = [], timeoutMs = 120000, allowLoopbackHTTP = false, fetch: fetcher = globalThis.fetch } = {}) {
  let endpoint;
  try { endpoint = new URL(baseURL); } catch { throw new PrivacyError('invalid_client_config'); }
  const local = ['127.0.0.1', '[::1]', 'localhost'].includes(endpoint.hostname);
  if ((endpoint.protocol !== 'https:' && !(allowLoopbackHTTP && local && endpoint.protocol === 'http:')) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname.replace(/\/$/, '') !== '/v1') throw new PrivacyError('invalid_client_config');
  if (typeof apiKey !== 'string' || !apiKey || apiKey.length > 2048 || /[^\x21-\x7e]/.test(apiKey) || typeof fetcher !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new PrivacyError('invalid_client_config');
  if (!Array.isArray(terms)) throw new PrivacyError('invalid_privacy_config');
  // Snapshot caller configuration; later mutations cannot remove protection.
  const configuredTerms = [...terms];
  protectChat({ model: 'privacy-config-check', messages: [{ role: 'user', content: '' }] }, configuredTerms);
  const url = endpoint.origin + '/v1/chat/completions';

  function inspect(input) {
    // Snapshot first; mutations during an awaited fetch cannot change the payload.
    // structuredClone rejects functions and drops custom serialization prototypes.
    let snapshot;
    try { snapshot = structuredClone(input); } catch { throw new PrivacyError('invalid_client_input'); }
    let result;
    try { result = protectChat(snapshot, configuredTerms); }
    catch (e) { if (e instanceof PrivacyError) throw e; throw new PrivacyError('invalid_client_input'); }
    const serialized = JSON.stringify(result.body);
    // Placeholder expansion can exceed the gateway's input cap. Never send an unusable body.
    if (new TextEncoder().encode(serialized).length > MAX_BYTES) throw new PrivacyError('sanitized_body_too_large', 413);
    return result;
  }

  async function complete(input, { signal } = {}) {
    const { body, counts } = inspect(input);
    const serialized = JSON.stringify(body);
    if (signal?.aborted) throw new PrivacyError('client_aborted', 499);
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const failure = () => new PrivacyError(timedOut ? 'client_timeout' : controller.signal.aborted ? 'client_aborted' : 'client_network_error', 502);
    let upstream;
    try {
      upstream = await fetcher(url, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
        body: serialized, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error', signal: controller.signal,
      });
    } catch { cleanup(); throw failure(); }
    const type = upstream.headers.get('content-type')?.split(';')[0].trim();
    if (!upstream.ok || !upstream.body || type !== (body.stream ? 'text/event-stream' : 'application/json')) {
      cleanup();
      // A broken error body must not expose its exception or change the failure policy.
      if (upstream.body) await upstream.body.cancel().then(() => undefined, () => undefined);
      throw new PrivacyError('client_upstream_rejected', 502);
    }
    const reader = upstream.body.getReader();
    const cancel = () => { void reader.cancel().then(cleanup, cleanup); };
    controller.signal.addEventListener('abort', cancel, { once: true });
    const finish = () => { controller.signal.removeEventListener('abort', cancel); cleanup(); };
    if (controller.signal.aborted) { cancel(); finish(); throw failure(); }
    const response = new Response(new ReadableStream({
      async pull(c) {
        try {
          const { done, value } = await reader.read();
          if (controller.signal.aborted) { finish(); c.error(failure()); }
          else if (done) { finish(); c.close(); }
          else c.enqueue(value);
        } catch { finish(); c.error(failure()); }
      },
      async cancel() { finish(); controller.abort(); await reader.cancel(); },
    }), { headers: { 'content-type': type, 'cache-control': 'no-store' } });
    return { response, counts };
  }

  return Object.freeze({ inspect, complete });
}
