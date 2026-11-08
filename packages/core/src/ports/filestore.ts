/**
 * FileStore port: app-private file operations. The encrypted variant used for
 * receipts, CSV copies and backups ships with the first story that stores a
 * file; the plain variant below backs the size-capped log file.
 */
export interface FileStore {
  exists(path: string): Promise<boolean>;
  size(path: string): Promise<number>;
  append(path: string, text: string): Promise<void>;
  write(path: string, text: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}
