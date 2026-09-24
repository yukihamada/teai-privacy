import { test } from 'node:test';
import assert from 'node:assert/strict';
import { protectChat } from '../src/core.js';

// Frozen v0.1.0 regex oracle. No need for git history in CI/archive installations.
const old = /[a-z0-9.!#$%&'*+\/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?){1,10}/gi;
test('optimized scanner preserves old email spans on seeded/overlap/length corpus', () => {
  const cases = ['a@b.co@c.de', 'a@b.co..x@d.ef', 'a'.repeat(100) + '@example.com', 'x@' + 'd'.repeat(64) + '.com', 'x@a.' + 'b.'.repeat(20) + 'com', 'A+tag@SUB.Example.COM', 'a@ b@c.de', 'a@@b.c', 'prefix-foo@example.com', 'あいうalice@example.comえお', 'a@b.coa@b.co'];
  let seed = 240924;
  cases.push('alice\n@example.com', 'alice\r@example.com', 'alice\r\n@example.com', 'alice\u2028@example.com');
  const next = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const parts = ['alice', '@', 'foo.example', '.', '-', '_', '+', ' ', '中文', 'a'.repeat(65), '/', 'x@b.co', '\n'];
  for (let i = 0; i < 2500; i++) cases.push(Array.from({ length: 2 + next(30) }, () => parts[next(parts.length)]).join(''));
  for (const text of cases) {
    const expected = text.normalize('NFKC').replace(old, '[EMAIL]');
    const result = protectChat({ model: 'test', messages: [{ role: 'user', content: text }] }).body.messages[0].content.replace(/\[PRIVATE_[0-9a-f]{32}_EMAIL_\d+\]/g, '[EMAIL]');
    assert.equal(result, expected, text);
  }
});
