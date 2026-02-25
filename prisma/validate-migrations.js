#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const migrationsDir = path.join(__dirname, "migrations");

function listSqlFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...listSqlFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".sql")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

function hasUtf16Bom(bytes) {
  return (
    bytes.length >= 2 &&
    ((bytes[0] === 0xff && bytes[1] === 0xfe) ||
      (bytes[0] === 0xfe && bytes[1] === 0xff))
  );
}

function hasUtf8Bom(bytes) {
  return (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  );
}

function countNul(bytes) {
  let count = 0;
  for (const byte of bytes) {
    if (byte === 0x00) count += 1;
  }
  return count;
}

if (!fs.existsSync(migrationsDir)) {
  console.error(`[Migration Encoding Check] Missing directory: ${migrationsDir}`);
  process.exit(1);
}

const sqlFiles = listSqlFiles(migrationsDir);
const failures = [];

for (const filePath of sqlFiles) {
  const bytes = fs.readFileSync(filePath);
  const nulCount = countNul(bytes);

  const issues = [];
  if (nulCount > 0) issues.push(`contains ${nulCount} NUL byte(s)`);
  if (hasUtf16Bom(bytes)) issues.push("starts with UTF-16 BOM");
  if (hasUtf8Bom(bytes)) issues.push("starts with UTF-8 BOM");

  if (issues.length > 0) {
    failures.push({ filePath, issues });
  }
}

if (failures.length > 0) {
  console.error("[Migration Encoding Check] Invalid SQL migration encoding detected:");
  for (const failure of failures) {
    const relativePath = path.relative(process.cwd(), failure.filePath);
    console.error(`- ${relativePath}: ${failure.issues.join(", ")}`);
  }
  console.error(
    "[Migration Encoding Check] Convert all migration SQL files to UTF-8 (without BOM) and retry."
  );
  process.exit(1);
}

console.log(
  `[Migration Encoding Check] OK (${sqlFiles.length} SQL file(s) checked, UTF-8 without BOM/NUL).`
);
