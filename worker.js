require('dotenv').config();
const { Client, escapeMarkdown } = require('discord.js-selfbot-v13');
const { WebhookClient } = require('discord.js');

console.log('[WORKER] Starting enhanced tracker...');

const client = new Client({
  checkUpdate: false,
  syncStatus: false,
  partials: ['USER', 'GUILD_MEMBER', 'CHANNEL']
});

const webhook = new WebhookClient({ url: process.env.WEBHOOK_URL });
const trackedUsers = new Map(); // { userId: { endTime, timer, userTag } }

// Helper functions
function parseDuration(durationMs) {
  if (durationMs >= 86400000) return `${Math.round(durationMs/86400000)}d`;
  if (durationMs >= 3600000) return `${Math.round(durationMs/3600000)}h`;
  if (durationMs >= 60000) return `${Math.round(durationMs/60000)}m`;
  return `${Math.round(durationMs/1000)}s`;
}

function sendEmbed(user, title, description, color, extraFields = []) {
  webhook.send({
    embeds: [{
      color: color,
      author: {
        name: `${user.tag} (${user.id})`,
        icon_url: user.displayAvatarURL()
      },
      title: title,
      description: description,
      fields: [
        {
          name: '🕒 Track Time',
          value: trackedUsers.get(user.id)?.endTime 
            ? parseDuration(trackedUsers.get(user.id).endTime - Date.now()) + ' remaining'
            : 'No time limit',
          inline: true
        },
        ...extraFields
      ],
      timestamp: new Date()
    }]
  }).catch(console.error);
}

// Tracking system
process.stdin.on('data', (data) => {
  const input = data.toString().trim();
  
  if (input.startsWith('TRACK:')) {
    const [_, userId, duration] = input.split(':');
    const endTime = duration ? Date.now() + parseInt(duration) : null;
    
    // Clear existing timer if re-tracking
    if (trackedUsers.has(userId)) {
      clearTimeout(trackedUsers.get(userId).timer);
    }

    // Try to get user tag if available
    let userTag = userId;
    try {
      const user = client.users.cache.get(userId);
      if (user) userTag = user.tag;
    } catch {}

    const timer = endTime ? setTimeout(() => {
      trackedUsers.delete(userId);
      webhook.send(`🛑 Auto-untracked <@${userId}> (${userTag}) (duration expired)`).catch(console.error);
    }, parseInt(duration)) : null;

    trackedUsers.set(userId, { endTime, timer, userTag });
    
    // Check current status in all servers
    client.guilds.cache.forEach(guild => {
      guild.members.fetch(userId).then(member => {
        if (member?.voice.channel) {
          const status = `🎤 Currently in ${member.voice.channel.toString()}`;
          const screenshare = member.voice.streaming ? '📽️ Screen Sharing' : '';
          const camera = member.voice.selfVideo ? '📹 Camera On' : '';
          
          sendEmbed(
            member.user,
            '🕵️ Current Status',
            `${status}\n${screenshare} ${camera}`,
            0x3498db,
            [
              { name: '🌐 Server', value: guild.name, inline: true }
            ]
          );
        }
      }).catch(() => {});
    });

    webhook.send(`👀 Now tracking <@${userId}> (${userTag})${duration ? ` for ${parseDuration(parseInt(duration))}` : ''}`).catch(console.error);
  }
  else if (input.startsWith('UNTRACK:')) {
    const userId = input.split(':')[1];
    if (trackedUsers.has(userId)) {
      const userTag = trackedUsers.get(userId).userTag || userId;
      clearTimeout(trackedUsers.get(userId).timer);
      trackedUsers.delete(userId);
      webhook.send(`🛑 Stopped tracking <@${userId}> (${userTag})`).catch(console.error);
    }
  }
  else if (input.startsWith('LISTTRACKED')) {
    if (trackedUsers.size === 0) {
      webhook.send('ℹ️ No users currently being tracked').catch(console.error);
    } else {
      const trackedList = Array.from(trackedUsers.entries()).map(([id, data]) => {
        const timeLeft = data.endTime ? ` (${parseDuration(data.endTime - Date.now())} left)` : '';
        return `• <@${id}> (${data.userTag || id})${timeLeft}`;
      }).join('\n');
      
      webhook.send({
        embeds: [{
          color: 0x7289DA,
          title: '📋 Currently Tracked Users',
          description: trackedList,
          timestamp: new Date()
        }]
      }).catch(console.error);
    }
  }
  else if (input.startsWith('INVITE:')) {
    const guildId = input.split(':')[1];
    const guild = client.guilds.cache.get(guildId);
    
    if (!guild) {
      return webhook.send(`❌ Not in server with ID ${guildId}`).catch(console.error);
    }

    const inviteChannel = guild.channels.cache.find(ch => 
      ch.type === 'GUILD_TEXT' && 
      ch.permissionsFor(guild.me).has('CREATE_INSTANT_INVITE')
    );

    if (!inviteChannel) {
      return webhook.send(`❌ No permission to create invites in ${guild.name}`).catch(console.error);
    }

    inviteChannel.createInvite({ maxAge: 86400, maxUses: 1 })
      .then(invite => {
        webhook.send({
          embeds: [{
            color: 0x7289DA,
            title: `📨 Invite for ${guild.name}`,
            description: `🔗 ${invite.url}`,
            fields: [
              { name: 'Expires', value: invite.expiresAt ? invite.expiresAt.toLocaleString() : 'Never', inline: true },
              { name: 'Max Uses', value: invite.maxUses || 'Unlimited', inline: true }
            ],
            timestamp: new Date()
          }]
        }).catch(console.error);
      })
      .catch(err => {
        webhook.send(`❌ Failed to create invite: ${err.message}`).catch(console.error);
      });
  }
});

// Voice tracking
client.on('voiceStateUpdate', (oldState, newState) => {
  const userId = newState.member.id;
  if (!trackedUsers.has(userId)) return;

  const action = 
    !oldState.channel && newState.channel ? 'JOINED' :
    oldState.channel && !newState.channel ? 'LEFT' :
    oldState.selfMute !== newState.selfMute ? 
      (newState.selfMute ? 'MUTED' : 'UNMUTED') :
    oldState.selfVideo !== newState.selfVideo ?
      (newState.selfVideo ? 'CAMERA_ON' : 'CAMERA_OFF') :
    oldState.streaming !== newState.streaming ?
      (newState.streaming ? 'SCREEN_ON' : 'SCREEN_OFF') : null;

  if (action) {
    const actions = {
      'JOINED': { emoji: '🎤', color: 0x2ecc71, text: 'joined' },
      'LEFT': { emoji: '🚪', color: 0xe74c3c, text: 'left' },
      'MUTED': { emoji: '🔇', color: 0x95a5a6, text: 'muted' },
      'UNMUTED': { emoji: '🔊', color: 0xf1c40f, text: 'unmuted' },
      'CAMERA_ON': { emoji: '📹', color: 0x9b59b6, text: 'camera turned on' },
      'CAMERA_OFF': { emoji: '📹', color: 0x34495e, text: 'camera turned off' },
      'SCREEN_ON': { emoji: '📽️', color: 0x1abc9c, text: 'started screenshare' },
      'SCREEN_OFF': { emoji: '📽️', color: 0x7f8c8d, text: 'stopped screenshare' }
    };

    const { emoji, color, text } = actions[action];
    sendEmbed(
      newState.member.user,
      `${emoji} Voice Activity`,
      `${newState.member.user.username} ${text} ${newState.channel?.toString() || oldState.channel?.toString()}`,
      color,
      [
        { name: '🌐 Server', value: newState.guild.name, inline: true },
        { name: '🔊 Status', value: `${newState.selfMute ? '🔇 Muted' : '🔊 Unmuted'} | ${newState.selfVideo ? '📹 Camera On' : '📹 Camera Off'} | ${newState.streaming ? '📽️ Screensharing' : '📽️ No Screen'}`, inline: true }
      ]
    );
  }
});

// Message tracking
client.on('messageCreate', (message) => {
  if (!trackedUsers.has(message.author.id)) return;
  if (message.author.bot || !message.guild) return;

  const content = message.content 
    ? escapeMarkdown(message.content.slice(0, 1500)) 
    : '[No text content]';
  
  const attachments = message.attachments.size > 0
    ? `\n\n📎 **Attachments:**\n${message.attachments.map(a => a.url).join('\n')}`
    : '';

  sendEmbed(
    message.author,
    '💬 New Message',
    `**In ${message.channel.toString()}**\n\n${content}${attachments}`,
    0xe91e63,
    [
      { name: '🌐 Server', value: message.guild.name, inline: true },
      { name: '📅 Channel', value: message.channel.name, inline: true }
    ]
  );
});

client.login(process.env.USER_TOKEN);