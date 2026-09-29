// Import the IITH Academic Office "Classroom Details" sheet (CSV export) into server/timetable.json.
//
//   node scripts/import-timetable.mjs classroom-details.csv
//
// Sheet: iith.ac.in/academics/calendars-timetables -> "Classroom Details" -> File > Download > CSV.
// Uses the real columns: Course Code, Course Name, Registered Students Count, Segment Name,
// Course Slot Code, Class Timings ("Monday-09:00-09:55,..."), Room No. ("LHC-07-Capacity:200").
// Keeps the hand-written "calendar" block of the existing timetable.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.TIMETABLE_PATH || path.join(__dirname, '..', 'timetable.json');
const DAYS = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };

/** Minimal RFC 4180 CSV parser (quoted fields, commas and newlines inside quotes). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') row.push(field), (field = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field), rows.push(row), (row = []), (field = '');
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  const [head, ...body] = rows;
  return body.filter((r) => r.some((x) => x.trim())).map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

/** "LHC-07-Capacity:200" / "CSE-LH-01 (Capacity - 70)" / "CHE-Class Room 118-Capacity:84" -> { id, seats } */
export function parseRoom(raw) {
  const first = raw.split('\n')[0].trim(); // a few rows list two rooms; the first is the main one
  if (!first || /not required/i.test(first)) return null;
  const capMatch = first.match(/(?:cap\w*|\()\D*(\d{2,4})/i);
  let id = first.split(/[-\s]*cap\w*|\s*\(/i)[0];
  const classRoom = first.match(/^(\w+)-.*Class Room (\d+)/i);
  if (classRoom) id = `${classRoom[1]}-${classRoom[2]}`;
  id = id.replace(/[-\s]*\(?[GS]F\)?\s*$/i, '').replace(/\s+/g, '-').replace(/-+$/, '').replace(/-{2,}/g, '-').toUpperCase();
  if (!/^[A-Z/]+-[A-Z0-9-]+$/.test(id)) return null; // garbled cells
  return { id, seats: capMatch ? Number(capMatch[1]) : null };
}

/** "Monday-11:01-11:55,Thursday-09:00-09:55" -> [[1,"11:00","11:55"], [4,"09:00","09:55"]] */
export function parseTimings(s) {
  return s
    .split(',')
    .map((t) => t.trim().match(/^(\w+)-(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/))
    .filter((m) => m && m[1] in DAYS)
    .map(([, d, h1, m1, h2, m2]) => [DAYS[d], `${h1.padStart(2, '0')}:${m1 === '01' ? '00' : m1}`, `${h2.padStart(2, '0')}:${m2}`]);
}

const placeOf = (roomId) => (roomId.startsWith('LHC-') ? 'lhc' : 'acad');
const buildingOf = (roomId) => (roomId.startsWith('LHC-') ? 'LHC' : roomId.split('-')[0]);

export function convert(rows) {
  const rooms = new Map();
  const classes = new Map(); // room + timings -> merged class (cross-listed courses share one room)
  for (const r of rows) {
    const room = parseRoom(r['Room No.'] ?? '');
    const sessions = parseTimings(r['Class Timings'] ?? '');
    const enrolled = Number(r['Registered Students Count']) || 0;
    if (!room || !sessions.length || !enrolled) continue;
    const prev = rooms.get(room.id);
    rooms.set(room.id, { id: room.id, placeId: placeOf(room.id), building: buildingOf(room.id), seats: Math.max(prev?.seats ?? 0, room.seats ?? 0) || null });
    const key = `${room.id}|${JSON.stringify(sessions)}|${r['Segment Name']}`;
    const c = classes.get(key);
    const code = r['Course Code'].replace(/\s+/g, '');
    if (c) {
      if (!c.course.split('/').includes(code)) c.course += `/${code}`;
      c.enrollment += enrolled;
    } else {
      classes.set(key, {
        course: code,
        name: r['Course Name'],
        room: room.id,
        slot: (r['Course Slot Code'] || '').split('_')[0] || null,
        segment: r['Segment Name'] || '1-6',
        sessions,
        enrollment: enrolled,
      });
    }
  }
  const roomList = [...rooms.values()].map((r) => ({ ...r, seats: r.seats ?? 60 })).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  const seats = new Map(roomList.map((r) => [r.id, r.seats]));
  const classList = [...classes.values()]
    .map((c) => ({ ...c, enrollment: Math.min(c.enrollment, seats.get(c.room)) })) // can't seat more than the room holds
    .sort((a, b) => a.course.localeCompare(b.course));
  return { rooms: roomList, classes: classList };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/import-timetable.mjs <classroom-details.csv>');
    process.exit(1);
  }
  const { rooms, classes } = convert(parseCsv(fs.readFileSync(file, 'utf8')));
  const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  const out = {
    _source: `Imported from IITH Academic Office "Classroom Details" sheet (${path.basename(file)}) on ${new Date().toISOString().slice(0, 10)}. Registered counts and room capacities are from the sheet.`,
    calendar: existing.calendar ?? {},
    rooms,
    classes,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  const byPlace = (p) => rooms.filter((r) => r.placeId === p).reduce((a, r) => a + r.seats, 0);
  console.log(`${classes.length} classes in ${rooms.length} rooms -> ${OUT}`);
  console.log(`Seats: LHC ${byPlace('lhc')}, department blocks ${byPlace('acad')}`);
}
