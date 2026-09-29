// Tiny JSON-file datastore. No native dependencies, so `npm install` works everywhere.
// For production, swap this module for Postgres/Mongo; the rest of the app only uses get()/save().
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'db.json');

const EMPTY = () => ({
  reports: [],
  issues: [],
  studyProfiles: [],
  studyRequests: [],
  roomReports: [],
  bookings: [],
  energyAudits: [],
  mealOptOuts: [],
  digests: [],
});

let state = null;
let saveTimer = null;

export function load() {
  if (state) return state;
  try {
    state = { ...EMPTY(), ...JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) };
  } catch {
    state = EMPTY();
  }
  return state;
}

export function get() {
  return load();
}

export function replace(next) {
  state = { ...EMPTY(), ...next };
  flush();
}

// Debounced write so bursts of requests don't hammer the disk.
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 200);
}

export function flush() {
  clearTimeout(saveTimer);
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, DB_PATH); // atomic replace
}

export function isEmpty() {
  const s = load();
  return s.reports.length === 0 && s.issues.length === 0;
}
