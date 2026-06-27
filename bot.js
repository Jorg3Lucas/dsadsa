// ==========================================
// 🚀 CLAIM SYSTEM INITIALIZATION
// Per-guild initialization of floor data,
// migrations, panel recovery, and tick interval.
// ==========================================

import "dotenv/config";
import {
  getGuildState,
  getDb,
  getDefaultFloors,
  getLastMessages,
} from "./state.js";
import {
  migrateBossCooldowns,
  migrateNamesCleanEmojis,
  migrateLastKilledAt,
  processAutoRecoveryOnBoot,
  refreshVisualPanel,
} from "./panel-utils.js";
import { startTickInterval } from "./panel-tick.js";
import { STATUS_AVAILABLE } from "./constants.js";

// ==========================================
// 🚀 INITIALIZATION (per guild)
// ==========================================

export function initClaimSystem(guildId) {
  const state = getGuildState(guildId);
  if (!state) {
    console.error(`❌ [${guildId}] Guild state not found.`);
    return;
  }

  const { db, defaultFloors, saveLocalStorage, logEvent } = state;

  // ── Initialize default floor data ──
  defaultFloors.forEach((floor) => {
    // ── Secret Peak ──
    if (!db[`${floor}peak`]) {
      db[`${floor}peak`] = {
        type: "peak",
        title: `Secret Peak ${floor}F`,
        timeWindow: "",
        next: null,
        ownerId: null,
        ownerName: null,
        left: {
          name: "⬅️ Left",
          status: STATUS_AVAILABLE,
          cooldown: 60,
          _freeSince: 0,
          _lastKilledTimeStr: "",
        },
        red: {
          name: "🟥 Red",
          status: STATUS_AVAILABLE,
          cooldown: 180,
          _freeSince: 0,
          _lastKilledTimeStr: "",
        },
        right: {
          name: "➡️ Right",
          status: STATUS_AVAILABLE,
          cooldown: 60,
          _freeSince: 0,
          _lastKilledTimeStr: "",
        },
        plant: {
          name: "🌱 Plant",
          status: STATUS_AVAILABLE,
          cooldown: 60,
          _freeSince: 0,
          _lastKilledTimeStr: "",
        },
        ore: {
          name: "⛏️ Ore",
          status: STATUS_AVAILABLE,
          cooldown: 60,
          _freeSince: 0,
          _lastKilledTimeStr: "",
        },
      };
    }

    // ── Magic Square (normal) ──
    if (!db[`${floor}squarenormal`]) {
      db[`${floor}squarenormal`] = {
        type: "normal",
        title: `Magic Square ${floor}F`,
        timeWindow: "",
        next: null,
        ownerId: null,
        ownerName: null,
        boss1: {
          name: "1️⃣ Leader 1",
          status: STATUS_AVAILABLE,
          cooldown: 30,
          _freeSince: 0,
          _lastKilledTimeStr: "",
        },
        boss2: {
          name: "2️⃣ Leader 2",
          status: STATUS_AVAILABLE,
          cooldown: 60,
          _freeSince: 0,
          _lastKilledTimeStr: "",
        },
        boss3: {
          name: "3️⃣ Leader 3",
          status: STATUS_AVAILABLE,
          cooldown: 180,
          _freeSince: 0,
          _lastKilledTimeStr: "",
        },
        plant: {
          name: "🌱 Plant",
          status: STATUS_AVAILABLE,
          cooldown: 60,
          _freeSince: 0,
          _lastKilledTimeStr: "",
        },
        ore: {
          name: "⛏️ Ore",
          status: STATUS_AVAILABLE,
          cooldown: 60,
          _freeSince: 0,
          _lastKilledTimeStr: "",
        },
      };
    }

    // ── Antidemon ──
    if (!db[`${floor}squareantidemon`]) {
      db[`${floor}squareantidemon`] = {
        type: "antidemon",
        title: `Antidemon ${floor}F`,
        left: {
          name: "LEFT ROOM",
          status: STATUS_AVAILABLE,
          ownerId: null,
          ownerName: null,
          time: "",
          timeWindow: "",
          nextId: null,
          nextName: null,
          formattedTimeNext: "",
          endLimit: null,
        },
        mid: {
          name: "MID ROOM",
          status: STATUS_AVAILABLE,
          ownerId: null,
          ownerName: null,
          time: "",
          timeWindow: "",
          nextId: null,
          nextName: null,
          formattedTimeNext: "",
          endLimit: null,
        },
        right: {
          name: "RIGHT ROOM",
          status: STATUS_AVAILABLE,
          ownerId: null,
          ownerName: null,
          time: "",
          timeWindow: "",
          nextId: null,
          nextName: null,
          formattedTimeNext: "",
          endLimit: null,
        },
      };
    }

    // ── Extra antidemon panels for MS9 and MS10 ──
    if (floor === "9" || floor === "10") {
      const roomTemplate = {
        name: "LEFT ROOM",
        status: STATUS_AVAILABLE,
        ownerId: null,
        ownerName: null,
        time: "",
        timeWindow: "",
        nextId: null,
        nextName: null,
        formattedTimeNext: "",
        endLimit: null,
      };
      const midTemplate = {
        name: "MID ROOM",
        status: STATUS_AVAILABLE,
        ownerId: null,
        ownerName: null,
        time: "",
        timeWindow: "",
        nextId: null,
        nextName: null,
        formattedTimeNext: "",
        endLimit: null,
      };
      const rightTemplate = {
        name: "RIGHT ROOM",
        status: STATUS_AVAILABLE,
        ownerId: null,
        ownerName: null,
        time: "",
        timeWindow: "",
        nextId: null,
        nextName: null,
        formattedTimeNext: "",
        endLimit: null,
      };

      if (!db[`${floor}squareantidemon11`]) {
        db[`${floor}squareantidemon11`] = {
          type: "antidemon",
          title: `Antidemon ${floor}F 1-1`,
          left: { ...roomTemplate },
          mid: { ...midTemplate },
          right: { ...rightTemplate },
        };
      }
      if (!db[`${floor}squareantidemon12`]) {
        db[`${floor}squareantidemon12`] = {
          type: "antidemon",
          title: `Antidemon ${floor}F 1-2`,
          left: { ...roomTemplate },
          mid: { ...midTemplate },
          right: { ...rightTemplate },
        };
      }
    }
  });

  // ── MS11 / MS12 panels ──
  [
    "11squareleaders",
    "11squarefury",
    "11squarefrenzy",
    "12squareleaders",
    "12squarefury",
    "12squarefrenzy",
  ].forEach((key) => {
    if (!db[key]) {
      const isFury = key.includes("fury");
      const isFrenzy = key.includes("frenzy");
      db[key] = {
        type: isFury || isFrenzy ? "fixed" : "normal",
        title: key.includes("11")
          ? `Magic Square 11F - ${isFury ? "Fury" : isFrenzy ? "Frenzy" : "Leaders"}`
          : `Magic Square 12F - ${isFury ? "Fury" : isFrenzy ? "Frenzy" : "Leaders"}`,
        timeWindow: "",
        next: null,
        ownerId: null,
        ownerName: null,
        ...(isFury || isFrenzy
          ? {
              schedules: isFury
                ? [0, 3, 6, 9, 12, 15, 18, 21]
                : [2, 5, 8, 11, 14, 17, 20, 23],
              ...(isFury ? { scheduleMinutes: 30 } : {}),
            }
          : {
              boss1: {
                name: "1️⃣ Leader 1",
                status: STATUS_AVAILABLE,
                cooldown: 30,
                _freeSince: 0,
                _lastKilledTimeStr: "",
              },
              boss2: {
                name: "2️⃣ Leader 2",
                status: STATUS_AVAILABLE,
                cooldown: 60,
                _freeSince: 0,
                _lastKilledTimeStr: "",
              },
              boss3: {
                name: "3️⃣ Leader 3",
                status: STATUS_AVAILABLE,
                cooldown: 180,
                _freeSince: 0,
                _lastKilledTimeStr: "",
              },
            }),
      };
    }
  });

  // ── Summon panel ──
  if (!db.summon) {
    db.summon = {
      type: "summon",
      title: "🌀 Summon Locations",
      sp2: {
        name: "⭐ SP 2F",
        status: STATUS_AVAILABLE,
        ownerId: null,
        ownerName: null,
        time: "",
        timeWindow: "",
        nextId: null,
        nextName: null,
        formattedTimeNext: "",
        endLimit: null,
      },
      sp4: {
        name: "⭐ SP 4F",
        status: STATUS_AVAILABLE,
        ownerId: null,
        ownerName: null,
        time: "",
        timeWindow: "",
        nextId: null,
        nextName: null,
        formattedTimeNext: "",
        endLimit: null,
      },
      sp7: {
        name: "⭐ SP 7F",
        status: STATUS_AVAILABLE,
        ownerId: null,
        ownerName: null,
        time: "",
        timeWindow: "",
        nextId: null,
        nextName: null,
        formattedTimeNext: "",
        endLimit: null,
      },
      ms11: {
        name: "👹 MS 11 (Goblin)",
        status: STATUS_AVAILABLE,
        ownerId: null,
        ownerName: null,
        time: "",
        timeWindow: "",
        nextId: null,
        nextName: null,
        formattedTimeNext: "",
        endLimit: null,
      },
      sp11: {
        name: "⭐ SP 11F (Goblin)",
        status: STATUS_AVAILABLE,
        ownerId: null,
        ownerName: null,
        time: "",
        timeWindow: "",
        nextId: null,
        nextName: null,
        formattedTimeNext: "",
        endLimit: null,
      },
      sp12: {
        name: "⭐ SP 12F (Goblin)",
        status: STATUS_AVAILABLE,
        ownerId: null,
        ownerName: null,
        time: "",
        timeWindow: "",
        nextId: null,
        nextName: null,
        formattedTimeNext: "",
        endLimit: null,
      },
    };
  }

  // ── Run migrations ──
  loadPunishmentsFromDisk();
  migrateBossCooldowns(guildId);
  migrateNamesCleanEmojis(guildId);
  migrateLastKilledAt(guildId);

  // ── Force-refresh all panels ──
  for (const key in db) {
    if (!db[key] || key.startsWith("_")) continue;
    refreshVisualPanel(guildId, key);
  }

  // ── Auto-recovery & tick interval ──
  processAutoRecoveryOnBoot(guildId).then(() => {
    startTickInterval();
    logEvent("Sub-system initialized and panels auto-refreshed.");
  });
}

// ==========================================
// 🔄 RE-EXPORTS (for index.js compatibility)
// ==========================================

export { handleClaimMessages, handleClaimInteractions } from "./claim-handlers.js";

// Load punishments (delegates to state)
function loadPunishmentsFromDisk() {
  // Punishments are loaded automatically in initGuildState
}
