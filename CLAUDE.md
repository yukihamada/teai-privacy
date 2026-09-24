# teai-privacy

Independent MIT-licensed text-only privacy gateway. Runtime dependencies: none.
Read README.md and SECURITY.md before changes. Do not claim complete PII detection.

- `npm ci && npm run check`: unit/adversarial tests, Worker bundle, real workerd tests.
- `npm run test:browser`: real installed Chrome (override CHROME_PATH). Bench recipes/evidence: bench/README.md.
- Deploy through GitHub Actions only. Never commit `.dev.vars` or real test credentials.
- Fail closed. Do not log prompt content, credentials, detected values or replacement maps.
- Do not restore identifiers into tool calls. v0.2 has no tools, attachments or restoration.
- Keep English/Japanese documentation in sync. No background paid model calls in tests.
