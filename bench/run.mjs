// Synthetic, deterministic corpus. No model call, no original user data, no external network.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, arch } from 'node:os';
import assert from 'node:assert/strict';
import { protectChat } from '../src/core.js';

const reference = 'e1cf63c9bdc6ab39787066bac1758deaf577c672';
const source = execFileSync('git', ['show', reference + ':src/core.js'], { encoding: 'utf8' });
const baseline = (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).protectChat;
const sha = value => createHash('sha256').update(value).digest('hex');
const chat = text => ({ model: 'fixture-model', messages: [{ role: 'user', content: text }] });
const repeat = (text, size) => text.repeat(Math.ceil(size / text.length)).slice(0, size);
const cases = [
  ['plain-2k', repeat('Explain this function and suggest a readable name. ', 2048), []],
  ['plain-32k', repeat('Explain this function and suggest a readable name. ', 32768), []],
  ['plain-128k', repeat('Explain this function and suggest a readable name. ', 131072), []],
  ['plain-240k', repeat('Explain this function and suggest a readable name. ', 245760), []],
  ['no-at-250k', 'a'.repeat(250000), []],
  ['near-email-240k', repeat('a'.repeat(200) + '@ ', 240000), []],
  ['mixed-ja-96k', repeat('この関数を説明してください。const total = 42;\n', 42000), []],
  ['pii-32k', repeat('Write to alice@example.com or call 090-1234-5678. Example Person.\n', 32768), ['Example Person']],
  ['terms100-32k', repeat('Explain this function and suggest a readable name. ', 32768), Array.from({ length: 100 }, (_, i) => 'Exact Name ' + i)],
  ['secret-end-128k', 'safe text '.repeat(13000) + 'sk-' + 'a'.repeat(32), []],
].map(([name, text, terms]) => ({ name, input: chat(text), terms }));
const canonical = result => JSON.stringify(result).replace(/PRIVATE_[0-9a-f]{32}_/g, 'PRIVATE_NONCE_');
function run(fn, item) {
  try { return { result: canonical(fn(item.input, item.terms)) }; }
  catch (e) { if (typeof e.code !== 'string') throw e; return { blocked: e.code }; }
}
function stats(values) {
  const ordered = [...values].sort((a, b) => a - b);
  return { p50_ms: ordered[Math.floor(ordered.length * .5)], p95_ms: ordered[Math.ceil(ordered.length * .95) - 1], samples: values.length };
}
const results = [];
for (const item of cases) {
  assert.deepEqual(run(protectChat, item), run(baseline, item));
  const timings = { baseline: [], current: [] };
  for (let n = 0; n < 30; n++) { run(baseline, item); run(protectChat, item); }
  for (let round = 0; round < 6; round++) {
    const order = round % 2 ? [['current', protectChat], ['baseline', baseline]] : [['baseline', baseline], ['current', protectChat]];
    for (const [label, fn] of order) for (let n = 0; n < 30; n++) {
      const start = performance.now(); run(fn, item); timings[label].push(performance.now() - start);
    }
  }
  const before = stats(timings.baseline), after = stats(timings.current);
  results.push({ name: item.name, json_bytes: Buffer.byteLength(JSON.stringify(item.input)), outcome_equal: true, baseline: before, current: after, p50_speedup: before.p50_ms / after.p50_ms, samples_ms: timings });
}
const report = {
  schema: 1, measured_at: new Date().toISOString(), runtime: process.version, platform: platform(), arch: arch(), cpu: cpus()[0].model,
  baseline_commit: reference, baseline_sha256: sha(source), current_sha256: sha(await readFile(new URL('../src/core.js', import.meta.url))),
  corpus_sha256: sha(JSON.stringify(cases)), method: '30 warmups; 6 alternating-order rounds x30 samples per implementation per case; includes protection and canonical output serialization; synthetic only',
  results,
};
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, results: results.map(({ samples_ms, ...row }) => row) }, null, 2));
