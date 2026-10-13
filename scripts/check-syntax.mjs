// ==========================================
// ✅ SYNTAX CHECK (lint)
// ==========================================
// Dependency-free "lint" pass: parses every JavaScript file under src/ with the
// Node parser (`node --check`). It catches the class of mistakes that a test
// run only catches if a test happens to import the file — stray brackets,
// broken template literals, accidental merge markers — in a couple of seconds
// and with zero extra dependencies.
//
// Usage: node scripts/check-syntax.mjs   (npm run lint)

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const TARGET_DIRS = ['src'];
const EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);

const failures = [];
let checked = 0;

function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules') continue;
            walk(full);
        } else if (EXTENSIONS.has(path.extname(entry.name))) {
            try {
                execFileSync(process.execPath, ['--check', full], { stdio: 'pipe' });
                checked++;
            } catch (error) {
                failures.push({ file: full, output: String(error.stderr || error.stdout || error.message).trim() });
            }
        }
    }
}

for (const dir of TARGET_DIRS) {
    try {
        walk(path.resolve(dir));
    } catch (error) {
        console.error(`❌ Could not scan "${dir}": ${error.message}`);
        process.exit(1);
    }
}

if (failures.length === 0) {
    console.log(`✅ Syntax OK — ${checked} file(s) checked.`);
    process.exit(0);
}

console.error(`❌ Syntax errors in ${failures.length} file(s):\n`);
for (const { file, output } of failures) {
    console.error(`── ${path.relative(process.cwd(), file)}`);
    console.error(`   ${output.split('\n').join('\n   ')}\n`);
}
process.exit(1);
