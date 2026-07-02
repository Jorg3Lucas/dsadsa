// ==========================================
// 🔉 TEMP VOICE CHANNEL SYSTEM
// Auto-creates a temporary voice channel when
// a user joins the designated source channel,
// moves them into it, and deletes it when empty.
// ==========================================

import { ChannelType } from "discord.js";
import { getAllClanRoleIds } from "./ranking-constants.js";
import { getActiveServerIds, getServer } from "./server-config.js";

const tempVoiceChannels = new Set();

// Resolve the source channel ID from server config (uses first configured server)
function getSourceChannelId() {
    const serverIds = getActiveServerIds();
    for (const serverId of serverIds) {
        const server = getServer(serverId);
        if (server?.channels?.tempVoiceSource) {
            return server.channels.tempVoiceSource;
        }
    }
    return null;
}

// ── Init ────────────────────────────────────

export function initTempVoiceSystem(client) {
    const sourceId = getSourceChannelId();
    if (!sourceId) {
        console.log("⚠️ [TempVoice] No source channel configured. Use !setup to configure a temp voice channel.");
        return;
    }
    console.log(`🔉 Temp voice system active — source channel ID: ${sourceId}`);

    client.on("voiceStateUpdate", async (oldState, newState) => {
        try {
            const srcId = getSourceChannelId();
            if (!srcId) return;
            
            // ── User JOINED the source channel ──
            if (newState.channelId === srcId && oldState.channelId !== srcId) {
                await handleUserJoinedSource(newState);
            }

            // ── User LEFT a channel (or moved away) ──
            const leftChannelId = oldState.channelId;
            if (leftChannelId && leftChannelId !== newState.channelId) {
                if (tempVoiceChannels.has(leftChannelId)) {
                    // Delay then check emptiness
                    setTimeout(async () => {
                        const channel = oldState.guild.channels.cache.get(leftChannelId);
                        if (channel && channel.members.size === 0) {
                            tempVoiceChannels.delete(leftChannelId);
                            await channel.delete("🔉 Temp channel empty — deleted automatically.")
                                .catch(() => {});
                        }
                    }, 2000);
                }
            }
        } catch (err) {
            console.error("❌ [TempVoice] Error in voiceStateUpdate:", err.message);
        }
    });

    // Clean up orphaned temp channels on startup
    if (client.guilds.cache.size > 0) {
        cleanupOrphanedChannels(client);
    } else {
        client.once("ready", () => cleanupOrphanedChannels(client));
    }
}

// ── Handle user joining source channel ──────

async function handleUserJoinedSource(state) {
    const member = state.member;
    const guild = state.guild;
    if (!member || !guild) return;

    const alliedRoleIds = getAllClanRoleIds();

    // If user already has a temp channel, just move them back
    for (const chId of tempVoiceChannels) {
        const existing = guild.channels.cache.get(chId);
        if (existing && existing.members.has(member.id)) {
            if (existing.id !== state.channelId) {
                await member.voice.setChannel(existing.id).catch(() => {});
            }
            return;
        }
    }

    try {
        const channelName = `${member.displayName} Channel`;
        const newChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildVoice,
            parent: state.channel.parentId,   // same category as source
            permissionOverwrites: [
                // Deny @everyone from creating invites
                {
                    id: guild.id,
                    deny: ["CreateInstantInvite"],
                },
                // Give all allied clan roles View Channel + Connect + Speak
                ...alliedRoleIds.map(roleId => ({
                    id: roleId,
                    allow: ["ViewChannel", "Connect", "Speak"],
                })),
                // Channel creator gets extra management permissions
                {
                    id: member.id,
                    allow: ["ManageChannels", "MuteMembers", "DeafenMembers", "MoveMembers"],
                },
            ],
        });

        tempVoiceChannels.add(newChannel.id);
        await member.voice.setChannel(newChannel.id).catch(() => {});
    } catch (err) {
        console.error("❌ [TempVoice] Error creating channel:", err.message);
    }
}

// ── Cleanup orphaned channels on startup ────

async function cleanupOrphanedChannels(client) {
    const srcId = getSourceChannelId();
    if (!srcId) return;

    for (const [, guild] of client.guilds.cache) {
        const source = guild.channels.cache.get(srcId);
        if (!source || !source.parentId) continue;

        const category = guild.channels.cache.get(source.parentId);
        if (!category) continue;

        for (const [, channel] of guild.channels.cache) {
            if (
                channel.type === ChannelType.GuildVoice &&
                channel.parentId === source.parentId &&
                channel.name.startsWith("🔊")
            ) {
                if (channel.members.size === 0) {
                    await channel.delete("🔉 Cleanup — orphaned temp channel on startup")
                        .catch(() => {});
                } else {
                    // Re-track occupied ones
                    tempVoiceChannels.add(channel.id);
                }
            }
        }
    }
}
