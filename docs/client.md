# Client guide

[日本語](client.ja.md) · [README](../README.md)

## API

Import `createPrivacyClient` from `src/client.js`. No installation from npm; use the source checkout. The factory performs no network call and returns a frozen object with `inspect` and `complete` methods.

| Option | Meaning |
|---|---|
| `baseURL` | Required HTTPS URL ending in `/v1` (optional trailing slash). No query, fragment or embedded credentials. |
| `apiKey` | Required nonempty printable ASCII, no spaces, ≤2,048 characters. For the Worker, use its distinct gateway token (32–1,024 chars). |
| `terms` | Optional string array; copied at creation. ≤100 terms, 2–256 characters each. Exact case-sensitive matches after NFKC. |
| `timeoutMs` | Integer 1–120,000, default 120,000. Covers fetch through response-stream completion; local synchronous inspection precedes the timer. |
| `allowLoopbackHTTP` | Default false. For local tests only, allow HTTP to `localhost`, `127.0.0.1`, `[::1]`. |
| `fetch` | Optional trusted transport implementation, default `globalThis.fetch`. Tests use it to verify outgoing data. |

### `inspect(input)`

Synchronous. Clones and validates the input, returning `{ body, counts }`. No network. Counts are `{ email, phone, term }`, counting distinct replaced values in that inspection. Throws on recognized secrets or invalid/unsupported input. The returned body may still contain undetected personal data.

### `await complete(input, { signal }?)`

Runs a fresh local inspection, serializes the protected body and sends it once. Returns `{ response, counts }` after response headers arrive. `response` is a Web `Response`, supporting `.json()`, `.text()` and `.body`. A fetch/stream timeout or abort throws/errors with a generic code. Cancellation cannot undo a request already sent or guarantee the backend stops billing.

Only two explicit request headers are constructed: `content-type` and `authorization`. Browsers/runtime can add protocol headers and transport metadata. Cookies and referrer are omitted; redirects are errors. Never pass an untrusted custom fetch implementation.

### Stream and abort

Use the `client` and `input` from the README. This example handles raw SSE bytes, **not parsed model tokens**:

```js
const controller = new AbortController();
const { response } = await client.complete(
  { ...input, stream: true },
  { signal: controller.signal },
);
const reader = response.body.getReader();
const decoder = new TextDecoder();
try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const sseFragment = decoder.decode(value, { stream: true });
    // Feed into your SSE parser, preserving partial lines between chunks.
  }
  const finalFragment = decoder.decode();
} finally {
  await reader.cancel();
  reader.releaseLock();
}
// To stop an active request from your UI: controller.abort()
```

Do not assume chunks align with JSON, UTF-8 characters or SSE events. A deadline/disconnect can truncate a stream. Always consume or cancel the response, even if you only needed its headers. There is no identifier restoration, persistence or automatic retry.

## Browser deployment

The source modules use standard Web APIs. Serve `src/client.js` and its relative `src/core.js` dependency from a trusted application origin (or bundle them), then import inside a module script. Web Crypto requires a secure context; localhost is suitable for development.

The destination must be same-origin or explicitly CORS-enabled. The stock Worker does not serve frontend assets and does not implement cross-origin preflight. Do not solve a failed preflight by putting shared backend credentials into public source. Use your application's trusted authentication/deployment architecture. No cookie-based authentication is implemented by this client; it uses the supplied Bearer token.

The endpoint you configure receives its authentication token. Direct-backend use has different trust from self-hosted Worker use. Local protection does not prevent browser extensions, service workers, XSS or other code in the page from seeing the original text.

## CLI

```sh
node bin/teai-privacy.js --help
node bin/teai-privacy.js inspect < examples/request.json
node bin/teai-privacy.js send < your-request.json
```

| Environment variable | Used by |
|---|---|
| `PRIVACY_BASE_URL` | `send`; `/v1` endpoint |
| `PRIVACY_API_KEY` | `send`; destination's credential |
| `PRIVACY_TERMS` | Both; optional JSON array, default `[]` |

`--lang=ja` changes CLI error prefix to Japanese, not the API response language. Success exits 0. Validation/transport failures exit 1 and write a generic code to stderr. A streaming failure can occur **after partial stdout**; check exit status before treating output as complete. stdin has a 256 KiB cap but no separate input deadline. CLI send requires HTTPS, with no CLI flag to opt into local HTTP.

For core-only use, `protectChat(input, terms)` in `src/core.js` returns `{ body, counts }` without a client or destination. The core does not send anything or apply the client's post-replacement output-size check.

## Errors & troubleshooting

| Code / symptom | Meaning and next step |
|---|---|
| `secret_detected` | Recognized secret in input. Remove it locally; do not retry the original through an unprotected endpoint. |
| `text_only`, `unsupported_field`, `unsupported_role` | Request contains unsupported media, tools, roles or fields. Use the documented text-only schema. |
| `unsupported_invisible_character` | Control/invisible/bidi character. Review the local text. |
| `invalid_json`, `invalid_client_input` | Supply valid UTF-8 JSON/plain data. Functions/cycles are not supported. |
| `body_too_large`, `too_many_matches` | Reduce request size or message match density. |
| `sanitized_body_too_large` | Placeholder-expanded request exceeds 256 KiB. Reduce input/history. |
| `invalid_privacy_config` | Terms must be a JSON string array within the limits; terms are also inspected for secret/control patterns. |
| `sensitive_routing_metadata` | A model routing name would need redaction. Use a legitimate non-sensitive model ID. |
| `invalid_client_config` | Check endpoint, key format and timeout. Must be HTTPS `/v1` except explicit local-test opt-in. |
| `client_timeout`, `client_aborted` | Deadline/cancellation. Local inspection is not the entire cause of network latency. |
| `client_network_error` | Network, redirect or browser CORS failure. Inspect network status without logging raw prompts/keys. |
| `client_upstream_rejected` | Non-2xx, missing body or wrong response content type. Check endpoint/credentials/model/balance via its own controls. Client does not expose raw response errors. |
| Worker HTTP 401 `unauthorized` | Gateway token missing/incorrect. It is not the upstream key. |
| Worker HTTP 503 `gateway_not_configured` | Configure distinct gateway/upstream keys, gateway-token length 32–1,024. |
| Worker `upstream_rejected` / `upstream_unavailable` | Backend error, redirect, incompatible content type or connectivity. Worker suppresses upstream details. |
| Zero Worker replacement count after local inspection | Expected when the client already replaced all recognized values. Layer counts are separate. |
| `/health` passes but generation fails | Health only confirms Worker availability. It does not exercise paid inference. |

Before reporting a bug, reproduce with synthetic input. [Private security reports](https://github.com/yukihamada/teai-privacy/security/advisories/new); general changes: [CONTRIBUTING.md](../CONTRIBUTING.md).
