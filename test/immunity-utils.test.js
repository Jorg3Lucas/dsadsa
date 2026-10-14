// ==========================================
// 🧪 UNIT TESTS — src/core/immunity-utils.js
// Run: npm test
// ==========================================
import test from 'node:test';
import assert from 'node:assert/strict';

const { isUserImmune } = await import('../src/core/immunity-utils.js');

test('immune user is immune', () => {
    assert.equal(isUserImmune('1441611106845196481'), true);
});

test('non-immune user is not immune', () => {
    assert.equal(isUserImmune('000000000000000000'), false);
});

test('immune flag is a strict allowlist', () => {
    assert.equal(isUserImmune(''), false);
    assert.equal(isUserImmune(null), false);
    assert.equal(isUserImmune(undefined), false);
    assert.equal(isUserImmune(123), false);
    assert.equal(isUserImmune('1441611106845196481'), true);
});
