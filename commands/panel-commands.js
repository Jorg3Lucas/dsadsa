// ==========================================
// 🗺️ PANEL TEXT COMMANDS
// !ms, !sp, !summon
// ==========================================

import { getMsg } from "../lang.js";
import { db, lastMessages, defaultFloors, saveLocalStorage } from "../state.js";
import { renderEmbed, renderButtons } from "../panel-render.js";
import { getAllServerKeys } from "../claim-resolver.js";

// ==========================================
// 🔧 Helper: resolve panel key for current channel
// ==========================================

function resolvePanelKey(baseKey, channel) {
    const keys = getAllServerKeys(baseKey);
    if (keys.length <= 1) return baseKey; // No multi-server config, use legacy
    
    // Try to match by channel's parent category to find the correct server
    if (channel?.parentId) {
        // We can't easily reverse-map category ID to server prefix here,
        // but we can check which prefixed key has a mapping in this channel
        for (const k of keys) {
            const mapping = db._panelMapping?.[k];
            if (mapping && mapping.channelId === channel.id) return k;
        }
    }
    
    // Fallback: return the first prefixed key that exists in db
    for (const k of keys) {
        if (db[k]) return k;
    }
    // Fallback to first server's key
    return keys[0];
}

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

    return false; // not handled
}

// ==========================================
// 🏛️ !MS COMMAND (Magic Square panels)
// ==========================================

async function handleMS(msg, lowerContent) {
    let sub = lowerContent.replace("!ms", "").trim();

    // MS11 / MS12 — Leaders, Events (Fury+Frenzy), Antidemon, Goblin
    if ("11" === sub || "12" === sub) {
        let list = [
            `${sub}squareleaders`,
            `${sub}squareevents`,
            `${sub}squareantidemon`,
            `${sub}msgoblin`
        ];
        db._panelMapping || (db._panelMapping = {});
        for (let rawItem of list) {
            const item = resolvePanelKey(rawItem, msg);
            if (db._panelMapping[item] && db._panelMapping[item].channelId === msg.channel.id) {
                try {
                    let oldMsg = await msg.channel.messages.fetch(db._panelMapping[item].messageId).catch(() => null);
                    oldMsg && await oldMsg.delete().catch(() => {});
                } catch (M) {}
            }
            let sent = await msg.channel.send({
                embeds: [renderEmbed(item)],
                components: renderButtons(item)
            });
            lastMessages[item] = sent;
            db._panelMapping[item] = { channelId: msg.channel.id, messageId: sent.id };
            // Track all instances for multi-server refresh
            if (!db._panelInstances) db._panelInstances = {};
            if (!db._panelInstances[item]) db._panelInstances[item] = [];
            db._panelInstances[item].push({ channelId: msg.channel.id, messageId: sent.id });
        }
        saveLocalStorage();
        try { await msg.delete() } catch (M) {}
        return;
    }

    // MS7 - MS10
    if (!defaultFloors.includes(sub)) return;

    let norm = resolvePanelKey(`${sub}squarenormal`, msg);

    // MS9 and MS10 have two antidemon panels (1-1 and 1-2)
    let antiKeys;
    if (sub === "9" || sub === "10") {
        antiKeys = [resolvePanelKey(`${sub}squareantidemon11`, msg), resolvePanelKey(`${sub}squareantidemon12`, msg)];
    } else {
        antiKeys = [resolvePanelKey(`${sub}squareantidemon`, msg)];
    }

    db._panelMapping || (db._panelMapping = {});

    for (let key of [norm, ...antiKeys]) {
        if (db._panelMapping[key] && db._panelMapping[key].channelId === msg.channel.id) {
            try {
                let oldMsg = await msg.channel.messages.fetch(db._panelMapping[key].messageId).catch(() => null);
                oldMsg && await oldMsg.delete().catch(() => {});
            } catch (L) {}
        }
    }

    let m1 = await msg.channel.send({
        embeds: [renderEmbed(norm)],
        components: renderButtons(norm)
    });
    lastMessages[norm] = m1;
    db._panelMapping[norm] = { channelId: msg.channel.id, messageId: m1.id };
    // Track all instances
    if (!db._panelInstances) db._panelInstances = {};
    if (!db._panelInstances[norm]) db._panelInstances[norm] = [];
    db._panelInstances[norm].push({ channelId: msg.channel.id, messageId: m1.id });

    for (let antiKey of antiKeys) {
        let m = await msg.channel.send({
            embeds: [renderEmbed(antiKey)],
            components: renderButtons(antiKey)
        });
        lastMessages[antiKey] = m;
        db._panelMapping[antiKey] = { channelId: msg.channel.id, messageId: m.id };
        if (!db._panelInstances) db._panelInstances = {};
        if (!db._panelInstances[antiKey]) db._panelInstances[antiKey] = [];
        db._panelInstances[antiKey].push({ channelId: msg.channel.id, messageId: m.id });
    }

    saveLocalStorage();
    try { await msg.delete() } catch (L) {}
}



// ==========================================
// 🗻 !SP COMMAND (Secret Peak panels)
// ==========================================

async function handleSP(msg, lowerContent) {
    let floorNum = lowerContent.replace("!sp", "").trim();
    
    // SP11 / SP12 — same as regular SP peaks (7-10)
    if ("11" === floorNum || "12" === floorNum) {
        let pKey = resolvePanelKey(`${floorNum}peak`, msg);
        db._panelMapping || (db._panelMapping = {});
        if (db._panelMapping[pKey] && db._panelMapping[pKey].channelId === msg.channel.id) {
            try {
                let oldMsg = await msg.channel.messages.fetch(db._panelMapping[pKey].messageId).catch(() => null);
                oldMsg && await oldMsg.delete().catch(() => {});
            } catch (C) {}
        }
    let pMsg = await msg.channel.send({
        embeds: [renderEmbed(pKey)],
        components: renderButtons(pKey)
    });
    lastMessages[pKey] = pMsg;
    db._panelMapping[pKey] = { channelId: msg.channel.id, messageId: pMsg.id };
    if (!db._panelInstances) db._panelInstances = {};
    if (!db._panelInstances[pKey]) db._panelInstances[pKey] = [];
    db._panelInstances[pKey].push({ channelId: msg.channel.id, messageId: pMsg.id });
    
    // SP12 also deploys the Random Event panel in the same channel
    if (floorNum === "12") {
        const rKey = resolvePanelKey("12randomevent", msg);
        if (db._panelMapping[rKey] && db._panelMapping[rKey].channelId === msg.channel.id) {
            try {
                let oldRMsg = await msg.channel.messages.fetch(db._panelMapping[rKey].messageId).catch(() => null);
                oldRMsg && await oldRMsg.delete().catch(() => {});
            } catch (C) {}
        }
        let rMsg = await msg.channel.send({
            embeds: [renderEmbed(rKey)],
            components: renderButtons(rKey)
        });
        lastMessages[rKey] = rMsg;
        db._panelMapping[rKey] = { channelId: msg.channel.id, messageId: rMsg.id };
        if (!db._panelInstances[rKey]) db._panelInstances[rKey] = [];
        db._panelInstances[rKey].push({ channelId: msg.channel.id, messageId: rMsg.id });
    }
    
    // Deploy goblin panel in the same channel for SP11 and SP12        const gKey = resolvePanelKey(`${floorNum}goblin`, msg);
    if (db._panelMapping[gKey] && db._panelMapping[gKey].channelId === msg.channel.id) {
        try {
            let oldGMsg = await msg.channel.messages.fetch(db._panelMapping[gKey].messageId).catch(() => null);
            oldGMsg && await oldGMsg.delete().catch(() => {});
        } catch (C) {}
    }
    let gMsg = await msg.channel.send({
        embeds: [renderEmbed(gKey)],
        components: renderButtons(gKey)
    });
    lastMessages[gKey] = gMsg;
    db._panelMapping[gKey] = { channelId: msg.channel.id, messageId: gMsg.id };
    if (!db._panelInstances[gKey]) db._panelInstances[gKey] = [];
    db._panelInstances[gKey].push({ channelId: msg.channel.id, messageId: gMsg.id });
    
    saveLocalStorage();
        try { await msg.delete() } catch (C) {}
        return;
    }

    if (!defaultFloors.includes(floorNum)) return;

    let pKey = resolvePanelKey(`${floorNum}peak`, msg);
    db._panelMapping || (db._panelMapping = {});

    if (db._panelMapping[pKey] && db._panelMapping[pKey].channelId === msg.channel.id) {
        try {
            let oldMsg = await msg.channel.messages.fetch(db._panelMapping[pKey].messageId).catch(() => null);
            oldMsg && await oldMsg.delete().catch(() => {});
        } catch (C) {}
    }

    let pMsg = await msg.channel.send({
        embeds: [renderEmbed(pKey)],
        components: renderButtons(pKey)
    });
    lastMessages[pKey] = pMsg;
    db._panelMapping[pKey] = { channelId: msg.channel.id, messageId: pMsg.id };
    if (!db._panelInstances) db._panelInstances = {};
    if (!db._panelInstances[pKey]) db._panelInstances[pKey] = [];
    db._panelInstances[pKey].push({ channelId: msg.channel.id, messageId: pMsg.id });
    saveLocalStorage();
    try { await msg.delete() } catch (C) {}
}

// ==========================================
// 🌀 !SUMMON COMMAND
// ==========================================

async function handleSummon(msg) {
    let pKey = resolvePanelKey("summon", msg);
    db._panelMapping || (db._panelMapping = {});

    if (db._panelMapping[pKey] && db._panelMapping[pKey].channelId === msg.channel.id) {
        try {
            let oldMsg = await msg.channel.messages.fetch(db._panelMapping[pKey].messageId).catch(() => null);
            oldMsg && await oldMsg.delete().catch(() => {});
        } catch (C) {}
    }

    let pMsg = await msg.channel.send({
        embeds: [renderEmbed(pKey)],
        components: renderButtons(pKey)
    });
    lastMessages[pKey] = pMsg;
    db._panelMapping[pKey] = { channelId: msg.channel.id, messageId: pMsg.id };
    if (!db._panelInstances) db._panelInstances = {};
    if (!db._panelInstances[pKey]) db._panelInstances[pKey] = [];
    db._panelInstances[pKey].push({ channelId: msg.channel.id, messageId: pMsg.id });
    saveLocalStorage();
    try { await msg.delete() } catch (C) {}
}
