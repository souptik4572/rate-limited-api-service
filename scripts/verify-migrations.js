#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const migrationsRoot = path.join(process.cwd(), 'prisma', 'migrations');
const requiredFiles = ['migration.sql', 'down.sql'];
const missingPaths = [];

if (!fs.existsSync(migrationsRoot)) {
  console.error('Migration verification failed: prisma/migrations directory is missing.');
  process.exit(1);
}

const migrationEntries = fs
  .readdirSync(migrationsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .sort((left, right) => left.name.localeCompare(right.name));

if (migrationEntries.length === 0) {
  console.error('Migration verification failed: no migration directories were found.');
  process.exit(1);
}

const lockFile = path.join(migrationsRoot, 'migration_lock.toml');
if (!fs.existsSync(lockFile)) {
  missingPaths.push('prisma/migrations/migration_lock.toml');
}

for (const entry of migrationEntries) {
  for (const requiredFile of requiredFiles) {
    const candidate = path.join(migrationsRoot, entry.name, requiredFile);

    if (!fs.existsSync(candidate)) {
      missingPaths.push(path.join('prisma', 'migrations', entry.name, requiredFile));
    }
  }
}

if (missingPaths.length > 0) {
  console.error('Migration verification failed. Each migration must include both up and down SQL files:');
  for (const missingPath of missingPaths) {
    console.error(`- ${missingPath}`);
  }
  process.exit(1);
}

console.log(`Verified ${migrationEntries.length} migration(s) with matching down.sql files.`);
