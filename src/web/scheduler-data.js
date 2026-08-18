// ==========================================
// 📅 SCHEDULER DATA (site copy)
// Mirror of the bot's boss-spawn-scheduler.js
// lists, kept here so the web server never
// needs to import bot handler modules.
// If the bot schedules change, update these.
// ==========================================

// ─── World boss spawn entries (5-min reminders, #reminders) ───
// Each entry: { world, layer, map, boss, times }
// times: array of { h, m } in 24h format (Server Time)
export const bossSpawns = [
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

  // ═══ LAYER 1 — W3 (level 158+) ═══
  { world: "W3", layer: "1", map: "Underground Jail", boss: "Molgrash",
    times: (() => { const t=[]; for(const h of[1,4,7,10,13,16,19,22])t.push({h,m:30}); return t; })() },
  { world: "W3", layer: "1", map: "Nine Dragon Palace", boss: "Wi Gwangryeong",
    times: (() => { const t=[]; for(const h of[2,5,8,11,14,17,20,23])t.push({h,m:30}); return t; })() },
  { world: "W3", layer: "1", map: "Primal Nefariox Ruins", boss: "Krog",
    times: (() => { const t=[]; for(const h of[1,7,13,19])t.push({h,m:30}); return t; })() },
  { world: "W3", layer: "1", map: "Frozen Gorge", boss: "Kelis",
    times: (() => { const t=[]; for(const h of[2,8,14,20])t.push({h,m:30}); return t; })() },
  { world: "W3", layer: "1", map: "Frozen Gorge", boss: "Talasa",
    times: (() => { const t=[]; for(const h of[2,5,8,11,14,17,20,23])t.push({h,m:30}); return t; })() },
  { world: "W3", layer: "1", map: "Ancient One's Old Castle", boss: "Barkas",
    times: (() => { const t=[]; for(const h of[3,9,15,21])t.push({h,m:30}); return t; })() },
  { world: "W3", layer: "1", map: "Hydra's Temple", boss: "Bargan",
    times: (() => { const t=[]; for(const h of[4,10,16,22])t.push({h,m:30}); return t; })() },
  { world: "W3", layer: "1", map: "Hydra's Temple", boss: "Morg",
    times: (() => { const t=[]; for(const h of[3,6,9,12,15,18,21,0])t.push({h,m:30}); return t; })() },
  { world: "W3", layer: "1", map: "Hydra's Depths", boss: "Bordo",
    times: (() => { const t=[]; for(const h of[5,11,17,23])t.push({h,m:30}); return t; })() },

];

// ─── Scheduled event alerts (10-min alerts, #events) ───
export const scheduledEvents = [
  { name: "Red Boss (Secret Peak)", hours: [1, 4, 7, 10, 13, 16, 19, 22] },
  { name: "Leader 3 (Magic Square)", hours: [0, 3, 6, 9, 12, 15, 18, 21] },
  { name: "Purgatory", hours: [0, 6, 12, 18] },
  { name: "World Boss Labyrinth", hours: [10, 20] },
  { name: "World Boss Valley", hours: [12, 22] },
  { name: "Mirage World Boss", hours: [0, 22] },
  { name: "Golden Sphere (W1 Roaring Flame)", hours: [3, 9, 15, 21] },
  { name: "Golden Sphere (W2 Nine Dragon)", hours: [5, 11, 17, 23] },
  { name: "Red Boss (SP11 + SP12)", hours: [1, 7, 13, 19] },
  { name: "Random Event (SP12)", hours: [3, 9, 15, 21] },
];

// Day-specific weekly events
// getDay(): Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6
export const weeklyScheduledEvents = [
  { name: "Krukan (Schackling Abbadon)", day: 1, hour: 23 },
  { name: "Valley War", day: 3, hour: 22 },
  { name: "Hellbar (7F Purgatory)", day: 3, hour: 23 },
  { name: "Utukan (Crimson Abbadon)", day: 5, hour: 23 },
  { name: "Altar Defense + Living Wraiths Event", day: 4, hour: 22 },
  { name: "Mirage Living Wraiths", day: 4, hour: 23 },
  { name: "Heist", day: 5, hour: 22 },
];
