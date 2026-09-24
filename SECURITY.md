# Security / セキュリティ

## Trust boundary

The aim is to reduce **accidental text disclosure** to an inference backend. This is not encryption, formal anonymization, a comprehensive DLP system, or a defense against a malicious sender deliberately encoding a secret.

Cloudflare terminates TLS and executes your Worker. Its infrastructure and the Worker account owner are trusted with the original body. An operator can modify code, enable logging, or deploy a different build. Publishing source does not attest that a hosted service runs it. Use your own account and review deployment hashes.

The upstream sees the sanitized prompt, routing model, timing and the configured upstream key/account. Context, retained relationships and unrecognized identifiers may still identify a person. The client and upstream can keep their own logs. Cloudflare platform/network metadata is outside this program's no-content-logging implementation.

## Deliberate v0.1 boundaries

- Regex-based, synthetic-tested detection, not a guarantee of recall or precision on real data.
- No automatic name/address recognition. Explicit terms are exact, case-sensitive matches after NFKC. ASCII email patterns; phone coverage is intentionally limited. No guaranteed postal, financial, medical or government-ID detection.
- Does not decode base64, URL-encoded strings, nested string-encoded JSON or custom encodings. JSON transport escapes are decoded. Text parts in one message are combined; secrets split across separate messages, extra whitespace, homoglyphs or unusual punctuation may escape.
- Historical assistant messages are inspected as input. Actual tool calls/results, schemas, media and attachments are rejected, not scanned. Opaque client-side strings can still contain encoded data the guard does not understand.
- A password/token label can cause a false positive. NFKC and conservative control-character rejection change accepted text. Phone-like non-phone identifiers can be masked.
- No output filtering, restoration or persistent correspondence map. Responses may contain new sensitive information generated/inferred by the model. No claim about answering quality; no real-model quality benchmark has been run.
- Only requests deliberately routed through this endpoint are covered. Direct backend calls, browser telemetry, MCP, other hosts and existing teai/Sente traffic are not intercepted.
- Single shared gateway credential. No per-user isolation, rate limiter or financial cap in this code. Use platform/backend controls. A holder of the gateway token can consume your upstream balance.
- Valid responses stream unchanged. A disconnect or 120-second deadline can truncate JSON/SSE. Errors are generic; no automatic recovery/retry.

## Implemented protections

Request authentication before reading the body; actual streamed byte cap; fixed route and operator-only destination; JSON/schema allowlist; restricted numeric controls; matched-span bound; no raw-content exceptions; fresh outbound headers; redirects disabled; generic upstream errors; response-header allowlist; cancellation propagation; nonpersistent request-local placeholders; disabled Worker observability; no analytics or prompt logging in source.

## Reporting

Use GitHub private vulnerability reporting on this repository. If unavailable, email `mail@yukihamada.jp` with a synthetic reproduction. Do not send real credentials, personal data or private prompts. No independent security audit or bug bounty is claimed.

## 日本語要約

目的はAIへの**うっかり送信を減らすこと**です。暗号化・完全匿名化・網羅的DLPではありません。原文を扱うCloudflareとWorker運営者を信頼する必要があります。OSS公開だけでは稼働コードを証明しません。

氏名・住所は明示指定、メール・電話は限定形式です。base64等の符号化、メッセージを跨いだ分割、類似文字、文脈からの再識別、モデルが生成する個人情報は防げない場合があります。置換による回答品質の変化は実モデルで未検証。個人データの法的な匿名加工を保証しません。

共有トークンを持つ人は後段の残高を使えます。複数人の課金分離・レート制限は内蔵しません。実データ・本物の鍵を公開Issueへ貼らないでください。第三者のセキュリティ監査は未実施です。
