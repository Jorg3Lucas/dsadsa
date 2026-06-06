import sharp from "sharp";
import { createWorker } from "tesseract.js";
import axios from "axios";
import { dailyLogs } from "./state.js";
import { saveDailyLogs } from "./daily-logs.js";

// ==========================================
// 🎯 PARTY SCANNER CONFIGURATION
// ==========================================

const CROP_RATIO_W = 0.22; // % of image width from left edge (≈420px on 1920px)
const CROP_RATIO_H = 0.28; // % of image height from top edge (≈300px on 1080px)
const EVENT_WINDOW_MINUTES = 75; // 75 min window (covers 1h events + 15min grace)
const OCR_LANGUAGE = "eng";
const MAX_PARTY_NAMES = 15; // MIR4 max party members

/**
 * Known UI text strings that should be filtered out from OCR results.
 * These are common in MIR4 party UI.
 */
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
  "confirm", "server"
]);

// ==========================================
// 🧠 RUNTIME STATE
// ==========================================

let ocrWorker = null;
let ocrWorkerBusy = false;
const ocrQueue = [];

/**
 * In-memory presence cache per event type.
 * Structure: {
 *   portal: {
 *     players: { "PlayerName": { count, firstSeen, lastSeen } },
 *     windowEnd: timestamp,
 *     screenshots: [ { authorId, authorName, names, timestamp } ]
 *   },
 *   ...
 * }
 */
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
 * Preprocess an image region with sharp for optimal OCR accuracy:
 * - Resize 2x for better character recognition
 * - Grayscale (removes color noise)
 * - Sharpen (enhances edges)
 * - Normalize (improves contrast)
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
 * Crop the top-left party region and split into left/right halves
 * to handle MIR4's two-column party layout.
 */
async function cropPartyRegions(buffer) {
  const metadata = await sharp(buffer).metadata();
  const imgW = metadata.width || 1920;
  const imgH = metadata.height || 1080;

  const cropW = Math.max(200, Math.floor(imgW * CROP_RATIO_W));
  const cropH = Math.max(200, Math.floor(imgH * CROP_RATIO_H));
  const halfW = Math.floor(cropW / 2);

  const [fullRegion, leftHalf, rightHalf] = await Promise.all([
    prepareOcrRegion(buffer, 0, 0, cropW, cropH),
    prepareOcrRegion(buffer, 0, 0, halfW, cropH),
    // Right half starts at halfway point of the crop region
    prepareOcrRegion(buffer, halfW, 0, cropW - halfW, cropH)
  ]);

  return { fullRegion, leftHalf, rightHalf };
}

/**
 * Get or create a shared Tesseract worker.
 * We reuse the same worker to avoid the ~2s startup cost per image.
 */
async function getOcrWorker() {
  if (!ocrWorker) {
    ocrWorker = await createWorker(OCR_LANGUAGE);
  }
  return ocrWorker;
}

/**
 * Run OCR on a preprocessed image buffer.
 * Uses a mutex to prevent concurrent worker.recognize() calls,
 * which Tesseract.js does not support safely.
 */
async function runOcr(buffer) {
  // If worker is busy, queue and wait
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
    // Process next in queue
    if (ocrQueue.length > 0) {
      const next = ocrQueue.shift();
      runOcr(next.buffer).then(next.resolve).catch(next.reject);
    }
  }
}

/**
 * Parse OCR text output into clean player names.
 * Filters out UI text artifacts and known non-name strings.
 */
function extractPlayerNames(ocrText) {
  const lines = ocrText.split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 2);

  const names = new Set();

  for (let line of lines) {
    // Skip purely numeric lines (HP values, coords, timers)
    if (/^\d{2,}$/.test(line)) continue;
    if (/^[\d\s]+$/.test(line)) continue;

    // Skip lines that are only special characters (icon artifacts)
    if (/^[^a-zA-Z0-9À-ÿ_\-\[\]()]+$/.test(line)) continue;

    // Skip known UI text (case-insensitive)
    if (KNOWN_UI.has(line.toLowerCase())) continue;

    // Skip lines with whitespace — MIR4 player names never have spaces
    if (/\s/.test(line)) continue;

    // Skip lines with common UI punctuation
    if (/[:\/%><@#\$&*+=\"']/.test(line)) continue;

    // Skip lines that look like UI headers (all caps, 4+ chars)
    const hasOnlyUppercaseLetters = /^[A-ZÀ-Ü\s]+$/.test(line.replace(/[_\-\[\]()]/g, ""));
    if (hasOnlyUppercaseLetters && line.replace(/[_\-\[\]()\s]/g, "").length > 3) continue;

    // Remove leading non-name characters (speaker icon artifacts)
    line = line.replace(/^[^a-zA-Z0-9À-ÿ_\-\[\]()]+/, "");
    // Remove trailing non-name characters (HP bar artifacts)
    line = line.replace(/[^a-zA-Z0-9À-ÿ_\-\[\]()]+$/, "");

    // Validate length and content
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

/**
 * Register detected player names for an event.
 * Extends the event window if a new screenshot arrives near the end.
 */
function registerPresence(eventType, names, authorId, authorName) {
  const now = Date.now();

  // Initialize cache bucket if needed
  if (!presenceCache[eventType]) {
    presenceCache[eventType] = {
      players: {},
      windowEnd: now + EVENT_WINDOW_MINUTES * 60 * 1000,
      screenshots: []
    };
  }

  const cache = presenceCache[eventType];

  // If the event window has expired, start fresh
  if (now > cache.windowEnd) {
    cache.players = {};
    cache.windowEnd = now + EVENT_WINDOW_MINUTES * 60 * 1000;
    cache.screenshots = [];
  }

  // Register the screenshot author as a participant
  // (The author is the one who posted the screenshot)
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

  // Register each detected party member
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

  // Log the event for reporting
  cache.screenshots.push({
    authorId,
    authorName,
    names,
    timestamp: now
  });
}

/**
 * Build a presence report for a given event type.
 */
function buildPresenceReport(eventType) {
  const cache = presenceCache[eventType];
  if (!cache || Object.keys(cache.players).length === 0) {
    return null;
  }

  const now = Date.now();
  const isActive = now <= cache.windowEnd;
  const timeLeft = isActive
    ? Math.ceil((cache.windowEnd - now) / 60000)
    : 0;

  // Get unique authors (people who posted screenshots)
  const uniqueAuthors = [...new Set(cache.screenshots.map(s => s.authorName))];

  // Sort players by count (most seen first)
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

/**
 * Build a combined report for all event types.
 */
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

    // Step 1: Download the image
    const buffer = await downloadImage(attachment.url);

    // Step 2: Crop and preprocess
    const regions = await cropPartyRegions(buffer);

    // Step 3: OCR all three regions
    const [fullText, leftText, rightText] = await Promise.all([
      runOcr(regions.fullRegion),
      runOcr(regions.leftHalf),
      runOcr(regions.rightHalf)
    ]);

    // Step 4: Extract names from each region
    const leftNames = extractPlayerNames(leftText);
    const rightNames = extractPlayerNames(rightText);
    const fullNames = extractPlayerNames(fullText);

    // Step 5: Merge — dedup by exact match across all regions
    // Split-column (left+right) handles 2-column layout; full region is fallback
    const mergedNames = [...new Set([...leftNames, ...rightNames, ...fullNames])];

    // Debug: log raw OCR text when results seem off
    if (mergedNames.length > 16 || mergedNames.length === 0) {
      console.log(`[PartyScanner] 📝 Raw OCR — Full region:`);
      console.log(`  ${fullText.replace(/\n/g, "\n  ").slice(0, 500)}`);
      console.log(`[PartyScanner] 📝 Raw OCR — Left half:`);
      console.log(`  ${leftText.replace(/\n/g, "\n  ").slice(0, 500)}`);
      console.log(`[PartyScanner] 📝 Raw OCR — Right half:`);
      console.log(`  ${rightText.replace(/\n/g, "\n  ").slice(0, 500)}`);
    }

    if (mergedNames.length === 0) {
      console.log(`[PartyScanner] ⚠️ No player names detected in ${eventType} screenshot from ${msg.author.username}`);
      try { await msg.react("❓"); } catch (e) {}
      return;
    }

    // Step 6: Register presence
    const displayName = msg.member?.displayName || msg.author.username;
    registerPresence(eventType, mergedNames, msg.author.id, displayName);

    console.log(`[PartyScanner] ✅ ${eventType}: ${displayName} — detected ${mergedNames.length} members: ${mergedNames.join(", ")}`);

    // If we detected too many, warn in console but keep the data
    if (mergedNames.length > 16) {
      console.log(`[PartyScanner] ⚠️ Unusually high member count (${mergedNames.length}) — OCR may be picking up UI text`);
    }

    // Step 7: React to acknowledge
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

    // Check if this channel is configured for party scanning
    const eventType = getEventTypeForChannel(msg.channel.id);
    if (!eventType) return;

    // Check for image attachments
    const imageAttachment = msg.attachments.find(
      a => a.contentType && a.contentType.startsWith("image/")
    );
    if (!imageAttachment) return;

    // Small delay to let the image propagate on Discord's CDN
    await new Promise(r => setTimeout(r, 500));

    await processPartyScreenshot(msg, eventType, imageAttachment);
  });

  console.log("✅ [PartyScanner] Ready — monitoring configured channels for screenshots");
}

/**
 * Get the current presence report for display.
 */
export function getPartyPresenceReport(eventType = null) {
  if (eventType) {
    return buildPresenceReport(eventType);
  }
  return buildAllReports();
}

/**
 * Manually clear presence cache for an event type (admin use).
 */
export function clearPartyPresence(eventType = null) {
  if (eventType) {
    delete presenceCache[eventType];
    return true;
  }
  presenceCache = {};
  return true;
}

/**
 * Get the list of available event categories and their icons.
 */
export const EVENT_CONFIG = Object.entries(EVENT_LABELS).map(([key, label]) => ({
  key,
  label,
  icon: EVENT_ICONS[key]
}));
