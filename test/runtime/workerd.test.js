import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unstable_startWorker } from 'wrangler';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('real Cloudflare workerd: health, unauthorized and fail-closed inspection', async () => {
  const server = await unstable_startWorker({ config: 'wrangler.jsonc', dev: { server: { port: 0 }, inspector: false }, bindings: {
    GATEWAY_TOKEN: { type: 'plain_text', value: 'fixture-runtime-token-'.repeat(3) },
    UPSTREAM_API_KEY: { type: 'plain_text', value: 'fixture-not-a-real-key' },
    UPSTREAM_BASE_URL: { type: 'plain_text', value: 'https://must-not-be-called.invalid/v1' },
  } });
  try {
    const health = await server.fetch('http://localhost/health');
    assert.equal(health.status, 200); assert.equal((await health.json()).version, '0.2.0');
    const unauthorized = await server.fetch('http://localhost/v1/chat/completions', { method: 'POST', body: '{}' });
    assert.equal(unauthorized.status, 401);
    const protectedResponse = await server.fetch('http://localhost/v1/chat/completions', { method: 'POST', headers: { authorization: 'Bearer ' + 'fixture-runtime-token-'.repeat(3), 'content-type': 'application/json' }, body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'sk-' + 'a'.repeat(32) }] }) });
    assert.equal(protectedResponse.status, 422); assert.equal((await protectedResponse.json()).error.code, 'secret_detected');
  } finally { await server.dispose(); }
});

test('real workerd bundle forwards only sanitized text and streams bytes unchanged', async () => {
  const requests = [];
  const sse = 'data: {"choices":[{"delta":{"content":"こんにちは"}}]}\n\ndata: [DONE]\n\n';
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, scriptPath: 'dist/worker.js', compatibilityDate: '2026-09-01', bindings: {
    GATEWAY_TOKEN: 'fixture-runtime-token-'.repeat(3), UPSTREAM_API_KEY: 'fixture-upstream-key', UPSTREAM_BASE_URL: 'https://upstream.example/v1', REDACT_TERMS: '["Example Person"]',
  }, outboundService: async request => {
    const raw = await request.text(); requests.push(raw);
    assert.equal(request.url, 'https://upstream.example/v1/chat/completions');
    assert.ok(!raw.includes('alice@example.com')); assert.ok(!raw.includes('Example Person'));
    assert.ok(!raw.includes('090-1234-5678'));
    assert.equal(request.headers.get('cookie'), null);
    assert.equal(request.headers.get('authorization'), 'Bearer fixture-upstream-key');
    return new Response(sse, { headers: { 'content-type': 'text/event-stream' } });
  } }));
  try {
    const response = await mf.dispatchFetch('https://gateway.example/v1/chat/completions', { method: 'POST', headers: { authorization: 'Bearer ' + 'fixture-runtime-token-'.repeat(3), 'content-type': 'application/json', cookie: 'fixture-cookie' }, body: JSON.stringify({ model: 'test', stream: true, messages: [{ role: 'user', content: 'Example Person alice@example.com 090-1234-5678' }] }) });
    assert.equal(response.status, 200); assert.equal(await response.text(), sse); assert.equal(requests.length, 1);
  } finally { await mf.dispose(); }
});
