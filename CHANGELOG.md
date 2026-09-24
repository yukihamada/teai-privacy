# Changelog / 変更履歴

## Documentation on main — 2026-09-24

- Reorganized English/Japanese onboarding around offline inspection, local clients and optional Worker deployment.
- Added bundled synthetic input, runnable offline example, client reference and troubleshooting.
- Clarified original-text trust boundaries, two-layer counts, runtime versus dev dependencies and browser requirements.
- Runtime/version unchanged. This documentation update is newer than the immutable v0.2.0 source archive; clone current main for the new examples.

日英導入手順・同梱例・API/エラーガイドを整備。実行時コード/バージョンは変更なし。新しい例はmainに含まれ、v0.2.0アーカイブとは異なります。

## [0.2.0](https://github.com/yukihamada/teai-privacy/releases/tag/v0.2.0) — 2026-09-24 · preview

- Local Node/browser client and stdin CLI, JSON/SSE, abort/deadline, pre-send inspection.
- Optimized email scanner; equivalent spans on the 2,515-case regression corpus.
- Published fixed-corpus benchmarks and raw samples. 55 functional tests at release.

端末内検査クライアント・CLI、メール検出高速化、固定条件の生ベンチ公開。公開時55テスト成功。

## [0.1.0](https://github.com/yukihamada/teai-privacy/releases/tag/v0.1.0) — 2026-09-24 · preview

- MIT text-only Worker gateway and network-free protection core.
- Recognized-secret blocking, email/phone/term replacement, fail-closed unsupported inputs.
- Synthetic tests and local workerd verification; 43 functional tests at release.

テキスト専用Worker/コアをMIT公開。対応形式キー停止・メール/電話/語句置換。公開時43テスト成功。
