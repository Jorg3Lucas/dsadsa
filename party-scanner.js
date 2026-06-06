import sharp from "sharp";
import { createWorker } from "tesseract.js";
import axios from "axios";
import { dailyLogs } from "./state.js";
import { saveDailyLogs } from "./daily-logs.js";

// ==========================================
// 🎯 PARTY SCANNER CONFIGURATION
// ==========================================

const CROP_RATIO_W = 0.22; // Mantido o seu original que cobria bem a largura
const CROP_RATIO_H = 0.35; // Reduzido de 0.88 para 0.35 (pega até 15 membros, mas ignora o botão 'Cambiar mazo')
const PARTY_COLUMNS = 3;   
const EVENT_WINDOW_MINUTES = 75; 
const OCR_LANGUAGE = "eng";
const MAX_PARTY_NAMES = 15; 

/**
 * Known UI text strings that should be filtered out from OCR results.
 */
const KNOWN_UI = new Set([
  "cambiar", "mazo", "cuerpo", "deck",
  "party", "clan", "member", "members", "online", "offline",
  "leader", "invite", "kick", "promote", "demote", "leave",
  "follow", "attack", "defend", "retreat", "ready", "cancel",
  "accept", "decline", "close", "settings", "exit", "chat",
  "whisper", "friend", "block", "report", "request", "trade",
  "guild", "alliance", "search", "list", "create", "join",
  "apply", "pending", "invitations", "combat", "power", "level",
  "name", "title", "rank", "exp", "hp", "mp", "atk", "def",
  "option", "menu", "back", "next", "page", "home", "start",
  "loading", "connect", "login", "logout", "select", "enter",
  "auto", "manual", "target", "alert", "notice", "system",
  "confirm", "server"
]);

// ==========================================
// 🧠 RUNTIME STATE
// ==========================================

let ocrWorker = null;
let ocrWorkerBusy = false;
const ocrQueue = [];
let presenceCache = {};

// ==========================================
// 🔧 HELPERS
// ==========================================

function getEventTypeForChannel(channelId) {
  const channels = dailyLogs.partyScannerChannels;
  if (!channels) return null;
  for (const [eventType, configChannelId] of Object.entries(channels)) {
    if (configChannelId === channelId) return eventType;
  }
  return null;
}

const EVENT_LABELS = {
  portal:    "Portals (SP/MS)",
  heist:     "Heist",
  tobd:      "TOBD",
  altar:     "Altar Defense",
  purgatory: "Purgatory",
  wb:        "World Boss (Valley/Labyrinth/Mirage)"
};

const EVENT_ICONS = {
  portal:    "🌀",
  heist:     "💰",
  tobd:      "⚔️",
  altar:     "🛡️",
  purgatory: "🔥",
  wb:        "🌍"
};

// ==========================================
// 🖼️ IMAGE PROCESSING & OCR
// ==========================================

async function downloadImage(url) {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 20000
  });
  return Buffer.from(response.data);
}

/**
 * Voltamos exatamente ao seu pipeline original que dava certo:
 * - Redimensiona 2x para manter a proporção que o seu Tesseract entendia
 * - Grayscale + Sharpen + Normalize (sem threshold agressivo para não sumir com as letras)
 */
async function prepareOcrRegion(buffer, left, top, width, height) {
  return await sharp(buffer)
    .extract({ left, top, width, height })
    .resize(width * 2, height * 2, { kernel: "lanczos3" })
    .grayscale()
    .sharpen()
    .normalize()
    .toBuffer();
}

/**
 * Recorta a área da PT e gera as 3 colunas para expedições,
 * além do bloco completo como o seu código original fazia.
 */
async function cropPartyRegions(buffer) {
  const metadata = await sharp(buffer).metadata();
  const imgW = metadata.width || 1920;
  const imgH = metadata.height || 1080;

  const cropW = Math.max(200, Math.floor(imgW * CROP_RATIO_W));
  const cropH = Math.max(200, Math.floor(imgH * CROP_RATIO_H));
  
  // Dividimos a largura em 3 para o modo expedição
  const colW = Math.floor(cropW / PARTY_COLUMNS);

  // Começamos em 0 no X e Y para manter idêntico ao seu corte original que capturava os nicks
  const [col1, col2, col3, fullRegion] = await Promise.all([
    prepareOcrRegion(buffer, 0, 0, colW, cropH),
    prepareOcrRegion(buffer, colW, 0, colW, cropH),
    prepareOcrRegion(buffer, colW * 2, 0, cropW - (colW * 2), cropH),
    prepareOcrRegion(buffer, 0, 0, cropW, cropH) // Sua região inteira original
  ]);

  return { col1, col2, col3, fullRegion };
}

async function getOcrWorker() {
  if (!ocrWorker) {
    ocrWorker = await createWorker(OCR_LANGUAGE);
    await ocrWorker.setParameters({
      tessedit_pageseg_mode: '6',
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789·ツ_ []()-."
    });
  }
  return ocrWorker;
}

async function runOcr(buffer) {
  if (ocrWorkerBusy) {
    return new Promise((resolve, reject) => {
      ocrQueue.push({ buffer, resolve, reject });
    });
  }

  ocrWorkerBusy = true;
  try {
    const worker = await getOcrWorker();
    const { data } = await worker.recognize(buffer);
    return data.text;
  } finally {
    ocrWorkerBusy = false;
    if (ocrQueue.length > 0) {
      const next = ocrQueue.shift();
      runOcr(next.buffer).then(next.resolve).catch(next.reject);
    }
  }
}

function extractPlayerNames(ocrText) {
  const lines = ocrText.split("\n")
    .map(l => l.trim())
    .filter(l => l.length >= 3);

  const names = new Set();

  for (let line of lines) {
    if (/^\d{2,}$/.test(line)) continue;
    if (KNOWN_UI.has(line.toLowerCase())) continue;
    if (/\s/.test(line)) continue; 

    if (/^[^a-zA-Z0-9À-ÿ_\-\[\]()·ツ]+$/.test(line)) continue;

    // Limpeza de artefatos nas bordas
    line = line.replace(/^[^a-zA-Z0-9À-ÿ_\-\[\]()·ツ]+/, "");
    line = line.replace(/[^a-zA-Z0-9À-ÿ_\-\[\]()·ツ]+$/, "");

    if (line.length < 3 || line.length > 18) continue;
    if (/^[_\-.]+$/.test(line)) continue;

    names.add(line);
    if (names.size >= MAX_PARTY_NAMES) break;
  }

  return [...names];
}

// ==========================================
// 📋 PRESENCE MANAGEMENT
// ==========================================

function registerPresence(eventType, names, authorId, authorName) {
  const now = Date.now();

  if (!presenceCache[eventType]) {
    presenceCache[eventType] = {
      players: {},
      windowEnd: now + EVENT_WINDOW_MINUTES * 60 * 1000,
      screenshots: []
    };
  }

  const cache = presenceCache[eventType];

  if (now > cache.windowEnd) {
    cache.players = {};
    cache.windowEnd = now + EVENT_WINDOW_MINUTES * 60 * 1000;
    cache.screenshots = [];
  }

  if (!cache.players[authorName]) {
    cache.players[authorName] = {
      count: 1,
      firstSeen: now,
      lastSeen: now,
      viaScreenshot: true
    };
  } else {
    cache.players[authorName].count++;
    cache.players[authorName].lastSeen = now;
  }

  for (const name of names) {
    if (cache.players[name]) {
      cache.players[name].count++;
      cache.players[name].lastSeen = now;
    } else {
      cache.players[name] = {
        count: 1,
        firstSeen: now,
        lastSeen: now,
        viaScreenshot: false
      };
    }
  }

  cache.screenshots.push({
    authorId,
    authorName,
    names,
    timestamp: now
  });
}

function buildPresenceReport(eventType) {
  const cache = presenceCache[eventType];
  if (!cache || Object.keys(cache.players).length === 0) {
    return null;
  }

  const now = Date.now();
  const isActive = now <= cache.windowEnd;
  const timeLeft = isActive ? Math.ceil((cache.windowEnd - now) / 60000) : 0;
  const uniqueAuthors = [...new Set(cache.screenshots.map(s => s.authorName))];

  const sortedPlayers = Object.entries(cache.players)
    .sort(([, a], [, b]) => b.count - a.count)
    .map(([name, data]) => ({
      name,
      timesSeen: data.count,
      firstSeen: new Date(data.firstSeen).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      lastSeen:  new Date(data.lastSeen).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    }));

  return {
    eventType,
    label: EVENT_LABELS[eventType] || eventType,
    icon: EVENT_ICONS[eventType] || "📋",
    windowActive: isActive,
    timeLeftMinutes: timeLeft,
    totalScreenshots: cache.screenshots.length,
    uniqueAuthors,
    authorCount: uniqueAuthors.length,
    totalPlayers: sortedPlayers.length,
    players: sortedPlayers
  };
}

function buildAllReports() {
  const reports = [];
  for (const eventType of Object.keys(EVENT_LABELS)) {
    const report = buildPresenceReport(eventType);
    if (report) reports.push(report);
  }
  return reports;
}

// ==========================================
// 🚀 MAIN PROCESSING
// ==========================================

async function processPartyScreenshot(msg, eventType, attachment) {
  try {
    console.log(`[PartyScanner] Processing ${eventType} screenshot from ${msg.author.username}...`);

    const buffer = await downloadImage(attachment.url);
    const regions = await cropPartyRegions(buffer);

    // OCR nas 3 colunas paralelas + região cheia unificada
    const [col1Text, col2Text, col3Text, fullText] = await Promise.all([
      runOcr(regions.col1),
      runOcr(regions.col2),
      runOcr(regions.col3),
      runOcr(regions.fullRegion)
    ]);

    const col1Names = extractPlayerNames(col1Text);
    const col2Names = extractPlayerNames(col2Text);
    const col3Names = extractPlayerNames(col3Text);
    const fullNames = extractPlayerNames(fullText);

    // Unimos tudo eliminando duplicatas
    const mergedNames = [...new Set([...col1Names, ...col2Names, ...col3Names, ...fullNames])];

    if (mergedNames.length > 16 || mergedNames.length === 0) {
      console.log(`[PartyScanner] 📝 Raw OCR — Full: ${fullText.replace(/\n/g, " ").slice(0, 150)}`);
    }

    if (mergedNames.length === 0) {
      console.log(`[PartyScanner] ⚠️ No player names detected in ${eventType} screenshot from ${msg.author.username}`);
      try { await msg.react("❓"); } catch (e) {}
      return;
    }

    const displayName = msg.member?.displayName || msg.author.username;
    registerPresence(eventType, mergedNames, msg.author.id, displayName);

    console.log(`[PartyScanner] ✅ ${eventType}: ${displayName} — detected ${mergedNames.length} members: ${mergedNames.join(", ")}`);

    try { await msg.react("✅"); } catch (e) {}

  } catch (err) {
    console.error(`[PartyScanner] ❌ Error processing ${eventType} screenshot:`, err.message);
    try { await msg.react("❌"); } catch (e) {}
  }
}

// ==========================================
// 🎬 INITIALIZATION
// ==========================================

export function initPartyScanner(client) {
  console.log("🔍 [PartyScanner] Initializing...");

  client.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;

    const eventType = getEventTypeForChannel(msg.channel.id);
    if (!eventType) return;

    const imageAttachment = msg.attachments.find(
      a => a.contentType && a.contentType.startsWith("image/")
    );
    if (!imageAttachment) return;

    await new Promise(r => setTimeout(r, 500));
    await processPartyScreenshot(msg, eventType, imageAttachment);
  });

  console.log("✅ [PartyScanner] Ready — monitoring configured channels for screenshots");
}

export function getPartyPresenceReport(eventType = null) {
  if (eventType) {
    return buildPresenceReport(eventType);
  }
  return buildAllReports();
}

export function clearPartyPresence(eventType = null) {
  if (eventType) {
    delete presenceCache[eventType];
    return true;
  }
  presenceCache = {};
  return true;
}

export const EVENT_CONFIG = Object.entries(EVENT_LABELS).map(([key, label]) => ({
  key,
  label,
  icon: EVENT_ICONS[key]
}));
