# Runnable examples / 実行例

Run from the repository root with Node 22+. Runtime packages, credentials and internet access are not needed for these two **offline** examples:

リポジトリのルートからNode 22以降で実行。次の**オフライン例**はパッケージ・認証情報・インターネット不要です。

```sh
node bin/teai-privacy.js inspect < examples/request.json
node examples/inspect.mjs
```

The CLI prints a sanitized request. The module example prints `{ body, counts }`; expect `email: 1`, `phone: 0`, `term: 0`. Nonces differ per invocation. All inputs are synthetic; `fixture-model` is not a real inference model. Examples are included on the current `main` branch; the earlier v0.2.0 source archive predates this documentation update.

CLIは置換後のリクエスト、モジュール例は `{ body, counts }` を出します。期待件数は `email: 1`・`phone: 0`・`term: 0`。乱数は毎回変わります。入力は架空、`fixture-model` は実モデルではありません。例は現在のmainに含まれ、先に公開したv0.2.0アーカイブには含まれません。

## Real API / 実APIへ送る場合

Create your own text-only request JSON with a model supported by your backend. Set `PRIVACY_BASE_URL` and `PRIVACY_API_KEY` through your environment; optional `PRIVACY_TERMS` is an array of exact strings in JSON. Then run:

後段で利用可能なモデルを指定したテキスト専用JSONを用意し、環境変数で接続先とキーを設定。任意の `PRIVACY_TERMS` は完全一致語句のJSON配列です。

```sh
node bin/teai-privacy.js send < your-request.json
```

This sends to the configured API and may incur charges. Do not use real customer prompts for a first connectivity check. `send` returns raw JSON/SSE without restoration. For library setup, abort/stream handling and errors, see [English client guide](../docs/client.md) / [日本語クライアントガイド](../docs/client.ja.md).

これは実APIへ送信し、料金が発生する場合があります。最初の疎通確認に実際のお客様の原文を使わないでください。`send` は復元せずJSON/SSEをそのまま返します。
