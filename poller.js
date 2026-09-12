const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const MB_BASE = 'https://musicbrainz.org/ws/2';
const CAA_BASE = 'https://coverartarchive.org/release';
const HEADERS = {
  'User-Agent': 'DiscordNewReleaseBot/1.0 (contact@example.com)',
  Accept: 'application/json',
};

// MusicBrainz API は 1req/秒 制限あり
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class MusicBrainzPoller {
  constructor(config, onNewRelease) {
    this.config = config;
    this.onNewRelease = onNewRelease;
    this.seenIds = new Set();
    this.initialized = false;
  }

  start() {
    this._poll();
    setInterval(() => this._poll(), this.config.POLL_INTERVAL_MINUTES * 60 * 1000);
  }

  async _poll() {
    console.log('🔍 MusicBrainz をチェック中...');
    try {
      const releases = await this._fetchReleases();
      let newCount = 0;

      for (const release of releases) {
        if (this.seenIds.has(release.id)) continue;
        this.seenIds.add(release.id);

        if (this.initialized) {
          release.coverUrl = await this._fetchCoverUrl(release.id);
          await this.onNewRelease(release);
          newCount++;
          await sleep(1000);
        }
      }

      if (!this.initialized) {
        this.initialized = true;
        console.log(`✅ 初期化完了: 既存 ${this.seenIds.size} 件を記録 (以降の新着を通知します)`);
      } else {
        console.log(`✅ チェック完了: 新着 ${newCount} 件`);
      }
    } catch (err) {
      console.error('❌ ポーリングエラー:', err.message);
    }
  }

  async _fetchReleases() {
    const results = [];

    // アーティスト指定の新譜
    for (const artistId of this.config.ARTIST_MBIDS) {
      await sleep(1100);
      const url = `${MB_BASE}/release?artist=${artistId}&type=album|single|ep&status=official&limit=10&fmt=json`;
      const data = await this._get(url);
      if (!data?.releases) continue;
      for (const r of data.releases) {
        results.push(this._normalize(r, 'artist'));
      }
    }

    // ジャンル指定の新譜（Lucene クエリで検索）
    for (const genre of this.config.GENRES) {
      await sleep(1100);
      const since = this._daysAgo(30);
      const query = `tag:${genre} AND status:official AND date:[${since} TO *]`;
      const url = `${MB_BASE}/release?query=${encodeURIComponent(query)}&limit=10&fmt=json`;
      const data = await this._get(url);
      if (!data?.releases) continue;
      for (const r of data.releases) {
        results.push(this._normalize(r, genre));
      }
    }

    return results;
  }

  _normalize(r, source) {
    const artist =
      r['artist-credit']?.map((ac) => ac?.artist?.name || ac?.name || '').join(' ') || '不明';
    const genres = r.genres?.map((g) => g.name) || [];
    return {
      id: r.id,
      title: r.title,
      artist,
      date: r.date || r['first-release-date'] || '',
      type: r['release-group']?.['primary-type'] || '',
      url: `https://musicbrainz.org/release/${r.id}`,
      genres,
      source,
      coverUrl: null,
    };
  }

  async _fetchCoverUrl(mbid) {
    try {
      await sleep(1100);
      const res = await fetch(`${CAA_BASE}/${mbid}`, { headers: HEADERS });
      if (!res.ok) return null;
      const data = await res.json();
      const front = data.images?.find((img) => img.front);
      return front?.thumbnails?.small || front?.image || null;
    } catch {
      return null;
    }
  }

  async _get(url) {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    return res.json();
  }

  _daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  }
}

module.exports = MusicBrainzPoller;
