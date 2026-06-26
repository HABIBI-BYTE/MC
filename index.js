const mineflayer = require('mineflayer');
const { Movements, pathfinder, goals } = require('mineflayer-pathfinder');
const { GoalBlock } = goals;
const config = require('./settings.json');
const express = require('express');
const http = require('http');
const https = require('https');

// ============================================================
// BEDROCK PROXY - Translates Bedrock <-> Java for mineflayer
// ============================================================
const { createClient, Relay } = require('bedrock-protocol');

// We use a local Java-protocol relay so mineflayer (Java-only) can
// connect to a Bedrock server.  The relay listens on localhost:19133
// and forwards traffic to the real Bedrock server.
const PROXY_HOST = '127.0.0.1';
const PROXY_PORT = 19133; // local Java-side port mineflayer connects to

let relay = null;

function startBedrockRelay() {
  return new Promise((resolve, reject) => {
    try {
      relay = new Relay({
        /* Upstream = the real Bedrock server */
         host: config.server.ip,       // Ora legge dal settings.json!
         port: config.server.port,     // Ora legge dal settings.json!
         version: 1.26.0,
         skipPing: true,               // Evita il "Ping timed out" di Aternos   // e.g. "1.21.1"

        /* Downstream = local Java endpoint that mineflayer connects to */
        destination: {
          host: PROXY_HOST,
          port: PROXY_PORT
        },

        /* Offline / cracked auth (matches settings.json "offline" type) */
        offline: config['bot-account'].type === 'offline',
        username: config['bot-account'].username,
        password: config['bot-account'].password || undefined
      });

      relay.listen();
      console.log(`[Bedrock Relay] Listening on ${PROXY_HOST}:${PROXY_PORT}`);
      console.log(`[Bedrock Relay] Forwarding to ${config.server.ip}:${config.server.port}`);
      resolve();
    } catch (e) {
      console.log('[Bedrock Relay] Failed to start relay:', e.message);
      reject(e);
    }
  });
}

// ============================================================
// EXPRESS SERVER - Keep Render/Aternos alive
// ============================================================
const app = express();
const PORT = process.env.PORT || 5000;

let botState = {
  connected: false,
  lastActivity: Date.now(),
  reconnectAttempts: 0,
  startTime: Date.now(),
  errors: []
};

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${config.name} Status</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; overflow: hidden; }
          .container { background: #1e293b; padding: 40px; border-radius: 20px; box-shadow: 0 0 50px rgba(45, 212, 191, 0.2); text-align: center; width: 400px; border: 1px solid #334155; }
          h1 { margin-bottom: 30px; font-size: 24px; color: #ccfbf1; display: flex; align-items: center; justify-content: center; gap: 10px; }
          .stat-card { background: #0f172a; padding: 15px; margin: 15px 0; border-radius: 12px; border-left: 5px solid #2dd4bf; text-align: left; box-shadow: 5px 5px 15px rgba(0,0,0,0.3); }
          .label { font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; }
          .value { font-size: 18px; font-weight: bold; color: #2dd4bf; margin-top: 5px; }
          .status-dot { height: 12px; width: 12px; border-radius: 50%; display: inline-block; margin-right: 8px; background-color: currentColor; }
          .pulse { animation: pulse 2s infinite; }
          @keyframes pulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:0.5; transform:scale(1.1); } }
          .btn-guide { display: inline-block; margin-top: 20px; padding: 12px 24px; background: #2dd4bf; color: #0f172a; text-decoration: none; border-radius: 8px; font-weight: bold; }
          .bedrock-badge { background: #7c3aed; color: white; font-size: 11px; padding: 3px 8px; border-radius: 12px; margin-left: 8px; }
        </style>
      </head>
      <body>
        <div class="container" id="main-container">
          <h1>
            <span id="live-indicator" class="status-dot pulse" style="color: #ef4444;"></span>
            ${config.name}
            <span class="bedrock-badge">BEDROCK</span>
          </h1>
          <div class="stat-card"><div class="label">Status</div><div class="value" id="status-text">Connecting...</div></div>
          <div class="stat-card"><div class="label">Uptime</div><div class="value" id="uptime-text">0h 0m 0s</div></div>
          <div class="stat-card"><div class="label">Coordinates</div><div class="value" id="coords-text">Waiting...</div></div>
          <div class="stat-card"><div class="label">Server (Bedrock)</div><div class="value">${config.server.ip}:${config.server.port}</div></div>
          <a href="/tutorial" class="btn-guide">View Setup Guide</a>
        </div>
        <script>
          const fmt = s => { const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sc=s%60; return h+'h '+m+'m '+sc+'s'; };
          const update = async () => {
            try {
              const d = await (await fetch('/health')).json();
              const st = document.getElementById('status-text');
              const dot = document.getElementById('live-indicator');
              if (d.status==='connected') { st.innerHTML='<span class="status-dot" style="color:#4ade80"></span> Online & Running'; dot.style.color='#4ade80'; }
              else { st.innerHTML='<span class="status-dot" style="color:#f87171"></span> Reconnecting...'; dot.style.color='#f87171'; }
              document.getElementById('uptime-text').innerText = fmt(d.uptime);
              document.getElementById('coords-text').innerText = d.coords ? 'X:'+Math.floor(d.coords.x)+' Y:'+Math.floor(d.coords.y)+' Z:'+Math.floor(d.coords.z) : 'Unknown';
            } catch(e) { document.getElementById('status-text').innerText='System Offline'; }
          };
          setInterval(update, 1000); update();
        </script>
      </body>
    </html>
  `);
});

app.get('/tutorial', (req, res) => {
  res.send(`
    <html><head><title>Setup Guide - Bedrock</title>
    <style>body{font-family:'Segoe UI',sans-serif;background:#0f172a;color:#cbd5e1;padding:40px;max-width:800px;margin:0 auto;line-height:1.6}h1,h2{color:#2dd4bf}h1{border-bottom:2px solid #334155;padding-bottom:10px}.card{background:#1e293b;padding:25px;border-radius:12px;margin-bottom:20px;border:1px solid #334155}a{color:#38bdf8}code{background:#334155;padding:2px 6px;border-radius:4px;color:#e2e8f0}.btn-home{display:inline-block;margin-bottom:20px;padding:8px 16px;background:#334155;color:white;border-radius:6px;text-decoration:none}.badge{background:#7c3aed;color:white;font-size:12px;padding:2px 8px;border-radius:10px}</style>
    </head><body>
    <a href="/" class="btn-home">← Dashboard</a>
    <h1>Setup Guide — Bedrock Edition <span class="badge">BEDROCK</span></h1>
    <div class="card"><h2>Step 1: Server Requirements</h2>
    <p>Your Bedrock server must have UDP port open (default <strong>19132</strong>). Aternos Bedrock servers work fine. No plugins needed.</p>
    <p>Update <code>settings.json</code>: set <code>port</code> to your Bedrock port (usually 19132) and <code>edition</code> to <code>"bedrock"</code>.</p></div>
    <div class="card"><h2>Step 2: Install & Run</h2>
    <ol><li>Run <code>npm install</code></li><li>Run <code>npm start</code></li><li>The bot auto-starts the Bedrock relay and connects.</li></ol></div>
    <div class="card"><h2>How It Works</h2>
    <p>This bot uses <code>bedrock-protocol</code> as a local relay that translates Bedrock packets into Java packets so mineflayer can connect. Everything else (AFK, combat, auto-reconnect) works the same.</p></div>
    </body></html>
  `);
});

app.get('/health', (req, res) => {
  res.json({
    status: botState.connected ? 'connected' : 'disconnected',
    uptime: Math.floor((Date.now() - botState.startTime) / 1000),
    coords: (bot && bot.entity) ? bot.entity.position : null,
    lastActivity: botState.lastActivity,
    reconnectAttempts: botState.reconnectAttempts,
    edition: 'bedrock',
    memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024
  });
});

app.get('/ping', (req, res) => res.send('pong'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] HTTP server started on port ${PORT}`);
});

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
}

// ============================================================
// SELF-PING
// ============================================================
const SELF_PING_INTERVAL = 10 * 60 * 1000;
function startSelfPing() {
  setInterval(() => {
    const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(`${url}/ping`, () => {}).on('error', (err) => {
      console.log(`[KeepAlive] Self-ping failed: ${err.message}`);
    });
  }, SELF_PING_INTERVAL);
  console.log('[KeepAlive] Self-ping started (every 10 min)');
}
startSelfPing();

// ============================================================
// MEMORY MONITORING
// ============================================================
setInterval(() => {
  const mem = process.memoryUsage();
  console.log(`[Memory] Heap: ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`);
}, 5 * 60 * 1000);

// ============================================================
// BOT CREATION
// ============================================================
let bot = null;
let activeIntervals = [];
let reconnectTimeout = null;
let isReconnecting = false;

function clearAllIntervals() {
  activeIntervals.forEach(id => clearInterval(id));
  activeIntervals = [];
}

function addInterval(callback, delay) {
  const id = setInterval(callback, delay);
  activeIntervals.push(id);
  return id;
}

function getReconnectDelay() {
  const baseDelay = config.utils['auto-reconnect-delay'] || 2000;
  const maxDelay = config.utils['max-reconnect-delay'] || 15000;
  return Math.min(baseDelay + (botState.reconnectAttempts * 1000), maxDelay);
}

function createBot() {
  if (isReconnecting) {
    console.log('[Bot] Already reconnecting, skipping...');
    return;
  }

  if (bot) {
    clearAllIntervals();
    try { bot.removeAllListeners(); bot.end(); } catch (e) {}
    bot = null;
  }

  console.log(`[Bot] Creating Bedrock bot instance...`);
  console.log(`[Bot] Connecting via relay to ${config.server.ip}:${config.server.port}`);

  try {
    // mineflayer connects to the LOCAL relay, not directly to Bedrock
    bot = mineflayer.createBot({
      username: config['bot-account'].username,
      password: config['bot-account'].password || undefined,
      auth: config['bot-account'].type,  // 'offline' for cracked/Bedrock
      host: PROXY_HOST,
      port: PROXY_PORT,
      version: 1.21,
      hideErrors: false,
      checkTimeoutInterval: 120000
    });

    bot.loadPlugin(pathfinder);

    const connectionTimeout = setTimeout(() => {
      if (!botState.connected) {
        console.log('[Bot] Connection timeout - no spawn received');
        scheduleReconnect();
      }
    }, 60000);

    bot.once('spawn', () => {
      clearTimeout(connectionTimeout);
      botState.connected = true;
      botState.lastActivity = Date.now();
      botState.reconnectAttempts = 0;
      isReconnecting = false;

      console.log(`[Bot] [+] Spawned on Bedrock server!`);
      if (config.discord && config.discord.events.connect) {
        sendDiscordWebhook(`[+] **Connected (Bedrock)** to \`${config.server.ip}\``, 0x4ade80);
      }

      const mcData = require('minecraft-data')(config.server.version);
      const defaultMove = new Movements(bot, mcData);
      defaultMove.allowFreeMotion = false;
      defaultMove.canDig = false;
      defaultMove.liquidCost = 1000;
      defaultMove.fallDamageCost = 1000;

      initializeModules(bot, mcData, defaultMove);
      setupLeaveRejoin(bot);

      setTimeout(() => {
        if (bot && botState.connected) {
          bot.chat('/gamerule sendCommandFeedback false');
        }
      }, 3000);
    });

    bot.on('end', (reason) => {
      console.log(`[Bot] Disconnected: ${reason || 'Unknown reason'}`);
      botState.connected = false;
      clearAllIntervals();
      if (config.discord && config.discord.events.disconnect && reason !== 'Periodic Rejoin') {
        sendDiscordWebhook(`[-] **Disconnected**: ${reason || 'Unknown'}`, 0xf87171);
      }
      if (config.utils['auto-reconnect']) scheduleReconnect();
    });

    bot.on('kicked', (reason) => {
      console.log(`[Bot] Kicked: ${reason}`);
      botState.connected = false;
      botState.errors.push({ type: 'kicked', reason, time: Date.now() });
      clearAllIntervals();
      if (config.discord && config.discord.events.disconnect) {
        sendDiscordWebhook(`[!] **Kicked**: ${reason}`, 0xff0000);
      }
      if (config.utils['auto-reconnect']) scheduleReconnect();
    });

    bot.on('error', (err) => {
      console.log(`[Bot] Error: ${err.message}`);
      botState.errors.push({ type: 'error', message: err.message, time: Date.now() });
    });

  } catch (err) {
    console.log(`[Bot] Failed to create bot: ${err.message}`);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  if (isReconnecting) return;
  isReconnecting = true;
  botState.reconnectAttempts++;
  const delay = getReconnectDelay();
  console.log(`[Bot] Reconnecting in ${delay / 1000}s (attempt #${botState.reconnectAttempts})`);
  reconnectTimeout = setTimeout(() => {
    isReconnecting = false;
    createBot();
  }, delay);
}

// ============================================================
// MODULE INITIALIZATION
// ============================================================
function initializeModules(bot, mcData, defaultMove) {
  console.log('[Modules] Initializing all modules...');

  if (config.utils['auto-auth'].enabled) {
    const password = config.utils['auto-auth'].password;
    setTimeout(() => {
      bot.chat(`/register ${password} ${password}`);
      bot.chat(`/login ${password}`);
      console.log('[Auth] Sent login commands');
    }, 1000);
  }

  if (config.utils['chat-messages'].enabled) {
    const messages = config.utils['chat-messages'].messages;
    if (config.utils['chat-messages'].repeat) {
      let i = 0;
      addInterval(() => {
        if (bot && botState.connected) {
          bot.chat(messages[i]);
          botState.lastActivity = Date.now();
          i = (i + 1) % messages.length;
        }
      }, config.utils['chat-messages']['repeat-delay'] * 1000);
    } else {
      messages.forEach((msg, idx) => setTimeout(() => bot.chat(msg), idx * 1000));
    }
  }

  if (config.position.enabled) {
    bot.pathfinder.setMovements(defaultMove);
    bot.pathfinder.setGoal(new GoalBlock(config.position.x, config.position.y, config.position.z));
  }

  if (config.utils['anti-afk'].enabled) {
    addInterval(() => {
      if (bot && botState.connected) {
        bot.setControlState('jump', true);
        setTimeout(() => { if (bot) bot.setControlState('jump', false); }, 100);
        botState.lastActivity = Date.now();
      }
    }, 3000);
    if (config.utils['anti-afk'].sneak) bot.setControlState('sneak', true);
  }

  if (config.movement['circle-walk'].enabled) startCircleWalk(bot, defaultMove);
  if (config.movement['random-jump'].enabled) startRandomJump(bot);
  if (config.movement['look-around'].enabled) startLookAround(bot);

  if (config.modules.avoidMobs) avoidMobs(bot);
  if (config.modules.combat) combatModule(bot, mcData);
  if (config.modules.beds) bedModule(bot, mcData);
  if (config.modules.chat) chatModule(bot);

  if (config.utils['periodic-rejoin'] && config.utils['periodic-rejoin'].enabled) {
    console.log('[Rejoin] Using leaveRejoin system.');
  }

  console.log('[Modules] All modules initialized!');
}

const setupLeaveRejoin = require('./leaveRejoin');

// ============================================================
// MOVEMENT HELPERS
// ============================================================
function startCircleWalk(bot, defaultMove) {
  const radius = config.movement['circle-walk'].radius;
  let angle = 0;
  let lastPathTime = 0;
  addInterval(() => {
    if (!bot || !botState.connected) return;
    const now = Date.now();
    if (now - lastPathTime < 2000) return;
    lastPathTime = now;
    try {
      const x = bot.entity.position.x + Math.cos(angle) * radius;
      const z = bot.entity.position.z + Math.sin(angle) * radius;
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(new GoalBlock(Math.floor(x), Math.floor(bot.entity.position.y), Math.floor(z)));
      angle += Math.PI / 4;
      botState.lastActivity = Date.now();
    } catch (e) { console.log('[CircleWalk] Error:', e.message); }
  }, config.movement['circle-walk'].speed);
}

function startRandomJump(bot) {
  addInterval(() => {
    if (!bot || !botState.connected) return;
    try {
      bot.setControlState('jump', true);
      setTimeout(() => { if (bot) bot.setControlState('jump', false); }, 300);
      botState.lastActivity = Date.now();
    } catch (e) { console.log('[RandomJump] Error:', e.message); }
  }, config.movement['random-jump'].interval);
}

function startLookAround(bot) {
  addInterval(() => {
    if (!bot || !botState.connected) return;
    try {
      const yaw = Math.random() * Math.PI * 2;
      const pitch = (Math.random() - 0.5) * Math.PI / 4;
      bot.look(yaw, pitch, true);
      botState.lastActivity = Date.now();
    } catch (e) { console.log('[LookAround] Error:', e.message); }
  }, config.movement['look-around'].interval);
}

// ============================================================
// CUSTOM MODULES
// ============================================================
function avoidMobs(bot) {
  const safeDistance = 5;
  addInterval(() => {
    if (!bot || !botState.connected) return;
    try {
      const entities = Object.values(bot.entities).filter(e =>
        e.type === 'mob' || (e.type === 'player' && e.username !== bot.username)
      );
      for (const e of entities) {
        if (!e.position) continue;
        const distance = bot.entity.position.distanceTo(e.position);
        if (distance < safeDistance) {
          bot.setControlState('back', true);
          setTimeout(() => { if (bot) bot.setControlState('back', false); }, 500);
          break;
        }
      }
    } catch (e) { console.log('[AvoidMobs] Error:', e.message); }
  }, 2000);
}

function combatModule(bot, mcData) {
  addInterval(() => {
    if (!bot || !botState.connected) return;
    try {
      if (config.combat['attack-mobs']) {
        const mobs = Object.values(bot.entities).filter(e =>
          e.type === 'mob' && e.position && bot.entity.position.distanceTo(e.position) < 4
        );
        if (mobs.length > 0) bot.attack(mobs[0]);
      }
    } catch (e) { console.log('[Combat] Error:', e.message); }
  }, 1500);

  bot.on('health', () => {
    if (!config.combat['auto-eat']) return;
    try {
      if (bot.food < 14) {
        const food = bot.inventory.items().find(i => {
          const itemData = mcData.itemsByName[i.name];
          return itemData && itemData.food;
        });
        if (food) {
          bot.equip(food, 'hand')
            .then(() => bot.consume())
            .catch(e => console.log('[AutoEat] Error:', e.message));
        }
      }
    } catch (e) { console.log('[AutoEat] Error:', e.message); }
  });
}

function bedModule(bot, mcData) {
  addInterval(async () => {
    if (!bot || !botState.connected) return;
    try {
      const isNight = bot.time.timeOfDay >= 12500 && bot.time.timeOfDay <= 23500;
      if (config.beds['place-night'] && isNight && !bot.isSleeping) {
        const bedBlock = bot.findBlock({ matching: block => block.name.includes('bed'), maxDistance: 8 });
        if (bedBlock) {
          try { await bot.sleep(bedBlock); console.log('[Bed] Sleeping...'); } catch (e) {}
        }
      }
    } catch (e) { console.log('[Bed] Error:', e.message); }
  }, 10000);
}

function chatModule(bot) {
  bot.on('chat', (username, message) => {
    if (!bot || username === bot.username) return;
    try {
      if (config.chat.respond) {
        const lowerMsg = message.toLowerCase();
        if (lowerMsg.includes('hello') || lowerMsg.includes('hi')) bot.chat(`Hello, ${username}!`);
        if (message.startsWith('!tp ') && config.chat.respond) {
          const target = message.split(' ')[1];
          if (target) bot.chat(`/tp ${target}`);
        }
      }
    } catch (e) { console.log('[Chat] Error:', e.message); }
  });
}

// ============================================================
// CONSOLE COMMANDS
// ============================================================
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
rl.on('line', (line) => {
  if (!bot || !botState.connected) { console.log('[Console] Bot not connected'); return; }
  const trimmed = line.trim();
  if (trimmed.startsWith('say ')) bot.chat(trimmed.slice(4));
  else if (trimmed.startsWith('cmd ')) bot.chat('/' + trimmed.slice(4));
  else if (trimmed === 'status') console.log(`Connected: ${botState.connected}, Uptime: ${formatUptime(Math.floor((Date.now() - botState.startTime) / 1000))}`);
  else if (trimmed === 'reconnect') { console.log('[Console] Manual reconnect'); bot.end(); }
  else bot.chat(trimmed);
});

// ============================================================
// DISCORD WEBHOOK
// ============================================================
function sendDiscordWebhook(content, color = 0x0099ff) {
  if (!config.discord || !config.discord.enabled || !config.discord.webhookUrl || config.discord.webhookUrl.includes('YOUR_DISCORD')) return;
  const protocol = config.discord.webhookUrl.startsWith('https') ? https : http;
  const urlParts = new URL(config.discord.webhookUrl);
  const payload = JSON.stringify({
    username: config.name,
    embeds: [{ description: content, color, timestamp: new Date().toISOString(), footer: { text: 'AFK Bot — Bedrock Edition' } }]
  });
  const options = { hostname: urlParts.hostname, port: 443, path: urlParts.pathname + urlParts.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length } };
  const req = protocol.request(options, () => {});
  req.on('error', (e) => console.log(`[Discord] Error: ${e.message}`));
  req.write(payload);
  req.end();
}

// ============================================================
// CRASH RECOVERY
// ============================================================
process.on('uncaughtException', (err) => {
  console.log(`[FATAL] Uncaught Exception: ${err.message}`);
  botState.errors.push({ type: 'uncaught', message: err.message, time: Date.now() });
  if (config.utils['auto-reconnect']) {
    clearAllIntervals();
    setTimeout(() => scheduleReconnect(), 1000);
  }
});

process.on('unhandledRejection', (reason) => {
  console.log(`[FATAL] Unhandled Rejection: ${reason}`);
  botState.errors.push({ type: 'rejection', message: String(reason), time: Date.now() });
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => { console.log('[System] Manual stop. Exiting...'); process.exit(0); });

// ============================================================
// START - First launch the Bedrock relay, then the bot
// ============================================================
console.log('='.repeat(50));
console.log('  Minecraft AFK Bot v2.3 — BEDROCK EDITION');
console.log('='.repeat(50));
console.log(`Server (Bedrock): ${config.server.ip}:${config.server.port}`);
console.log(`Version: ${config.server.version}`);
console.log(`Auto-Reconnect: ${config.utils['auto-reconnect'] ? 'Enabled' : 'Disabled'}`);
console.log('='.repeat(50));

startBedrockRelay()
  .then(() => {
    // Give the relay a moment to fully initialize before mineflayer connects
    setTimeout(() => createBot(), 1500);
  })
  .catch((e) => {
    console.log('[FATAL] Could not start Bedrock relay. Exiting.', e.message);
    process.exit(1);
  });
