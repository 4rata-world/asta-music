const COUNTRY = process.env.ITUNES_COUNTRY || 'JP';
const BASE = 'https://itunes.apple.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function searchArtists(term, limit = 10) {
  const data = await getJson(
    `${BASE}/search?term=${encodeURIComponent(term)}&entity=musicArtist&country=${COUNTRY}&limit=${limit}`
  );
  return (data.results || [])
    .filter((r) => r.artistId)
    .map((r) => ({ id: String(r.artistId), name: r.artistName, genre: r.primaryGenreName || '' }));
}

async function lookupArtist(id) {
  const data = await getJson(`${BASE}/lookup?id=${encodeURIComponent(id)}&country=${COUNTRY}`);
  const r = data.results?.[0];
  if (!r || r.wrapperType !== 'artist') return null;
  return { id: String(r.artistId), name: r.artistName, genre: r.primaryGenreName || '' };
}

function normalize(r) {
  const name = r.collectionName || '';
  let type = 'Album';
  if (/ - Single$/i.test(name)) type = 'Single';
  else if (/ - EP$/i.test(name)) type = 'EP';
  return {
    id: String(r.collectionId),
    title: name.replace(/ - (Single|EP)$/i, ''),
    artist: r.artistName,
    date: (r.releaseDate || '').slice(0, 10),
    releaseTime: Date.parse(r.releaseDate) || 0,
    type,
    url: r.collectionViewUrl,
    genres: r.primaryGenreName ? [r.primaryGenreName] : [],
    coverUrl: r.artworkUrl100 ? r.artworkUrl100.replace('100x100bb', '600x600bb') : null,
    footer: 'Apple Music / iTunes より取得',
  };
}

async function lookupReleases(artistId) {
  const data = await getJson(
    `${BASE}/lookup?id=${encodeURIComponent(artistId)}&entity=album&country=${COUNTRY}&limit=50&sort=recent`
  );
  return (data.results || []).filter((r) => r.wrapperType === 'collection').map(normalize);
}

class ItunesPoller {
  constructor(config, db, onNewRelease) {
    this.config = config;
    this.db = db;
    this.onNewRelease = onNewRelease;
    this.running = false;
  }

  start() {
    this._poll();
    setInterval(() => this._poll(), this.config.POLL_INTERVAL_MINUTES * 60 * 1000);
  }

  // 追加時・初回に、すでに発売済みの作品を通知なしで既知として記録
  async seedArtist(artistId) {
    const releases = await lookupReleases(artistId);
    const now = Date.now();
    for (const r of releases) {
      if (r.releaseTime <= now) await this.db.addKnownRelease(r.id, artistId);
    }
    return releases.length;
  }

  async _poll() {
    if (this.running) return;
    this.running = true;
    console.log('🔍 iTunes をチェック中...');
    let newCount = 0;
    try {
      const artists = await this.db.getItunesArtists();
      for (const { artist_id } of artists) {
        try {
          await sleep(3000); // iTunes API は約20req/分が目安
          const known = await this.db.getKnownReleaseIds(artist_id);
          if (known.size === 0) {
            await this.seedArtist(artist_id);
            continue;
          }
          const now = Date.now();
          const releases = await lookupReleases(artist_id);
          for (const r of releases) {
            if (known.has(r.id)) continue;
            if (r.releaseTime > now) continue; // 予約作品は発売日になってから通知
            await this.db.addKnownRelease(r.id, artist_id); // 先に記録して重複投稿を防ぐ
            await this.onNewRelease(r);
            newCount++;
          }
        } catch (err) {
          console.error(`❌ iTunes エラー (artist ${artist_id}):`, err.message);
        }
      }
      console.log(`✅ iTunes チェック完了: 新着 ${newCount} 件`);
    } finally {
      this.running = false;
    }
  }
}

module.exports = { ItunesPoller, searchArtists, lookupArtist };
