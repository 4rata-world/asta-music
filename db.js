const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS artist_mbids (
      mbid TEXT PRIMARY KEY
    );
    CREATE TABLE IF NOT EXISTS genres (
      name TEXT PRIMARY KEY
    );
    CREATE TABLE IF NOT EXISTS guild_channels (
      guild_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS itunes_artists (
      artist_id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS known_releases (
      release_id TEXT PRIMARY KEY,
      artist_id TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  console.log('✅ DB初期化完了');
}

async function getArtists() {
  const res = await pool.query('SELECT mbid FROM artist_mbids');
  return res.rows.map((r) => r.mbid);
}

async function addArtist(mbid) {
  await pool.query('INSERT INTO artist_mbids (mbid) VALUES ($1) ON CONFLICT DO NOTHING', [mbid]);
}

async function removeArtist(mbid) {
  const res = await pool.query('DELETE FROM artist_mbids WHERE mbid = $1', [mbid]);
  return res.rowCount > 0;
}

async function getGenres() {
  const res = await pool.query('SELECT name FROM genres');
  return res.rows.map((r) => r.name);
}

async function addGenre(name) {
  await pool.query('INSERT INTO genres (name) VALUES ($1) ON CONFLICT DO NOTHING', [name]);
}

async function removeGenre(name) {
  const res = await pool.query('DELETE FROM genres WHERE name = $1', [name]);
  return res.rowCount > 0;
}

async function setGuildChannel(guildId, channelId) {
  await pool.query(
    `INSERT INTO guild_channels (guild_id, channel_id) VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET channel_id = $2`,
    [guildId, channelId]
  );
}

async function getGuildChannel(guildId) {
  const res = await pool.query('SELECT channel_id FROM guild_channels WHERE guild_id = $1', [guildId]);
  return res.rows[0]?.channel_id || null;
}

async function getAllGuildChannels() {
  const res = await pool.query('SELECT guild_id, channel_id FROM guild_channels');
  return res.rows;
}

// ── iTunes ──
async function getItunesArtists() {
  const res = await pool.query('SELECT artist_id, name FROM itunes_artists ORDER BY name');
  return res.rows;
}

async function addItunesArtist(artistId, name) {
  await pool.query(
    'INSERT INTO itunes_artists (artist_id, name) VALUES ($1, $2) ON CONFLICT (artist_id) DO UPDATE SET name = $2',
    [artistId, name]
  );
}

async function removeItunesArtist(artistId) {
  await pool.query('DELETE FROM known_releases WHERE artist_id = $1', [artistId]);
  const res = await pool.query('DELETE FROM itunes_artists WHERE artist_id = $1', [artistId]);
  return res.rowCount > 0;
}

async function getKnownReleaseIds(artistId) {
  const res = await pool.query('SELECT release_id FROM known_releases WHERE artist_id = $1', [artistId]);
  return new Set(res.rows.map((r) => r.release_id));
}

async function addKnownRelease(releaseId, artistId) {
  await pool.query(
    'INSERT INTO known_releases (release_id, artist_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [releaseId, artistId]
  );
}

module.exports = {
  init,
  getArtists, addArtist, removeArtist,
  getGenres, addGenre, removeGenre,
  setGuildChannel, getGuildChannel, getAllGuildChannels,
  getItunesArtists, addItunesArtist, removeItunesArtist,
  getKnownReleaseIds, addKnownRelease,
};
