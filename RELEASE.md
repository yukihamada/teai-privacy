# v0.1.0 — text-only self-hosted preview

Release date: 2026-09-24. License: MIT.

## Scope

Independent source release for deploying to your own Cloudflare account. Not installed into existing Sente Cloud/teai paths. No shared inference endpoint, npm package publication, or paid model call in release verification.

## Verification

- Local `npm run check`: 41 unit/adversarial tests + 2 real local workerd tests. Covers synthetic secret blocking, PII replacement, text-part splitting, normalization, history, unknown-field rejection, actual body-size limits, header isolation, no upstream call on rejection, redirects/errors, SSE and cancellation.
- `npm audit`: 0 known vulnerabilities in the installed dependency tree on 2026-09-24. Runtime dependencies: zero. Development tools pinned in package-lock.json.
- Worker dry-run bundle verified. The workerd egress test intercepts the real Worker's outbound fetch and asserts original email/phone/configured name and client cookie are absent; the upstream receives only the sanitized payload and its dedicated key.
- Near-limit 240–252 KB inputs exercised, including repetitive adversarial text. Timing ceilings in tests are regression checks, not a production latency or Cloudflare CPU guarantee.
- GitHub Actions runs are publicly available in the repository's Actions tab. The release tag is created only after the source commit passes verification.

The test corpus is synthetic and is not a real-world detection accuracy benchmark. Independent security audit, production customer deployment and model-answer-quality evaluation are not yet performed.

## 日本語

自分のCloudflareへ配置するための、テキストチャット専用OSS初版です。既存Sente Cloudの標準機能ではありません。氏名・住所は指定語句、メール・電話・キーは対応形式に限ります。完全検出や完全匿名化は保証しません。原文はCloudflareに届きます。
