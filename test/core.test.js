import { test } from 'node:test';
import assert from 'node:assert/strict';
import { protectChat } from '../src/core.js';

const chat = content => ({ model: 'test-model', messages: [{ role: 'user', content }] });
const blocks = (input, code = 'secret_detected') => assert.throws(() => protectChat(input), e => e.code === code);
const fakeSecrets = {
  openai: 'sk-' + 'a'.repeat(32), anthropic: 'sk-ant-' + 'b'.repeat(32),
  stripe: 'sk_live_' + 'c'.repeat(24), aws: 'AKIA' + 'D'.repeat(16), temporaryAws: 'ASIA' + 'E'.repeat(16),
  github: 'ghp_' + 'f'.repeat(36), githubPat: 'github_pat_' + 'g'.repeat(40),
  slack: 'xoxb-' + '1234567890-'.repeat(3), google: 'AIza' + 'h'.repeat(35),
  teai: 'tew_' + 'i'.repeat(32), koe: 'koeu_' + 'j'.repeat(32),
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.c2lnbmF0dXJl',
  bearer: 'Bearer ' + 'k'.repeat(32), basic: 'Basic ' + 'b'.repeat(20),
  password: 'password="fixture-only"', quotedJson: '"api_key": "fixture-only"',
  url: 'postgres://fixture:fixture-only@example.invalid/db',
  pem: '-----BEGIN PRIVATE KEY-----\nTEST ONLY\n-----END PRIVATE KEY-----',
  truncatedPem: '-----BEGIN RSA PRIVATE KEY-----\nTEST ONLY',
};
for (const [kind, value] of Object.entries(fakeSecrets)) test(`blocks synthetic ${kind}`, () => blocks(chat(`Here is ${value}`)));

test('detects secrets after JSON decoding and NFKC normalization', () => {
  blocks(JSON.parse('{"model":"test-model","messages":[{"role":"user","content":"\\u0073k-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}'));
  blocks(chat('ｓｋ－' + 'ａ'.repeat(32)));
});
test('rejects zero-width and bidi controls', () => {
  for (const char of ['\u200b', '\u202e', '\u2060', '\u0000']) blocks(chat('s' + char + 'k-aaaaaaaaaaaaaaaaaaaaaaaa'), 'unsupported_invisible_character');
});
test('text parts are inspected together', () => blocks(chat([{ type: 'text', text: 'sk-' }, { type: 'text', text: 'a'.repeat(32) }])));
test('every message including history and system is inspected', () => {
  for (const role of ['system', 'developer', 'user', 'assistant']) blocks({ model: 'test', messages: [{ role, content: fakeSecrets.github }, { role: 'user', content: 'hello' }] });
});
test('email and Japanese/international phone redaction', () => {
  for (const text of ['alice@example.com', 'First.Last+tag@sub.example.co.jp', '090-1234-5678', '0312345678', '+81 90 1234 5678', '+1 (202) 555-0123']) {
    const { body, counts } = protectChat(chat(text));
    assert.ok(!JSON.stringify(body).includes(text), text);
    assert.equal(counts.email + counts.phone, 1, text);
  }
});
test('specified names and addresses, longest overlap and repeated values', () => {
  const input = chat('Example Person lives at Example Street. Example Person alice@example.com');
  const result = protectChat(input, ['Example', 'Example Person', 'Example Street', 'alice']);
  const output = result.body.messages[0].content;
  assert.ok(!output.includes('Person')); assert.ok(!output.includes('@example.com'));
  assert.equal(result.counts.term, 2);
  assert.equal(result.counts.email, 1);
  const placeholders = output.match(/\[PRIVATE_[^\]]+\]/g);
  assert.equal(placeholders[0], placeholders[2]);
  assert.equal(input.messages[0].content, 'Example Person lives at Example Street. Example Person alice@example.com');
});
test('maps never cross requests and original values are not returned', () => {
  const a = protectChat(chat('alice@example.com'));
  const b = protectChat(chat('alice@example.com'));
  assert.notEqual(a.body.messages[0].content, b.body.messages[0].content);
  assert.ok(!JSON.stringify(a).includes('alice@example.com'));
});
test('safe content and numbers are preserved', () => {
  for (const text of ['Hello 世界', 'const total = 123456789;', '2026-09-24', 'version 1.2.3 and 42', 'The password field is required.', 'Call the tool later.']) {
    assert.equal(protectChat(chat(text)).body.messages[0].content, text);
  }
});
test('unsupported payload surfaces fail closed', () => {
  for (const input of [
    { ...chat('hello'), tools: [] }, { ...chat('hello'), metadata: { email: 'a@example.com' } },
    { ...chat('hello'), user: 'a@example.com' }, { ...chat('hello'), response_format: {} },
    chat([{ type: 'image_url', image_url: { url: 'https://example.com/image.png' } }]),
    chat([{ type: 'input_audio', input_audio: { data: 'YWJj' } }]),
    { model: 'test', messages: [{ role: 'tool', content: 'result' }] },
    { model: 'test', messages: [{ role: 'user', content: 'text', name: 'Alice' }] },
    { model: 'test', messages: [{ role: 'assistant', content: null, tool_calls: [] }] },
    { model: 'test', messages: [] }, null, [],
  ]) assert.throws(() => protectChat(input));
});
test('stop strings and routing metadata cannot carry recognized secrets', () => {
  blocks({ ...chat('hi'), stop: [fakeSecrets.openai] });
  blocks({ ...chat('hi'), model: fakeSecrets.openai });
  blocks({ ...chat('hi'), model: '090-1234-5678' }, 'sensitive_routing_metadata');
  assert.ok(!JSON.stringify(protectChat({ ...chat('hi'), stop: ['alice@example.com'] })).includes('alice@example.com'));
});
test('invalid controls/configuration rejected without raw values in errors', () => {
  for (const patch of [{ temperature: NaN }, { max_tokens: 0 }, { max_tokens: 3.5 }, { stream: 'yes' }, { stream_options: { unknown: 1 } }, { seed: Infinity }]) assert.throws(() => protectChat({ ...chat('hello'), ...patch }));
  for (const terms of [null, 'Example', ['x'], [123], ['x'.repeat(257)]]) assert.throws(() => protectChat(chat('hello'), terms), e => e.code === 'invalid_privacy_config');
  try { protectChat(chat(fakeSecrets.openai)); } catch (e) { assert.ok(!String(e).includes(fakeSecrets.openai)); }
});

test('near-limit ordinary and adversarial text has bounded execution and match expansion', () => {
  for (const text of ['a'.repeat(250000), 'ordinary text '.repeat(18000), 'a@'.repeat(120000)]) {
    const start = performance.now(); protectChat(chat(text));
    assert.ok(performance.now() - start < 2000, 'inspection exceeded 2s regression ceiling');
  }
  blocks(chat('alice@example.com '.repeat(5000)), 'too_many_matches');
  blocks(chat('a'.repeat(262144)), 'body_too_large');
});
