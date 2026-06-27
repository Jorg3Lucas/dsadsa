// ==========================================
// 🎨 RENDERING (Embeds & Buttons)
// Guild-aware: all operations scoped to a guild.
// ==========================================

import {
  EmbedBuilder as e,
  ActionRowBuilder as t,
  ButtonBuilder as n,
  ButtonStyle as a,
  StringSelectMenuBuilder as i,
} from "discord.js";
import {
  getLocalTime,
  isRoomOpen,
  getFormattedTime12h,
  getDynamicQueueETA,
  getEndLimitCountdown,
  calculateNextOpening,
  getNextScheduleAfter,
  usesScheduleRespawn,
  getBossSchedules,
  parseStringToDate,
} from "./time-utils.js";
import { getMsg } from "./lang.js";
import { getGuildState, getDb, getTimezone } from "./state.js";
import {
  STATUS_AVAILABLE,
  STATUS_CLAIMED,
  STATUS_OPEN,
  STATUS_KILLED,
  STATUS_KILLED_PREFIX,
  STATUS_ANY_MOMENT,
  STATUS_NOW,
  COLOR_OCCUPIED,
  COLOR_HAS_QUEUE,
  COLOR_DEFAULT,
  COLOR_OPEN,
} from "./constants.js";

// ==========================================
// 🎨 RENDERING
// ==========================================

export function getEmbedColor(guildId, key) {
  const db = getDb(guildId);
  const current = db ? db[key] : null;

  if (!current) return COLOR_DEFAULT;
  if (current.ownerId) return COLOR_OCCUPIED;
  if (current.next) return COLOR_HAS_QUEUE;
  if ("antidemon" === current.type || "summon" === current.type) {
    const props =
      "summon" === current.type
        ? ["sp2", "sp4", "sp7", "ms11", "sp11", "sp12"]
        : ["left", "mid", "right"];
    const hasClaimed = props.some(
      (p) => current[p] && current[p].status.startsWith("🔴"),
    );
    if (hasClaimed) return COLOR_OCCUPIED;
    const hasQueue = props.some((p) => current[p] && current[p].nextId);
    if (hasQueue) return COLOR_HAS_QUEUE;
  }
  if ("fixed" === current.type) {
    return isRoomOpen(current.schedules, current.scheduleMinutes || 0, getTimezone(guildId))
      ? COLOR_OPEN
      : COLOR_DEFAULT;
  }
  return COLOR_DEFAULT;
}

export function renderEmbed(guildId, key) {
  const db = getDb(guildId);
  const current = db ? db[key] : null;
  const timezone = getTimezone(guildId);

  if (!current)
    return new e().setTitle(getMsg("system.errorTitle"));

  const embedColor = getEmbedColor(guildId, key);
  const now = getLocalTime(timezone);
  const embed = new e().setColor(embedColor);

  // Dynamic title with time window
  "antidemon" !== current.type && current.timeWindow
    ? embed.setTitle(
        `${current.title} \u200B \u200B \u200B \u200B \` ⏱️ ${current.timeWindow} \``,
      )
    : embed.setTitle(current.title);

  embed.setTimestamp();

  if ("antidemon" === current.type || "summon" === current.type) {
    const summonProps =
      "summon" === current.type
        ? ["sp2", "sp4", "sp7", "ms11", "sp11", "sp12"]
        : ["left", "mid", "right"];
    embed.setDescription(`**${getMsg("rooms.statusOverview")}**`);
    for (const room of summonProps) {
      const rData = current[room];
      let remainingClaimStr = "";
      if (STATUS_CLAIMED === rData.status && rData.timeWindow) {
        const endTimeStr = rData.timeWindow.split(" ~ ")[1];
        const endTime = parseStringToDate(endTimeStr, timezone);
        if (endTime) {
          const remainingSecs = Math.floor(
            (endTime.getTime() - now.getTime()) / 1e3,
          );
          if (remainingSecs > 0) {
            const mins = Math.floor(remainingSecs / 60);
            const secs = remainingSecs % 60;
            remainingClaimStr = `⏱️ ${mins}m ${secs}s (${getMsg("render.countdownUntil")} ${endTimeStr})`;
          } else {
            remainingClaimStr = "⏱️ Expiring...";
          }
        }
      }
      let block =
        STATUS_CLAIMED === rData.status && rData.ownerName
          ? `\`\`\`md\n# 👑 ${rData.ownerName}\n${remainingClaimStr || rData.time}\n\`\`\``
          : rData.endLimit && rData.nextName
            ? `\`\`\`md\n⏭️ ${rData.nextName}\n\`\`\`\n${getEndLimitCountdown(rData.endLimit, timezone)}`
            : `\`\`\`yaml\n${STATUS_AVAILABLE}\n\`\`\``;

      if (STATUS_CLAIMED === rData.status && rData.nextName) {
        block += `\n\`\`\`md\n⏭️ ${rData.nextName}\n\`\`\``;
      } else if (rData.nextName && !rData.endLimit) {
        block += `\n\`\`\`md\n⏭️ ${rData.nextName}\n\`\`\``;
      }
      embed.addFields({ name: rData.name, value: block, inline: true });
    }
  } else {
    let desc = "";

    if (current.ownerId) {
      desc += `\`\`\`md\n# ${current.ownerName || getMsg("render.unknownUser")}\n\`\`\`\n`;
      if (current.next) {
        desc += current.next.endLimit
          ? `\`\`\`md\n⏭️ ${current.next.userName} — ${getEndLimitCountdown(current.next.endLimit, timezone)}\n\`\`\`\n`
          : `\`\`\`md\n⏭️ ${current.next.userName} — 🕒 ${getMsg("rooms.expectedAt", { formattedTime: getDynamicQueueETA(current, timezone), timezone: "Server" })}\n\`\`\`\n`;
      }
    } else if (current.next && current.next.endLimit) {
      desc += `\`\`\`md\n⏭️ ${current.next.userName} — ${getEndLimitCountdown(current.next.endLimit, timezone)}\n\`\`\`\n`;
    } else if ("fixed" === current.type) {
      desc += isRoomOpen(current.schedules, current.scheduleMinutes || 0, timezone)
        ? `\`\`\`fix\n🟢 ${getMsg("rooms.roomIsOpen")}\n\`\`\`\n`
        : `\`\`\`yaml\n🔴 ${getMsg("rooms.eventEnded")}\n\`\`\`\n`;
    } else if (current.next) {
      desc += `\`\`\`md\n⏭️ ${current.next.userName} — 🕒 ${getMsg("rooms.expectedAt", { formattedTime: getDynamicQueueETA(current, timezone), timezone: "Server" })}\n\`\`\`\n`;
    } else {
      desc += `\`\`\`yaml\n${STATUS_AVAILABLE}\n\`\`\`\n`;
    }
    embed.setDescription(desc);

    if ("fixed" === current.type) {
      const minuteOffset = current.scheduleMinutes || 0;
      if (isRoomOpen(current.schedules, minuteOffset, timezone)) {
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        let endMinute = Math.ceil((nowMinutes - minuteOffset + 1) / 60) * 60 + minuteOffset;
        const endOfEvent = new Date(now.getTime());
        endOfEvent.setHours(Math.floor(endMinute / 60) % 24, endMinute % 60, 0, 0);
        if (endOfEvent <= now) endOfEvent.setHours(endOfEvent.getHours() + 1);
        const closeMins = Math.floor((endOfEvent.getTime() - now.getTime()) / 6e4);
        const countdownStr = closeMins <= 0 ? "🟢 Open now" : `🟢 Closes in ${closeMins}m`;
        embed.addFields({
          name: `⏰ ${getMsg("rooms.nextOpeningTitle")}`,
          value: `\`\`\`yaml\n${countdownStr}\n\`\`\``,
          inline: false,
        });
      } else {
        const nextOpenDate = calculateNextOpening(current.schedules, minuteOffset, timezone);
        const diffMs = nextOpenDate.getTime() - now.getTime();
        const diffMins = Math.floor(diffMs / 6e4);
        const countdownStr =
          diffMins < 60
            ? `Next in ${diffMins}m`
            : `Next in ${Math.floor(diffMins / 60)}h ${diffMins % 60}m`;
        embed.addFields({
          name: `⏰ ${getMsg("rooms.nextOpeningTitle")}`,
          value: `\`\`\`yaml\n${countdownStr}\n\`\`\``,
          inline: false,
        });
      }
    } else {
      for (const prop in current) {
        if (
          ![
            "title",
            "timeWindow",
            "next",
            "ownerId",
            "ownerName",
            "type",
            "schedules",
            "_claimTimestamp",
          ].includes(prop)
        ) {
          let displayStatus = current[prop].status;

          if (displayStatus.startsWith(STATUS_KILLED) && current[prop].cooldown) {
            let killedTime;
            if (current[prop]._lastKilledAt) {
              killedTime = new Date(current[prop]._lastKilledAt);
            } else {
              killedTime = parseStringToDate(
                displayStatus.replace(STATUS_KILLED_PREFIX, "").trim(),
                timezone,
              );
            }
            if (killedTime) {
              if (usesScheduleRespawn(current, prop)) {
                const schedules = getBossSchedules(current, prop);
                const nextSpawn = getNextScheduleAfter(killedTime, schedules);
                if (nextSpawn) {
                  const remainingMs = nextSpawn.getTime() - now.getTime();
                  if (remainingMs > 0) {
                    const totalMins = Math.ceil(remainingMs / 6e4);
                    const hrs = Math.floor(totalMins / 60);
                    const mins = totalMins % 60;
                    displayStatus =
                      hrs > 0
                        ? `🔴 Respawn in ${hrs}h ${mins}m`
                        : `🔴 Respawn in ${mins}m`;
                  } else {
                    displayStatus = STATUS_ANY_MOMENT;
                  }
                }
              } else {
                const totalCooldownSeconds = 60 * current[prop].cooldown;
                const secondsPassed = Math.floor(
                  (now.getTime() - killedTime.getTime()) / 1e3,
                );
                const remainingSeconds = totalCooldownSeconds - secondsPassed;
                if (remainingSeconds > 0) {
                  const mins = Math.floor(remainingSeconds / 60);
                  const secs = remainingSeconds % 60;
                  displayStatus = `🔴 Respawn in ${mins}m ${secs}s`;
                } else {
                  displayStatus = STATUS_ANY_MOMENT;
                }
              }
            }
          }

          if (displayStatus === STATUS_AVAILABLE && current[prop]._freeSince > 0) {
            const freeDate = new Date(current[prop]._freeSince);
            const diffMs = now.getTime() - freeDate.getTime();
            if (diffMs >= 0) {
              const diffMins = Math.floor(diffMs / 6e4);
              const diffHours = Math.floor(diffMs / 36e5);
              if (diffMins < 1) {
                displayStatus = `🟢 Now`;
              } else if (diffHours < 1) {
                displayStatus = `🟢 ${diffMins}m ago`;
              } else {
                const remainingMins = diffMins % 60;
                displayStatus =
                  remainingMins > 0
                    ? `🟢 ${diffHours}h ${remainingMins}m ago`
                    : `🟢 ${diffHours}h ago`;
              }
            }
          } else if (
            displayStatus === STATUS_AVAILABLE &&
            !current[prop]._freeSince &&
            (current[prop]._lastKilledAt || current[prop]._lastKilledTimeStr)
          ) {
            let killedDate;
            if (current[prop]._lastKilledAt) {
              killedDate = new Date(current[prop]._lastKilledAt);
            } else {
              killedDate = parseStringToDate(
                current[prop]._lastKilledTimeStr,
                timezone,
              );
            }
            if (killedDate && !isNaN(killedDate.getTime())) {
              const diffMs = now.getTime() - killedDate.getTime();
              if (diffMs >= 0) {
                const diffMins = Math.floor(diffMs / 6e4);
                const diffHours = Math.floor(diffMs / 36e5);
                if (diffMins < 1) {
                  displayStatus = `🟢 Now`;
                } else if (diffHours < 1) {
                  displayStatus = `🟢 ${diffMins}m ago`;
                } else {
                  const remainingMins = diffMins % 60;
                  displayStatus =
                    remainingMins > 0
                      ? `🟢 ${diffHours}h ${remainingMins}m ago`
                      : `🟢 ${diffHours}h ago`;
                }
              }
            }
          }

          embed.addFields({
            name: current[prop].name,
            value: `\`\`\`yaml\n${displayStatus}\n\`\`\``,
            inline: true,
          });
        }
      }
    }
  }
  return embed;
}

export function renderButtons(guildId, key) {
  const db = getDb(guildId);
  const current = db ? db[key] : null;
  if (!current) return [];

  const componentsList = [];

  if (
    "fixed" !== current.type &&
    "antidemon" !== current.type &&
    "summon" !== current.type
  ) {
    const row = new t();
    let hasProperties = false;
    for (const prop in current) {
      if (
        [
          "title",
          "timeWindow",
          "next",
          "ownerId",
          "ownerName",
          "type",
          "schedules",
          "_claimTimestamp",
        ].includes(prop)
      )
        continue;
      let emojiStr = "🎯";
      if (current[prop].name.includes("Left")) emojiStr = "⬅️";
      else if (current[prop].name.includes("Right")) emojiStr = "➡️";
      else if (current[prop].name.includes("Red")) emojiStr = "🟥";
      else if (current[prop].name.includes("Plant")) emojiStr = "🌱";
      else if (current[prop].name.includes("Ore")) emojiStr = "⛏️";
      else if (current[prop].name.includes("1")) emojiStr = "1️⃣";
      else if (current[prop].name.includes("2")) emojiStr = "2️⃣";
      else if (current[prop].name.includes("3")) emojiStr = "3️⃣";

      row.addComponents(
        new n()
          .setCustomId(`death-${key}-${prop}`)
          .setEmoji(emojiStr)
          .setStyle(a.Secondary),
      );
      hasProperties = true;
    }
    if (hasProperties) componentsList.push(row);
  }

  // Core action buttons
  const coreRow = new t();

  if ("antidemon" === current.type || "summon" === current.type) {
    const summonProps =
      "summon" === current.type
        ? ["sp2", "sp4", "sp7", "ms11", "sp11", "sp12"]
        : ["left", "mid", "right"];
    const anyClaimed = summonProps.some(
      (p) => current[p] && current[p].status === STATUS_CLAIMED,
    );
    coreRow.addComponents(
      new n()
        .setCustomId(`floor-${key}-claim`)
        .setLabel(getMsg("buttons.claimLabel"))
        .setStyle(a.Success),
      ...(anyClaimed
        ? [
            new n()
              .setCustomId(`floor-${key}-next`)
              .setLabel(getMsg("buttons.nextLabel"))
              .setStyle(a.Primary),
          ]
        : []),
      new n()
        .setCustomId(`floor-${key}-cancel`)
        .setLabel(getMsg("buttons.cancelLabel"))
        .setStyle(a.Danger),
    );
  } else {
    coreRow.addComponents(
      new n()
        .setCustomId(`floor-${key}-claim`)
        .setLabel(getMsg("buttons.claimLabel"))
        .setStyle(a.Success),
      new n()
        .setCustomId(`floor-${key}-cancel`)
        .setLabel(getMsg("buttons.cancelLabel"))
        .setStyle(a.Danger),
    );
  }

  componentsList.push(coreRow);
  return componentsList;
}
