const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
} = require('@discordjs/voice');
const YTDlpWrap = require('yt-dlp-wrap').default;
const SoundCloud = require('soundcloud-scraper');
const { EmbedBuilder } = require('discord.js');
const { Readable } = require('stream');

const ytDlp = new YTDlpWrap();

// yt-dlpバイナリを自動ダウンロード
(async () => {
  try {
    await YTDlpWrap.downloadFromGithub();
    console.log('✅ yt-dlp ダウンロード完了');
  } catch (e) {
    console.error('⚠️ yt-dlp ダウンロード失敗:', e.message);
  }
})();
const scClient = new SoundCloud.Client();

const queues = new Map();

function getQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, {
      tracks: [],
      player: null,
      connection: null,
      textChannel: null,
      playing: false,
    });
  }
  return queues.get(guildId);
}

function isYouTubeUrl(url) {
  return /(?:youtube\.com|youtu\.be)/.test(url);
}

function isSoundCloudUrl(url) {
  return /soundcloud\.com/.test(url);
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function getTrackInfo(query) {
  if (isYouTubeUrl(query)) {
    const info = await ytDlp.getVideoInfo(query);
    return {
      title: info.title,
      url: query,
      thumbnail: info.thumbnail,
      duration: formatDuration(info.duration || 0),
      source: 'YouTube',
    };
  }

  if (isSoundCloudUrl(query)) {
    const song = await scClient.getSongInfo(query);
    return {
      title: song.title,
      url: query,
      thumbnail: song.thumbnail,
      duration: formatDuration(Math.floor(song.duration / 1000)),
      source: 'SoundCloud',
    };
  }

  throw new Error('YouTubeまたはSoundCloudのURLを指定してください');
}

async function createStream(track) {
  if (isYouTubeUrl(track.url)) {
    const stream = ytDlp.execStream([
      track.url,
      '-f', 'bestaudio',
      '-o', '-',
      '--no-playlist',
    ]);
    return stream;
  }

  if (isSoundCloudUrl(track.url)) {
    const stream = await scClient.stream(track.url);
    return stream.stream;
  }

  throw new Error('対応していないURLです');
}

async function play(guild, textChannel) {
  const queue = getQueue(guild.id);
  if (queue.tracks.length === 0) {
    queue.playing = false;
    setTimeout(() => {
      const q = getQueue(guild.id);
      if (q.tracks.length === 0) {
        q.connection?.destroy();
        queues.delete(guild.id);
      }
    }, 30000);
    return;
  }

  const track = queue.tracks[0];
  queue.playing = true;

  try {
    const stream = await createStream(track);
    const resource = createAudioResource(stream);
    queue.player.play(resource);

    const embed = new EmbedBuilder()
      .setColor(0xc8714a)
      .setTitle(`▶️ 再生中: ${track.title}`)
      .addFields(
        { name: '時間', value: track.duration, inline: true },
        { name: 'ソース', value: track.source, inline: true },
      )
      .setFooter({ text: track.url });

    if (track.thumbnail) embed.setThumbnail(track.thumbnail);
    textChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error('再生エラー:', err.message);
    textChannel.send(`❌ 再生に失敗しました: ${track.title}`);
    queue.tracks.shift();
    play(guild, textChannel);
  }
}

async function addToQueue(interaction, query) {
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    return interaction.reply({ content: '⚠️ まずボイスチャンネルに入ってください！', ephemeral: true });
  }

  await interaction.deferReply();

  let track;
  try {
    track = await getTrackInfo(query);
  } catch (err) {
    return interaction.editReply(`❌ ${err.message}`);
  }

  const queue = getQueue(interaction.guildId);
  queue.textChannel = interaction.channel;
  queue.tracks.push(track);

  if (!queue.connection || queue.connection.state.status === VoiceConnectionStatus.Destroyed) {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: interaction.guildId,
      adapterCreator: interaction.guild.voiceAdapterCreator,
    });

    const player = createAudioPlayer();
    connection.subscribe(player);
    queue.connection = connection;
    queue.player = player;

    player.on(AudioPlayerStatus.Idle, () => {
      queue.tracks.shift();
      play(interaction.guild, queue.textChannel);
    });

    player.on('error', (err) => {
      console.error('PlayerError:', err.message);
      queue.tracks.shift();
      play(interaction.guild, queue.textChannel);
    });

    play(interaction.guild, interaction.channel);
  } else if (!queue.playing) {
    play(interaction.guild, interaction.channel);
  }

  const embed = new EmbedBuilder()
    .setColor(0xc8714a)
    .setTitle(queue.tracks.length === 1 ? `▶️ 再生します: ${track.title}` : `➕ キューに追加: ${track.title}`)
    .addFields(
      { name: '時間', value: track.duration, inline: true },
      { name: 'ソース', value: track.source, inline: true },
      { name: 'キュー', value: `${queue.tracks.length}曲`, inline: true },
    );

  if (track.thumbnail) embed.setThumbnail(track.thumbnail);
  return interaction.editReply({ embeds: [embed] });
}

function skipTrack(guildId) {
  const queue = getQueue(guildId);
  if (!queue.player || !queue.playing) return false;
  queue.player.stop();
  return true;
}

function stopPlayer(guildId) {
  const queue = getQueue(guildId);
  queue.tracks = [];
  queue.player?.stop();
  queue.connection?.destroy();
  queues.delete(guildId);
  return true;
}

function getQueueList(guildId) {
  return getQueue(guildId).tracks;
}

module.exports = { addToQueue, skipTrack, stopPlayer, getQueueList };
