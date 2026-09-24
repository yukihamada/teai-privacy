# クライアントガイド

[English](client.md) · [README](../README.ja.md)

## API

`src/client.js` から `createPrivacyClient` をimportします。npm配布ではなくソースを取得して使用します。生成時に通信は発生せず、`inspect` と `complete` を持つ変更不能なオブジェクトを返します。

| オプション | 意味 |
|---|---|
| `baseURL` | 必須。HTTPSで末尾 `/v1`（末尾スラッシュ可）。query・fragment・埋込認証情報は禁止。 |
| `apiKey` | 必須。空白なしの表示可能ASCII、空不可、2,048文字以下。Worker接続では専用ゲートウェイトークン（32〜1,024文字）。 |
| `terms` | 任意の文字列配列。生成時にコピー。100個以下、各2〜256文字。NFKC後の完全一致で大文字小文字を区別。 |
| `timeoutMs` | 整数1〜120,000、既定120,000。fetch開始からストリーム完了まで。同期のローカル検査はタイマー開始前。 |
| `allowLoopbackHTTP` | 既定false。ローカルテスト専用で `localhost`・`127.0.0.1`・`[::1]` のHTTPを許可。 |
| `fetch` | 任意の信頼できる通信実装。既定 `globalThis.fetch`。テストでは送信内容の照合に使用。 |

### `inspect(input)`

同期処理。入力を複製・検査し `{ body, counts }` を返します。通信なし。`counts` は `{ email, phone, term }` で、今回置換した異なる値の数です。キー検出・不正/未対応入力では例外。出力には未検出の個人情報が残る場合があります。

### `await complete(input, { signal }?)`

改めて端末で検査・シリアライズし1回だけ送信します。応答ヘッダー到着後に `{ response, counts }` を返します。`response` はWeb `Response` で `.json()`・`.text()`・`.body` が使えます。通信・ストリームの期限切れや中断は汎用コードで通知します。中断しても送信済みの内容は取り戻せず、後段の課金停止も保証しません。

明示的に作る送信ヘッダーは `content-type` と `authorization` の2つ。ブラウザ/実行環境が通信ヘッダーやメタデータを追加する場合があります。Cookie/Refererは除外、リダイレクトはエラー。信頼できない独自fetchを渡さないでください。

### ストリーム・中断

READMEの `client`・`input` を用意して使います。これは**生SSEの読み取り**で、モデルのトークン抽出処理ではありません。

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
    // 途中の行を次のchunkへ持ち越せるSSE parserに渡す。
  }
  const finalFragment = decoder.decode();
} finally {
  await reader.cancel();
  reader.releaseLock();
}
// UIから進行中の通信を止める場合：controller.abort()
```

chunk境界とJSON・UTF-8文字・SSEイベントの境界は一致しません。期限切れ・切断では途中終了する場合があります。ヘッダーだけ使う場合も最後まで読むかcancelしてください。識別子復元・永続保存・自動再試行はありません。

## ブラウザへの組み込み

標準Web APIを使います。信頼できるアプリのoriginから `src/client.js` と相対依存の `src/core.js` を配信するかbundleし、module scriptでimportしてください。Web Cryptoにはsecure contextが必要で、開発時はlocalhostを使えます。

接続先は同一originまたは明示的にCORSを許可したものが必要です。同梱Workerはフロントエンドを配信せず、別originのpreflightも実装していません。preflight失敗への対処として共用後段キーを公開ソースへ埋め込まないでください。アプリ側の信頼できる認証・配信構成で利用します。このクライアントはCookie認証ではなく渡されたBearer tokenを使います。

設定した接続先に認証tokenが送られます。後段APIへの直接接続と自分のWorker経由では信頼先が異なります。端末内検査でも拡張・Service Worker・XSS・同じページの別コードによる原文読取までは防げません。

## CLI

```sh
node bin/teai-privacy.js --help
node bin/teai-privacy.js inspect --lang=ja < examples/request.json
node bin/teai-privacy.js send --lang=ja < your-request.json
```

| 環境変数 | 用途 |
|---|---|
| `PRIVACY_BASE_URL` | send用の `/v1` 接続先 |
| `PRIVACY_API_KEY` | send用の接続先認証情報 |
| `PRIVACY_TERMS` | 両モード共通。任意のJSON配列、既定 `[]` |

`--lang=ja` はCLIエラーの接頭辞を日本語にするもので、API応答の言語設定ではありません。成功exit0。検査/通信失敗exit1、stderrへ汎用コード。ストリームは**標準出力が一部出た後に失敗する場合**があるため、終了コードを確認してください。stdinは256 KiB上限、収集期限は別途設けていません。CLIのsendはHTTPS必須で、ローカルHTTP用のCLIフラグはありません。

コアだけ使う場合は `src/core.js` の `protectChat(input, terms)` が接続先なしで `{ body, counts }` を返します。通信は行わず、クライアントの置換後サイズ検査も適用しません。

## エラーと対処

| コード / 症状 | 意味と対処 |
|---|---|
| `secret_detected` | 対応形式のキー等を検出。手元で除去。原文を未保護の接続先へ再送しない。 |
| `text_only` / `unsupported_field` / `unsupported_role` | 未対応メディア・ツール・ロール・フィールド。テキスト専用schemaへ。 |
| `unsupported_invisible_character` | 不可視・制御・双方向文字。元テキストを手元で確認。 |
| `invalid_json` / `invalid_client_input` | 正しいUTF-8 JSON/プレーンデータが必要。関数・循環参照は不可。 |
| `body_too_large` / `too_many_matches` | 入力サイズ・1メッセージ内の検出密度を減らす。 |
| `sanitized_body_too_large` | 識別子への置換で256 KiB超過。入力・履歴を減らす。 |
| `invalid_privacy_config` | 上限内の文字列JSON配列が必要。語句自体の秘密情報/制御文字検出も行う。 |
| `sensitive_routing_metadata` | model名に置換対象が含まれる。正しい非機密モデルIDを使用。 |
| `invalid_client_config` | URL・キー形式・期限を確認。ローカルテスト指定時以外HTTPS `/v1` 必須。 |
| `client_timeout` / `client_aborted` | 期限切れ/中断。通信遅延全体が検査処理の時間とは限らない。 |
| `client_network_error` | 通信・リダイレクト・CORS失敗。原文や鍵をログへ出さず通信状態を確認。 |
| `client_upstream_rejected` | non-2xx・bodyなし・content-type不一致。接続先/キー/モデル/残高を後段の管理画面等で確認。元のエラー本文は公開しない。 |
| Worker 401 `unauthorized` | ゲートウェイトークンの不足/不一致。後段APIキーとは別。 |
| Worker 503 `gateway_not_configured` | 異なるゲートウェイ/後段キーを設定。ゲートウェイトークン32〜1,024文字。 |
| Worker `upstream_rejected` / `upstream_unavailable` | 後段エラー・redirect・応答形式不一致・通信失敗。後段の詳細本文は隠す。 |
| 端末で置換済みなのにWorker件数0 | Workerで追加置換がなければ正常。各層の件数は別。 |
| `/health` 成功、生成は失敗 | healthはWorker確認のみ。有料推論は試さない。 |

不具合報告は合成データで再現してください。[非公開の脆弱性報告](https://github.com/yukihamada/teai-privacy/security/advisories/new)、一般変更は[貢献方法](../CONTRIBUTING.md)。
