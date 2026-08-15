// ==========================================
// 🧠 CLAIM CORE — Room Keys & Names
// Extracted from claim-core.js
// ==========================================

const SUMMON_PROPS_INTERNAL = ["sp2", "sp4", "sp7"];

// Rooms for expanded antidemon panels
// MS9/MS10: 1-1, 1-2 each with LEFT/MID/RIGHT (6 rooms)
const ANTIDEMON_9_10_ROOMS = [
    { key: "v1l", name: "1-1 LEFT" }, { key: "v1m", name: "1-1 MID" }, { key: "v1r", name: "1-1 RIGHT" },
    { key: "v2l", name: "1-2 LEFT" }, { key: "v2m", name: "1-2 MID" }, { key: "v2r", name: "1-2 RIGHT" }
];
const ANTIDEMON_9_10_KEYS = ANTIDEMON_9_10_ROOMS.map(r => r.key);

// Returns room keys for a summon panel based on its key
export function getSummonRoomKeys(panelKey) {
    // Combined summon panel uses the default rooms
    return SUMMON_PROPS_INTERNAL;
}

// Returns room key array for an antidemon panel based on its key
export function getAntidemonRoomKeys(panelKey) {
    const floor = panelKey?.match(/^(\d+)/)?.[1];
    if (floor === "9" || floor === "10") return ANTIDEMON_9_10_KEYS;
    return ["left", "mid", "right"];
}

// Returns the display name for a room key in a given panel
export function getAntidemonRoomName(panelKey, roomKey) {
    if (roomKey === "left") return "LEFT ROOM";
    if (roomKey === "mid") return "MID ROOM";
    if (roomKey === "right") return "RIGHT ROOM";
    const found = ANTIDEMON_9_10_ROOMS.find(r => r.key === roomKey);
    return found ? found.name : roomKey.toUpperCase();
}
