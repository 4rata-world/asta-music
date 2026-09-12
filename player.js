const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
} = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const SoundCloud = require('soundcloud-scraper');
const { EmbedBuilder } = require('discord.js');

const scClient = new SoundCloud.Client();

// サーバーごとのキューを管理
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

async function getTrackInfo(query) {
  // URLかどうか判定
  if (isYouTubeUrl(query)) {
    const info = await ytdl.getInfo(query);
    return {
      title: info.videoDetails.title,
      url: query,
      thumbnail: info.videoDetails.thumbnails.at(-1)?.url,
      duration: formatDuration(parseInt(info.videoDetails.lengthSeconds)),
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

  // テキスト検索 → YouTubeで検索
  const results = await SoundCloud.Util.fetchSongStreamURL(query).catch(() => null);
  if (results) {
    return {
      title: query,
      url: results,
      thumbnail: null,
      duration: '不明',
      source: 'SoundCloud',
    };
  }

  // YouTube検索
  const ytSearch = await ytdl.getInfo(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
  ).catch(() => null);

  throw new Error('曲が見つかりませんでした。URLを直接指定してみてください。');
}

async function createStream(track) {
  if (isYouTubeUrl(track.url)) {
    return ytdl(track.url, {
      filter: 'audioonly',
      quality: 'highestaudio',
      highWaterMark: 1 << 25,
    });
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
    if (queue.connection) {
      setTimeout(() => {
        const q = getQueue(guild.id);
        if (q.tracks.length === 0) {
          q.connection?.destroy();
          queues.delete(guild.id);
        }
      }, 30000); // 30秒後に退出
    }
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
  const member = interaction.member;
  const voiceChannel = member?.voice?.channel;

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

  // 接続していなければ接続
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

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

module.exports = { addToQueue, skipTrack, stopPlayer, getQueueList };
