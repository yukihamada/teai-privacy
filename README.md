# teai-privacy

**Inspect text before it reaches your AI backend.** A small, self-hosted privacy gateway for Cloudflare Workers, with a network-free JavaScript core.

[日本語](README.ja.md) · [Security & limitations](SECURITY.md) · [Release verification](RELEASE.md) · MIT

```text
Your client → your Cloudflare Worker → teai / compatible text-chat backend
                    │
                    ├─ recognized secret → block before forwarding
                    └─ email / phone / configured terms → placeholders
```

## What v0.1 does

- Blocks recognized API-token formats, PEM private-key markers, JWTs, credential assignments, Bearer/Basic credentials and credential-bearing URLs.
- Replaces common ASCII email addresses, Japanese domestic phone numbers, explicit international `+` numbers, and your exact configured names/addresses.
- Inspects every message, including system prompts and conversation history. Combines text parts before inspection.
- Supports **text-only `POST /v1/chat/completions`**, JSON responses and SSE streaming.
- Rejects unknown fields, tool calls, images, audio, files, malformed input and oversized requests. Inspection failure never falls back to the original request.
- Builds outbound headers from scratch. Client cookies, IP-forwarding headers and the gateway token are not forwarded. Uses a separate upstream API key.
- No prompt logging, analytics, database, retry, third-party detection API or runtime dependency. Worker observability defaults to disabled.

**Not complete anonymization.** Names/addresses require explicit terms. Obfuscated/encoded secrets, unsupported formats and information inferred from context can escape detection. Outputs are passed through, not inspected. Read [SECURITY.md](SECURITY.md).

## Deploy to your Cloudflare account

1. Fork this repository. Use Node 22+, then `npm ci && npm run check`.
2. In GitHub, create a `production` environment (recommended: require your approval). Add these repository/environment secrets:

   | Secret | Value |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | Workers deployment permission for your account |
   | `CLOUDFLARE_ACCOUNT_ID` | Your account ID |
   | `GATEWAY_TOKEN` | Random token, at least 32 characters; only trusted clients receive it |
   | `UPSTREAM_API_KEY` | Your backend API key; never the same token as `GATEWAY_TOKEN` |
   | `REDACT_TERMS` | Optional JSON array, e.g. `["Example Person","Example Street"]` |

3. Set `UPSTREAM_BASE_URL` in `wrangler.jsonc` if needed. Default: `https://api.teai.io/v1`. HTTPS and `/v1` are required. This is operator configuration, not a caller-controlled URL.
4. Run **Actions → deploy → Run workflow**. Tests run before secrets upload and deployment. For repeat deployments, editing secrets changes the live Worker's secrets; schedule such changes appropriately.
5. Check `https://teai-privacy.<your-subdomain>.workers.dev/health`. Configure your client's base URL to `https://teai-privacy.<your-subdomain>.workers.dev/v1` and API key to your **gateway token**, not your upstream key.

The public GitHub release is source code for self-hosting. There is no shared public inference service. Cloudflare/backend usage is charged to your accounts. Existing Sente Cloud and teai endpoints are not automatically protected by installing this repository.

### Example request

```sh
curl "$GATEWAY_URL/v1/chat/completions" \
  -H "Authorization: Bearer $GATEWAY_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"model":"your-supported-model","messages":[{"role":"user","content":"Draft a reply to alice@example.com"}],"max_tokens":200}'
```

The backend receives a per-request placeholder such as `[PRIVATE_<random>_EMAIL_1]`. Repeated values within a request share a placeholder. Values are **not restored** in the response, and no mapping is persisted. The response header `x-teai-privacy-replacements` reports the number of distinct replaced values, not detection completeness.

### Use locally before any network call

```js
import { protectChat } from './src/core.js';

const { body, counts } = protectChat({
  model: 'your-supported-model',
  messages: [{ role: 'user', content: 'Reply to alice@example.com' }],
}, ['Example Person']);
// Send only `body`. Never log the original input.
```

The core uses Web Crypto and works in modern browsers, Node 22+ and Workers. This library example is not an installed Sente/browser integration. `package.json` is private to avoid accidental npm publication; consume the tagged source.

## Compatibility and limits

- At most 256 KiB JSON, 128 messages, 64 text parts/message, 4,096 matches/message, 100 configured terms of 2–256 characters.
- NFKC normalization changes full-width and other compatibility characters. Invisible/bidi control characters are rejected. These choices can affect code and multilingual text.
- `model`, `messages`, `stream`, `stream_options.include_usage`, `temperature`, `top_p`, `max_tokens`, `max_completion_tokens`, `stop`, `seed`, `presence_penalty`, `frequency_penalty` only.
- No `tools`, `tool_calls`, `tool` role, `response_format`, `user`, attachments, model-list endpoint or Responses API. Some general-purpose agent clients require these and are **not compatible** with v0.1.
- A detection false positive stops the request. There is no bypass header. Phone-like order numbers may be redacted.
- Request-body deadline 10 seconds; upstream deadline 120 seconds (including streaming). No redirects followed, no automatic retry. Upstream failures return a generic error.
- This is a single-trust-domain gateway, not a multi-tenant billing service. Set upstream spending limits and Cloudflare request/rate limits before sharing access. CORS is not enabled; do not embed the shared gateway token in a public website.

## Development

```sh
npm ci
npm run check       # adversarial/unit tests, bundle, real local workerd tests
npm audit
```

Tests use synthetic credentials and a fake upstream; no paid model calls. Do not use real customer data in issues, tests, CI or screenshots. See [CONTRIBUTING.md](CONTRIBUTING.md).
