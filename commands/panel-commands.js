// ==========================================
// 🗺️ PANEL TEXT COMMANDS
// !ms, !sp, !summon
// ==========================================

import { db, lastMessages, defaultFloors, saveLocalStorage } from "../state.js";
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

    return false; // not handled
}

// ==========================================
// 🏛️ !MS COMMAND (Magic Square panels)
// ==========================================

async function handleMS(msg, lowerContent) {
    const sub = lowerContent.replace("!ms", "").trim();

    // MS11 / MS12 — Leaders, Events (Fury+Frenzy), Antidemon, Goblin
    if ("11" === sub || "12" === sub) {
        const list = [
            `${sub}squareleaders`,
            `${sub}squareevents`,
            `${sub}squareantidemon`,
            `${sub}msgoblin`
        ];
        db._panelMapping || (db._panelMapping = {});
        for (const item of list) {
            if (db._panelMapping[item] && db._panelMapping[item].channelId === msg.channel.id) {
                try {
                    const oldMsg = await msg.channel.messages.fetch(db._panelMapping[item].messageId).catch(() => null);
                    oldMsg && await oldMsg.delete().catch(() => {});
                } catch (M) {}
            }
            const sent = await msg.channel.send({
                embeds: [renderEmbed(item)],
                components: renderButtons(item)
            });
            lastMessages[item] = sent;
            db._panelMapping[item] = { channelId: msg.channel.id, messageId: sent.id };
        }
        saveLocalStorage();
        try { await msg.delete() } catch (M) {}
        return;
    }

    // MS7 - MS10
    if (!defaultFloors.includes(sub)) return;

    const norm = `${sub}squarenormal`;

    // MS9 and MS10 have two antidemon panels (1-1 and 1-2)
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
                oldMsg && await oldMsg.delete().catch(() => {});
            } catch (L) {}
        }
    }

    const m1 = await msg.channel.send({
        embeds: [renderEmbed(norm)],
        components: renderButtons(norm)
    });
    lastMessages[norm] = m1;
    db._panelMapping[norm] = { channelId: msg.channel.id, messageId: m1.id };

    for (const antiKey of antiKeys) {
        const m = await msg.channel.send({
            embeds: [renderEmbed(antiKey)],
            components: renderButtons(antiKey)
        });
        lastMessages[antiKey] = m;
        db._panelMapping[antiKey] = { channelId: msg.channel.id, messageId: m.id };
    }

    saveLocalStorage();
    try { await msg.delete() } catch (L) {}
}

// ==========================================
// 🗻 !SP COMMAND (Secret Peak panels)
// ==========================================

async function handleSP(msg, lowerContent) {
    const floorNum = lowerContent.replace("!sp", "").trim();
    
    // SP11 / SP12 — same as regular SP peaks (7-10)
    if ("11" === floorNum || "12" === floorNum) {
        const pKey = `${floorNum}peak`;
        db._panelMapping || (db._panelMapping = {});
        if (db._panelMapping[pKey] && db._panelMapping[pKey].channelId === msg.channel.id) {
            try {
                const oldMsg = await msg.channel.messages.fetch(db._panelMapping[pKey].messageId).catch(() => null);
                oldMsg && await oldMsg.delete().catch(() => {});
            } catch (C) {}
        }
        const pMsg = await msg.channel.send({
            embeds: [renderEmbed(pKey)],
            components: renderButtons(pKey)
        });
        lastMessages[pKey] = pMsg;
        db._panelMapping[pKey] = { channelId: msg.channel.id, messageId: pMsg.id };
        
        // SP12 also deploys the Random Event panel in the same channel
        if (floorNum === "12") {
            const rKey = "12randomevent";
            if (db._panelMapping[rKey] && db._panelMapping[rKey].channelId === msg.channel.id) {
                try {
                    const oldRMsg = await msg.channel.messages.fetch(db._panelMapping[rKey].messageId).catch(() => null);
                    oldRMsg && await oldRMsg.delete().catch(() => {});
                } catch (C) {}
            }
            const rMsg = await msg.channel.send({
                embeds: [renderEmbed(rKey)],
                components: renderButtons(rKey)
            });
            lastMessages[rKey] = rMsg;
            db._panelMapping[rKey] = { channelId: msg.channel.id, messageId: rMsg.id };
        }
        
        // Deploy goblin panel in the same channel for SP11 and SP12
        const gKey = `${floorNum}goblin`;
        if (db._panelMapping[gKey] && db._panelMapping[gKey].channelId === msg.channel.id) {
            try {
                const oldGMsg = await msg.channel.messages.fetch(db._panelMapping[gKey].messageId).catch(() => null);
                oldGMsg && await oldGMsg.delete().catch(() => {});
            } catch (C) {}
        }
        const gMsg = await msg.channel.send({
            embeds: [renderEmbed(gKey)],
            components: renderButtons(gKey)
        });
        lastMessages[gKey] = gMsg;
        db._panelMapping[gKey] = { channelId: msg.channel.id, messageId: gMsg.id };
        
        saveLocalStorage();
        try { await msg.delete() } catch (C) {}
        return;
    }

    if (!defaultFloors.includes(floorNum)) return;

    const pKey = `${floorNum}peak`;
    db._panelMapping || (db._panelMapping = {});

    if (db._panelMapping[pKey] && db._panelMapping[pKey].channelId === msg.channel.id) {
        try {
            const oldMsg = await msg.channel.messages.fetch(db._panelMapping[pKey].messageId).catch(() => null);
            oldMsg && await oldMsg.delete().catch(() => {});
        } catch (C) {}
    }

    const pMsg = await msg.channel.send({
        embeds: [renderEmbed(pKey)],
        components: renderButtons(pKey)
    });
    lastMessages[pKey] = pMsg;
    db._panelMapping[pKey] = { channelId: msg.channel.id, messageId: pMsg.id };
    saveLocalStorage();
    try { await msg.delete() } catch (C) {}
}

// ==========================================
// 🌀 !SUMMON COMMAND
// ==========================================

async function handleSummon(msg) {
    const pKey = "summon";
    db._panelMapping || (db._panelMapping = {});

    if (db._panelMapping[pKey] && db._panelMapping[pKey].channelId === msg.channel.id) {
        try {
            const oldMsg = await msg.channel.messages.fetch(db._panelMapping[pKey].messageId).catch(() => null);
            oldMsg && await oldMsg.delete().catch(() => {});
        } catch (C) {}
    }

    const pMsg = await msg.channel.send({
        embeds: [renderEmbed(pKey)],
        components: renderButtons(pKey)
    });
    lastMessages[pKey] = pMsg;
    db._panelMapping[pKey] = { channelId: msg.channel.id, messageId: pMsg.id };
    saveLocalStorage();
    try { await msg.delete() } catch (C) {}
}
