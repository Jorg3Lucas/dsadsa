// ==========================================
// 🦁 BOSS SPAWN SCHEDULER
// Server Time (Europe/Berlin) based spawn alerts
// ==========================================

import { EmbedBuilder } from "discord.js";
import { client, dailyLogs, bossSpawnAlertCache } from "./state.js";
import { getLocalTime } from "./time-utils.js";

// ─── Boss schedule entries ───────────────────────────────
// Each entry: { world, layer, map, boss, times }
// times: array of { h, m } in 24h format (Server Time)

const bossSpawns = [
  // ═══ LAYER 3 — W1 ═══
  { world: "W1", layer: "3", map: "Bullface Forest", boss: "Matha",
    times: [2,4,6,8,10,12,14,16,18,20,22,0].map(h => ({ h, m: 0 })) },
  { world: "W1", layer: "3", map: "Demon Bull Temple 1F", boss: "Boltox",
    times: [1,3,5,7,9,11,13,15,17,19,21,23].map(h => ({ h, m: 0 })) },
  { world: "W1", layer: "3", map: "Bullface Fiend King's Sanctuary", boss: "Bullface Fiend King",
    times: [3,6,9,12,15,18,21,0].map(h => ({ h, m: 0 })) },

  // ═══ LAYER 3 — W8 ═══
  { world: "W8", layer: "3", map: "Whitemaur Sealing Circle", boss: "Yeo Wihuang",
    times: [1,5,9,13,17,21].map(h => ({ h, m: 0 })) },

  // ═══ LAYER 3 — W7 ═══
  { world: "W7", layer: "3", map: "Redmoon Gorge 2F", boss: "Taehyul",
    times: [1,3,5,7,9,11,13,15,17,19,21,23].map(h => ({ h, m: 0 })) },
  { world: "W7", layer: "3", map: "Demonic Cult Main Hall", boss: "Yiun",
    times: [2,5,8,11,14,17,20,23].map(h => ({ h, m: 0 })) },

  // ═══ LAYER 3 — W4 ═══
  { world: "W4", layer: "3", map: "Phantasia Desert", boss: "Nefariox Obdurate Zenith",
    times: [2,4,6,8,10,12,14,16,18,20,22,0].map(h => ({ h, m: 0 })) },
  { world: "W4", layer: "3", map: "Overlord Sealing Circle", boss: "Kurilaca",
    times: [3,6,9,12,15,18,21,0].map(h => ({ h, m: 0 })) },

  // ═══ LAYER 3 — W2 ═══
  { world: "W2", layer: "3", map: "Redmoon Mountain", boss: "Juhui",
    times: (() => { const t=[]; for(const h of[2,5,8,11,14,17,20,23])t.push({h,m:30}); return t; })() },

  // ═══ LAYER 3 — W5 ═══
  { world: "W5", layer: "3", map: "Great Sabuk Wall Camp", boss: "Faluk",
    times: (() => { const t=[]; for(const h of[3,6,9,12,15,18,21,0])t.push({h,m:30}); return t; })() },
  { world: "W5", layer: "3", map: "Illusion Temple", boss: "Tale Warper Fiend",
    times: (() => { const t=[]; for(const h of[1,4,7,10,13,16,19,22])t.push({h,m:30}); return t; })() },

  // ═══ LAYER 3 — W3 ═══
  { world: "W3", layer: "3", map: "Viperbeast Plain", boss: "Dusk Armado Emperor",
    times: (() => { const t=[]; for(const h of[1,3,7,9,11,13,15,19,21,23])t.push({h,m:30}); return t; })() },
  { world: "W3", layer: "3", map: "Rockcut Tomb", boss: "Mara",
    times: (() => { const t=[]; for(const h of[2,5,8,11,14,17,20,23])t.push({h,m:30}); return t; })() },
  { world: "W3", layer: "3", map: "Tombbeast Gyo", boss: "Tombbeast Gyo",
    times: (() => { const t=[]; for(const h of[2,8,14,20])t.push({h,m:30}); return t; })() },
  { world: "W3", layer: "3", map: "Rockcut Tomb", boss: "Boodo",
    times: (() => { const t=[]; for(const h of[3,9,15,21])t.push({h,m:30}); return t; })() },

  // ═══ LAYER 3 — W6 ═══
  { world: "W6", layer: "3", map: "Bicheon Town", boss: "Cheol Mokgang",
    times: (() => { const t=[]; for(const h of[2,4,6,8,10,12,14,16,18,20,22,0])t.push({h,m:30}); return t; })() },
  { world: "W6", layer: "3", map: "Abiss Demonic Mine", boss: "Hong Yeo",
    times: (() => { const t=[]; for(const h of[1,3,5,7,9,11,13,15,17,19,21,23])t.push({h,m:30}); return t; })() },
  { world: "W6", layer: "3", map: "Bicheon Town", boss: "Asura Bicheon",
    times: (() => { const t=[]; for(const h of[4,10,16,22])t.push({h,m:30}); return t; })() },
  { world: "W6", layer: "3", map: "Phantom Woods", boss: "Wihan",
    times: (() => { const t=[]; for(const h of[5,11,17,23])t.push({h,m:30}); return t; })() },
  { world: "W6", layer: "3", map: "Bicheon Labyrinth", boss: "Obscene Yeticlops",
    times: (() => { const t=[]; for(const h of[6,12,18,0])t.push({h,m:30}); return t; })() },

  // ═══ LAYER 1 — W1 ═══
  { world: "W1", layer: "1", map: "Unseo Town", boss: "Jihwa",
    times: (() => { const t=[]; for(const h of[2,5,8,11,14,17,20,23])t.push({h,m:30}); return t; })() },
  { world: "W1", layer: "1", map: "Seven Valleys Mountain", boss: "Nighteyes Yaksha",
    times: (() => { const t=[]; for(const h of[3,9,15,21])t.push({h,m:30}); return t; })() },
  { world: "W1", layer: "1", map: "Seven Valleys Mountain", boss: "Black Carapace Dusk Armado",
    times: (() => { const t=[]; for(const h of[0,3,6,9,12,15,18,21])t.push({h,m:30}); return t; })() },
  { world: "W1", layer: "1", map: "Roaring Flame Island", boss: "Bulhu",
    times: (() => { const t=[]; for(const h of[4,10,16,22])t.push({h,m:30}); return t; })() },

  // ═══ LAYER 1 — W2 ═══
  { world: "W2", layer: "1", map: "Nine Dragon Ice Field", boss: "Guemugwang",
    times: (() => { const t=[]; for(const h of[5,11,17,23])t.push({h,m:30}); return t; })() },
  { world: "W2", layer: "1", map: "Underground Jail", boss: "Do Maeongryong",
    times: (() => { const t=[]; for(const h of[0,6,12,18])t.push({h,m:30}); return t; })() },
  { world: "W2", layer: "1", map: "Underground Jail", boss: "Molgrash",
    times: (() => { const t=[]; for(const h of[1,4,7,10,13,16,19,22])t.push({h,m:30}); return t; })() },
  { world: "W2", layer: "1", map: "Nine Dragon Palace", boss: "Wi Gwangryeong",
    times: (() => { const t=[]; for(const h of[2,5,8,11,14,17,20,23])t.push({h,m:30}); return t; })() },

  // ═══ GOLDEN SPHERE ═══
  { world: "W1", layer: "1", map: "Roaring Flame Island", boss: "Golden Sphere",
    times: [3,9,15,21].map(h => ({ h, m: 0 })) },
  { world: "W2", layer: "1", map: "Nine Dragon Palace", boss: "Golden Sphere",
    times: [5,11,17,23].map(h => ({ h, m: 0 })) },
];

// ─── Build spawn time key for cache ──────────────────────

function spawnKey(bossIndex, hour, minute) {
  return `${bossIndex}-${hour}-${minute}`;
}

// ─── Check for upcoming spawns ───────────────────────────

export function getUpcomingSpawnAlerts() {
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

export { bossSpawns };

// ─── Send notification ───────────────────────────────────

export async function sendBossSpawnAlerts() {
  if (!dailyLogs.bossSpawnChannelId) return;

  const channel = await client.channels.fetch(dailyLogs.bossSpawnChannelId).catch(() => null);
  if (!channel) return;

  const alerts = getUpcomingSpawnAlerts();
  if (alerts.length === 0) return;

  for (const alert of alerts) {
    const { entry, spawnTime, cacheKey } = alert;

    const spawnHour12 = spawnTime.h % 12 || 12;
    const amPm = spawnTime.h < 12 ? "AM" : "PM";
    const timeStr = `${spawnHour12}:${String(spawnTime.m).padStart(2, "0")} ${amPm}`;

    const embed = new EmbedBuilder()
      .setTitle("🛡️ Boss Spawning Soon! ⚔️")
      .setColor("#ff4444")
      .setDescription(
        `**${entry.boss}** at **${entry.map}** (${entry.world} Layer ${entry.layer})\n\n` +
        `⏰ **Spawning in 5 minutes** — ${timeStr} (Server Time)\n\n` +
        `Prepare yourselves and **don't forget to do the mission!** 💪`
      )
      .setTimestamp();

    try {
      await channel.send({ embeds: [embed] });
      bossSpawnAlertCache[cacheKey] = true;
      console.log(`✅ [Boss Spawn Alert] Sent: ${entry.boss} at ${entry.map} (${timeStr})`);
    } catch (err) {
      console.error(`❌ [Boss Spawn Alert] Failed to send: ${err.message}`);
    }
  }
}
