require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActivityType,
  REST,
  Routes,
  SlashCommandBuilder,
} = require('discord.js');
const MusicBrainzPoller = require('./poller');
const config = require('./config');
const db = require('./db');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

let poller = null;

const commands = [
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('コマンド一覧を表示します'),
  new SlashCommandBuilder()
    .setName('track')
    .setDescription('アーティストを追跡リストに追加します')
    .addStringOption((o) =>
      o.setName('mbid').setDescription('アーティストのMusicBrainz MBID').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('untrack')
    .setDescription('アーティストを追跡リストから削除します')
    .addStringOption((o) =>
      o.setName('mbid').setDescription('アーティストのMusicBrainz MBID').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('list')
    .setDescription('追跡中のアーティストとジャンルを表示します'),
  new SlashCommandBuilder()
    .setName('genre')
    .setDescription('ジャンルを追跡リストに追加します')
    .addStringOption((o) =>
      o.setName('name').setDescription('MusicBrainz のジャンルタグ名（例: j-pop）').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('ungenre')
    .setDescription('ジャンルを追跡リストから削除します')
    .addStringOption((o) =>
      o.setName('name').setDescription('削除するジャンルタグ名').setRequired(true)
    ),
].map((c) => c.toJSON());

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  client.user.setActivity('/help', { type: ActivityType.Playing });

  await db.init();
  config.ARTIST_MBIDS = await db.getArtists();
  config.GENRES = await db.getGenres();
  console.log(`📋 追跡中: アーティスト ${config.ARTIST_MBIDS.length}件, ジャンル ${config.GENRES.length}件`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
  console.log('✅ スラッシュコマンド登録完了');

  const channel = await client.channels.fetch(config.ANNOUNCE_CHANNEL_ID).catch(() => null);
  if (!channel) {
    console.error('❌ ANNOUNCE_CHANNEL_ID が見つかりません。');
    process.exit(1);
  }

  poller = new MusicBrainzPoller(config, async (release) => {
    const embed = buildEmbed(release);
    await channel.send({ embeds: [embed] });
    console.log(`📢 アナウンス: ${release.title} / ${release.artist}`);
  });

  poller.start();
  console.log(`🎵 ポーリング開始 (間隔: ${config.POLL_INTERVAL_MINUTES}分)`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  if (commandName === 'help') {
    const embed = new EmbedBuilder()
      .setColor(0x1db954)
      .setTitle('🎵 新譜アナウンスBot コマンド一覧')
      .addFields(
        { name: '/help', value: 'このヘルプを表示します', inline: false },
        { name: '/track <mbid>', value: 'アーティストを追跡リストに追加します\nMBIDはmusicbrainz.orgのアーティストページURLの末尾', inline: false },
        { name: '/untrack <mbid>', value: 'アーティストを追跡リストから削除します', inline: false },
        { name: '/genre <name>', value: 'ジャンルを追跡リストに追加します（例: j-pop）', inline: false },
        { name: '/ungenre <name>', value: 'ジャンルを追跡リストから削除します', inline: false },
        { name: '/list', value: '追跡中のアーティストとジャンルを一覧表示します', inline: false },
      )
      .setFooter({ text: 'MusicBrainz より新譜情報を取得しています' });
    return interaction.reply({ embeds: [embed] });
  }

  if (commandName === 'track') {
    const mbid = interaction.options.getString('mbid').trim();
    const artists = await db.getArtists();
    if (artists.includes(mbid)) {
      return interaction.reply({ content: `⚠️ \`${mbid}\` はすでに追跡中です`, ephemeral: true });
    }
    await db.addArtist(mbid);
    config.ARTIST_MBIDS = await db.getArtists();
    return interaction.reply({ content: `✅ MBID \`${mbid}\` を追跡リストに追加しました！` });
  }

  if (commandName === 'untrack') {
    const mbid = interaction.options.getString('mbid').trim();
    const removed = await db.removeArtist(mbid);
    if (!removed) {
      return interaction.reply({ content: `⚠️ \`${mbid}\` は追跡リストにありません`, ephemeral: true });
    }
    config.ARTIST_MBIDS = await db.getArtists();
    return interaction.reply({ content: `🗑️ MBID \`${mbid}\` を追跡リストから削除しました` });
  }

  if (commandName === 'genre') {
    const name = interaction.options.getString('name').trim().toLowerCase();
    const genres = await db.getGenres();
    if (genres.includes(name)) {
      return interaction.reply({ content: `⚠️ \`${name}\` はすでに追跡中です`, ephemeral: true });
    }
    await db.addGenre(name);
    config.GENRES = await db.getGenres();
    return interaction.reply({ content: `✅ ジャンル \`${name}\` を追跡リストに追加しました！` });
  }

  if (commandName === 'ungenre') {
    const name = interaction.options.getString('name').trim().toLowerCase();
    const removed = await db.removeGenre(name);
    if (!removed) {
      return interaction.reply({ content: `⚠️ \`${name}\` は追跡リストにありません`, ephemeral: true });
    }
    config.GENRES = await db.getGenres();
    return interaction.reply({ content: `🗑️ ジャンル \`${name}\` を追跡リストから削除しました` });
  }

  if (commandName === 'list') {
    const artists = await db.getArtists();
    const genres = await db.getGenres();
    const artistStr = artists.length > 0 ? artists.map((id) => `\`${id}\``).join('\n') : 'なし';
    const genreStr = genres.length > 0 ? genres.map((g) => `\`${g}\``).join(', ') : 'なし';
    const embed = new EmbedBuilder()
      .setColor(0x1db954)
      .setTitle('📋 追跡リスト')
      .addFields(
        { name: 'アーティスト (MBID)', value: artistStr, inline: false },
        { name: 'ジャンル', value: genreStr, inline: false },
      );
    return interaction.reply({ embeds: [embed] });
  }
});

function buildEmbed(release) {
  const embed = new EmbedBuilder()
    .setColor(0x1db954)
    .setTitle(`🎵 新譜リリース: ${release.title}`)
    .setURL(release.url)
    .addFields(
      { name: 'アーティスト', value: release.artist, inline: true },
      { name: 'リリース日', value: release.date || '不明', inline: true },
      { name: 'タイプ', value: release.type || '不明', inline: true },
    )
    .setFooter({ text: 'MusicBrainz より取得' })
    .setTimestamp();

  if (release.genres && release.genres.length > 0) {
    embed.addFields({ name: 'ジャンル', value: release.genres.join(', '), inline: false });
  }
  if (release.coverUrl) {
    embed.setThumbnail(release.coverUrl);
  }
  return embed;
}

client.login(process.env.DISCORD_TOKEN);
