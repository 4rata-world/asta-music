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

module.exports = {
  init,
  getArtists, addArtist, removeArtist,
  getGenres, addGenre, removeGenre,
  setGuildChannel, getGuildChannel, getAllGuildChannels,
};
