import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { handle } from '../src/worker.js';
import { MAX_BYTES } from '../src/core.js';
const env = { GATEWAY_TOKEN: 'fixture-gateway-token-'.repeat(3), UPSTREAM_API_KEY: 'fixture-upstream-key', UPSTREAM_BASE_URL: 'https://upstream.example/v1' };
const payload = { model: 'test', messages: [{ role: 'user', content: 'hello alice@example.com' }] };
function req(body = payload, init = {}) {
  return new Request('https://gateway.example/v1/chat/completions', { method: 'POST', headers: { authorization: 'Bearer ' + env.GATEWAY_TOKEN, 'content-type': 'application/json', cookie: 'secret-cookie', 'x-forwarded-for': '192.0.2.1', 'x-api-key': 'fixture' }, body: JSON.stringify(body), ...init });
}
const ok = () => Response.json({ choices: [{ message: { content: 'Hello' } }] });

test('only sanitized body and explicitly constructed headers cross upstream boundary', async () => {
  let calls = 0;
  const response = await handle(req(), env, async (url, init) => {
    calls++;
    assert.equal(url, 'https://upstream.example/v1/chat/completions');
    assert.deepEqual(Object.keys(init.headers).sort(), ['authorization', 'content-type']);
    assert.equal(init.headers.authorization, 'Bearer ' + env.UPSTREAM_API_KEY);
    assert.ok(!init.body.includes('alice@example.com'));
    assert.ok(!init.body.includes(env.GATEWAY_TOKEN));
    assert.equal(init.redirect, 'manual');
    return new Response(JSON.stringify({ choices: [] }), { headers: { 'content-type': 'application/json', 'set-cookie': 'upstream-secret', 'x-debug-secret': 'fixture' } });
  });
  assert.equal(calls, 1); assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-teai-privacy-replacements'), '1');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie'), null); assert.equal(response.headers.get('x-debug-secret'), null);
  await response.text();
});

test('secrets, invalid JSON/UTF8, unsupported media, oversized and extra fields never call upstream', async () => {
  let calls = 0;
  const cases = [
    req({ ...payload, messages: [{ role: 'user', content: 'sk-' + 'a'.repeat(32) }] }),
    req(payload, { body: '{bad' }), req(payload, { body: new Uint8Array([0xff]) }),
    req({ ...payload, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com' } }] }] }),
    req(payload, { body: 'x'.repeat(MAX_BYTES + 1) }),
    req({ ...payload, metadata: { original: 'alice@example.com' } }),
  ];
  for (const request of cases) { const response = await handle(request, env, async () => { calls++; return ok(); }); assert.ok(response.status >= 400); assert.ok(!(await response.text()).includes('alice@example.com')); }
  assert.equal(calls, 0);
});
test('body actual size is bounded even when content-length lies', async () => {
  const request = req(payload, { body: 'x'.repeat(MAX_BYTES + 1), headers: { authorization: 'Bearer ' + env.GATEWAY_TOKEN, 'content-type': 'application/json', 'content-length': '1' } });
  assert.equal((await handle(request, env, () => assert.fail('upstream called'))).status, 413);
});
test('authentication, content type, encoding, path and query are fail-closed', async () => {
  const noFetch = () => assert.fail('upstream called');
  for (const headers of [{}, { authorization: 'Bearer wrong' }]) assert.equal((await handle(req(payload, { headers }), env, noFetch)).status, 401);
  assert.equal((await handle(req(), { ...env, GATEWAY_TOKEN: 'short' }, noFetch)).status, 503);
  assert.equal((await handle(req(), { ...env, UPSTREAM_API_KEY: env.GATEWAY_TOKEN }, noFetch)).status, 503);
  for (const patch of [{ 'content-type': 'text/plain' }, { 'content-encoding': 'gzip' }]) {
    const headers = new Headers(req().headers); for (const [k, v] of Object.entries(patch)) headers.set(k, v);
    assert.equal((await handle(req(payload, { headers }), env, noFetch)).status, 415);
  }
  for (const path of ['/v1/responses', '/v1/chat/completions?token=secret', '/v1/chat/completions/']) assert.equal((await handle(new Request('https://gateway.example' + path), env, noFetch)).status, 404);
});
test('invalid privacy and upstream configuration cannot silently disable protection', async () => {
  for (const patch of [{ REDACT_TERMS: '{bad' }, { REDACT_TERMS: 'null' }, { UPSTREAM_BASE_URL: 'http://example.com/v1' }, { UPSTREAM_BASE_URL: 'https://alice:password@example.com/v1' }, { UPSTREAM_BASE_URL: 'https://example.com/v1?key=fixture' }]) assert.equal((await handle(req(), { ...env, ...patch }, () => assert.fail('upstream called'))).status, 503);
});
test('upstream errors/redirect bodies and headers never leak; no retry', async () => {
  for (const status of [302, 400, 401, 429, 500]) {
    let calls = 0;
    const response = await handle(req(), env, async () => { calls++; return new Response('PRIVATE UPSTREAM DEBUG', { status, headers: { location: 'https://other.example', 'content-type': 'application/json' } }); });
    assert.equal(response.status, 502); assert.equal(calls, 1); assert.ok(!(await response.text()).includes('PRIVATE'));
  }
  const response = await handle(req(), env, async () => { throw new Error('UPSTREAM SECRET'); });
  assert.equal(response.status, 502); assert.ok(!(await response.text()).includes('SECRET'));
});
test('JSON and SSE survive chunk boundaries without restoration', async () => {
  const sse = 'data: {"choices":[{"delta":{"content":"こんにちは"}}]}\n\ndata: [DONE]\n\n';
  const bytes = new TextEncoder().encode(sse);
  const response = await handle(req({ ...payload, stream: true }), env, async () => new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.slice(i, i + 3)); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } }));
  assert.equal(response.status, 200); assert.equal(await response.text(), sse);
});
test('downstream cancel aborts the upstream request', async () => {
  let signal, cancelled = false;
  const response = await handle(req({ ...payload, stream: true }), env, async (_, init) => {
    signal = init.signal;
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
  });
  await response.body.cancel(); assert.equal(signal.aborted, true); assert.equal(cancelled, true);
});
test('configured exact terms stay at the gateway and response is not restored', async () => {
  const response = await handle(req({ ...payload, messages: [{ role: 'user', content: 'Example Person' }] }), { ...env, REDACT_TERMS: '["Example Person"]' }, async (_, init) => {
    assert.ok(!init.body.includes('Example Person'));
    return Response.json({ choices: [{ message: { content: JSON.parse(init.body).messages[0].content } }] });
  });
  assert.ok(!(await response.text()).includes('Example Person'));
});
test('Workers fetch signature does not mistake ExecutionContext for a fetch function', async () => {
  const response = await worker.fetch(new Request('https://gateway.example/health'), env, {});
  assert.equal((await response.json()).version, '0.2.0');
});
