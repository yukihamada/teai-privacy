#!/usr/bin/env node
import { MAX_BYTES, PrivacyError, protectChat } from '../src/core.js';
import { createPrivacyClient } from '../src/client.js';
import { once } from 'node:events';

const HELP = `teai-privacy inspect | send [--lang=en|ja]
Read a text-chat JSON request from stdin. inspect: local only; send: inspect then send.
環境変数 / Environment: PRIVACY_BASE_URL, PRIVACY_API_KEY, PRIVACY_TERMS (JSON array).
Secrets/prompts must not be command-line arguments. / 鍵・原文は引数に入れない。
Output: sanitized JSON (inspect), JSON or raw SSE (send). No restoration.
`;

async function readInput() {
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new PrivacyError('body_too_large', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new PrivacyError('invalid_json'); }
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === '--help') { process.stdout.write(HELP); return; }
  if (!['inspect', 'send'].includes(mode) || args.some(a => !['--lang=en', '--lang=ja'].includes(a))) throw new PrivacyError('invalid_arguments');
  let terms;
  try { terms = JSON.parse(process.env.PRIVACY_TERMS ?? '[]'); } catch { throw new PrivacyError('invalid_privacy_config'); }
  const input = await readInput();
  if (mode === 'inspect') {
    const { body } = protectChat(input, terms);
    process.stdout.write(JSON.stringify(body) + '\n');
    return;
  }
  const client = createPrivacyClient({ baseURL: process.env.PRIVACY_BASE_URL, apiKey: process.env.PRIVACY_API_KEY, terms });
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  const { response } = await client.complete(input, { signal: controller.signal });
  try {
    for await (const chunk of response.body) if (!process.stdout.write(chunk)) await once(process.stdout, 'drain');
  } finally { process.removeListener('SIGINT', stop); }
}

process.stdout.on('error', () => { process.exitCode = 1; process.stdout.destroy(); });
main().catch(error => {
  const code = error instanceof PrivacyError ? error.code : 'client_failed';
  const japanese = process.argv.includes('--lang=ja');
  process.stderr.write((japanese ? '処理を停止しました: ' : 'Stopped: ') + code + '\n');
  process.exitCode = 1;
});
