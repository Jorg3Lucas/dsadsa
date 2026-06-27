// ==========================================
// 🗺️ PANEL TEXT COMMANDS
// Guild-aware: !ms, !sp, !summon
// ==========================================

import { getMsg } from "../lang.js";
import { getGuildState, getDb, getLastMessages, getDefaultFloors } from "../state.js";
import { renderEmbed, renderButtons } from "../panel-render.js";

// ==========================================
// 🎯 MAIN DISPATCH
// ==========================================

export async function handlePanelCommand(msg) {
  const lowerContent = msg.content.toLowerCase().trim();

  if (lowerContent.startsWith("!ms")) {
    return handleMS(msg, lowerContent);
  }
  if (lowerContent.startsWith("!sp")) {
    return handleSP(msg, lowerContent);
  }
  if ("!summon" === lowerContent) {
    return handleSummon(msg);
  }

  return false;
}

// ==========================================
// 🏛️ !MS COMMAND (Magic Square panels)
// ==========================================

async function handleMS(msg, lowerContent) {
  const guildId = msg.guildId;
  if (!guildId) return false;
  const state = getGuildState(guildId);
  if (!state) return false;
  const { db, saveLocalStorage } = state;
  const defaultFloors = getDefaultFloors(guildId);

  const sub = lowerContent.replace("!ms", "").trim();

  // MS11 / MS12 — Leaders, Fury, Frenzy
  if ("11" === sub || "12" === sub) {
    const list = [`${sub}squareleaders`, `${sub}squarefury`, `${sub}squarefrenzy`];
    db._panelMapping || (db._panelMapping = {});
    for (const item of list) {
      if (db._panelMapping[item] && db._panelMapping[item].channelId === msg.channel.id) {
        try {
          const oldMsg = await msg.channel.messages.fetch(db._panelMapping[item].messageId).catch(() => null);
          if (oldMsg) await oldMsg.delete().catch(() => {});
        } catch (_) {}
      }
      const sent = await msg.channel.send({
        embeds: [renderEmbed(guildId, item)],
        components: renderButtons(guildId, item),
      });
      state.lastMessages[item] = sent;
      db._panelMapping[item] = { channelId: msg.channel.id, messageId: sent.id };
    }
    saveLocalStorage();
    try { await msg.delete(); } catch (_) {}
    return true;
  }

  // MS7 - MS10
  if (!defaultFloors.includes(sub)) return false;

  const norm = `${sub}squarenormal`;
  let antiKeys;
  if (sub === "9" || sub === "10") {
    antiKeys = [`${sub}squareantidemon11`, `${sub}squareantidemon12`];
  } else {
    antiKeys = [`${sub}squareantidemon`];
  }

  db._panelMapping || (db._panelMapping = {});
  for (const key of [norm, ...antiKeys]) {
    if (db._panelMapping[key] && db._panelMapping[key].channelId === msg.channel.id) {
      try {
        const oldMsg = await msg.channel.messages.fetch(db._panelMapping[key].messageId).catch(() => null);
        if (oldMsg) await oldMsg.delete().catch(() => {});
      } catch (_) {}
    }
  }

  const m1 = await msg.channel.send({
    embeds: [renderEmbed(guildId, norm)],
    components: renderButtons(guildId, norm),
  });
  state.lastMessages[norm] = m1;
  db._panelMapping[norm] = { channelId: msg.channel.id, messageId: m1.id };

  for (const antiKey of antiKeys) {
    const m = await msg.channel.send({
      embeds: [renderEmbed(guildId, antiKey)],
      components: renderButtons(guildId, antiKey),
    });
    state.lastMessages[antiKey] = m;
    db._panelMapping[antiKey] = { channelId: msg.channel.id, messageId: m.id };
  }

  saveLocalStorage();
  try { await msg.delete(); } catch (_) {}
  return true;
}

// ==========================================
// 🗻 !SP COMMAND (Secret Peak panels)
// ==========================================

async function handleSP(msg, lowerContent) {
  const guildId = msg.guildId;
  if (!guildId) return false;
  const state = getGuildState(guildId);
  if (!state) return false;
  const { db, saveLocalStorage } = state;
  const defaultFloors = getDefaultFloors(guildId);

  const floorNum = lowerContent.replace("!sp", "").trim();
  if (!defaultFloors.includes(floorNum)) return false;

  const pKey = `${floorNum}peak`;
  db._panelMapping || (db._panelMapping = {});

  if (db._panelMapping[pKey] && db._panelMapping[pKey].channelId === msg.channel.id) {
    try {
      const oldMsg = await msg.channel.messages.fetch(db._panelMapping[pKey].messageId).catch(() => null);
      if (oldMsg) await oldMsg.delete().catch(() => {});
    } catch (_) {}
  }

  const pMsg = await msg.channel.send({
    embeds: [renderEmbed(guildId, pKey)],
    components: renderButtons(guildId, pKey),
  });
  state.lastMessages[pKey] = pMsg;
  db._panelMapping[pKey] = { channelId: msg.channel.id, messageId: pMsg.id };
  saveLocalStorage();
  try { await msg.delete(); } catch (_) {}
  return true;
}

// ==========================================
// 🌀 !SUMMON COMMAND
// ==========================================

async function handleSummon(msg) {
  const guildId = msg.guildId;
  if (!guildId) return false;
  const state = getGuildState(guildId);
  if (!state) return false;
  const { db, saveLocalStorage } = state;

  const pKey = "summon";
  db._panelMapping || (db._panelMapping = {});

  if (db._panelMapping[pKey] && db._panelMapping[pKey].channelId === msg.channel.id) {
    try {
      const oldMsg = await msg.channel.messages.fetch(db._panelMapping[pKey].messageId).catch(() => null);
      if (oldMsg) await oldMsg.delete().catch(() => {});
    } catch (_) {}
  }

  const pMsg = await msg.channel.send({
    embeds: [renderEmbed(guildId, pKey)],
    components: renderButtons(guildId, pKey),
  });
  state.lastMessages[pKey] = pMsg;
  db._panelMapping[pKey] = { channelId: msg.channel.id, messageId: pMsg.id };
  saveLocalStorage();
  try { await msg.delete(); } catch (_) {}
  return true;
}
