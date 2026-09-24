import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { createPrivacyClient } from '../src/client.js';

const payload = text => ({ model: 'fixture', messages: [{ role: 'user', content: text }] });
const config = { baseURL: 'https://gateway.example/v1', apiKey: 'fixture-key' };
const secret = 'sk-' + 'x'.repeat(32);

test('client blocks before fetch and before any auth or prompt leaves the device', async () => {
  let calls = 0;
  const client = createPrivacyClient({ ...config, fetch: async () => { calls++; return Response.json({}); } });
  for (const input of [payload(secret), { ...payload('hello'), tools: [] }, payload([{ type: 'image_url', image_url: {} }])]) await assert.rejects(client.complete(input));
  assert.equal(calls, 0);
});

test('client sends an inspected immutable snapshot, only explicit headers and no browser credentials', async () => {
  const terms = ['Example Person'];
  const input = payload('Example Person alice@example.com 090-1234-5678');
  const client = createPrivacyClient({ ...config, terms, fetch: async (url, options) => {
    assert.equal(url, 'https://gateway.example/v1/chat/completions');
    assert.ok(!options.body.includes('alice@example.com')); assert.ok(!options.body.includes('Example Person'));
    assert.ok(!options.body.includes('090-1234-5678')); assert.ok(!options.body.includes(secret));
    assert.deepEqual(Object.keys(options.headers).sort(), ['authorization', 'content-type']);
    assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer'); assert.equal(options.redirect, 'error');
    return Response.json({ choices: [] });
  } });
  terms.length = 0;
  const preview = client.inspect(input);
  preview.body.messages[0].content = secret; // editing preview cannot influence complete()
  const promise = client.complete(input);
  input.messages[0].content = secret;
  const result = await promise;
  assert.deepEqual(result.counts, { email: 1, phone: 1, term: 1 }); await result.response.json();
});

test('real loopback socket receives sanitized JSON; rejected request makes zero socket requests', async () => {
  const received = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    received.push({ body, headers: req.headers });
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"choices":[]}');
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const client = createPrivacyClient({ ...config, baseURL: `http://127.0.0.1:${server.address().port}/v1`, allowLoopbackHTTP: true });
    const result = await client.complete(payload('Contact alice@example.com')); await result.response.text();
    await assert.rejects(client.complete(payload(secret)));
    assert.equal(received.length, 1); assert.ok(!received[0].body.includes('alice@example.com'));
    assert.equal(received[0].headers.cookie, undefined);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('stream preserves UTF8 split boundaries, cancellation propagates', async () => {
  const text = 'data: {"text":"こんにちは"}\n\ndata: [DONE]\n\n';
  const bytes = new TextEncoder().encode(text);
  const client = createPrivacyClient({ ...config, fetch: async () => new Response(new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } }) });
  assert.equal(await (await client.complete({ ...payload('hi'), stream: true })).response.text(), text);
  let signal, cancelled = false;
  const other = createPrivacyClient({ ...config, fetch: async (_, init) => { signal = init.signal; return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } }); } });
  await (await other.complete({ ...payload('hi'), stream: true })).response.body.cancel();
  assert.equal(signal.aborted, true); assert.equal(cancelled, true);
});

test('abort/timeout, upstream failure and network exceptions have no raw error leakage', async () => {
  const controller = new AbortController(); controller.abort();
  const client = createPrivacyClient({ ...config, fetch: () => assert.fail('must not send') });
  await assert.rejects(client.complete(payload('hi'), { signal: controller.signal }), e => e.code === 'client_aborted');
  const timeout = createPrivacyClient({ ...config, timeoutMs: 5, fetch: async (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error(secret)))) });
  await assert.rejects(timeout.complete(payload('hi')), e => e.code === 'client_timeout' && !String(e).includes(secret));
  const broken = createPrivacyClient({ ...config, fetch: async () => { throw new Error(secret); } });
  await assert.rejects(broken.complete(payload('hi')), e => e.code === 'client_network_error');
  const upstreamError = createPrivacyClient({ ...config, fetch: async () => new Response(secret, { status: 401 }) });
  await assert.rejects(upstreamError.complete(payload('hi')), e => e.code === 'client_upstream_rejected');
});

test('client disallows insecure/credential-bearing destinations and invalid settings', () => {
  for (const baseURL of ['http://gateway.example/v1', 'http://127.0.0.1/v1', 'https://user:pass@gateway.example/v1', 'https://gateway.example/v1?key=fixture', 'https://gateway.example/other']) assert.throws(() => createPrivacyClient({ ...config, baseURL }));
  assert.throws(() => createPrivacyClient({ ...config, apiKey: 'bad\r\nheader' }));
  assert.throws(() => createPrivacyClient({ ...config, terms: null }));
});

test('custom serialization and cyclic input cannot bypass inspection or leak exceptions', async () => {
  const client = createPrivacyClient({ ...config, fetch: () => assert.fail('must not send') });
  await assert.rejects(client.complete({ ...payload('hi'), toJSON() { return payload(secret); } }), e => e.code === 'invalid_client_input');
  const cyclic = payload('hi'); cyclic.extra = cyclic;
  await assert.rejects(client.complete(cyclic), e => e.code === 'invalid_client_input');
});

test('placeholder expansion over gateway cap is rejected before fetch', async () => {
  const client = createPrivacyClient({ ...config, fetch: () => assert.fail('must not send') });
  const input = { model: 'fixture', messages: Array.from({ length: 10 }, () => ({ role: 'user', content: 'a@b.co '.repeat(600) })) };
  await assert.rejects(client.complete(input), e => e.code === 'sanitized_body_too_large');
});

test('CLI inspects stdin locally, rejects secrets and never echoes rejected input', () => {
  const cli = (args, input, extra = {}) => spawnSync(process.execPath, ['bin/teai-privacy.js', ...args], { input, encoding: 'utf8', env: { ...process.env, PRIVACY_TERMS: '[]', ...extra } });
  const ok = cli(['inspect'], JSON.stringify(payload('alice@example.com')));
  assert.equal(ok.status, 0); assert.equal(ok.stderr, ''); assert.ok(!ok.stdout.includes('alice@example.com')); assert.ok(JSON.parse(ok.stdout).messages);
  const blocked = cli(['inspect', '--lang=ja'], JSON.stringify(payload(secret)));
  assert.equal(blocked.status, 1); assert.equal(blocked.stdout, ''); assert.ok(blocked.stderr.includes('secret_detected')); assert.ok(!blocked.stderr.includes(secret));
  const invalid = cli(['inspect'], '{"raw":"PRIVATE', { PRIVACY_TERMS: '[]' });
  assert.equal(invalid.status, 1); assert.ok(!invalid.stderr.includes('PRIVATE'));
  const malformedUtf8 = cli(['inspect'], Buffer.from([0xff])); assert.equal(malformedUtf8.status, 1);
});

test('CLI send path emits JSON/SSE after local protection', () => {
  for (const stream of [false, true]) {
    const result = spawnSync(process.execPath, ['--import', './test/fixtures/cli-transport.mjs', 'bin/teai-privacy.js', 'send'], { encoding: 'utf8', input: JSON.stringify({ ...payload('alice@example.com'), stream }), env: { ...process.env, PRIVACY_TERMS: '[]', PRIVACY_BASE_URL: 'https://gateway.example/v1', PRIVACY_API_KEY: 'fixture-cli-key' } });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, '');
    if (stream) assert.ok(result.stdout.endsWith('data: [DONE]\n\n')); else assert.deepEqual(JSON.parse(result.stdout), { fixture: true });
  }
});
