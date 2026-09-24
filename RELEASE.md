# v0.2.0 — local client and measured scanner optimization (preview)

Release date: 2026-09-24. License: MIT.

- Added Node/browser `createPrivacyClient` (`inspect` / `complete`) and stdin CLI. Local inspection before fetch; JSON/SSE, abort/deadline, no cookies/referrer, no raw upstream error leakage.
- Improved email scanning without changing secret patterns. Old/new outputs agree on fixed benchmark corpus and 2,515 seeded/boundary email cases.
- Local functional validation: 52 unit/adversarial tests, 2 real workerd tests, 1 real Chrome test; Worker bundle and dependency audit. GitHub verification runs on the release source before tagging.
- Benchmark: 32 KB plain text p50 0.439 → 0.188 ms; pathological 250 KB letters 31.320 → 1.522 ms. One M5 Max / Node 25.8.2 run, 180 samples per variant/case. Dense-PII ~1.09× and secret-at-end ~2.5% slower. Raw results and limitations in [bench/README.md](bench/README.md).
- Real local HTTP: 32 KB client addition ~0.236 ms (difference of medians); rejected synthetic key causes zero calls. Not WAN/model latency. No paid inference or production deployment in this release.
- Still text-only, no tool calls, attachments, restoration or automatic Sente integration. Browser callers need same-origin/CORS access. Do not embed shared credentials in public sites.

日本語：端末内で検査してから送るクライアント/CLIを追加。合成ベンチで通常32KB約2.3倍、特殊な連続英字250KB約20.6倍に高速化。全データ/環境に一律の改善ではありません。原文の検出済み情報は端末外へ送らず、未検出情報は残りえます。旧版同様プレビュー、完全匿名化保証なし。

---

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
