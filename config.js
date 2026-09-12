/**
 * Bot 設定ファイル
 * 環境変数 (.env) から読み込みます
 */

function requireEnv(key) {
  const val = process.env[key];
  if (!val) throw new Error(`環境変数 ${key} が設定されていません`);
  return val;
}

function parseList(val) {
  if (!val) return [];
  return val
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

module.exports = {
  // Discord の投稿先チャンネルID
  ANNOUNCE_CHANNEL_ID: requireEnv('ANNOUNCE_CHANNEL_ID'),

  // 追跡するアーティストの MusicBrainz MBID（カンマ区切り）
  // 例: "65f4f0c5-ef9e-490c-aee3-909e7ae6b2ab,..."
  ARTIST_MBIDS: parseList(process.env.ARTIST_MBIDS),

  // 追跡するジャンルタグ（カンマ区切り・MusicBrainz タグ名と一致させる）
  // 例: "j-pop,city pop,jazz"
  GENRES: parseList(process.env.GENRES),

  // ポーリング間隔（分）。MusicBrainz の更新頻度は低いので30〜60分推奨
  POLL_INTERVAL_MINUTES: parseInt(process.env.POLL_INTERVAL_MINUTES || '60', 10),
};
