import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import axios from "axios";
import { dailyLogs } from "./state.js";

// ==========================================
// 🎯 PARTY SCANNER CONFIGURATION
// ==========================================

const EVENT_WINDOW_MINUTES = 75;
const MAX_PARTY_NAMES = 15;
const PYTHON_SCRIPT = path.resolve("./party_ocr.py");

// ==========================================
// 🧠 RUNTIME STATE
// ==========================================

let pythonAvailable = null; // null = unknown, true/false after first check

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
// 🖼️ EASYOCR (PYTHON) BACKEND
// ==========================================

async function downloadImage(url) {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 20000
  });
  return Buffer.from(response.data);
}

/**
 * Check if Python and the EasyOCR script are available.
 * Runs once and caches the result.
 */
async function checkPythonAvailable() {
  if (pythonAvailable !== null) return pythonAvailable;

  try {
    // Check if Python exists
    await new Promise((resolve, reject) => {
      const proc = spawn("python3", ["--version"], { timeout: 5000 });
      let stderr = "";
      proc.on("error", () => reject(new Error("python3 not found")));
      proc.on("exit", (code) => {
        code === 0 ? resolve() : reject(new Error(`python3 exit code ${code}`));
      });
    });

    // Check if the OCR script exists
    if (!fs.existsSync(PYTHON_SCRIPT)) {
      throw new Error(`OCR script not found: ${PYTHON_SCRIPT}`);
    }

    pythonAvailable = true;
    console.log("[PartyScanner] ✅ Python + EasyOCR available");
    return true;
  } catch (err) {
    pythonAvailable = false;
    console.error("[PartyScanner] ❌ Python/EasyOCR not available:", err.message);
    console.error("[PartyScanner] To install: pip install easyocr opencv-python-headless numpy");
    return false;
  }
}

/**
 * Call the Python EasyOCR script to extract names from an image.
 * Saves the image to a temp file, calls the script, parses JSON output.
 */
async function runPythonOcr(imageBuffer) {
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `mir4_pt_${Date.now()}_${Math.random().toString(36).slice(2)}.png`);

  try {
    // Save image to temp file
    fs.writeFileSync(tmpFile, imageBuffer);

    // Call Python OCR script
    const result = await new Promise((resolve, reject) => {
      const proc = spawn("python3", [PYTHON_SCRIPT, tmpFile, "--debug"], {
        timeout: 120000, // 120s — EasyOCR downloads model (~100MB) on first run
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => { stdout += data.toString(); });
      proc.stderr.on("data", (data) => { stderr += data.toString(); });

      proc.on("error", (err) => reject(err));
      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Python OCR exited with code ${code}: ${stderr.slice(0, 500)}`));
        } else {
          try {
            resolve(JSON.parse(stdout));
          } catch (e) {
            reject(new Error(`Invalid JSON from Python OCR: ${stdout.slice(0, 200)}`));
          }
        }
      });
    });

    return result;
  } finally {
    // Clean up temp file
    try { fs.unlinkSync(tmpFile); } catch (e) {}
  }
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

    // Step 1: Check Python/EasyOCR availability
    const pyOk = await checkPythonAvailable();
    if (!pyOk) {
      console.log(`[PartyScanner] ❌ Python OCR unavailable — skipping screenshot`);
      try { await msg.react("⚠️"); } catch (e) {}
      return;
    }

    // Step 2: Download the image
    const buffer = await downloadImage(attachment.url);

    // Step 3: Run Python EasyOCR
    const result = await runPythonOcr(buffer);

    // Handle error from Python
    if (result.error) {
      console.error(`[PartyScanner] ❌ Python OCR error: ${result.error}`);
      try { await msg.react("❌"); } catch (e) {}
      return;
    }

    const mergedNames = result.names || [];

    // Debug: log column details when results are unexpected
    if (mergedNames.length > 16 || mergedNames.length === 0) {
      if (result.columns) {
        for (const col of result.columns) {
          console.log(`[PartyScanner] 📝 Col ${col.index + 1}: ${col.names.join(", ") || "(empty)"}`);
        }
      }
    }

    if (mergedNames.length === 0) {
      console.log(`[PartyScanner] ⚠️ No player names detected in ${eventType} screenshot from ${msg.author.username}`);
      try { await msg.react("❓"); } catch (e) {}
      return;
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

export function initPartyScanner(client) {
  console.log("🔍 [PartyScanner] Initializing...");

  // Check Python availability at startup (async, non-blocking)
  checkPythonAvailable().then(ok => {
    if (ok) {
      console.log("✅ [PartyScanner] EasyOCR backend ready");
    } else {
      console.log("⚠️ [PartyScanner] EasyOCR not available — will check again on first screenshot");
    }
  });

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
