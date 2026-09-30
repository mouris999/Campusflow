import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_DATA_DIR = path.resolve(__dirname, '../data');

/** Returns true only when we can genuinely create and write inside `dir`. */
function isWritableDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.campusflow-write-probe-${process.pid}`);
    fs.writeFileSync(probe, 'ok', 'utf-8');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves the directory CampusFlow persists to.
 *
 * Priority:
 *  1. CAMPUSFLOW_DATA_DIR — explicit override (used by the test harness).
 *  2. <repo>/data — the normal local / single-server location.
 *  3. os.tmpdir()/campusflow-data — fallback for read-only bundles, which is
 *     what serverless deployments (Vercel functions) hand us.
 */
function resolveDataDir(): string {
  const explicit = process.env.CAMPUSFLOW_DATA_DIR;
  if (explicit) {
    const resolved = path.resolve(explicit);
    isWritableDir(resolved);
    return resolved;
  }
  if (isWritableDir(REPO_DATA_DIR)) return REPO_DATA_DIR;
  const fallback = path.join(os.tmpdir(), 'campusflow-data');
  isWritableDir(fallback);
  return fallback;
}

export const DATA_DIR = resolveDataDir();

/**
 * True when we had to fall back to ephemeral storage because the deployment
 * bundle is read-only. Surfaced through /api/health so the limitation is never
 * silently hidden from operators.
 */
export const IS_EPHEMERAL_STORAGE = DATA_DIR !== REPO_DATA_DIR;
