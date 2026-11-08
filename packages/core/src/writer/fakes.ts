import type { SqlDatabase, SqlParam, SqlTransaction } from '../ports/storage';

export interface AuditRow {
  id: string;
  kind: string;
  actor: string;
  entity_kind: string;
  entity_id: string;
  change_json: string;
  created_at: number;
}

export interface OutboxRow {
  id: string;
  event: string;
  actor: string;
  payload_json: string;
  created_at: number;
  delivered_at: number | null;
}

export interface Recorded {
  sql: string;
  params: readonly SqlParam[];
}

interface State {
  audit: AuditRow[];
  outbox: OutboxRow[];
  data: string[];
  /** Rows of the profile tables, recorded as the statements that wrote them. */
  profile: Recorded[];
  settings: Recorded[];
  promptState: Recorded[];
}

const clone = (s: State): State => ({
  audit: s.audit.map((r) => ({ ...r })),
  outbox: s.outbox.map((r) => ({ ...r })),
  data: [...s.data],
  profile: [...s.profile],
  settings: [...s.settings],
  promptState: [...s.promptState],
});

/**
 * In-memory database with real transaction semantics for writer tests: a
 * transaction works on a copy that replaces the live state only on success, and
 * a detector records whether two transactions ever overlapped.
 */
export class MemoryDatabase implements Pick<SqlDatabase, 'query' | 'transaction'> {
  state: State = { audit: [], outbox: [], data: [], profile: [], settings: [], promptState: [] };
  active = 0;
  maxActive = 0;
  transactions = 0;
  /** Makes the next UPDATE of the outbox throw (simulates a crash between handler and mark). */
  failNextDeliveredMark = false;

  get audit(): AuditRow[] {
    return this.state.audit;
  }
  get outbox(): OutboxRow[] {
    return this.state.outbox;
  }
  get data(): string[] {
    return this.state.data;
  }
  get profile(): Recorded[] {
    return this.state.profile;
  }
  get settings(): Recorded[] {
    return this.state.settings;
  }
  get promptState(): Recorded[] {
    return this.state.promptState;
  }

  query(sql: string): Promise<SqlParam[][]> {
    return Promise.resolve(this.read(this.state, sql));
  }

  private read(state: State, sql: string): SqlParam[][] {
    if (sql.startsWith('SELECT id, event, actor, payload_json, created_at FROM outbox WHERE delivered_at IS NULL')) {
      return state.outbox
        .filter((r) => r.delivered_at === null)
        .sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1))
        .map((r) => [r.id, r.event, r.actor, r.payload_json, r.created_at]);
    }
    if (sql === 'SELECT 1 FROM profile LIMIT 1') return state.profile.length > 0 ? [[1]] : [];
    if (sql === 'SELECT v FROM ledger_test') return state.data.map((v) => [v]);
    throw new Error(`MemoryDatabase: unsupported query ${sql}`);
  }

  private write(state: State, sql: string, p: readonly SqlParam[]): void {
    if (sql.startsWith('INSERT INTO audit_event')) {
      state.audit.push({
        id: String(p[0]),
        kind: String(p[1]),
        actor: String(p[2]),
        entity_kind: String(p[3]),
        entity_id: String(p[4]),
        change_json: String(p[5]),
        created_at: Number(p[6]),
      });
    } else if (sql.startsWith('INSERT INTO outbox')) {
      state.outbox.push({
        id: String(p[0]),
        event: String(p[1]),
        actor: String(p[2]),
        payload_json: String(p[3]),
        created_at: Number(p[4]),
        delivered_at: null,
      });
    } else if (sql.startsWith('UPDATE outbox SET delivered_at')) {
      if (this.failNextDeliveredMark) {
        this.failNextDeliveredMark = false;
        throw new Error('crash before the delivered mark was written');
      }
      const row = state.outbox.find((r) => r.id === p[1]);
      if (row) row.delivered_at = Number(p[0]);
    } else if (sql.startsWith('INSERT INTO profile')) {
      state.profile.push({ sql, params: p });
    } else if (sql.startsWith('INSERT INTO settings')) {
      state.settings.push({ sql, params: p });
    } else if (sql.startsWith('INSERT INTO prompt_state')) {
      state.promptState.push({ sql, params: p });
    } else if (sql.startsWith('INSERT INTO ledger_test')) {
      state.data.push(String(p[0]));
    } else {
      throw new Error(`MemoryDatabase: unsupported statement ${sql}`);
    }
  }

  async transaction<T>(fn: (tx: SqlTransaction) => Promise<T>): Promise<T> {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    this.transactions += 1;
    const work = clone(this.state);
    try {
      // Yield a few times so an unserialised caller would interleave here.
      for (let i = 0; i < 3; i++) await Promise.resolve();
      const result = await fn({
        query: (sql) => Promise.resolve(this.read(work, sql)),
        execute: async (sql, params = []) => {
          await Promise.resolve();
          this.write(work, sql, params);
        },
      });
      this.state = work; // commit
      return result;
    } finally {
      this.active -= 1;
    }
  }

}
