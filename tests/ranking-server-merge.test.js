import { describe, it, expect, vi, beforeEach } from 'vitest';

// Do NOT mock ranking-constants — test the real implementation
import {
    WORLD_IDS,
    SERVER_MERGES,
    resolveServerName,
    migrateAlliedClans,
    ensureConfig
} from '../src/core/ranking-constants.js';

describe('resolveServerName', () => {
    it('resolves absorbed servers to their surviving server', () => {
        expect(resolveServerName('ASIA013')).toBe('ASIA021');
        expect(resolveServerName('EU013')).toBe('EU011');
        expect(resolveServerName('NA041')).toBe('NA012');
        expect(resolveServerName('SA041')).toBe('SA013');
        expect(resolveServerName('INMENA012')).toBe('INMENA011');
    });

    it('returns surviving server names unchanged', () => {
        expect(resolveServerName('EU011')).toBe('EU011');
        expect(resolveServerName('ASIA021')).toBe('ASIA021');
        expect(resolveServerName('NA011')).toBe('NA011');
    });

    it('returns unknown names unchanged', () => {
        expect(resolveServerName('UNKNOWN')).toBe('UNKNOWN');
        expect(resolveServerName('')).toBe('');
    });

    it('every absorbed server in SERVER_MERGES resolves to a surviving server in WORLD_IDS', () => {
        for (const [absorbed, surviving] of Object.entries(SERVER_MERGES)) {
            const survivingWorldId = Object.values(WORLD_IDS).find(v => v === surviving);
            expect(survivingWorldId).toBeDefined();
        }
    });
});

describe('migrateAlliedClans', () => {
    let db;

    beforeEach(() => {
        db = { config: { alliedClans: {} } };
    });

    it('moves allied clans from absorbed server to surviving server', () => {
        // ASIA013 (worldId 813) → ASIA021 (worldId 821)
        db.config.alliedClans[813] = ['ClanA', 'ClanB'];

        const result = migrateAlliedClans(db);

        expect(result.migrated).toBeGreaterThanOrEqual(1);
        expect(result.clansMoved).toBe(2);
        // Absorbed config deleted
        expect(db.config.alliedClans[813]).toBeUndefined();
        // Surviving config has the clans
        expect(db.config.alliedClans[821]).toContain('ClanA');
        expect(db.config.alliedClans[821]).toContain('ClanB');
    });

    it('does not duplicate clans that already exist on the surviving server', () => {
        db.config.alliedClans[813] = ['SharedClan'];
        db.config.alliedClans[821] = ['SharedClan'];

        const result = migrateAlliedClans(db);

        expect(result.clansMoved).toBe(0);
        expect(db.config.alliedClans[821]).toEqual(['SharedClan']);
    });

    it('merges case-insensitively', () => {
        db.config.alliedClans[813] = ['gearsofwar'];
        db.config.alliedClans[821] = ['GearsofWar'];

        const result = migrateAlliedClans(db);

        expect(result.clansMoved).toBe(0); // already exists (case-insensitive)
        expect(db.config.alliedClans[821]).toEqual(['GearsofWar']);
    });

    it('skips absorbed servers with no worldId (ASIA314/324/341) and warns', () => {
        // These servers were never in WORLD_IDS
        const result = migrateAlliedClans(db);

        const warnings314 = result.warnings.find(w => w.includes('ASIA314'));
        const warnings324 = result.warnings.find(w => w.includes('ASIA324'));
        const warnings341 = result.warnings.find(w => w.includes('ASIA341'));
        expect(warnings314).toBeDefined();
        expect(warnings324).toBeDefined();
        expect(warnings341).toBeDefined();
    });

    it('skips absorbed servers with empty clan lists', () => {
        db.config.alliedClans[813] = [];

        const result = migrateAlliedClans(db);

        // Empty arrays don't count as "migrated"
        expect(result.migrated).toBe(0);
    });

    it('is idempotent — calling twice produces the same result', () => {
        db.config.alliedClans[813] = ['ClanA'];

        migrateAlliedClans(db);
        const result2 = migrateAlliedClans(db);

        expect(result2.migrated).toBe(0); // nothing left to migrate
        expect(db.config.alliedClans[821]).toEqual(['ClanA']);
    });

    it('migrates multiple absorbed servers in one call', () => {
        // EU013 (613) → EU011 (611), EU023 (623) → EU021 (621)
        db.config.alliedClans[613] = ['EUClan1'];
        db.config.alliedClans[623] = ['EUClan2'];

        const result = migrateAlliedClans(db);

        expect(result.migrated).toBeGreaterThanOrEqual(2);
        expect(db.config.alliedClans[611]).toContain('EUClan1');
        expect(db.config.alliedClans[621]).toContain('EUClan2');
        expect(db.config.alliedClans[613]).toBeUndefined();
        expect(db.config.alliedClans[623]).toBeUndefined();
    });
});
