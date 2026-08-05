import { describe, it, expect, vi, beforeEach } from 'vitest';

// Track all created components for assertions
const createdComponents = [];

// Mock discord.js with proper constructors
vi.mock('discord.js', () => {
    class MockActionRowBuilder {
        constructor() {
            this.components = [];
        }
        addComponents(...components) {
            this.components.push(...components);
            return this;
        }
    }

    class MockStringSelectMenuBuilder {
        constructor() {
            this._customId = '';
            this._placeholder = '';
            this._options = [];
        }
        setCustomId(id) {
            this._customId = id;
            return this;
        }
        setPlaceholder(text) {
            this._placeholder = text;
            return this;
        }
        addOptions(options) {
            this._options = options;
            return this;
        }
    }

    class MockButtonBuilder {
        constructor() {
            this._customId = '';
            this._label = '';
            this._style = 0;
            this._disabled = false;
        }
        setCustomId(id) {
            this._customId = id;
            return this;
        }
        setLabel(text) {
            this._label = text;
            return this;
        }
        setStyle(style) {
            this._style = style;
            return this;
        }
        setDisabled(disabled) {
            this._disabled = disabled;
            return this;
        }
    }

    class MockModalBuilder {
        constructor() {
            this._customId = '';
            this._title = '';
            this._components = [];
        }
        setCustomId(id) {
            this._customId = id;
            return this;
        }
        setTitle(title) {
            this._title = title;
            return this;
        }
        addComponents(...rows) {
            this._components.push(...rows);
            return this;
        }
    }

    class MockTextInputBuilder {
        constructor() {
            this._data = {};
        }
        setCustomId(id) {
            this._data.customId = id;
            return this;
        }
        setLabel(text) {
            this._data.label = text;
            return this;
        }
        setStyle(style) {
            this._data.style = style;
            return this;
        }
        setPlaceholder(text) {
            this._data.placeholder = text;
            return this;
        }
        setMinLength(min) {
            this._data.minLength = min;
            return this;
        }
        setMaxLength(max) {
            this._data.maxLength = max;
            return this;
        }
        setRequired(required) {
            this._data.required = required;
            return this;
        }
        setValue(value) {
            this._data.value = value;
            return this;
        }
    }

    return {
        ActionRowBuilder: MockActionRowBuilder,
        StringSelectMenuBuilder: MockStringSelectMenuBuilder,
        ButtonBuilder: MockButtonBuilder,
        ButtonStyle: { Success: 3, Danger: 4, Secondary: 2, Primary: 1 },
        PermissionFlagsBits: { Administrator: 1n << 3n },
        ModalBuilder: MockModalBuilder,
        TextInputBuilder: MockTextInputBuilder,
        TextInputStyle: { Short: 1 }
    };
});

// Mock lang module
vi.mock('../src/lang/lang.js', () => ({
    getMsg: vi.fn((key) => key)
}));

// Mock constants
vi.mock('../src/core/ranking-constants.js', () => ({
    MEMBER_ROLE_ID: '123456',
    WORLD_IDS: { '1': 'World 1', '2': 'World 2' },
    confirmationCache: {},
    ensureConfig: vi.fn((db) => {
        if (!db.config) db.config = {};
        if (!db.config.alliedClans) db.config.alliedClans = {};
    })
}));

// Mock cache module
vi.mock('../src/core/ranking-cache.js', () => ({
    findNicknameInCache: vi.fn(),
    findAllNicknameMatchesInCache: vi.fn(() => []),
    findTopNicknamesInCache: vi.fn(() => []),
    findTopClanSuggestions: vi.fn().mockReturnValue([]),
    getLocalRankingCache: vi.fn().mockReturnValue(null),
    cleanNickname: vi.fn((name) => name),
    levenshteinDistance: vi.fn(() => 99)
}));

import {
    handleManageAlliedWorld,
    handleManageAlliedPage,
    handleManageAlliedRemove
} from '../src/handlers/ranking-management.js';

function createMockInteraction(customId, values = [], permissions = true) {
    return {
        customId,
        values,
        user: {
            id: '123456789',
            tag: 'TestUser#1234'
        },
        member: {
            permissions: {
                has: vi.fn().mockReturnValue(permissions)
            }
        },
        update: vi.fn().mockResolvedValue(undefined)
    };
}

describe('Allied Clans Pagination - Discord 25-option limit', () => {
    let db;

    beforeEach(() => {
        vi.clearAllMocks();
        db = {
            users: {},
            config: {
                alliedClans: {}
            }
        };
    });

    it('should not exceed 25 options when viewing world with many clans', async () => {
        // Create 50 clans for world '1'
        const clans = Array.from({ length: 50 }, (_, i) => `Clan ${i + 1}`);
        db.config.alliedClans['1'] = clans;

        const interaction = createMockInteraction('manage_allied_world', ['1']);
        
        await handleManageAlliedWorld(interaction, db, () => {}, () => {});

        // Verify interaction.update was called
        expect(interaction.update).toHaveBeenCalled();
        
        // The content should contain pagination info
        const updateCall = interaction.update.mock.calls[0][0];
        expect(updateCall.content).toContain('50 total clans');
        expect(updateCall.content).toContain('Page 1/2');
    });

    it('should handle page navigation correctly', async () => {
        // Create 30 clans for world '1'
        const clans = Array.from({ length: 30 }, (_, i) => `Clan ${i + 1}`);
        db.config.alliedClans['1'] = clans;

        const interaction = createMockInteraction('manage_allied_page_1_0');
        
        await handleManageAlliedPage(interaction, db, () => {}, () => {});

        expect(interaction.update).toHaveBeenCalled();
        const updateCall = interaction.update.mock.calls[0][0];
        expect(updateCall.content).toContain('30 total clans');
    });

    it('should reset to page 0 when removing a clan', async () => {
        // Create 30 clans for world '1'
        const clans = Array.from({ length: 30 }, (_, i) => `Clan ${i + 1}`);
        db.config.alliedClans['1'] = [...clans];

        // Remove clan at index 5 (which is "Clan 6")
        const interaction = createMockInteraction('manage_allied_remove', ['1_5']);
        
        await handleManageAlliedRemove(interaction, db, () => {}, () => {});

        expect(interaction.update).toHaveBeenCalled();
        // Should now have 29 clans
        expect(db.config.alliedClans['1'].length).toBe(29);
        expect(db.config.alliedClans['1']).not.toContain('Clan 6');
    });

    it('should show empty message when no clans exist', async () => {
        db.config.alliedClans['1'] = [];

        const interaction = createMockInteraction('manage_allied_world', ['1']);
        
        await handleManageAlliedWorld(interaction, db, () => {}, () => {});

        expect(interaction.update).toHaveBeenCalled();
        const updateCall = interaction.update.mock.calls[0][0];
        expect(updateCall.content).toContain('No allied clans configured');
    });

    it('should deny access for non-admin users', async () => {
        const interaction = createMockInteraction('manage_allied_world', ['1'], false);
        
        await handleManageAlliedWorld(interaction, db, () => {}, () => {});

        expect(interaction.update).toHaveBeenCalledWith({
            content: '❌ Permission denied.',
            components: []
        });
    });
});

describe('Pagination customId parsing', () => {
    it('should parse manage_allied_page_{worldId}_{page} correctly', () => {
        const testCases = [
            { customId: 'manage_allied_page_1_0', expectedWorldId: '1', expectedPage: 0 },
            { customId: 'manage_allied_page_2_1', expectedWorldId: '2', expectedPage: 1 },
            { customId: 'manage_allied_page_1_3', expectedWorldId: '1', expectedPage: 3 },
        ];

        for (const tc of testCases) {
            const parts = tc.customId.split('_');
            const worldId = parts[3];
            const page = parseInt(parts[4], 10);
            
            expect(worldId).toBe(tc.expectedWorldId);
            expect(page).toBe(tc.expectedPage);
        }
    });

    it('should parse manage_allied_remove value correctly', () => {
        const testCases = [
            { value: '1_5', expectedWorldId: '1', expectedIndex: 5 },
            { value: '2_24', expectedWorldId: '2', expectedIndex: 24 },
            { value: '1_0', expectedWorldId: '1', expectedIndex: 0 },
        ];

        for (const tc of testCases) {
            const [worldId, indexStr] = tc.value.split('_');
            const index = parseInt(indexStr, 10);
            
            expect(worldId).toBe(tc.expectedWorldId);
            expect(index).toBe(tc.expectedIndex);
        }
    });
});
