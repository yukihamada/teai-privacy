import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

test('real Chrome: inspect before socket send, no cookies/referrer, SSE and local blocking', async () => {
  const captured = [];
  const files = new Map(await Promise.all(['client', 'core'].map(async name => [`/src/${name}.js`, await readFile(new URL(`../../src/${name}.js`, import.meta.url))])));
  const server = createServer(async (req, res) => {
    if (files.has(req.url)) { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(files.get(req.url)); return; }
    if (req.url === '/v1/chat/completions') {
      let text = ''; for await (const chunk of req) text += chunk;
      captured.push({ text, headers: req.headers });
      if (JSON.parse(text).stream) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: {"text":"こんにちは"}\n\n'); res.end('data: [DONE]\n\n'); }
      else { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); }
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Local privacy test</title>');
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome'), headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const result = await page.evaluate(async () => {
      const { createPrivacyClient } = await import('/src/client.js');
      document.cookie = 'fixture=must-not-be-forwarded; Path=/';
      const client = createPrivacyClient({ baseURL: location.origin + '/v1', apiKey: 'fixture-browser-key', terms: ['Example Person'], allowLoopbackHTTP: true });
      const input = { model: 'fixture', messages: [{ role: 'user', content: 'Example Person alice@example.com 090-1234-5678' }] };
      const json = await (await client.complete(input)).response.json();
      const sse = await (await client.complete({ ...input, stream: true })).response.text();
      let blocked;
      try { await client.complete({ ...input, messages: [{ role: 'user', content: 'sk-' + 'a'.repeat(32) }] }); } catch (e) { blocked = e.code; }
      return { json, sse, blocked };
    });
    assert.deepEqual(result.json, { ok: true }); assert.equal(result.blocked, 'secret_detected'); assert.ok(result.sse.includes('こんにちは')); assert.ok(result.sse.endsWith('data: [DONE]\n\n'));
    assert.equal(captured.length, 2);
    for (const request of captured) {
      for (const raw of ['alice@example.com', 'Example Person', '090-1234-5678']) assert.ok(!request.text.includes(raw));
      assert.equal(request.headers.cookie, undefined); assert.equal(request.headers.referer, undefined);
    }
  } finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
