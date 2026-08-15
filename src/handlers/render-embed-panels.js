// ==========================================
// 🎨 EMBED — Panel Renderer (dispatcher)
// Extracted from render-embed.js
// Summon / antidemon / default room renderers live in render-embed-rooms.js
// ==========================================

import {
    EmbedBuilder as e
} from "discord.js";
import { getLocalTime } from "../core/time-utils.js";
import { db } from "../core/state.js";
import { getEmbedColor } from "./render-embed-core.js";
import { renderSummonPanel, renderAntidemonPanel, renderDefaultPanel } from "./render-embed-rooms.js";

/** Build a complete Discord Embed for a panel, showing claim status, timers, and boss states. @param {string} key @returns {import('discord.js').EmbedBuilder} */
export function renderEmbed(key) {
    const current = db[key];
    if (!current) return new e().setTitle(getMsg("system.errorTitle"));

    const embedColor = getEmbedColor(current, key),
        now = getLocalTime();
    const embed = new e().setColor(embedColor);

    // Dynamic title with time window
    if ("antidemon" !== current.type && current.timeWindow) {
        embed.setTitle(`${current.title} \u200B \u200B \u200B \u200B \` ⏱️ ${current.timeWindow} \``);
    } else {
        embed.setTitle(current.title);
    }
    embed.setTimestamp();

    if ("summon" === current.type) {
        renderSummonPanel(embed, current, key, now);
    } else if ("antidemon" === current.type) {
        renderAntidemonPanel(embed, current, key, now);
    } else {
        renderDefaultPanel(embed, current, now);
    }
    return embed;
}
