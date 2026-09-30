// ==========================================
// 🧪 UNIT TESTS — src/core/ranking-cache.js
// Run: npm test
// ==========================================
import test from 'node:test';
import assert from 'node:assert/strict';

// config.js refuses to load without DISCORD_SERVER_ID (a boot-time guard), so
// provide a dummy guild id before importing the cache module under test.
process.env.DISCORD_SERVER_ID ||= '000000000000000000';

const {
    cleanNickname,
    levenshteinDistance,
    findNicknameInCache,
    findAllNicknameMatchesInCache,
    findTopNicknamesInCache,
    getClanNamesInWorld,
    findTopClanSuggestions
} = await import('../src/core/ranking-cache.js');

// Small multi-world cache shaped like the real one: worldId -> { nickname: clanName }
const CACHE = {
    '611': {
        'Dinizメ': 'AlliedClan',
        'Diniz メ': 'OtherClan',      // same world, DIFFERENT player, same cleaned name
        '🎮Dinizp': 'AlliedClan',
        'SomeoneElse': 'EnemyClan'
    },
    '777': {
        'Dinizメ': 'ForeignClan'      // other world — same nickname again
    }
};

test('cleanNickname normalizes case, width, decoration and spaces', () => {
    assert.equal(cleanNickname('  DINIZメ  '), 'dinizメ');
    assert.equal(cleanNickname('ＤＩＮＩＺ'), 'diniz');            // NFKC full-width
    assert.equal(cleanNickname('▲Diniz★'), 'diniz');
    assert.equal(cleanNickname('Diniz メ'), 'dinizメ');           // whitespace stripped
    assert.equal(cleanNickname('Diniz\u200bメ'), 'dinizメ');      // zero-width space (Cf)
});

test('cleanNickname never splits astral (emoji) code points', () => {
    // Regression: without the /u flag the strip class matched lone surrogates
    // and corrupted neighbouring emojis (e.g. 🎵 + 🎮).
    const cleaned = cleanNickname('🎮John');
    assert.equal(cleaned, '🎮john');
    assert.equal([...cleaned].length, 5); // 🎮 stays a single code point
});

test('levenshteinDistance computes edit distance', () => {
    assert.equal(levenshteinDistance('diniz', 'diniz'), 0);
    assert.equal(levenshteinDistance('kitten', 'sitting'), 3);
    assert.equal(levenshteinDistance('', 'abc'), 3);
});

test('findAllNicknameMatchesInCache returns every variant sharing a cleaned name', () => {
    const matches = findAllNicknameMatchesInCache('Dinizメ', CACHE);
    const keys = matches.map(m => `${m.worldId}:${m.nickname}`).sort();
    assert.deepEqual(keys, ['611:Diniz メ', '611:Dinizメ', '777:Dinizメ'].sort());
});

test('findNicknameInCache returns the first match (and null when unknown)', () => {
    assert.equal(findNicknameInCache('Diniz メ', CACHE).clanName, 'AlliedClan');
    assert.equal(findNicknameInCache('nobody-here', CACHE), null);
});

test('findTopNicknamesInCache ranks fuzzy matches across worlds', () => {
    const top = findTopNicknamesInCache('Dinizz', CACHE, 6);
    assert.ok(top.length > 0, 'expected at least one suggestion');
    // Highest score first.
    for (let i = 1; i < top.length; i++) {
        assert.ok(top[i - 1].score >= top[i].score, 'results must be sorted by score desc');
    }
    // A no-match query returns nothing instead of throwing.
    assert.deepEqual(findTopNicknamesInCache('zzzzzzzzzz', CACHE), []);
});

test('getClanNamesInWorld lists unique clans for one world only', () => {
    assert.deepEqual(
        getClanNamesInWorld('611', CACHE).sort(),
        ['AlliedClan', 'EnemyClan', 'OtherClan']
    );
    assert.deepEqual(getClanNamesInWorld('999', CACHE), []);
});

test('findTopClanSuggestions matches clan names fuzzily', () => {
    const suggestions = findTopClanSuggestions('alliedclan', '611', CACHE, 3);
    assert.equal(suggestions[0].clanName, 'AlliedClan');
});
