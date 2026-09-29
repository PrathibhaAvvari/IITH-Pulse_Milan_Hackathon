// Real identity: Google sign-in restricted to the IITH Google Workspace domain.
// The browser gets a Google ID token (Google Identity Services); the server checks it with Google,
// enforces the domain, and hands back a signed session token. No extra dependencies.
// Auth is ON when GOOGLE_CLIENT_ID is set. Without it (local dev / offline demo) the app falls back to
// anonymous browser IDs and the admin PIN.
import crypto from 'node:crypto';

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
export const ALLOWED_DOMAIN = (process.env.ALLOWED_DOMAIN || 'iith.ac.in').toLowerCase();
export const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);
// With sign-in on, the signing key MUST come from the environment: no hardcoded fallback (anyone could
// forge an admin session) and no random one (everyone is logged out on each restart).
// With sign-in off, sessions are never issued, so a throwaway random key is fine.
if (GOOGLE_CLIENT_ID && (process.env.SESSION_SECRET ?? '').length < 32) {
  throw new Error('SESSION_SECRET (32+ characters) is required when GOOGLE_CLIENT_ID is set');
}
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const TTL_MS = 7 * 86_400_000;

const mac = (body) => crypto.createHmac('sha256', SECRET).update(body).digest('base64url');

export function signSession(user, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ ...user, exp: now + TTL_MS })).toString('base64url');
  return `${body}.${mac(body)}`;
}

export function verifySession(token, now = Date.now()) {
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  const good = mac(body);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString());
    return s.exp > now ? s : null;
  } catch {
    return null;
  }
}

/** Validate a Google ID token and enforce the IITH domain. Returns { id, email, name, admin }. */
export async function verifyGoogle(credential, { clientId = GOOGLE_CLIENT_ID, domain = ALLOWED_DOMAIN, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!res.ok) throw new Error('Google sign-in could not be verified');
  const t = await res.json(); // Google has checked the signature and expiry
  if (t.aud !== clientId) throw new Error('Token was issued for another app');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(t.iss)) throw new Error('Bad token issuer');
  if (String(t.email_verified) !== 'true') throw new Error('Email not verified');
  const email = String(t.email).toLowerCase();
  // hd is only present for Google Workspace accounts, so a gmail.com address can't fake it.
  if (t.hd !== domain || !email.endsWith(`@${domain}`)) throw new Error(`Please sign in with your @${domain} account`);
  return { id: `g:${t.sub}`, email, name: t.given_name || t.name || email.split('@')[0], admin: ADMIN_EMAILS.has(email) };
}
