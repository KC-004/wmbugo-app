import { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import * as opsqlite from '@op-engineering/op-sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { eq } from 'drizzle-orm';
import { CORE_PACKAGE } from '@wmbugo/core';
import migrations from '../../drizzle/migrations';
import { probe } from './schema';

// THROWAWAY spike key. Not a real secret; never reuse.
const SPIKE_KEY = 'spike-only-key-0000000000000000';

type Log = (line: string) => void;

async function step<T>(log: Log, name: string, fn: () => T | Promise<T>) {
  try {
    const v = await fn();
    log(`ok ${name}`);
    return v;
  } catch (e) {
    log(`FAIL ${name}: ${String(e)}`);
    throw e;
  }
}

async function run(log: Log) {
  log(`core import: ${CORE_PACKAGE}`);
  log(`op-sqlite exports: ${Object.keys(opsqlite).join(',')}`);
  const db = await step(log, 'open', () =>
    opsqlite.open({ name: 'spike.db', encryptionKey: SPIKE_KEY }),
  );
  log(`db keys: ${Object.keys(db).join(',')}`);
  const cipher = await step(log, "cipher_version", () =>
    db.executeRaw("PRAGMA cipher_version"),
  );
  log("CIPHER=" + "v=" + String(cipher.rawRows[0]?.[0] ?? "EMPTY") + " isSQLCipher=" + String(opsqlite.isSQLCipher()));
  const orm = drizzle(async (sql, params, method) => {
    const res = await db.executeRaw(sql, params as never[]);
    return { rows: method === "get" ? (res.rawRows[0] ?? []) : res.rawRows };
  });
  await step(log, "migrate", async () => {
    await db.executeRaw(
      "CREATE TABLE IF NOT EXISTS __migrations (idx INTEGER PRIMARY KEY, tag TEXT NOT NULL)",
    );
    const done = (await db.executeRaw("SELECT idx FROM __migrations")).rawRows.map(r => Number(r[0]));
    const cmds: [string, unknown[]?][] = [];
    for (const e of migrations.journal.entries) {
      if (done.includes(e.idx)) continue;
      const sqlText = ((migrations.migrations as Record<string, string>)["m" + String(e.idx).padStart(4, "0")] as string);
      for (const stmt of sqlText.split("--> statement-breakpoint")) cmds.push([stmt]);
      cmds.push(["INSERT INTO __migrations (idx, tag) VALUES (?, ?)", [e.idx, e.tag]]);
    }
    log("migration statements: " + cmds.length);
    if (cmds.length) await db.executeBatch(cmds as never);
  });
  await step(log, "atomicity", async () => {
    let failed = false;
    try {
      await db.executeBatch([
        ["CREATE TABLE atom_a (x INTEGER)"],
        ["INSERT INTO nonexistent_table VALUES (1)"],
      ]);
    } catch {
      failed = true;
    }
    const t = await db.executeRaw(
      "SELECT name FROM sqlite_master WHERE name = 'atom_a'",
    );
    log("ATOMIC batchFailed=" + failed + " atom_a_rows=" + t.rawRows.length);
  });
  const tables = await step(log, 'list tables', () =>
    db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"),
  );
  log(`tables: ${tables.rows.map(r => String(r.name)).join(',')}`);
  await db.executeRaw('DELETE FROM probe');
  await step(log, 'insert', () =>
    orm.insert(probe).values({ id: 'a', amount_minor: 12345, note: 'x' }),
  );
  const rows = await step(log, 'select', () =>
    orm.select().from(probe).where(eq(probe.id, 'a')),
  );
  log("roundtrip: " + rows.map(r => r.id + "|" + r.amount_minor + "|" + r.note).join(";"));
  log(`dbpath: ${db.getDbPath()}`);
  db.close();
  await step(log, "nokey-open", async () => {
    const plain = opsqlite.open({ name: 'spike.db' });
    try {
      await plain.executeRaw('SELECT count(*) FROM sqlite_master');
      log('NOKEY readable=true (NOT ENCRYPTED)');
    } catch (e) {
      log('NOKEY readable=false: ' + String(e).slice(0, 120));
    }
    plain.close();
  });
}

export function Probe() {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    const log: Log = l => setLines(prev => [...prev, l]);
    run(log).catch(() => {});
  }, []);
  return (
    <ScrollView>
      {lines.map((l, i) => (
        <Text key={i} selectable>
          {l}
        </Text>
      ))}
    </ScrollView>
  );
}
