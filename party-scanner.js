import axios from "axios";
import sharp from "sharp";
import { dailyLogs } from "./state.js";

// ==========================================
// 🎯 PARTY SCANNER CONFIGURATION
// ==========================================

const EVENT_WINDOW_MINUTES = 75;
// ── OCR.space API ─────────────────────────
const OCR_SPACE_API_URL = "https://api.ocr.space/parse/image";
const OCR_SPACE_API_KEY = process.env.OCR_SPACE_API_KEY;
const OCR_SPACE_AVAILABLE = !!OCR_SPACE_API_KEY;

// ── OCR filtering (ported from Python backend) ──
const KNOWN_UI = new Set([
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
  "confirm", "server", "control", "display", "graphics", "sound",
  "party1", "party2", "party3"
]);

// ==========================================
// 🧠 RUNTIME STATE
// ==========================================

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
// 🖼️ OCR.SPACE BACKEND
// ==========================================

async function downloadImage(url) {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 20000
  });
  return Buffer.from(response.data);
}

/**
 * Crop the left-side party strip (22% width, 88% height) — mirrors the
 * Python crop logic so we only OCR the relevant area.
 */
async function cropPartyStrip(buffer) {
  const metadata = await sharp(buffer).metadata();
  const w = metadata.width;
  const h = metadata.height;

  const cropW = Math.max(100, Math.round(w * 0.22));
  const cropH = Math.max(100, Math.round(h * 0.88));

  return await sharp(buffer)
    .extract({ left: 0, top: 0, width: cropW, height: cropH })
    .png() // ensure PNG
    .toBuffer();
}

/**
 * Strip leading/trailing non-name characters from an OCR token.
 * Ported from the Python party_ocr.py `clean_name()`.
 */
function cleanName(text) {
  return text.replace(/^[^a-zA-Z0-9À-ÿ_\-\[\]()·ツ]+/, "")
             .replace(/[^a-zA-Z0-9À-ÿ_\-\[\]()·ツ]+$/, "")
             .trim();
}

/**
 * Validate a single token as a plausible MIR4 player name.
 */
function isValidName(text) {
  const t = text.trim();

  if (t.length < 3 || t.length > 18) return false;
  if (/^\d+$/.test(t)) return false;                // purely numeric
  if (KNOWN_UI.has(t.toLowerCase())) return false;   // known UI label
  if (t.includes(" ")) return false;                 // MIR4 names have no spaces

  // Reject if only special chars remain after stripping common symbols
  const cleaned = t.replace(/[_\-\u005b\u005d()\u00b7\u30c4]/g, "");
  if (cleaned.length === 0) return false;
  if (/^\d+$/.test(cleaned)) return false;

  return true;
}

/**
 * Run OCR via OCR.space API.
 *
 * Steps:
 *  1. Downloads the full image
 *  2. Crops to the left-side party strip (so OCR sees mostly names)
 *  3. Sends the cropped region as base64 to OCR.space
 *  4. Parses + filters the returned text into a name list
 */
async function runOcrSpaceApi(imageUrl) {
  if (!OCR_SPACE_AVAILABLE) {
    throw new Error("OCR_SPACE_API_KEY not configured. Set the OCR_SPACE_API_KEY environment variable.");
  }

  // 1. Download full image
  const fullBuffer = await downloadImage(imageUrl);

  // 2. Crop to party list area
  const croppedBuffer = await cropPartyStrip(fullBuffer);
  const base64Image = `data:image/png;base64,${croppedBuffer.toString("base64")}`;

  // 3. Send to OCR.space
  const response = await axios.post(
    OCR_SPACE_API_URL,
    new URLSearchParams({
      base64Image,
      language: "eng",
      isOverlayRequired: "false",
      detectOrientation: "true",
      scale: "true",
      OCREngine: "2"
    }),
    {
      headers: {
        apikey: OCR_SPACE_API_KEY,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      timeout: 30000
    }
  );

  const data = response.data;

  if (data.OCRExitCode !== 1) {
    throw new Error(
      `OCR.space error (exit ${data.OCRExitCode}): ${(data.ErrorMessage || []).join(", ") || "Unknown"}`
    );
  }

  if (data.IsErroredOnProcessing) {
    throw new Error(
      `OCR.space processing error: ${(data.ErrorMessage || []).join(", ") || "Unknown"}`
    );
  }

  // 4. Extract & filter player names
  const rawText = (data.ParsedResults || [])
    .map(r => r.ParsedText)
    .join("\n");

  const names = rawText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .map(l => cleanName(l))       // strip leading/trailing artifact chars
    .filter(l => l.length > 0)
    .filter(l => isValidName(l));

  return { names: [...new Set(names)], count: names.length, rawText };
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

  // Register the screenshot author
  if (!cache.players[authorName]) {
    cache.players[authorName] = {
      count: 1, firstSeen: now, lastSeen: now, viaScreenshot: true
    };
  } else {
    cache.players[authorName].count++;
    cache.players[authorName].lastSeen = now;
  }

  // Register each detected party member
  for (const name of names) {
    if (cache.players[name]) {
      cache.players[name].count++;
      cache.players[name].lastSeen = now;
    } else {
      cache.players[name] = {
        count: 1, firstSeen: now, lastSeen: now, viaScreenshot: false
      };
    }
  }

  cache.screenshots.push({ authorId, authorName, names, timestamp: now });
}

function buildPresenceReport(eventType) {
  const cache = presenceCache[eventType];
  if (!cache || Object.keys(cache.players).length === 0) return null;

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

    // Step 1: Check OCR.space availability
    if (!OCR_SPACE_AVAILABLE) {
      console.error("[PartyScanner] ❌ OCR_SPACE_API_KEY not set — skipping screenshot");
      try { await msg.react("⚠️"); } catch (e) {}
      return;
    }

    // Step 2: Run OCR via OCR.space
    const result = await runOcrSpaceApi(attachment.url);

    const mergedNames = result.names || [];

    if (mergedNames.length === 0) {
      console.log(`[PartyScanner] ⚠️ No player names detected in ${eventType} screenshot from ${msg.author.username}`);
      console.log(`[PartyScanner] 📄 Raw OCR text: ${result.rawText?.slice(0, 300)}`);
      try { await msg.react("❓"); } catch (e) {}
      return;
    }

    // Step 3: Register presence
    const displayName = msg.member?.displayName || msg.author.username;
    registerPresence(eventType, mergedNames, msg.author.id, displayName);

    console.log(`[PartyScanner] ✅ ${eventType}: ${displayName} — detected ${mergedNames.length} members: ${mergedNames.join(", ")}`);

    if (mergedNames.length > 16) {
      console.log(`[PartyScanner] ⚠️ Unusually high member count (${mergedNames.length})`);
    }

    // Step 4: React to acknowledge
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

  if (OCR_SPACE_AVAILABLE) {
    console.log("✅ [PartyScanner] OCR.space API key found — ready");
  } else {
    console.log("⚠️ [PartyScanner] OCR_SPACE_API_KEY not set — set this env var for OCR support");
    console.log("   Get a free key at https://ocr.space/ocrapi");
  }

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
  if (eventType) return buildPresenceReport(eventType);
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
