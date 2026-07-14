// ==========================================
// 📊 SALARY — Voting Interaction Handlers
// Extracted from salary-poll.js
// ==========================================

import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { rankingDb } from "../core/state.js";
import { noop } from "../core/config.js";
import { getSalaryState, saveSalaryState, getFormattedWeekRange } from "./salary-state.js";
import { createOrUpdatePollMessage } from "./salary-lifecycle.js";
import { syncSingleVoteToSheet } from "./salary-sheets.js";

const PERCENT_OPTIONS = [0, 25, 50, 75, 100];

const STONE_EMOJIS = { yellow: "🎨", purple: "🟣" };

const voteSessionCache = {};

// ─── Handle Vote Button ─────────────────────

/** Show the vote UI (percentage select menus). @returns {Promise<Message>} ephemeral reply */
export async function handleVoteButton(interaction) {
    const state = getSalaryState();
    if (state.status !== "open") {
        return await interaction.reply({
            content: "❌ The poll is currently closed. Wait for next Monday at 12:30 (BRT)!",
            flags: 64
        }).catch(noop);
    }

    const userId = interaction.user.id;
    let currentVote = state.votes[userId];
    if (!currentVote && rankingDb && rankingDb.users) {
        for (const [uid, data] of Object.entries(rankingDb.users)) {
            if (data.pilotIds && data.pilotIds.includes(userId)) {
                currentVote = state.votes[uid] || null;
                break;
            }
        }
    }

    voteSessionCache[userId] = {
        yellowPercent: currentVote ? currentVote.yellowPercent : null,
        purplePercent: currentVote ? currentVote.purplePercent : null
    };

    const percentOptions = PERCENT_OPTIONS.map(p => ({
        label: p === 0 ? "0% — No stones" : `${p}%`,
        value: String(p),
        emoji: p === 0 ? "🚫" : p <= 50 ? "🔸" : "🔶"
    }));

    const yellowSelect = new StringSelectMenuBuilder()
        .setCustomId(`salary_yellow_${userId}`)
        .setPlaceholder("🎨 Choose % of Yellow Stones")
        .addOptions(percentOptions);

    const purpleSelect = new StringSelectMenuBuilder()
        .setCustomId(`salary_purple_${userId}`)
        .setPlaceholder("🟣 Choose % of Purple Stones")
        .addOptions(percentOptions);

    const confirmBtn = new ButtonBuilder()
        .setCustomId(`salary_confirm_${userId}`).setLabel("✅ Confirm Vote").setStyle(ButtonStyle.Success);
    const cancelBtn = new ButtonBuilder()
        .setCustomId(`salary_cancel_${userId}`).setLabel("❌ Cancel").setStyle(ButtonStyle.Secondary);

    let embedDesc = "Choose the percentages for each stone type:";
    if (currentVote) {
        embedDesc += `\n\n**Your current vote:**\n` +
            `${STONE_EMOJIS.yellow} Yellow Stones: **${currentVote.yellowPercent}%**\n` +
            `${STONE_EMOJIS.purple} Purple Stones: **${currentVote.purplePercent}%**\n` +
            `⚪ Darksteel: **${currentVote.dsPercent}%**`;
    } else {
        embedDesc += "\n\n*You haven't voted this week yet.*";
    }

    const embed = new EmbedBuilder()
        .setTitle("🗳️ Your Salary Choice").setColor("#FEE75C")
        .setDescription(embedDesc)
        .addFields({ name: "📌 Rules", value: "The total (%) of Yellow Stones + Purple Stones cannot exceed **100%**.\nThe remainder will be automatically converted to ⚪ **Darksteel**." })
        .setTimestamp();

    return await interaction.reply({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(yellowSelect), new ActionRowBuilder().addComponents(purpleSelect), new ActionRowBuilder().addComponents(confirmBtn, cancelBtn)],
        flags: 64
    }).catch(noop);
}

// ─── Handle Select Menu ─────────────────────

/** Update the live preview when the user selects a percentage. */
export async function handleSalarySelect(interaction) {
    const userId = interaction.user.id;
    const customId = interaction.customId;
    const value = parseInt(interaction.values[0], 10);

    if (!voteSessionCache[userId]) {
        voteSessionCache[userId] = { yellowPercent: null, purplePercent: null };
    }

    if (customId.startsWith("salary_yellow_")) voteSessionCache[userId].yellowPercent = value;
    else if (customId.startsWith("salary_purple_")) voteSessionCache[userId].purplePercent = value;

    const yellowPct = voteSessionCache[userId].yellowPercent || 0;
    const purplePct = voteSessionCache[userId].purplePercent || 0;
    const dsPct = Math.max(0, 100 - yellowPct - purplePct);

    const embed = EmbedBuilder.from(interaction.message.embeds[0])
        .setFields({ name: "📌 Rules", value: "The total (%) of Yellow Stones + Purple Stones cannot exceed **100%**.\nThe remainder will be automatically converted to ⚪ **Darksteel**." });

    const desc = `Choose the percentages for each stone type:\n\n` +
        `**Your current selection:**\n` +
        `${STONE_EMOJIS.yellow} Yellow Stones: **${yellowPct}%**\n` +
        `${STONE_EMOJIS.purple} Purple Stones: **${purplePct}%**\n` +
        `⚪ Darksteel: **${dsPct}%**\n\n` +
        (yellowPct + purplePct > 100 ? "⚠️ **Warning:** The sum exceeds 100%! Adjust the values." :
         yellowPct + purplePct === 100 ? "⚠️ **100% in stones** — You will not receive Darksteel this week." :
         (yellowPct > 0 || purplePct > 0) ? `✅ **${dsPct}%** of your salary will be Darksteel.` :
         "💡 You will receive **100% of your salary in Darksteel**.");

    embed.setDescription(desc);

    return await interaction.update({ embeds: [embed], components: interaction.message.components }).catch(noop);
}

// ─── Handle Confirm ─────────────────────────

/** Validate and save the user's vote to state, then sync to sheets. */
export async function handleSalaryConfirm(interaction) {
    const userId = interaction.user.id;
    const session = voteSessionCache[userId];

    if (!session || session.yellowPercent === null || session.purplePercent === null) {
        return await interaction.update({
            content: "❌ You need to select the percentages of both stones before confirming!",
            embeds: [], components: [], flags: 64
        }).catch(noop);
    }

    const total = session.yellowPercent + session.purplePercent;
    if (total > 100) {
        return await interaction.update({
            content: `❌ The sum (${total}%) exceeds 100%! Adjust the values.`,
            embeds: [], components: [], flags: 64
        }).catch(noop);
    }

    const dsPercent = 100 - total;
    let effectiveUserId = userId;
    let effectiveName = interaction.member?.displayName || interaction.user.username;
    let rankedName = null;

    if (rankingDb && rankingDb.users) {
        let ownerId = null, ownerData = null;
        for (const [uid, data] of Object.entries(rankingDb.users)) {
            if (data.pilotIds && data.pilotIds.includes(userId)) { ownerId = uid; ownerData = data; break; }
        }
        if (ownerId && ownerData) {
            effectiveUserId = ownerId;
            effectiveName = ownerData.nickname || ownerData.characterName || effectiveName;
            rankedName = ownerData.nickname || ownerData.characterName || null;
        } else {
            const userData = rankingDb.users[userId];
            if (userData) rankedName = userData.nickname || userData.characterName || null;
        }
    }

    const state = getSalaryState();
    state.votes[effectiveUserId] = {
        yellowPercent: session.yellowPercent, purplePercent: session.purplePercent, dsPercent,
        userName: effectiveName, rankedName: rankedName, updatedAt: new Date().toISOString()
    };
    saveSalaryState();
    delete voteSessionCache[userId];
    await createOrUpdatePollMessage();
    syncSingleVoteToSheet(effectiveUserId, state.votes[effectiveUserId]).catch(noop);

    const embed = new EmbedBuilder()
        .setTitle("✅ Vote Registered!").setColor("#57F287")
        .setDescription(
            `**Your salary for the week** ${getFormattedWeekRange()}:\n\n` +
            `${STONE_EMOJIS.yellow} Yellow Stones: **${session.yellowPercent}%**\n` +
            `${STONE_EMOJIS.purple} Purple Stones: **${session.purplePercent}%**\n` +
            `⚪ Darksteel: **${dsPercent}%**\n\n` +
            `📝 You can change your vote until Wednesday 13:00 (BRT).`
        ).setTimestamp();

    return await interaction.update({ embeds: [embed], components: [], flags: 64 }).catch(noop);
}

// ─── Handle Cancel ──────────────────────────

/** Cancel the vote session without saving. */
export async function handleSalaryCancel(interaction) {
    const userId = interaction.user.id;
    delete voteSessionCache[userId];
    return await interaction.update({
        content: "❌ Vote canceled. No changes were saved.", embeds: [], components: [], flags: 64
    }).catch(noop);
}
