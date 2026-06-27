// ==========================================
// 📡 PANEL UTILITIES
// Guild-aware: all operations scoped to a guild.
// ==========================================

import {
  getLocalTime,
  getFormattedTime12h,
  parseStringToDate,
} from "./time-utils.js";
import { getMsg } from "./lang.js";
import {
  getGuildState,
  getDb,
  getClient,
  getLastMessages,
  getTimezone,
} from "./state.js";
import { renderEmbed, renderButtons, getEmbedColor } from "./panel-render.js";
import {
  STATUS_AVAILABLE,
  STATUS_KILLED,
  STATUS_KILLED_PREFIX,
} from "./constants.js";

// ==========================================
// 📡 PANEL UPDATE & NOTIFICATIONS
// ==========================================

export async function refreshVisualPanel(guildId, key) {
  const state = getGuildState(guildId);
  if (!state) return;
  const cachedMsg = state.lastMessages[key];
  if (cachedMsg) {
    try {
      await cachedMsg.edit({
        embeds: [renderEmbed(guildId, key)],
        components: renderButtons(guildId, key),
      });
    } catch (_) {
      delete state.lastMessages[key];
    }
  }
}

export async function notifyUserDM(uid, msgContent) {
  const client = getClient();
  if (!client) return;
  try {
    await (await client.users.fetch(uid)).send({
      content: msgContent,
    });
  } catch (_) {}
}

// ==========================================
// 🔄 RESET PANEL DATA (admin !reset)
// ==========================================

export function resetPanelData(guildId, key) {
  const state = getGuildState(guildId);
  if (!state) return;
  const { db, logEvent, saveLocalStorage } = state;

  const oldMapping = db._panelMapping ? db._panelMapping[key] : null;
  delete db[key];

  // Re-initialize using the same logic as bot.js
  const isPeak = key.match(/^(\d+)peak$/);
  const isNormal = key.match(/^(\d+)squarenormal$/);
  const isAnti = key.match(/^(\d+)squareantidemon(\d+)?$/);
  const is11or12 = key.match(/^(11|12)square(leaders|fury|frenzy)$/);

  if (isPeak) {
    const floor = isPeak[1];
    db[key] = {
      type: "peak",
      title: `Secret Peak ${floor}F`,
      timeWindow: "",
      next: null,
      ownerId: null,
      ownerName: null,
      left: { name: "⬅️ Left", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
      red: { name: "🟥 Red", status: STATUS_AVAILABLE, cooldown: 180, _freeSince: 0, _lastKilledTimeStr: "" },
      right: { name: "➡️ Right", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
      plant: { name: "🌱 Plant", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
      ore: { name: "⛏️ Ore", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
    };
  } else if (isNormal) {
    const floor = isNormal[1];
    db[key] = {
      type: "normal",
      title: `Magic Square ${floor}F`,
      timeWindow: "",
      next: null,
      ownerId: null,
      ownerName: null,
      boss1: { name: "1️⃣ Leader 1", status: STATUS_AVAILABLE, cooldown: 30, _freeSince: 0, _lastKilledTimeStr: "" },
      boss2: { name: "2️⃣ Leader 2", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
      boss3: { name: "3️⃣ Leader 3", status: STATUS_AVAILABLE, cooldown: 180, _freeSince: 0, _lastKilledTimeStr: "" },
      plant: { name: "🌱 Plant", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
      ore: { name: "⛏️ Ore", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
    };
  } else if (isAnti) {
    const floor = isAnti[1];
    const version = isAnti[2] || "";
    const title = version ? `Antidemon ${floor}F ${version.slice(0, 1)}-${version.slice(1)}` : `Antidemon ${floor}F`;
    db[key] = {
      type: "antidemon",
      title,
      left: { name: "LEFT ROOM", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null },
      mid: { name: "MID ROOM", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null },
      right: { name: "RIGHT ROOM", status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "", nextId: null, nextName: null, formattedTimeNext: "", endLimit: null },
    };
  } else if ("summon" === key) {
    const locTemplate = (name) => ({
      name, status: STATUS_AVAILABLE, ownerId: null, ownerName: null, time: "", timeWindow: "",
      nextId: null, nextName: null, formattedTimeNext: "", endLimit: null,
    });
    db[key] = {
      type: "summon",
      title: "🌀 Summon Locations",
      sp2: locTemplate("⭐ SP 2F"),
      sp4: locTemplate("⭐ SP 4F"),
      sp7: locTemplate("⭐ SP 7F"),
      ms11: locTemplate("👹 MS 11 (Goblin)"),
      sp11: locTemplate("⭐ SP 11F (Goblin)"),
      sp12: locTemplate("⭐ SP 12F (Goblin)"),
    };
  } else if (is11or12) {
    const num = is11or12[1];
    const type = is11or12[2];
    const isFury = "fury" === type;
    const isFrenzy = "frenzy" === type;
    db[key] = {
      type: isFury || isFrenzy ? "fixed" : "normal",
      title: `11` === num
        ? `Magic Square 11F - ${isFury ? "Fury" : isFrenzy ? "Frenzy" : "Leaders"}`
        : `Magic Square 12F - ${isFury ? "Fury" : isFrenzy ? "Frenzy" : "Leaders"}`,
      timeWindow: "", next: null, ownerId: null, ownerName: null,
      ...(isFury || isFrenzy
        ? {
            schedules: isFury ? [0, 3, 6, 9, 12, 15, 18, 21] : [2, 5, 8, 11, 14, 17, 20, 23],
            ...(isFury ? { scheduleMinutes: 30 } : {}),
          }
        : {
            boss1: { name: "1️⃣ Leader 1", status: STATUS_AVAILABLE, cooldown: 30, _freeSince: 0, _lastKilledTimeStr: "" },
            boss2: { name: "2️⃣ Leader 2", status: STATUS_AVAILABLE, cooldown: 60, _freeSince: 0, _lastKilledTimeStr: "" },
            boss3: { name: "3️⃣ Leader 3", status: STATUS_AVAILABLE, cooldown: 180, _freeSince: 0, _lastKilledTimeStr: "" },
          }),
    };
  }

  // Restore panel mapping if existed
  if (oldMapping) {
    db._panelMapping || (db._panelMapping = {});
    db._panelMapping[key] = oldMapping;
  }
  logEvent(`Panel ${key} data reset to defaults.`);
}

// ==========================================
// 🔄 MIGRATION: Clean emoji prefixes
// ==========================================

export function migrateNamesCleanEmojis(guildId) {
  const state = getGuildState(guildId);
  if (!state) return;
  const { db, saveLocalStorage, logEvent } = state;

  let migrated = 0;
  const emojiReplacements = [
    { from: "Left Boss", to: "⬅️ Left" },
    { from: "Red Boss", to: "🟥 Red" },
    { from: "Right Boss", to: "➡️ Right" },
    { from: "Golden Plant", to: "🌱 Plant" },
    { from: "Golden Ore", to: "⛏️ Ore" },
    { from: "Leader 1", to: "1️⃣ Leader 1" },
    { from: "Leader 2", to: "2️⃣ Leader 2" },
    { from: "Leader 3", to: "3️⃣ Leader 3" },
    { from: "⬅️ LEFT ROOM", to: "LEFT ROOM" },
    { from: "🔵 MID ROOM", to: "MID ROOM" },
    { from: "➡️ RIGHT ROOM", to: "RIGHT ROOM" },
    { from: "🏔️ Secret Peak ", to: "Secret Peak " },
    { from: "🔮 Magic Square ", to: "Magic Square " },
    { from: "👹 Antidemon ", to: "Antidemon " },
    { from: "👑 Magic Square ", to: "Magic Square " },
  ];

  for (const key in db) {
    if (!db[key] || key.startsWith("_")) continue;
    const current = db[key];
    let changed = false;
    for (const r of emojiReplacements) {
      if (current.title && current.title.includes(r.from)) {
        current.title = current.title.replace(r.from, r.to);
        changed = true;
      }
    }
    for (const prop in current) {
      if (!["title", "timeWindow", "next", "ownerId", "ownerName", "type", "schedules", "_claimTimestamp"].includes(prop) && current[prop] && current[prop].name) {
        for (const r of emojiReplacements) {
          if (current[prop].name === r.from) {
            current[prop].name = r.to;
            changed = true;
          }
        }
      }
    }
    if (changed) migrated++;
  }

  if (migrated > 0) {
    saveLocalStorage();
    logEvent(`Cleaned emoji prefixes from ${migrated} existing panel entries.`);
  }
}

// ==========================================
// 🔄 MIGRATION: Backfill cooldown on existing boss entries
// ==========================================

export function migrateBossCooldowns(guildId) {
  const state = getGuildState(guildId);
  if (!state) return;
  const { db, saveLocalStorage, logEvent } = state;

  let migrated = 0;
  for (const key in db) {
    if (!db[key] || key.startsWith("_")) continue;
    const current = db[key];

    if ("peak" === current.type && current.red) {
      if (!current.red.cooldown) {
        current.red.cooldown = 180;
        if (!current.red._freeSince) current.red._freeSince = 0;
        if (!current.red._lastKilledTimeStr) current.red._lastKilledTimeStr = "";
        migrated++;
      }
    }
    if ("normal" === current.type && current.boss3) {
      if (!current.boss3.cooldown) {
        current.boss3.cooldown = 180;
        if (!current.boss3._freeSince) current.boss3._freeSince = 0;
        if (!current.boss3._lastKilledTimeStr) current.boss3._lastKilledTimeStr = "";
        migrated++;
      }
    }
  }

  if (migrated > 0) {
    saveLocalStorage();
    logEvent(`Migrated cooldown property for ${migrated} existing boss entries.`);
  }
}

// ==========================================
// 🔄 MIGRATION: Backfill _lastKilledAt timestamp
// ==========================================

export function migrateLastKilledAt(guildId) {
  const state = getGuildState(guildId);
  if (!state) return;
  const { db, saveLocalStorage, logEvent, timezone } = state;

  let migrated = 0;
  for (const key in db) {
    if (!db[key] || key.startsWith("_")) continue;
    const current = db[key];
    for (const prop in current) {
      if (["title", "timeWindow", "next", "ownerId", "ownerName", "type", "schedules", "_claimTimestamp"].includes(prop)) continue;
      const bossData = current[prop];
      if (!bossData || typeof bossData !== "object") continue;

      if (bossData.status && bossData.status.startsWith(STATUS_KILLED) && !bossData._lastKilledAt) {
        const killedTimeStr = bossData.status.replace(STATUS_KILLED_PREFIX, "").trim();
        const killedDate = parseStringToDate(killedTimeStr, timezone);
        if (killedDate && !isNaN(killedDate.getTime())) {
          bossData._lastKilledAt = killedDate.getTime();
          migrated++;
        }
      }
      if (bossData.status === STATUS_AVAILABLE && !bossData._lastKilledAt && bossData._lastKilledTimeStr) {
        const killedDate = parseStringToDate(bossData._lastKilledTimeStr, timezone);
        if (killedDate && !isNaN(killedDate.getTime())) {
          const diffMs = getLocalTime(timezone).getTime() - killedDate.getTime();
          if (diffMs > 0) {
            bossData._lastKilledAt = killedDate.getTime();
            migrated++;
          }
        }
      }
      if (bossData._lastKilledAt && !bossData._lastKilledTimeStr) {
        bossData._lastKilledTimeStr = getFormattedTime12h(new Date(bossData._lastKilledAt));
        migrated++;
      }
    }
  }

  if (migrated > 0) {
    saveLocalStorage();
    logEvent(`Migrated _lastKilledAt timestamp for ${migrated} existing boss entries.`);
  }
}

// ==========================================
// 🔄 AUTO-RECOVERY ON BOOT
// ==========================================

export async function processAutoRecoveryOnBoot(guildId) {
  const state = getGuildState(guildId);
  if (!state) return;
  const { db, saveLocalStorage, logEvent, client } = state;

  logEvent("Starting automatic panel recovery and chat cleanup...");
  db._panelMapping || (db._panelMapping = {});

  for (const key in db) {
    if (!db[key] || key.startsWith("_")) continue;
    const mapping = db._panelMapping[key];
    if (mapping && mapping.channelId && mapping.messageId) {
      try {
        const channel = await client.channels.fetch(mapping.channelId).catch(() => null);
        if (!channel) continue;
        try {
          const msg = await channel.messages.fetch(mapping.messageId).catch(() => null);
          if (msg) await msg.delete().catch(() => {});
        } catch (_) {}
        const newMsg = await channel
          .send({
            embeds: [renderEmbed(guildId, key)],
            components: renderButtons(guildId, key),
          })
          .catch(() => null);
        if (newMsg) {
          state.lastMessages[key] = newMsg;
          db._panelMapping[key] = { channelId: channel.id, messageId: newMsg.id };
        }
      } catch (s) {
        logEvent(`Failed to restore panel ${key}: ${s.message}`);
      }
    }
  }
  saveLocalStorage();
}
