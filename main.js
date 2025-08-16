require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { spawn } = require('child_process');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const worker = spawn('node', ['worker.js'], {
  stdio: ['pipe', 'pipe', 'inherit'],
  detached: true
});

worker.stdout.on('data', (data) => {
  console.log('[WORKER]', data.toString().trim());
});

client.on('ready', () => {
  console.log('✅ Main bot ready');
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const args = message.content.split(/ +/);
  const command = args[0].toLowerCase();

  if (command === '!track') {
    const targetUser = message.mentions.users.first() || { id: args[1], tag: args[1] };
    
    if (!targetUser?.id?.match(/^\d+$/)) {
      return message.reply('❌ Invalid user format. Use `!track @user [duration]` or `!track USER_ID [duration]`');
    }

    // Parse duration (supports s/m/h/d)
    let duration = 0;
    if (args[2]) {
      const num = parseInt(args[2]);
      if (args[2].endsWith('s')) duration = num * 1000;
      else if (args[2].endsWith('m')) duration = num * 60 * 1000;
      else if (args[2].endsWith('h')) duration = num * 60 * 60 * 1000;
      else if (args[2].endsWith('d')) duration = num * 24 * 60 * 60 * 1000;
      else duration = num * 1000; // Default to seconds
    }

    worker.stdin.write(`TRACK:${targetUser.id}:${duration}\n`);
    message.reply(`👀 Tracking ${targetUser.tag || targetUser.id}${duration ? ` for ${args[2]}` : ''}`);
  }
  else if (command === '!untrack') {
    const targetUser = message.mentions.users.first() || { id: args[1], tag: args[1] };
    
    if (!targetUser?.id?.match(/^\d+$/)) {
      return message.reply('❌ Invalid user format. Use `!untrack @user` or `!untrack USER_ID`');
    }

    worker.stdin.write(`UNTRACK:${targetUser.id}\n`);
    message.reply(`🛑 Stopped tracking ${targetUser.tag || targetUser.id}`);
  }
  else if (command === '!listtracked') {
    worker.stdin.write('LISTTRACKED\n');
    message.reply('📋 Checking tracked users...');
  }
  else if (command === '!invite') {
    const guildId = args[1];
    
    if (!guildId?.match(/^\d+$/)) {
      return message.reply('❌ Invalid server ID format. Use `!invite SERVER_ID`');
    }

    worker.stdin.write(`INVITE:${guildId}\n`);
    message.reply('👀 Fetching invite...');
  }
});

process.on('exit', () => worker.kill());
process.on('SIGINT', () => process.exit());

client.login(process.env.BOT_TOKEN);