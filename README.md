# teai-privacy

**Send less private information to AI. Inspect text on your device or in your own Cloudflare Worker.**

[![Verify](https://github.com/yukihamada/teai-privacy/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/yukihamada/teai-privacy/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**[日本語](README.ja.md)** · [v0.2.0 preview](https://github.com/yukihamada/teai-privacy/releases/tag/v0.2.0) · [Benchmarks](bench/README.md) · [Security](SECURITY.md)

A dependency-free JavaScript protection core, a Node/browser client, a stdin CLI, and a self-hosted Worker. Recognized secrets **stop the request**. Recognized email addresses, phone numbers and configured terms become **placeholders**.

**Status:** text-only preview. No npm distribution or hosted inference service. No automatic Sente integration. Detection is format-based, not complete anonymization. Names and addresses need explicit terms; model outputs are not filtered or restored.

## Choose where protection runs

```text
Local client / CLI → [optional: your Cloudflare Worker] → text-chat API
  inspect before      inspect before the backend
  leaving the device
```

| Mode | Where original text is inspected | What it requires |
|---|---|---|
| Local inspection | Your device; no network | Node 22+ |
| Local client / CLI send | Your device, before fetch | Node 22+ or a modern browser, backend access |
| Worker only | Cloudflare receives the original request | Your Cloudflare account and backend key |
| Client + Worker | Device first, Worker checks again | Both above |

Only **detected** values are blocked/replaced. Unrecognized identifiers and identifying context can still leave the device. Read the [trust boundaries](SECURITY.md).

## Quick start — no key, no API call

```sh
git clone https://github.com/yukihamada/teai-privacy.git
cd teai-privacy
node --version  # 22 or later
node bin/teai-privacy.js inspect < examples/request.json
```

No `npm install` is needed for the core, client or CLI. The bundled request contains synthetic contact details and `fixture-model` for offline examples. The output includes:

```json
{"model":"fixture-model","messages":[{"role":"user","content":"Draft a reply to [PRIVATE_<random>_EMAIL_1]."}],"max_tokens":200}
```

`<random>` is illustrative; the real nonce changes on each inspection. Original email absent, valid request JSON preserved. This command makes **zero network calls**. It writes the sanitized request to stdout, so use synthetic data when recording a demo.

## Node / browser client

Import the source from your clone (no package-name install):

```js
import { createPrivacyClient } from './src/client.js';

const client = createPrivacyClient({
  baseURL: 'https://your-gateway.example/v1',
  apiKey: gatewayToken, // supplied at runtime
  terms: ['Example Person'],
});
const input = {
  model: 'your-supported-model',
  messages: [{ role: 'user', content: 'Reply to alice@example.com' }],
};
const preview = client.inspect(input); // local only: { body, counts }
const { response, counts } = await client.complete(input); // fresh inspection, then fetch
const answer = await response.json();
```

Replace the example URL, runtime token and model with your own. Editing `preview` does not change what `complete(input)` sends. Both calls may produce different random placeholders. Inspection failures throw `PrivacyError` with a machine-readable `code` before fetch. [Client API, streaming and browser setup →](docs/client.md)

The client can target the Worker or a compatible HTTPS `/v1` backend directly. With the Worker, `apiKey` is the **gateway token**; with a direct backend, it is the **backend key**. This authentication credential is intentionally sent in a header, separately from prompt inspection.

**Browser:** serve modules from your application, using a secure context and a same-origin or appropriately CORS-enabled endpoint. The provided Worker does not enable cross-origin CORS or serve a browser UI. Do not embed shared credentials in public browser assets.

### CLI send

Supply `PRIVACY_BASE_URL`, `PRIVACY_API_KEY` and optional `PRIVACY_TERMS` (JSON string array) through your environment. Choose a supported model in your request JSON, then:

```sh
node bin/teai-privacy.js send < your-request.json
# Japanese CLI errors:
node bin/teai-privacy.js send --lang=ja < your-request.json
```

`send` can incur backend charges. Output is backend JSON or raw SSE. `inspect` only prints the locally protected request and needs no key. Keep real prompts/keys out of shell arguments and history. [Runnable examples →](examples/README.md)

## Deploy your own Worker

1. Fork this repository and enable GitHub Actions on the fork. Use Node 22+ and run `npm ci && npm run check` locally.
2. In GitHub repository settings, configure the following Actions secrets (repository or `production` environment). Use a dedicated gateway token, **32–1,024 characters**, different from the backend key.

   | Secret | Purpose |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | Workers deployment permission for your account |
   | `CLOUDFLARE_ACCOUNT_ID` | The destination account ID |
   | `GATEWAY_TOKEN` | Credential accepted from your trusted clients |
   | `UPSTREAM_API_KEY` | Credential the Worker sends to the backend |
   | `REDACT_TERMS` | Optional array, e.g. `["Example Person","Example Street"]` |

3. Review `wrangler.jsonc`. The Worker name is `teai-privacy`; choose another if that name is already in use. `UPSTREAM_BASE_URL` defaults to `https://api.teai.io/v1`; HTTPS and path `/v1` are required.
4. **Actions → deploy → Run workflow**. The workflow tests, configures Worker secrets and deploys. Repeat deployments can update live secrets before the code update. Any `production` environment approval rules you configure apply here.
5. Use the actual URL from the deployment output:

   ```sh
   curl --fail https://teai-privacy.YOUR-SUBDOMAIN.workers.dev/health
   ```

   Expected: `{"ok":true,"version":"0.2.0","scope":"text-chat-only"}`. This checks the Worker, not backend credentials, balance or model availability. Set the client's base URL to that origin plus `/v1` and its key to `GATEWAY_TOKEN`.

Deployment is opt-in. Cloudflare/backend charges belong to your accounts. The source release is tested locally in workerd and CI; deployment to a real customer account is not part of the recorded release verification.

## What is covered?

| Input | Behavior |
|---|---|
| Recognized API-token patterns, PEM private-key markers, JWTs, credential assignments, Bearer/Basic credentials, credential-bearing URLs | Block request |
| Common ASCII emails; Japanese domestic phones; explicit international `+` phone formats | Replace recognized matches |
| Names, addresses or other configured exact terms | Replace; case-sensitive after NFKC normalization |
| System/developer/user/assistant text, including history | Inspect every message; combine text parts before scanning |
| Images, audio, files, tool calls, unknown fields | Reject |
| AI response | Pass through; no inspection or identifier restoration |

One value shares a placeholder **within one request**. No mapping persists between requests. Counts mean distinct replaced values, not a recall/accuracy score. With two inspection layers, the Worker's `x-teai-privacy-replacements` reports **only its own pass**, not prior client replacements.

### Protocol and limits

- Only `POST /v1/chat/completions`; JSON responses and SSE. No `/v1/models`, `/v1/responses`, `/v1/messages`, tools, `tool` role, `user` metadata or `response_format`.
- JSON input ≤256 KiB, ≤128 messages, ≤64 text parts/message, ≤4,096 matches/message, ≤100 configured terms of 2–256 characters. Client `complete` also rejects oversized placeholder-expanded output.
- Request fields: `model`, `messages`, `stream`, `stream_options.include_usage`, `temperature`, `top_p`, `max_tokens`, `max_completion_tokens`, `stop`, `seed`, `presence_penalty`, `frequency_penalty`.
- NFKC normalization can change code/text; invisible and bidi control characters are rejected. Phone-like order numbers and credential descriptions may cause false positives. No bypass header.
- Worker input deadline 10s; Worker upstream and client network/stream deadline 120s. No redirects or retries. Consume/cancel response streams. CLI stdin collection has no separate deadline.
- One shared gateway trust domain. No built-in per-user billing separation or rate/spend limit; use your platform/backend controls.

Some agent SDKs require unsupported endpoints/fields and will fail closed. This is not a drop-in gateway for every agent. [Errors and troubleshooting →](docs/client.md#errors--troubleshooting)

## Performance and verification

M5 Max, Node 25.8.2, fixed synthetic corpus; 180 samples per implementation/case. p50 includes inspection and benchmark output serialization, not inference or WAN:

| Input | v0.1.0 | v0.2.0 | Ratio |
|---|---:|---:|---:|
| Plain text 32 KB | 0.439 ms | 0.188 ms | 2.34× |
| Plain text 128 KB | 1.850 ms | 0.807 ms | 2.29× |
| Repeated letters 250 KB | 31.320 ms | 1.522 ms | 20.57× |

Dense PII: only 1.09×; secret-at-end rejection: ~2.5% slower at p50. Real loopback HTTP client overhead at 32 KB: **0.236ms difference of medians**. No general latency guarantee. [All cases, p95, raw samples and reproduction →](bench/README.md)

v0.2.0 verification: **52 unit/adversarial + 2 workerd + 1 real Chrome tests**, 2,515 email-boundary cases in the equivalence test. Real socket/browser checks confirm recognized contact values are absent, cookies/referrer omitted and recognized secrets blocked before sending. No paid-model accuracy or answer-quality benchmark; no independent security audit. See [release evidence](RELEASE.md).

## Development and contributing

```sh
npm ci
npm run check         # unit/adversarial, Worker bundle, local workerd
npm run test:browser  # installed Chrome; optional CHROME_PATH override
npm audit
```

Browser test defaults: macOS `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; Linux `/usr/bin/google-chrome`. Other locations/platforms: set `CHROME_PATH` to the installed executable. `npm ci` does not download Chrome. Production/runtime code has zero package dependencies; tooling has dev dependencies.

[Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [Security reporting](https://github.com/yukihamada/teai-privacy/security/advisories/new) · [MIT license](LICENSE)
