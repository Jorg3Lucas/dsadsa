// ==========================================
// 🛠️ SHARED UTILITIES
// ==========================================
import { MEMBER_ROLE_ID } from './ranking-constants.js';
import { getMsg } from './lang.js';

/**
 * Assign the general member role to a verified player
 */
export async function assignMemberRole(targetMember, logEvent) {
    if (!targetMember.roles.cache.has(MEMBER_ROLE_ID)) {
        await targetMember.roles.add(MEMBER_ROLE_ID).catch(() => {});
        logEvent(getMsg('ranking.logs.roleAdded', { clan: 'Member', username: targetMember.user.username }));
    }
}
