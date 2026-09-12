# 🎵 Discord 新譜アナウンス Bot

MusicBrainz を定期的にチェックし、指定したアーティストやジャンルの新譜を Discord チャンネルに自動投稿するBotです。

## セットアップ手順

### 1. Discord Bot を作成する

1. [Discord Developer Portal](https://discord.com/developers/applications) にアクセス
2. 「New Application」→ アプリ名を入力
3. 左メニュー「Bot」→ 「Add Bot」
4. 「Token」をコピーしておく（後で使用）
5. 「MESSAGE CONTENT INTENT」を ON にする
6. 左メニュー「OAuth2 → URL Generator」で以下を選択：
   - Scopes: `bot`
   - Bot Permissions: `Send Messages`, `Embed Links`
7. 生成された URL でBotをサーバーに招待

### 2. 依存パッケージをインストール

```bash
npm install
```

### 3. 環境変数を設定

```bash
cp .env.example .env
```

`.env` を開いて以下を設定：

| 変数名 | 説明 |
|--------|------|
| `DISCORD_TOKEN` | Discord Bot のトークン |
| `ANNOUNCE_CHANNEL_ID` | 投稿先チャンネルの ID（チャンネルを右クリック→「IDをコピー」） |
| `ARTIST_MBIDS` | アーティストの MBID（カンマ区切り） |
| `GENRES` | ジャンルタグ（カンマ区切り） |
| `POLL_INTERVAL_MINUTES` | チェック間隔（分、デフォルト: 60） |

### 4. アーティスト MBID の調べ方

1. [MusicBrainz](https://musicbrainz.org) でアーティストを検索
2. アーティストページの URL を確認：  
   `https://musicbrainz.org/artist/a74b1b7f-71a5-4011-9441-d0b5e4122711`
3. 末尾の UUID が MBID

### 5. 起動

```bash
npm start
```

## 動作の仕組み

1. 起動時に既存リリースを取得して「既知」として記録（起動時は通知しない）
2. 設定間隔ごとに MusicBrainz をポーリング
3. 新しいリリースが見つかったら即座に Discord に投稿
4. カバーアートがあれば自動でサムネイル表示

## 注意事項

- MusicBrainz API は **1リクエスト/秒** の制限があります（自動でスリープを入れています）
- ジャンル検索は MusicBrainz のタグシステムを使用します
- MusicBrainz のデータ更新頻度の都合上、**60分間隔**推奨です

## サーバー常時稼働

VPS や Railway / Render などのホスティングサービスに deploy することで常時稼働できます。

```bash
# Railway の場合
railway up

# PM2 で常駐させる場合
npm install -g pm2
pm2 start index.js --name musicbot
pm2 save
```
