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

// ── Known clan member names (from rankingDb) ──
let knownNames = [];            // raw names as stored
let knownNamesNormalized = [];  // NFC-lowercased for exact matching
let knownNamesFuzzy = [];       // NFD-decomposed-stripped for fuzzy matching

/**
 * Rebuild the known-names index from the ranking database.
 * Should be called after the ranking DB is loaded/updated.
 */
export function setKnownNamesFromRankingDb(rankingDb) {
  if (!rankingDb?.users) {
    knownNames = [];
    knownNamesNormalized = [];
    knownNamesFuzzy = [];
    return;
  }

  const names = [];
  const seen = new Set();

  for (const user of Object.values(rankingDb.users)) {
    if (user.nickname && !seen.has(user.nickname)) {
      seen.add(user.nickname);
      const raw = user.nickname.trim();
      names.push(raw);
    }
    // Also collect pilot nicks (they share the owner's nickname)
    // Pilots use the same nickname as the owner
  }

  knownNames = names;
  knownNamesNormalized = names.map(n => n.normalize('NFC').toLowerCase());
  knownNamesFuzzy = names.map(n => normalizeForFuzzy(n));

  console.log(`[PartyScanner] 📖 Loaded ${names.length} known clan member names for fuzzy matching`);
}

/**
 * Normalize a string for fuzzy comparison:
 * - NFD decompose (split base + combining marks)
 * - Strip combining diacritical marks
 * - Lowercase
 * - Strip common name-special characters (brackets, dots, etc.)
 */
function normalizeForFuzzy(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')        // strip combining diacritics
    .replace(/[^\p{L}\p{N}]/gu, '')          // keep letters & numbers from ANY script
    .toLowerCase();
}

/**
 * Levenshtein distance between two strings.
 */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  // Use a single-row optimization for small strings (names are max 18 chars)
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,      // insert
        prev[j] + 1,           // delete
        prev[j - 1] + cost     // substitute
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Try to fuzzy-match an OCR name against the known clan member list.
 * Returns { matched: true, name: "corrected name" } or { matched: false }.
 */
function fuzzyMatchName(ocrName) {
  const fuzzy = normalizeForFuzzy(ocrName);
  if (fuzzy.length < 3) return null;

  // 1. Exact match on normalized name — quick path
  const normalizedOcr = ocrName.normalize('NFC').toLowerCase();
  const exactIdx = knownNamesNormalized.indexOf(normalizedOcr);
  if (exactIdx !== -1) {
    return { matched: true, name: knownNames[exactIdx], confidence: 'exact' };
  }

  // 2. Exact match on fuzzy-normalized (ignoring diacritics + special chars)
  const fuzzyIdx = knownNamesFuzzy.indexOf(fuzzy);
  if (fuzzyIdx !== -1) {
    return { matched: true, name: knownNames[fuzzyIdx], confidence: 'normalized' };
  }

  // 3. Levenshtein distance — find the closest match within threshold
  //    Threshold scales with name length: 1 edit per ~5 chars, min 1, max 3
  const threshold = Math.max(1, Math.min(3, Math.floor(fuzzy.length / 5)));

  let bestDist = Infinity;
  let bestIdx = -1;

  for (let i = 0; i < knownNamesFuzzy.length; i++) {
    const dist = levenshtein(fuzzy, knownNamesFuzzy[i]);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
      if (dist === 0) break; // can't beat zero
    }
  }

  if (bestDist > 0 && bestDist <= threshold) {
    return {
      matched: true,
      name: knownNames[bestIdx],
      confidence: 'fuzzy',
      distance: bestDist
    };
  }

  return null;
}

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
 * Crop the left-side party strip — expanded to 28% width, 92% height
 * to ensure even wide party lists or unusual UI layouts are captured.
 * Original Python logic was 22% × 88%.
 */
async function cropPartyStrip(buffer) {
  const metadata = await sharp(buffer).metadata();
  const w = metadata.width;
  const h = metadata.height;

  const cropW = Math.max(120, Math.round(w * 0.28));
  const cropH = Math.max(100, Math.round(h * 0.92));

  return await sharp(buffer)
    .extract({ left: 0, top: 0, width: cropW, height: cropH })
    .png()
    .toBuffer();
}

/**
 * Strip leading/trailing characters that are NOT plausible name chars.
 * Uses Unicode property escapes (\p{L} = any letter from any script) so
 * Japanese, Korean, Chinese, accented Latin, etc. are all preserved.
 */
function cleanName(text) {
  return text
    .replace(/^[^\p{L}\p{N}_\-\[\]()·丶ツ]+/u, '')
    .replace(/[^\p{L}\p{N}_\-\[\]()·丶ツ]+$/u, '');
}

/**
 * Validate a single token as a plausible MIR4 player name.
 * Works with any script (Latin, Japanese, Korean, Chinese, etc.).
 */
function isValidName(text) {
  const t = text.trim();

  if (t.length < 3 || t.length > 18) return false;  // MIR4 name length limits
  if (/^\p{N}+$/u.test(t)) return false;             // purely numeric (Unicode-aware)
  if (KNOWN_UI.has(t.toLowerCase())) return false;    // known UI label
  if (t.includes(" ")) return false;                  // MIR4 names have no spaces

  // Reject if after stripping common decorational symbols nothing remains
  const cleaned = t.replace(/[_\-\u005b\u005d()\u00b7\u30c4]/g, "");
  if (cleaned.length === 0) return false;
  if (/^\p{N}+$/u.test(cleaned)) return false;

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
      language: "eng,jpn,kor,cht,chs",
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

    let mergedNames = result.names || [];

    if (mergedNames.length === 0) {
      console.log(`[PartyScanner] ⚠️ No player names detected in ${eventType} screenshot from ${msg.author.username}`);
      console.log(`[PartyScanner] 📄 Raw OCR text: ${result.rawText?.slice(0, 500)}`);
      try { await msg.react("❓"); } catch (e) {}
      return;
    }

    // Step 3: Fuzzy-match OCR names against known clan members
    const unmatched = knownNames.length > 0 ? mergedNames.filter(n => !fuzzyMatchName(n)) : [];
    if (unmatched.length > 0) {
      console.log(`[PartyScanner] ⚠️ ${unmatched.length} OCR names did NOT match any known clan member: ${unmatched.join(", ")}`);
    }
    const corrections = [];
    if (knownNames.length > 0) {
      mergedNames = mergedNames.map(ocrName => {
        const match = fuzzyMatchName(ocrName);
        if (match && match.confidence !== 'exact') {
          corrections.push({ ocr: ocrName, corrected: match.name, confidence: match.confidence });
          return match.name;
        }
        return ocrName;
      });
      // Deduplicate again after corrections
      mergedNames = [...new Set(mergedNames)];
    }

    if (corrections.length > 0) {
      console.log(`[PartyScanner] 🔧 Fuzzy corrections: ${corrections.map(c => `${c.ocr} → ${c.corrected} (${c.confidence})`).join(", ")}`);
    }

    // Step 4: Register presence
    const displayName = msg.member?.displayName || msg.author.username;
    registerPresence(eventType, mergedNames, msg.author.id, displayName);

    console.log(`[PartyScanner] ✅ ${eventType}: ${displayName} — detected ${mergedNames.length} members: ${mergedNames.join(", ")}`);

    if (mergedNames.length > 16) {
      console.log(`[PartyScanner] ⚠️ Unusually high member count (${mergedNames.length})`);
    }

    // Step 5: React to acknowledge
    try { await msg.react("✅"); } catch (e) {}

  } catch (err) {
    console.error(`[PartyScanner] ❌ Error processing ${eventType} screenshot:`, err.message);
    try { await msg.react("❌"); } catch (e) {}
  }
}

// ==========================================
// 🎬 INITIALIZATION
// ==========================================

export function initPartyScanner(client, rankingDb) {
  console.log("🔍 [PartyScanner] Initializing...");

  if (OCR_SPACE_AVAILABLE) {
    console.log("✅ [PartyScanner] OCR.space API key found — ready");
  } else {
    console.log("⚠️ [PartyScanner] OCR_SPACE_API_KEY not set — set this env var for OCR support");
    console.log("   Get a free key at https://ocr.space/ocrapi");
  }

  // Load known clan member names for fuzzy matching
  setKnownNamesFromRankingDb(rankingDb);

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
