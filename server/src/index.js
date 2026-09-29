import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { createApp, weeklyJob, ALLOWED_ORIGINS } from './app.js';
import * as clock from './clock.js';
import * as db from './db.js';
import { generateDemo, demoStudy, simulatedReport } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4000);
const DEMO_MODE = (process.env.DEMO_MODE ?? 'true') !== 'false';

// First run: fill the database with simulated data so the app isn't empty.
if (db.isEmpty()) {
  db.replace(generateDemo());
  console.log('[pulse] Empty database - generated demo data.');
}
// Older databases may predate Study Match: add demo study profiles if none exist.
if (DEMO_MODE && !db.get().studyProfiles.some((p) => p.user.startsWith('demo-'))) {
  const demo = demoStudy();
  db.get().studyProfiles.push(...demo.studyProfiles);
  db.get().studyRequests.push(...demo.studyRequests);
  db.flush();
}

let io;
const app = createApp({ emit: (event, payload) => io?.emit(event, payload), demoMode: DEMO_MODE });

// Serve the built React app in production (`npm run build && npm start`).
const dist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const server = http.createServer(app);
io = new Server(server, { cors: { origin: ALLOWED_ORIGINS } });
io.on('connection', (socket) => {
  io.emit('presence', io.engine.clientsCount);
  socket.on('disconnect', () => io.emit('presence', io.engine.clientsCount));
});

// Demo mode: a simulated student reports a crowd level every 20s so the map feels alive.
if (DEMO_MODE) {
  setInterval(() => {
    const r = simulatedReport(clock.now());
    if (!r) return;
    db.get().reports.push({ id: `sim-${Date.now()}`, ...r });
    db.save();
    io.emit('pulse:update', { placeId: r.placeId });
  }, 20_000);
}

// Auto-generate the estate office's weekly FixIt digest (Monday 9 am, once per week).
setInterval(() => {
  const d = weeklyJob();
  if (d) io.emit('digest', { key: d.key });
}, 10 * 60_000);

process.on('SIGINT', () => {
  db.flush();
  process.exit(0);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[pulse] Port ${PORT} is already in use - another copy of IITH Pulse is probably still running.`);
    console.error('[pulse] Stop it with Ctrl + C in its terminal, or run:  pkill -f "src/index.js"; pkill -f vite\n');
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`[pulse] API on http://localhost:${PORT}  (demo mode: ${DEMO_MODE ? 'on' : 'off'})`);
});
