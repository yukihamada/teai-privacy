import { MAX_BYTES, PrivacyError, protectChat, VERSION } from './core.js';

const safeHeaders = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-teai-privacy-version': VERSION };
function error(code, status) { return Response.json({ error: { code } }, { status, headers: safeHeaders }); }

async function equalToken(left, right) {
  const digest = async s => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

async function readBody(request) {
  if (!request.body) throw new PrivacyError('invalid_json');
  const reader = request.body.getReader();
  const chunks = []; let size = 0;
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { void reader.cancel(); reject(new PrivacyError('body_timeout', 408)); }, 10000); });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new PrivacyError('body_too_large', 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new PrivacyError('invalid_json'); }
  } finally { clearTimeout(timer); reader.releaseLock(); }
}

/** fetcher injection is for tests; production always uses the runtime's fetch. */
export async function handle(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  if (url.pathname === '/health' && request.method === 'GET' && !url.search) return Response.json({ ok: true, version: VERSION, scope: 'text-chat-only' }, { headers: safeHeaders });
  if (url.pathname !== '/v1/chat/completions' || url.search) return error('unsupported_endpoint', 404);
  if (request.method !== 'POST') return error('method_not_allowed', 405);
  if (typeof env.GATEWAY_TOKEN !== 'string' || env.GATEWAY_TOKEN.length < 32 || env.GATEWAY_TOKEN.length > 1024 || typeof env.UPSTREAM_API_KEY !== 'string' || !env.UPSTREAM_API_KEY || env.GATEWAY_TOKEN === env.UPSTREAM_API_KEY) return error('gateway_not_configured', 503);
  const auth = request.headers.get('authorization') ?? '';
  if (auth.length > 2048 || !await equalToken(auth, 'Bearer ' + env.GATEWAY_TOKEN)) return error('unauthorized', 401);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '') || request.headers.has('content-encoding')) return error('json_required', 415);
  try {
    const upstream = new URL(env.UPSTREAM_BASE_URL ?? 'https://api.teai.io/v1');
    if (upstream.protocol !== 'https:' || upstream.username || upstream.password || upstream.search || upstream.hash || upstream.pathname.replace(/\/$/, '') !== '/v1') throw new PrivacyError('invalid_upstream_config', 503);
    let terms;
    try { terms = JSON.parse(env.REDACT_TERMS ?? '[]'); } catch { throw new PrivacyError('invalid_privacy_config', 503); }
    const { body, counts } = protectChat(await readBody(request), terms);
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) controller.abort();
    const timer = setTimeout(abort, 120000);
    const cleanup = () => { clearTimeout(timer); request.signal.removeEventListener('abort', abort); };
    let response;
    try {
      response = await fetcher(upstream.origin + '/v1/chat/completions', {
        method: 'POST', redirect: 'manual', signal: controller.signal,
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.UPSTREAM_API_KEY },
        body: JSON.stringify(body),
      });
    } catch { cleanup(); return error('upstream_unavailable', 502); }
    const type = response.headers.get('content-type')?.split(';')[0].trim();
    if (!response.ok || !response.body || (body.stream ? type !== 'text/event-stream' : type !== 'application/json')) {
      await response.body?.cancel(); cleanup();
      return error('upstream_rejected', 502);
    }
    const reader = response.body.getReader();
    // Cancellation may itself reject on a disconnected upstream. Both outcomes release resources.
    const cancelReader = () => { void reader.cancel().then(cleanup, cleanup); };
    controller.signal.addEventListener('abort', cancelReader, { once: true });
    const finish = () => { controller.signal.removeEventListener('abort', cancelReader); cleanup(); };
    if (controller.signal.aborted) { cancelReader(); finish(); return error('upstream_unavailable', 502); }
    const stream = new ReadableStream({
      async pull(c) {
        try { const { done, value } = await reader.read(); if (done) { finish(); c.close(); } else c.enqueue(value); }
        catch { finish(); c.error(new Error('upstream_stream_failed')); }
      },
      async cancel() { finish(); controller.abort(); await reader.cancel(); },
    });
    return new Response(stream, { headers: {
      ...safeHeaders, 'content-type': type,
      'x-teai-privacy-replacements': String(Object.values(counts).reduce((a, b) => a + b, 0)),
    } });
  } catch (cause) {
    return cause instanceof PrivacyError ? error(cause.code, cause.status) : error('inspection_failed', 503);
  }
}

export default { fetch: (request, env) => handle(request, env) };
