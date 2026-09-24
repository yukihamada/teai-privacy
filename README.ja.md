# teai-privacy

**AIへ送る前に、テキストを検査する。** 自分のCloudflare Workersで動かせる、小さな機密情報保護ゲートウェイです。検出エンジンはネットワーク不要のJavaScript。

[English](README.md) · [脅威モデルと限界](SECURITY.md) · [検証記録](RELEASE.md) · MIT

```text
クライアント → 自分のCloudflare Worker → teai等のチャットAPI
                         ├ 対応形式のキーを検出 → 送信停止
                         └ メール・電話・指定語句 → 仮の識別子に置換
```

## 初版でできること

- 対応形式のAPIトークン、秘密鍵のPEMヘッダー、JWT、認証情報の代入、Bearer/Basic認証文字列、認証情報付きURLを検出すると停止。
- 一般的なASCIIメールアドレス、日本国内の電話番号、`+`から始まる国際電話番号、指定した氏名・住所等の完全一致語句を置換。
- システム指示・過去の会話を含む全メッセージを検査。分割されたテキストパーツは結合して検査。
- **テキスト専用 `POST /v1/chat/completions`**、JSON応答・SSEストリーミング対応。
- 未対応フィールド、ツール呼出、画像、音声、ファイル、不正入力、大きすぎる入力は停止。検査エラー時に原文を送信しません。
- 送信ヘッダーは新規作成。クライアントのCookie・転送元IPヘッダー・ゲートウェイトークンは後段へ送らず、別のAPIキーを利用。
- 原文ログ・分析タグ・DB・自動再試行・外部検出API・実行時依存パッケージなし。Workerのobservabilityは既定で無効。

**完全な匿名化ではありません。** 氏名・住所は明示的な語句設定が必要です。難読化・符号化された秘密情報、未対応形式、文脈から特定できる情報は検出できない場合があります。モデルの応答自体は検査せず通します。

## 自分のCloudflareへ配置

1. このリポジトリをFork。Node 22以降で `npm ci && npm run check`。
2. GitHubに `production` environmentを作成（本人承認必須を推奨）。Secretsを設定します。

   | Secret | 内容 |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | 自分のアカウントのWorkers配備権限 |
   | `CLOUDFLARE_ACCOUNT_ID` | アカウントID |
   | `GATEWAY_TOKEN` | 32文字以上のランダムな文字列。信頼するクライアントのみへ |
   | `UPSTREAM_API_KEY` | 後段APIのキー。上記トークンとは別にする |
   | `REDACT_TERMS` | 任意。`["Example Person","Example Street"]` のようなJSON配列 |

3. 必要なら `wrangler.jsonc` の `UPSTREAM_BASE_URL` を変更。既定は `https://api.teai.io/v1`。HTTPS・パス `/v1` 必須。呼出側から変更できません。
4. **Actions → deploy → Run workflow**。テスト後にSecretsを登録し配備します。再配備時のSecrets変更は既存Workerにも反映されるため、変更時刻を考慮してください。
5. `/health` を確認。クライアントのbase URLは `https://teai-privacy.<自分のサブドメイン>.workers.dev/v1`、APIキーは `GATEWAY_TOKEN` に設定。

公開物は**セルフホスト用のOSS**です。共用の推論サービスは提供しません。Cloudflare・モデル利用料は各自のアカウントに発生します。既存Sente Cloudやteaiの全経路に自動適用されるものではありません。

## 端末の外へ出す前にも利用可能

```js
import { protectChat } from './src/core.js';
const { body, counts } = protectChat({
  model: 'your-supported-model',
  messages: [{ role: 'user', content: 'alice@example.com への返信を書いて' }],
}, ['指定する氏名']);
// bodyだけを送信する。原文をログに出さない。
```

Web Crypto対応のブラウザ・Node 22以降・Workersで利用できます。これはライブラリの使用例で、Senteやブラウザへの組み込み済み機能ではありません。npm配布は行わず、タグ付きソースを利用します。

原文はランダムな `[PRIVATE_<乱数>_EMAIL_1]` 等に置換。同じリクエスト内では同じ値が同じ識別子になります。**回答で元に戻しません。** 対応表の永続保存もありません。`x-teai-privacy-replacements` は異なる置換値の個数で、検出率ではありません。

## 互換性・上限

- JSON 256 KiB、128メッセージ、1メッセージ64テキストパーツ・4,096検出、指定語句100個（各2〜256文字）。
- NFKC正規化で全角等の文字が変わります。不可視・双方向制御文字は拒否。コードや多言語の意味に影響する場合があります。
- 対応フィールド：`model`、`messages`、`stream`、`stream_options.include_usage`、`temperature`、`top_p`、`max_tokens`、`max_completion_tokens`、`stop`、`seed`、`presence_penalty`、`frequency_penalty`。
- ツール・添付・`response_format`・`user`・モデル一覧・Responses APIは未対応。これらを必要とする汎用エージェントクライアントでは使えません。
- 誤検出でも停止。検査を迂回するヘッダーはありません。電話に似た注文番号が置換される場合があります。
- 入力受信10秒、後段処理はストリーム全体を含め120秒まで。転送先リダイレクト・自動再試行なし。後段エラー本文は返しません。
- 同じ信頼範囲で使うゲートウェイで、複数組織の認証・課金分離はありません。共有前に後段の支出上限・Cloudflareのレート制限を設定。CORSなし。公開Webサイトにトークンを埋め込まないでください。

**Cloudflare上で検査する場合、原文はCloudflareとそのWorker運営者の信頼範囲に届きます。** 端末外に原文を出したくない場合は、コアを端末で実行する必要があります。文脈による再識別や検出漏れがあるため、匿名化の法的保証・完全秘匿を意味しません。

検証：`npm ci && npm run check && npm audit`。合成データ・疑似APIだけを使い、有料モデルには接続しません。詳しくは[脅威モデル](SECURITY.md)と[検証記録](RELEASE.md)。
