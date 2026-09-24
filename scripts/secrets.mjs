import { spawnSync } from 'node:child_process';
const { GATEWAY_TOKEN, UPSTREAM_API_KEY, REDACT_TERMS = '[]' } = process.env;
if (!GATEWAY_TOKEN || GATEWAY_TOKEN.length < 32 || GATEWAY_TOKEN.length > 1024 || !UPSTREAM_API_KEY || GATEWAY_TOKEN === UPSTREAM_API_KEY) throw new Error('Configure a distinct GATEWAY_TOKEN (32–1024 chars) and UPSTREAM_API_KEY.');
const terms = JSON.parse(REDACT_TERMS || '[]');
if (!Array.isArray(terms) || terms.length > 100 || terms.some(t => typeof t !== 'string' || t.length < 2 || t.length > 256)) throw new Error('Invalid REDACT_TERMS.');
// Supply via stdin; never command-line arguments, logs, or files.
const result = spawnSync('npx', ['wrangler', 'secret', 'bulk'], { input: JSON.stringify({ GATEWAY_TOKEN, UPSTREAM_API_KEY, REDACT_TERMS: JSON.stringify(terms) }), stdio: ['pipe', 'inherit', 'inherit'] });
if (result.error) throw new Error('Could not start Wrangler.');
process.exit(result.status ?? 1);
