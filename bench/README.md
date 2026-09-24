# Reproducible local benchmarks / ローカルベンチ

2026-09-24, Apple M5 Max, macOS arm64, Node v25.8.2. Synthetic data only. No paid model, WAN or production Cloudflare measurement. Results vary by runtime/hardware; these are not model-latency or detection-accuracy claims.

## Method

- Baseline: published v0.1.0 commit `e1cf63c9bdc6ab39787066bac1758deaf577c672`, loaded from git without editing it.
- Fixed corpus SHA-256 `886465545cd2156174db4cf0581f91728cffed1a0347fec7c607fa76c3faeaa8`.
- 30 warmups, then six alternating-order rounds × 30 samples = 180 samples per implementation/case. Same process. Includes guard and canonical output serialization; random placeholder nonces normalized for equivalence.
- Both success payload/counts and rejection codes must match. Additional seeded test compares old/new email spans on 2,515 cases (including terminal-newline boundaries). Synthetic equivalence is not proof of complete PII detection.
- `before.json` is an A/A run of identical code before optimization. `after.json` compares frozen baseline against the final optimized source. Both contain all raw samples, hashes and environment.
- Optimization: scan `@` positions, bounded 64-character local parts and sticky domain matching. Retains old regex bounds and non-overlap behavior. All secret patterns remain unchanged.

| Fixture | Old p50 ms | New p50 ms | Old p95 ms | New p95 ms | p50 ratio |
|---|---:|---:|---:|---:|---:|
| Plain 2 KB | 0.0313 | 0.0162 | 0.0474 | 0.0247 | 1.93× |
| Plain 32 KB | 0.4390 | 0.1880 | 0.5029 | 0.2258 | 2.34× |
| Plain 128 KB | 1.8497 | 0.8068 | 2.0189 | 0.9751 | 2.29× |
| Plain 240 KB | 3.3766 | 1.5032 | 3.6137 | 1.7364 | 2.25× |
| Repeated letters 250 KB | 31.3201 | 1.5224 | 33.5575 | 1.6635 | 20.57× |
| Near-email 240 KB | 26.6032 | 1.8506 | 31.6786 | 2.3803 | 14.38× |
| Mixed Japanese (80,143 JSON bytes) | 0.4229 | 0.2968 | 0.5714 | 0.3425 | 1.42× |
| Dense PII 32 KB | 0.8336 | 0.7662 | 1.3208 | 0.9020 | 1.09× |
| 100 terms / 32 KB | 1.6029 | 1.3674 | 1.8734 | 1.6870 | 1.17× |
| Secret at end / 128 KB | 0.2570 | 0.2634 | 0.3969 | 0.5130 | 0.98× |

The legacy fixture name `mixed-ja-96k` is an identifier; use recorded `json_bytes` for actual size. Dense-PII results have much smaller gains. Rejection at the end was ~2.5% slower at p50 (p95 also regressed); do not call this an across-the-board speedup. No statistical confidence interval is claimed. Intermediate scanner variants were measured during development; the published table is the final source-hash-matched run, not the best sample selected across runs.

## Client end-to-end

`client-results.json`: real loopback HTTP receiver asserts original email absent. Direct control starts with an already-sanitized, pre-serialized payload; the client performs local protection, serialization and response wrapping. Twenty warmup pairs, 120 alternating measured pairs per size, consume full JSON response. Difference of medians is not a per-request paired latency estimate.

| JSON bytes | Direct p50 ms | Client p50 ms | Difference of p50 ms |
|---|---:|---:|---:|
| 2,127 | 0.1699 | 0.2144 | 0.0445 |
| 32,847 | 0.1475 | 0.3830 | 0.2355 |
| 131,151 | 0.2596 | 1.1563 | 0.8968 |

Rejected secret request: **zero network calls**. Real Chrome additionally verifies email/name/phone removal, cookies/referrer omission, JSON/SSE and blocking. These are functional checks, not a browser performance benchmark.

## Reproduce

```sh
npm ci
npm run check
npm run test:browser
# Full git history (or fetch the baseline commit) is needed for old/new comparison.
node bench/run.mjs /path/to/new-core-results.json
node bench/client.mjs /path/to/new-client-results.json
```

Keep release evidence files unchanged; choose a new output path for a new run.

## 日本語

固定合成コーパスを旧版/新版で交互測定し、生データ・ソースSHA・検出結果一致を保存しました。25万文字の特殊入力で約20.6倍、通常32KBで約2.3倍。全処理の改善率ではなくメール検出の改善で、モデル推論時間は含みません。PII密集は約1.09倍、末尾キー停止は約2.5%遅い結果でした。開発中の中間測定ではなく最終コードの測定を掲載しています。

クライアントは実ローカルHTTPで32KBの中央値差約0.236ms。実ブラウザでも原文の対象値/Cookie/Referer非送信と秘密情報の通信前停止を確認。Cloudflare本番・実モデルの回答品質・実データ検出率は未測定です。
