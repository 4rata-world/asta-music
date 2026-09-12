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

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

let poller = null;

// ===== スラッシュコマンド定義 =====
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

// ===== Bot 起動 =====
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  client.user.setActivity('/help', { type: ActivityType.Playing });

  // スラッシュコマンドをDiscordに登録
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

// ===== コマンドハンドラ =====
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'help') {
    const embed = new EmbedBuilder()
      .setColor(0x1db954)
      .setTitle('Nelo Music bot コマンド一覧')
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
    if (config.ARTIST_MBIDS.includes(mbid)) {
      return interaction.reply({ content: `⚠️ \`${mbid}\` はすでに追跡中です`, ephemeral: true });
    }
    config.ARTIST_MBIDS.push(mbid);
    return interaction.reply({ content: `✅ MBID \`${mbid}\` を追跡リストに追加しました！` });
  }

  if (commandName === 'untrack') {
    const mbid = interaction.options.getString('mbid').trim();
    const idx = config.ARTIST_MBIDS.indexOf(mbid);
    if (idx === -1) {
      return interaction.reply({ content: `⚠️ \`${mbid}\` は追跡リストにありません`, ephemeral: true });
    }
    config.ARTIST_MBIDS.splice(idx, 1);
    return interaction.reply({ content: `🗑️ MBID \`${mbid}\` を追跡リストから削除しました` });
  }

  if (commandName === 'genre') {
    const name = interaction.options.getString('name').trim().toLowerCase();
    if (config.GENRES.includes(name)) {
      return interaction.reply({ content: `⚠️ \`${name}\` はすでに追跡中です`, ephemeral: true });
    }
    config.GENRES.push(name);
    return interaction.reply({ content: `✅ ジャンル \`${name}\` を追跡リストに追加しました！` });
  }

  if (commandName === 'ungenre') {
    const name = interaction.options.getString('name').trim().toLowerCase();
    const idx = config.GENRES.indexOf(name);
    if (idx === -1) {
      return interaction.reply({ content: `⚠️ \`${name}\` は追跡リストにありません`, ephemeral: true });
    }
    config.GENRES.splice(idx, 1);
    return interaction.reply({ content: `🗑️ ジャンル \`${name}\` を追跡リストから削除しました` });
  }

  if (commandName === 'list') {
    const artists = config.ARTIST_MBIDS.length > 0
      ? config.ARTIST_MBIDS.map((id) => `\`${id}\``).join('\n')
      : 'なし';
    const genres = config.GENRES.length > 0
      ? config.GENRES.map((g) => `\`${g}\``).join(', ')
      : 'なし';

    const embed = new EmbedBuilder()
      .setColor(0x1db954)
      .setTitle('📋 追跡リスト')
      .addFields(
        { name: 'アーティスト (MBID)', value: artists, inline: false },
        { name: 'ジャンル', value: genres, inline: false },
      );
    return interaction.reply({ embeds: [embed] });
  }
});

// ===== 新譜埋め込み生成 =====
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
