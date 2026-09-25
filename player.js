const { DisTube } = require('distube');
const { SoundCloudPlugin } = require('@distube/soundcloud');
const { EmbedBuilder } = require('discord.js');

let distube = null;

function initDistube(client) {
  distube = new DisTube(client, {
    plugins: [new SoundCloudPlugin()],
    emitNewSongOnly: true,
    joinNewVoiceChannel: true,
  });

  distube.on('playSong', (queue, song) => {
    const embed = new EmbedBuilder()
      .setColor(0xc8714a)
      .setTitle(`▶️ 再生中: ${song.name}`)
      .addFields(
        { name: '時間', value: song.formattedDuration, inline: true },
        { name: 'リクエスト', value: song.user?.tag || '不明', inline: true },
      )
      .setFooter({ text: song.url });
    if (song.thumbnail) embed.setThumbnail(song.thumbnail);
    queue.textChannel?.send({ embeds: [embed] });
  });

  distube.on('addSong', (queue, song) => {
    queue.textChannel?.send(`➕ キューに追加: **${song.name}** (${song.formattedDuration})`);
  });

  distube.on('error', (channel, error) => {
    console.error('DisTubeエラー:', error.message);
    channel?.send(`❌ エラーが発生しました: ${error.message}`);
  });

  distube.on('finish', (queue) => {
    queue.textChannel?.send('⏹️ キューが終了しました');
  });

  return distube;
}

async function addToQueue(interaction, query) {
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    return interaction.reply({ content: '⚠️ まずボイスチャンネルに入ってください！', ephemeral: true });
  }

  await interaction.deferReply();

  try {
    await distube.play(voiceChannel, query, {
      textChannel: interaction.channel,
      member: interaction.member,
    });
    return interaction.editReply('🎵 処理中...');
  } catch (err) {
    console.error('再生エラー:', err.message);
    return interaction.editReply(`❌ 再生に失敗しました: ${err.message}`);
  }
}

function skipTrack(guildId) {
  const queue = distube.getQueue(guildId);
  if (!queue) return false;
  queue.skip();
  return true;
}

function stopPlayer(guildId) {
  const queue = distube.getQueue(guildId);
  if (!queue) return false;
  queue.stop();
  return true;
}

function getQueueList(guildId) {
  const queue = distube.getQueue(guildId);
  if (!queue) return [];
  return queue.songs;
}

module.exports = { initDistube, addToQueue, skipTrack, stopPlayer, getQueueList };