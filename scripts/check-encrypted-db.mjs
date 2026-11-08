#!/usr/bin/env node
// Fails when a database file is readable as plain SQLite. A SQLCipher database
// has no "SQLite format 3\0" magic: its first 16 bytes are the salt.
// Usage: node scripts/check-encrypted-db.mjs <path-to-wmbugo.db>
import { closeSync, existsSync, openSync, readSync } from 'node:fs';

const PLAIN_MAGIC = Buffer.from('SQLite format 3\0', 'latin1');

export function checkHeader(header) {
  if (header.length < 16) return { ok: false, reason: `file is only ${header.length} bytes; expected a populated database` };
  if (header.subarray(0, 16).equals(PLAIN_MAGIC)) {
    return { ok: false, reason: 'header reads "SQLite format 3": the database is NOT encrypted' };
  }
  return { ok: true, reason: 'header is not plain SQLite (encrypted)' };
}

const file = process.argv[2];
if (file === undefined) {
  console.error('usage: check-encrypted-db.mjs <database-file>');
  process.exit(2);
}
if (!existsSync(file)) {
  console.error(`check-encrypted-db: ${file} does not exist`);
  process.exit(1);
}
const fd = openSync(file, 'r');
const buf = Buffer.alloc(16);
const n = readSync(fd, buf, 0, 16, 0);
closeSync(fd);
const result = checkHeader(buf.subarray(0, n));
console.log(`check-encrypted-db: ${result.ok ? 'OK' : 'FAIL'} - ${result.reason}`);
process.exit(result.ok ? 0 : 1);
