require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActivityType,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const MusicBrainzPoller = require('./poller');
const config = require('./config');
const db = require('./db');
const { initDistube, addToQueue, skipTrack, stopPlayer, getQueueList } = require('./player');


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

let poller = null;

const commands = [
  // ── 新譜追跡 ──
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('コマンド一覧を表示します'),
  new SlashCommandBuilder()
    .setName('setchannel')
    .setDescription('新譜通知を投稿するチャンネルを設定します（管理者のみ）')
    .addChannelOption((o) =>
      o.setName('channel').setDescription('投稿先チャンネル').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
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

  // ── 音楽再生 ──
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('YouTubeまたはSoundCloudのURLで音楽を再生します')
    .addStringOption((o) =>
      o.setName('query').setDescription('YouTubeもしくはSoundCloudのURL').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('skip')
    .setDescription('現在の曲をスキップします'),
  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('再生を停止してボイスチャンネルから退出します'),
  new SlashCommandBuilder()
    .setName('queue')
    .setDescription('現在の再生キューを表示します'),
].map((c) => c.toJSON());

client.once('ready', async () => {
  initDistube(client);
  console.log(`✅ Logged in as ${client.user.tag}`);
  client.user.setActivity('/help', { type: ActivityType.Playing });

  await db.init();
  config.ARTIST_MBIDS = await db.getArtists();
  config.GENRES = await db.getGenres();
  console.log(`📋 追跡中: アーティスト ${config.ARTIST_MBIDS.length}件, ジャンル ${config.GENRES.length}件`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
  console.log(`✅ スラッシュコマンド登録完了: ${commands.length}個`);
  console.log(commands.map(c => c.name).join(', '));

  // サーバーごとのチャンネルに新譜通知
  poller = new MusicBrainzPoller(config, async (release) => {
    const embed = buildEmbed(release);
    const guildChannels = await db.getAllGuildChannels();

    if (guildChannels.length === 0) {
      console.log('⚠️ 通知先チャンネルが設定されていません。/setchannel で設定してください。');
      return;
    }

    for (const { channel_id } of guildChannels) {
      const channel = await client.channels.fetch(channel_id).catch(() => null);
      if (channel) {
        await channel.send({ embeds: [embed] });
        console.log(`📢 アナウンス: ${release.title} / ${release.artist} → #${channel.name}`);
      }
    }
  });

  poller.start();
  console.log(`🎵 ポーリング開始 (間隔: ${config.POLL_INTERVAL_MINUTES}分)`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  if (commandName === 'help') {
    const embed = new EmbedBuilder()
      .setColor(0xc8714a)
      .setTitle('🎵 Nelo コマンド一覧')
      .addFields(
        { name: '⚙️ 設定', value: '─────────────', inline: false },
        { name: '/setchannel <channel>', value: '新譜通知を投稿するチャンネルを設定（管理者のみ）', inline: false },
        { name: '📢 新譜通知', value: '─────────────', inline: false },
        { name: '/track <mbid>', value: 'アーティストを追跡リストに追加', inline: false },
        { name: '/untrack <mbid>', value: 'アーティストを追跡リストから削除', inline: false },
        { name: '/genre <name>', value: 'ジャンルを追跡リストに追加（例: j-pop）', inline: false },
        { name: '/ungenre <name>', value: 'ジャンルを追跡リストから削除', inline: false },
        { name: '/list', value: '追跡中のアーティスト・ジャンル一覧', inline: false },
        { name: '🎧 音楽再生', value: '─────────────', inline: false },
        { name: '/play <URL>', value: 'YouTubeまたはSoundCloudのURLで再生', inline: false },
        { name: '/skip', value: '現在の曲をスキップ', inline: false },
        { name: '/stop', value: '再生停止してボイスチャンネルから退出', inline: false },
        { name: '/queue', value: '再生キューを表示', inline: false },
      )
      .setFooter({ text: 'Powered by MusicBrainz · YouTube · SoundCloud' });
    return interaction.reply({ embeds: [embed] });
  }

  if (commandName === 'setchannel') {
    const channel = interaction.options.getChannel('channel');
    await db.setGuildChannel(interaction.guildId, channel.id);
    return interaction.reply({
      content: `✅ 新譜通知チャンネルを <#${channel.id}> に設定しました！`,
    });
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
      .setColor(0xc8714a)
      .setTitle('📋 追跡リスト')
      .addFields(
        { name: 'アーティスト (MBID)', value: artistStr, inline: false },
        { name: 'ジャンル', value: genreStr, inline: false },
      );
    return interaction.reply({ embeds: [embed] });
  }

  if (commandName === 'play') {
    const query = interaction.options.getString('query');
    return addToQueue(interaction, query);
  }

  if (commandName === 'skip') {
    const skipped = skipTrack(interaction.guildId);
    return interaction.reply({ content: skipped ? '⏭️ スキップしました' : '⚠️ 再生中の曲がありません', ephemeral: !skipped });
  }

  if (commandName === 'stop') {
    stopPlayer(interaction.guildId);
    return interaction.reply({ content: '⏹️ 再生を停止しました' });
  }

  if (commandName === 'queue') {
  const tracks = getQueueList(interaction.guildId);
  if (tracks.length === 0) {
    return interaction.reply({ content: '📭 キューは空です', ephemeral: true });
  }
  const list = tracks
    .slice(0, 10)
    .map((t, i) => `${i === 0 ? '▶️' : `${i + 1}.`} ${t.name} (${t.formattedDuration})`)
    .join('\n');
  const embed = new EmbedBuilder()
    .setColor(0xc8714a)
    .setTitle(`🎵 再生キュー (${tracks.length}曲)`)
    .setDescription(list);
  return interaction.reply({ embeds: [embed] });
}
};

function buildEmbed(release) {
  const embed = new EmbedBuilder()
    .setColor(0xc8714a)
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
  if (release.coverUrl) embed.setThumbnail(release.coverUrl);
  return embed;
}

client.login(process.env.DISCORD_TOKEN);
