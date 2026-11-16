// ==========================================
// 📊 SALARY — Ranking DB reference
// The salary poll maps a pilot's Discord ID to the owner's character (so a
// pilot's vote counts for the owner). The ranking DB lives in index.js and is
// only loaded when RANKING_ENABLED=true, so this module holds a reference the
// boot code can update instead of importing index.js state.
// ==========================================

let rankingDbRef = { users: {} };

/** Point the salary system at the loaded ranking DB. @param {{users?: object}|null} db */
export function setSalaryRankingDb(db) {
    rankingDbRef = db || { users: {} };
}

/** @returns {{users: object}} The current ranking DB (empty when ranking is off) */
export function getSalaryRankingDb() {
    return rankingDbRef;
}
