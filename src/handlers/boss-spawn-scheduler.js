// ==========================================
// 🦁 BOSS SPAWN SCHEDULER
// Server Time (fixed UTC-4 / NA) based spawn alerts
// ==========================================

import { EmbedBuilder } from "discord.js";
import { dailyLogs, bossSpawnAlertCache } from "../core/state.js";
import { getLocalTime } from "../core/time-utils.js";
import { resolveAlertChannel } from "../core/daily-logs.js";
import { getGeneralChannelName } from "../core/server-structure.js";

// ─── Boss schedule entries ───────────────────────────────
// Each entry: { world, layer, map, boss, times }
// times: array of { h, m } in 24h format (Server Time)
// Source: official NA42 spawn table (Layer 3 + Layer 1)

// Helper: convert [hour, minute] pairs (24h) into { h, m } objects
const at = (...pairs) => pairs.map(([h, m]) => ({ h, m }));

const bossSpawns = [
  // ═══ LAYER 3 ═══
  // W1
  { world: "W1", layer: "3", map: "Bullface Forest", boss: "Mata",
    times: at([2,0],[4,0],[6,0],[8,0],[10,0],[12,0],[14,0],[16,0],[18,0],[20,0],[22,0],[0,0]) },
  { world: "W1", layer: "3", map: "Demon Bull Temple 1F", boss: "Boltox",
    times: at([1,0],[3,0],[5,0],[7,0],[9,0],[11,0],[13,0],[15,0],[17,0],[19,0],[21,0],[23,0]) },
  { world: "W1", layer: "3", map: "Bullface Fiend King's Sanctuary", boss: "Bullface Fiend King",
    times: at([3,0],[6,0],[9,0],[12,0],[15,0],[18,0],[21,0],[0,0]) },
  // W8
  { world: "W8", layer: "3", map: "Whitemaur Sealing Circle", boss: "Yeo Wihwang",
    times: at([1,0],[5,0],[9,0],[13,0],[17,0],[21,0]) },
  // W7
  { world: "W7", layer: "3", map: "Taehyul's Garden", boss: "Taehyul",
    times: at([1,0],[3,0],[5,0],[7,0],[9,0],[11,0],[13,0],[15,0],[17,0],[19,0],[21,0],[23,0]) },
  { world: "W7", layer: "3", map: "Demonic Cult Main Hall", boss: "Yiun",
    times: at([2,0],[5,0],[8,0],[11,0],[14,0],[17,0],[20,0],[23,0]) },
  // W4
  { world: "W4", layer: "3", map: "Phantasia Desert", boss: "Nefariox Obdurate Zenith",
    times: at([2,0],[4,0],[6,0],[8,0],[10,0],[12,0],[14,0],[16,0],[18,0],[20,0],[22,0],[0,0]) },
  { world: "W4", layer: "3", map: "Overlord Sealing Circle", boss: "Kurilaica",
    times: at([3,0],[6,0],[9,0],[12,0],[15,0],[18,0],[21,0],[0,0]) },
  // W2
  { world: "W2", layer: "3", map: "Redmoon Mountain", boss: "Juhui",
    times: at([2,30],[5,30],[8,30],[11,30],[14,30],[17,30],[20,30],[23,30]) },
  // W5
  { world: "W5", layer: "3", map: "Great Sabuk Wall", boss: "Faluk",
    times: at([3,30],[6,30],[9,30],[12,30],[15,30],[18,30],[21,30],[0,30]) },
  { world: "W5", layer: "3", map: "Illusion Temple", boss: "Tale Warper Fiend",
    times: at([1,30],[4,30],[7,30],[10,30],[13,30],[16,30],[19,30],[22,30]) },
  // W3
  { world: "W3", layer: "3", map: "Nefariox Necropolis", boss: "Tombbeast Gyo",
    times: at([2,30],[8,30],[14,30],[20,30]) },
  { world: "W3", layer: "3", map: "Viperbeast Plain", boss: "Dusk Armado Emperor",
    times: at([1,30],[3,30],[5,30],[7,30],[9,30],[11,30],[13,30],[15,30],[17,30],[19,30],[21,30],[23,30]) },
  { world: "W3", layer: "3", map: "Rockcut Tomb", boss: "Boodo",
    times: at([3,30],[9,30],[15,30],[21,30]) },
  { world: "W3", layer: "3", map: "Rockcut Tomb", boss: "Mara",
    times: at([2,30],[5,30],[8,30],[11,30],[14,30],[17,30],[20,30],[23,30]) },
  // W6
  { world: "W6", layer: "3", map: "Bicheon Town", boss: "Bicheon Sura",
    times: at([4,30],[10,30],[16,30],[22,30]) },
  { world: "W6", layer: "3", map: "Bicheon Town", boss: "Cheol Mokgang",
    times: at([2,30],[4,30],[6,30],[8,30],[10,30],[12,30],[14,30],[16,30],[18,30],[20,30],[22,30],[0,30]) },
  { world: "W6", layer: "3", map: "Phantom Woods", boss: "Wuihan",
    times: at([5,30],[11,30],[17,30],[23,30]) },
  { world: "W6", layer: "3", map: "Bicheon Labyrinth", boss: "Obscene Yeticlops",
    times: at([6,30],[12,30],[18,30],[0,30]) },
  { world: "W6", layer: "3", map: "Demonic Mine Depths", boss: "Hong Yeom",
    times: at([1,30],[3,30],[5,30],[7,30],[9,30],[11,30],[13,30],[15,30],[17,30],[19,30],[21,30],[23,30]) },

  // ═══ LAYER 1 ═══
  // W1
  { world: "W1", layer: "1", map: "Unseo Town", boss: "Jihwa",
    times: at([2,30],[5,30],[8,30],[11,30],[14,30],[17,30],[20,30],[23,30]) },
  { world: "W1", layer: "1", map: "Seven Valleys Mountain", boss: "Black Carapace Dusk Armado",
    times: at([3,30],[6,30],[9,30],[12,30],[15,30],[18,30],[21,30],[0,30]) },
  { world: "W1", layer: "1", map: "Seven Valleys Mountain", boss: "Nightyes Yaksha",
    times: at([3,30],[9,30],[15,30],[21,30]) },
  { world: "W1", layer: "1", map: "Roaring Flame Island", boss: "Bulhu",
    times: at([4,30],[10,30],[16,30],[22,30]) },
  // W2
  { world: "W2", layer: "1", map: "Nine Dragon Ice Field", boss: "Guemgwang",
    times: at([5,30],[11,30],[17,30],[23,30]) },
  { world: "W2", layer: "1", map: "Underground Jail", boss: "Molgrash",
    times: at([1,30],[4,30],[7,30],[10,30],[13,30],[16,30],[19,30],[22,30]) },
  { world: "W2", layer: "1", map: "Underground Jail", boss: "Do Maengryong",
    times: at([6,30],[12,30],[18,30],[0,30]) },
  { world: "W2", layer: "1", map: "Nine Dragon Ice Palace", boss: "Wi Gwangryeong",
    times: at([2,30],[5,30],[8,30],[11,30],[14,30],[17,30],[20,30],[23,30]) },
  // W3
  { world: "W3", layer: "1", map: "Primal Nefariox Ruins", boss: "Krog",
    times: at([1,30],[7,30],[13,30],[19,30]) },
  { world: "W3", layer: "1", map: "Frozen Gorge", boss: "Talasa",
    times: at([2,30],[5,30],[8,30],[11,30],[14,30],[17,30],[20,30],[23,30]) },
  { world: "W3", layer: "1", map: "Frozen Gorge", boss: "Kelis",
    times: at([2,30],[8,30],[14,30],[20,30]) },
  { world: "W3", layer: "1", map: "Ancient One's Old Castle", boss: "Barkas",
    times: at([3,30],[9,30],[15,30],[21,30]) },
  { world: "W3", layer: "1", map: "Hydra's Temple", boss: "Morg",
    times: at([4,30],[10,30],[16,30],[22,30]) },
  { world: "W3", layer: "1", map: "Hydra's Temple", boss: "Bargan",
    times: at([3,30],[6,30],[9,30],[12,30],[15,30],[18,30],[21,30],[0,30]) },
  { world: "W3", layer: "1", map: "Hydra's Depths", boss: "Bordo",
    times: at([5,30],[11,30],[17,30],[23,30]) },
];

// ─── Build spawn time key for cache ──────────────────────

function spawnKey(bossIndex, hour, minute) {
  return `${bossIndex}-${hour}-${minute}`;
}

// ─── Check for upcoming spawns ───────────────────────────

function getUpcomingSpawnAlerts() {
  const now = getLocalTime();
  const results = [];

  for (let i = 0; i < bossSpawns.length; i++) {
    const entry = bossSpawns[i];

    for (const time of entry.times) {
      // Calculate the "5 minutes before" time
      let alertH = time.h;
      let alertM = time.m - 5;
      if (alertM < 0) {
        alertM += 60;
        alertH = (alertH - 1 + 24) % 24;
      }

      // Check if current server time matches the alert time
      if (now.getHours() === alertH && now.getMinutes() === alertM) {
        const key = spawnKey(i, time.h, time.m);
        if (!bossSpawnAlertCache[key]) {
          results.push({ entry, spawnTime: time, cacheKey: key });
        }
      }
    }
  }

  return results;
}

// ─── Send notification ───────────────────────────────────

export async function sendBossSpawnAlerts() {
  // Uses the configured channel ID, or falls back to a text channel named ⏰ reminders
  const channel = await resolveAlertChannel(dailyLogs.bossSpawnChannelId, getGeneralChannelName("reminders"));
  if (!channel) return;

  const alerts = getUpcomingSpawnAlerts();
  if (alerts.length === 0) return;

  // Group alerts by their spawn time — bosses at the same time go in one message
  const groups = new Map(); // "h:m" -> [alerts]
  for (const alert of alerts) {
    const key = `${alert.spawnTime.h}:${alert.spawnTime.m}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(alert);
  }

  for (const [key, groupAlerts] of groups) {
    const spawnTime = groupAlerts[0].spawnTime;

    const spawnHour12 = spawnTime.h % 12 || 12;
    const amPm = spawnTime.h < 12 ? "AM" : "PM";
    const timeStr = `${spawnHour12}:${String(spawnTime.m).padStart(2, "0")} ${amPm}`;

    const bossList = groupAlerts
      .map(a => `• **${a.entry.boss}** at **${a.entry.map}** (${a.entry.world} Layer ${a.entry.layer})`)
      .join("\n");

    const description =
      `The following bosses are spawning in **5 minutes**:\n\n` +
      `${bossList}\n\n` +
      `⏰ **Spawn time:** ${timeStr} (Server Time)\n\n` +
      `Prepare yourselves and **don't forget to do the mission!** 💪`;

    const embed = new EmbedBuilder()
      .setTitle("🛡️ Boss Spawning Soon! ⚔️")
      .setColor("#ff4444")
      .setDescription(description)
      .setTimestamp();

    try {
      await channel.send({ embeds: [embed] });
      for (const alert of groupAlerts) {
        bossSpawnAlertCache[alert.cacheKey] = true;
      }
      console.log(`✅ [Boss Spawn Alert] Sent: ${groupAlerts.map(a => a.entry.boss).join(", ")} at ${timeStr}`);
    } catch (err) {
      console.error(`❌ [Boss Spawn Alert] Failed to send: ${err.message}`);
    }
  }
}

// ══════════════════════════════════════════════════════════
// 🌍 SCHEDULED EVENT ALERTS (World Boss, Labyrinth, Purgatory)
// — 10 minutes before each spawn, with @everyone mention.
// Everything else (Red Boss, Leader 3, SP12, Golden Sphere,
// weekly Abbadon/War/Heist...) was removed to stop spam.
// ══════════════════════════════════════════════════════════

const scheduledEvents = [
  { name: "Purgatory", hours: [0, 6, 12, 18] },
  { name: "World Boss Labyrinth", hours: [10, 20] },
  { name: "World Boss Valley", hours: [12, 22] },
  { name: "Mirage World Boss", hours: [0, 22] },
];

// Day-specific weekly events (only Purgatory-related ones kept)
// getDay(): Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6
const weeklyScheduledEvents = [
  { name: "Hellbar (7F Purgatory)", day: 3, hour: 23 },
];

let scheduledEventAlertCache = {};

export function resetScheduledEventAlertCache() {
  scheduledEventAlertCache = {};
}

function getUpcomingScheduledAlerts() {
  const now = getLocalTime();
  const currentDay = now.getDay();
  const results = [];

  for (const event of scheduledEvents) {
    for (const hour of event.hours) {
      // Calculate the "10 minutes before" time
      let alertH = hour;
      let alertM = 0 - 10;
      if (alertM < 0) {
        alertM += 60;
        alertH = (alertH - 1 + 24) % 24;
      }

      // Check if current server time matches the alert time
      if (now.getHours() === alertH && now.getMinutes() === alertM) {
        const cacheKey = `${event.name}-${hour}`;
        if (!scheduledEventAlertCache[cacheKey]) {
          results.push({ name: event.name, hour, cacheKey });
        }
      }
    }
  }

  // Check day-specific weekly events
  for (const event of weeklyScheduledEvents) {
    if (currentDay !== event.day) continue;

    let alertH = event.hour;
    let alertM = 0 - 10;
    if (alertM < 0) {
      alertM += 60;
      alertH = (alertH - 1 + 24) % 24;
    }

    if (now.getHours() === alertH && now.getMinutes() === alertM) {
      const cacheKey = `${event.name}-${event.day}-${event.hour}`;
      if (!scheduledEventAlertCache[cacheKey]) {
        results.push({ name: event.name, hour: event.hour, cacheKey });
      }
    }
  }

  return results;
}

export async function sendScheduledEventAlerts() {
  // Uses the configured channel ID, or falls back to a text channel named 📅 events
  const channel = await resolveAlertChannel(dailyLogs.scheduledEventChannelId, getGeneralChannelName("events"));
  if (!channel) return;

  const alerts = getUpcomingScheduledAlerts();
  if (alerts.length === 0) return;

  // Build list of event names for this alert time
  const eventNames = alerts.map(a => a.name);
  const firstAlert = alerts[0];

  const spawnHour12 = firstAlert.hour % 12 || 12;
  const amPm = firstAlert.hour < 12 ? "AM" : "PM";
  const timeStr = `${spawnHour12}:00 ${amPm}`;

  const description =
    `The following events are starting in **10 minutes**:\n\n` +
    eventNames.map(n => `• **${n}**`).join("\n") +
    `\n\n` +
    `⏰ **Spawn time:** ${timeStr} (Server Time)\n\n` +
    `Get ready and **don't forget to do the mission!** 💪`;

  const embed = new EmbedBuilder()
    .setTitle("🚨 Event Alert! 🚨")
    .setColor("#ff6600")
    .setDescription(description)
    .setTimestamp();

  try {
    await channel.send({ content: "@everyone", embeds: [embed] });
    for (const alert of alerts) {
      scheduledEventAlertCache[alert.cacheKey] = true;
    }
    console.log(`✅ [Event Alert] Sent: ${eventNames.join(", ")} at ${timeStr}`);
  } catch (err) {
    console.error(`❌ [Event Alert] Failed to send: ${err.message}`);
  }
}
