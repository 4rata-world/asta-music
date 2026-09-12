require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const MusicBrainzPoller = require('./poller');
const config = require('./config');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

let poller = null;

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const channel = await client.channels.fetch(config.ANNOUNCE_CHANNEL_ID).catch(() => null);
  if (!channel) {
    console.error('❌ ANNOUNCE_CHANNEL_ID が見つかりません。.env を確認してください。');
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
