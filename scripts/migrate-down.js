#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function getLatestAppliedMigration() {
  try {
    return await prisma.$queryRawUnsafe(
      'SELECT migration_name FROM `_prisma_migrations` WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at DESC, migration_name DESC LIMIT 1'
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('_prisma_migrations')) {
      return [];
    }

    throw error;
  }
}

async function main() {
  const [latestMigration] = await getLatestAppliedMigration();

  if (!latestMigration) {
    console.log('No applied migrations found. Nothing to roll back.');
    return;
  }

  const migrationName = latestMigration.migration_name;
  const downFile = path.join(
    process.cwd(),
    'prisma',
    'migrations',
    migrationName,
    'down.sql'
  );

  if (!fs.existsSync(downFile)) {
    throw new Error(`Missing down migration for ${migrationName}: ${downFile}`);
  }

  execFileSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['prisma', 'db', 'execute', '--file', downFile, '--schema', 'prisma/schema.prisma'],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    }
  );

  await prisma.$executeRawUnsafe(
    'DELETE FROM `_prisma_migrations` WHERE migration_name = ?',
    migrationName
  );

  console.log(`Rolled back migration ${migrationName}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
