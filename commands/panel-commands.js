// ==========================================
// 🗺️ PANEL TEXT COMMANDS
// !ms, !sp, !summon
// ==========================================

import { getMsg } from "../lang.js";
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
    let sub = lowerContent.replace("!ms", "").trim();

    // MS11 / MS12 — Leaders, Events (Fury+Frenzy), Antidemon (single panel with versions)
    if ("11" === sub || "12" === sub) {
        let list = [
            `${sub}squareleaders`,
            `${sub}squareevents`,
            `${sub}squareantidemon`
        ];
        db._panelMapping || (db._panelMapping = {});
        for (let item of list) {
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
        }
        saveLocalStorage();
        try { await msg.delete() } catch (M) {}
        return;
    }

    // MS7 - MS10
    if (!defaultFloors.includes(sub)) return;

    let norm = `${sub}squarenormal`;

    // MS9 and MS10 have two antidemon panels (1-1 and 1-2)
    let antiKeys;
    if (sub === "9" || sub === "10") {
        antiKeys = [`${sub}squareantidemon11`, `${sub}squareantidemon12`];
    } else {
        antiKeys = [`${sub}squareantidemon`];
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

    for (let antiKey of antiKeys) {
        let m = await msg.channel.send({
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
    let floorNum = lowerContent.replace("!sp", "").trim();
    
    // SP11 / SP12 — unified event_group panel (Red Boss + Goblin + Random Event for SP12)
    if ("11" === floorNum || "12" === floorNum) {
        // Send the unified panel (key is just the floor number)
        const keys = [`${floorNum}`];
        // Also send legacy panels if they exist (for data migration)
        if (db[`${floorNum}peak`]) keys.push(`${floorNum}peak`);
        if (db[`${floorNum}goblin`]) keys.push(`${floorNum}goblin`);
        db._panelMapping || (db._panelMapping = {});
        for (let pKey of keys) {
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
        }
        saveLocalStorage();
        try { await msg.delete() } catch (C) {}
        return;
    }

    if (!defaultFloors.includes(floorNum)) return;

    let pKey = `${floorNum}peak`;
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
    saveLocalStorage();
    try { await msg.delete() } catch (C) {}
}

// ==========================================
// 🌀 !SUMMON COMMAND
// ==========================================

async function handleSummon(msg) {
    let pKey = "summon";
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
    saveLocalStorage();
    try { await msg.delete() } catch (C) {}
}
