# teai-privacy

**AIに渡す個人情報を減らす。端末内、または自分のCloudflareで送信前に検査。**

[![Verify](https://github.com/yukihamada/teai-privacy/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/yukihamada/teai-privacy/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**[English](README.md)** · [v0.2.0 プレビュー](https://github.com/yukihamada/teai-privacy/releases/tag/v0.2.0) · [ベンチマーク](bench/README.md) · [セキュリティ](SECURITY.md)

依存パッケージ不要のJavaScript検出コア、Node/ブラウザ用クライアント、標準入力CLI、セルフホスト用Workerを提供します。対応形式のキーは**検出時に送信停止**。メール・電話・指定語句は**仮の識別子へ置換**します。

**現在の状態：** テキスト専用プレビュー。npm配布・共用推論サービス・Senteへの自動組み込みはありません。形式ベースの検出で、完全匿名化ではありません。氏名・住所は指定が必要です。モデル応答の検査・原文への復元は行いません。

## どこで保護するか

```text
端末クライアント / CLI → [任意：自分のCloudflare Worker] → チャットAPI
  端末を出る前に検査         後段APIへ送る前に再検査
```

| 使い方 | 原文を検査する場所 | 必要なもの |
|---|---|---|
| ローカル検査 | 自分の端末。通信なし | Node 22以降 |
| クライアント / CLI送信 | 端末内。fetch前に検査 | Node 22以降または対応ブラウザ、API接続先 |
| Workerのみ | Cloudflareに原文が届く | 自分のCloudflareアカウントと後段キー |
| クライアント＋Worker | 端末で検査後、Workerで再検査 | 上記の両方 |

止めたり置換したりできるのは**検出した情報**です。未検出の識別情報や個人を特定できる文脈は端末外へ出る場合があります。[信頼範囲・限界](SECURITY.md)を確認してください。

## まず試す — 鍵不要・API呼出なし

```sh
git clone https://github.com/yukihamada/teai-privacy.git
cd teai-privacy
node --version  # 22以降
node bin/teai-privacy.js inspect --lang=ja < examples/request.json
```

コア・クライアント・CLIだけなら `npm install` は不要です。同梱JSONは架空の連絡先と、オフライン例専用の `fixture-model` を使っています。出力例：

```json
{"model":"fixture-model","messages":[{"role":"user","content":"Draft a reply to [PRIVATE_<random>_EMAIL_1]."}],"max_tokens":200}
```

`<random>` は説明用表記で、実際の乱数は毎回変わります。元のメールは消え、リクエストのJSON形式は維持されます。このコマンドの**通信は0回**。検査後本文を標準出力へ出すので、デモ記録には合成データを使ってください。

## Node / ブラウザから使う

取得したソースからimportします（npmパッケージ名でのインストールではありません）。

```js
import { createPrivacyClient } from './src/client.js';

const client = createPrivacyClient({
  baseURL: 'https://your-gateway.example/v1',
  apiKey: gatewayToken, // 実行時に渡す
  terms: ['Example Person'],
});
const input = {
  model: 'your-supported-model',
  messages: [{ role: 'user', content: 'Reply to alice@example.com' }],
};
const preview = client.inspect(input); // 通信なし：{ body, counts }
const { response, counts } = await client.complete(input); // 再検査してから送信
const answer = await response.json();
```

URL・実行時のキー・モデル名を自分の環境へ置き換えます。`preview` を編集しても `complete(input)` の送信内容は変わりません。再検査するため、識別子の乱数は両者で異なる場合があります。検査失敗時はfetch前に `PrivacyError` を投げ、`code` で理由を取得できます。[API・ストリーミング・ブラウザ設定 →](docs/client.ja.md)

接続先はWorkerまたは互換HTTPS `/v1` APIです。Worker経由なら `apiKey` は**ゲートウェイトークン**、直接接続なら**後段APIキー**。認証用のキーは意図的にヘッダーで送信し、本文に紛れたキーの検査とは区別します。

**ブラウザ：** 自分のアプリからモジュールを配信し、secure contextと同一オリジン、または適切なCORS対応APIを使います。同梱Workerは別オリジン向けCORSやブラウザUIを提供しません。公開アセットへ共用キーを埋め込まないでください。

### CLIで送信

`PRIVACY_BASE_URL`・`PRIVACY_API_KEY`・任意の `PRIVACY_TERMS`（文字列のJSON配列）を環境変数で設定し、JSONのモデル名を利用可能なものにして実行します。

```sh
node bin/teai-privacy.js send --lang=ja < your-request.json
```

`send` は後段APIの料金が発生する場合があります。出力はJSONまたは生SSE。`inspect` はローカルで置換後本文を出力するだけで、キー不要です。原文や鍵をコマンド引数・履歴へ残さないでください。[そのまま実行できる例 →](examples/README.md)

## 自分のCloudflareへ配置

1. リポジトリをForkし、Fork先のGitHub Actionsを有効にします。Node 22以降で `npm ci && npm run check` を実行。
2. GitHubのActions secrets（リポジトリ、または `production` environment）に以下を設定。ゲートウェイトークンは **32〜1,024文字**、後段キーと異なる専用の値を使います。

   | Secret | 用途 |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | 自分のアカウントのWorkers配備権限 |
   | `CLOUDFLARE_ACCOUNT_ID` | 配備先アカウントID |
   | `GATEWAY_TOKEN` | 信頼するクライアントに渡す認証情報 |
   | `UPSTREAM_API_KEY` | Workerから後段APIへ送るキー |
   | `REDACT_TERMS` | 任意。例：`["Example Person","Example Street"]` |

3. `wrangler.jsonc` を確認。Worker名 `teai-privacy` が既に使われているなら変更。`UPSTREAM_BASE_URL` の既定は `https://api.teai.io/v1`。HTTPS・パス `/v1` 必須です。
4. **Actions → deploy → Run workflow**。テスト、Worker Secrets設定、配備の順に実行します。再配備時はコードより先に稼働中のSecretsが変わる場合があります。設定した `production` environmentの承認ルールも適用されます。
5. 配備ログの実際のURLで確認します。

   ```sh
   curl --fail https://teai-privacy.YOUR-SUBDOMAIN.workers.dev/health
   ```

   期待値：`{"ok":true,"version":"0.2.0","scope":"text-chat-only"}`。Workerの稼働確認であり、後段キー・残高・モデルの利用可否は確認しません。クライアントのbase URLはこのorigin＋`/v1`、キーは `GATEWAY_TOKEN` にします。

配備は任意で、Cloudflare・後段APIの料金は各自のアカウントに発生します。ソース公開版はローカルworkerdとCIで検証済みですが、実お客様のアカウントへの配備は公開時の検証に含みません。

## 保護対象

| 入力 | 処理 |
|---|---|
| 対応形式のAPIトークン、秘密鍵PEMヘッダー、JWT、認証情報の代入、Bearer/Basic文字列、認証情報付きURL | リクエスト停止 |
| 一般的なASCIIメール、日本国内電話、`+`付き国際電話の対応形式 | 検出した範囲を置換 |
| 指定した氏名・住所など | NFKC正規化後の完全一致・大文字小文字区別で置換 |
| system/developer/user/assistantの本文・履歴 | 全メッセージ検査。テキストパーツは結合して検査 |
| 画像・音声・ファイル・ツール呼出・未知フィールド | 拒否 |
| AI応答 | そのまま返す。検査・識別子の復元なし |

同じ値は**同一リクエスト内**で同じ識別子になります。対応表はリクエスト間で保持しません。件数は異なる置換値の数で、検出率ではありません。2段階検査の場合、Workerの `x-teai-privacy-replacements` は**Worker自身が置換した数だけ**で、端末での置換を含みません。

### 対応プロトコル・上限

- `POST /v1/chat/completions` のみ。JSON応答・SSE対応。`/v1/models`・`/v1/responses`・`/v1/messages`・ツール・toolロール・`user` metadata・`response_format` は未対応。
- JSON入力256 KiB以下、128メッセージ以下、1メッセージ64パーツ・4,096検出以下、指定語句100個以下（各2〜256文字）。クライアント `complete` は置換によるサイズ超過も送信前に拒否します。
- 対応フィールド：`model`・`messages`・`stream`・`stream_options.include_usage`・`temperature`・`top_p`・`max_tokens`・`max_completion_tokens`・`stop`・`seed`・`presence_penalty`・`frequency_penalty`。
- NFKCによりコードや文字が変わる場合があります。不可視・双方向制御文字は拒否。電話風の注文番号や認証情報の説明文で誤検出する場合があります。迂回ヘッダーなし。
- Worker入力受信10秒、Worker後段処理とクライアント通信はストリーム込み120秒。リダイレクト・再試行なし。応答は最後まで読むかcancelしてください。CLIの標準入力収集には別の期限を設けていません。
- 共用ゲートウェイ1つの信頼範囲。利用者別課金・レート/支出上限は内蔵せず、基盤や後段で管理します。

未対応フィールドやエンドポイントが必要なエージェントSDKは停止します。全エージェントへそのまま差し替えられる製品ではありません。[エラーと対処 →](docs/client.ja.md#エラーと対処)

## 速度・検証結果

M5 Max・Node 25.8.2、固定合成入力、旧新各180回。中央値は検査とベンチ用出力シリアライズを含み、推論・WANは含みません。

| 入力 | v0.1.0 | v0.2.0 | 比率 |
|---|---:|---:|---:|
| 通常32KB | 0.439 ms | 0.188 ms | 2.34倍 |
| 通常128KB | 1.850 ms | 0.807 ms | 2.29倍 |
| 連続英字250KB | 31.320 ms | 1.522 ms | 20.57倍 |

PII密集は1.09倍、末尾キー停止は中央値で約2.5%遅い結果です。実ローカルHTTPの32KBクライアント追加時間は**中央値差0.236ms**。一般的な遅延保証ではありません。[全ケース・p95・生データ・再現手順 →](bench/README.md)

v0.2.0検証：**52 unit/adversarial＋2 workerd＋1実Chrome**、検出同等性テスト内に2,515メール境界ケース。実socket/ブラウザで対象連絡先の非送信、Cookie/Referer除外、キーの通信前停止を確認。有料モデルでの検出率・回答品質評価、第三者監査は未実施です。[検証記録](RELEASE.md)

## 開発・貢献

```sh
npm ci
npm run check         # 単体/境界、Worker bundle、ローカルworkerd
npm run test:browser  # インストール済みChrome。CHROME_PATHで変更可
npm audit
```

ブラウザテスト既定：macOS `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`、Linux `/usr/bin/google-chrome`。別の場所・OSでは実行ファイルの `CHROME_PATH` を指定。`npm ci` はChromeをダウンロードしません。実行時コードの依存パッケージは0、開発ツールには依存があります。

[貢献方法](CONTRIBUTING.md) · [変更履歴](CHANGELOG.md) · [脆弱性の非公開報告](https://github.com/yukihamada/teai-privacy/security/advisories/new) · [MITライセンス](LICENSE)
