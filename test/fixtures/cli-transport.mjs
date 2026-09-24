// Preloaded ONLY by CLI tests. Synthetic in-process transport; no external calls.
import assert from 'node:assert/strict';
globalThis.fetch = async (url, init) => {
  assert.equal(url, 'https://gateway.example/v1/chat/completions');
  assert.ok(!init.body.includes('alice@example.com'));
  assert.equal(init.headers.authorization, 'Bearer fixture-cli-key');
  const input = JSON.parse(init.body);
  return input.stream ? new Response('data: {"text":"fixture"}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }) : Response.json({ fixture: true });
};
