/**
 * An in-memory stand-in for `@dr.pogodin/react-native-fs`, for adapter tests: paths are plain strings, a directory exists when a
 * file lies under it or it was made. Used through `jest.mock('@dr.pogodin/react-native-fs', () => require('.../memoryRnfs').rnfsModule)`.
 */
const files = new Map<string, string>();
const dirs = new Set<string>();

const under = (path: string) => [...files.keys()].filter((k) => k === path || k.startsWith(`${path}/`));
const isDir = (path: string) => dirs.has(path) || [...files.keys()].some((k) => k.startsWith(`${path}/`));
const missing = (path: string) => Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });

export const memoryFiles = {
  files,
  dirs,
  reset(): void {
    files.clear();
    dirs.clear();
    state.freeSpace = 10_000_000;
    state.failOn = null;
  },
};

/** Lets a test make one operation fail: `{ op: 'unlink', path }` rejects the next `unlink` of that path (once). */
export const state: { freeSpace: number; failOn: { op: string; path?: string } | null } = { freeSpace: 10_000_000, failOn: null };

function maybeFail(op: string, path: string): void {
  const f = state.failOn;
  if (f && f.op === op && (f.path === undefined || f.path === path)) {
    state.failOn = null;
    throw new Error(`${op} failed: ${path}`);
  }
}

export const rnfsModule = {
  DocumentDirectoryPath: '/data/files',
  CachesDirectoryPath: '/data/cache',
  async exists(path: string) {
    return files.has(path) || isDir(path);
  },
  async unlink(path: string) {
    maybeFail('unlink', path);
    if (!files.has(path) && !isDir(path)) throw missing(path);
    for (const k of under(path)) files.delete(k);
    for (const d of [...dirs]) if (d === path || d.startsWith(`${path}/`)) dirs.delete(d);
  },
  async moveFile(from: string, to: string) {
    maybeFail('moveFile', from);
    const keys = under(from);
    if (keys.length === 0) throw missing(from);
    for (const k of keys) {
      files.set(to + k.slice(from.length), files.get(k)!);
      files.delete(k);
    }
  },
  async mkdir(path: string) {
    dirs.add(path);
  },
  async readFile(path: string) {
    if (!files.has(path)) throw missing(path);
    return files.get(path)!;
  },
  async writeFile(path: string, text: string) {
    maybeFail('writeFile', path);
    files.set(path, text);
  },
  /** A slice of the file as base64 (the content is treated as latin-1 bytes). */
  async read(path: string, length: number, position: number) {
    if (!files.has(path)) throw missing(path);
    return Buffer.from(files.get(path)!.slice(position, position + length), 'latin1').toString('base64');
  },
  async appendFile(path: string, text: string) {
    files.set(path, (files.get(path) ?? '') + text);
  },
  async stat(path: string) {
    if (isDir(path) && !files.has(path)) return { size: 0, isDirectory: () => true };
    if (!files.has(path)) throw missing(path);
    return { size: files.get(path)!.length, isDirectory: () => false };
  },
  async readDir(path: string) {
    const names = new Set<string>();
    for (const k of files.keys()) if (k.startsWith(`${path}/`)) names.add(k.slice(path.length + 1).split('/')[0]!);
    return [...names].map((n) => ({ name: n, path: `${path}/${n}` }));
  },
  async getFSInfo() {
    return { freeSpace: state.freeSpace, totalSpace: 100_000_000 };
  },
};
