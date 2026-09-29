// Thin fetch wrapper + student identity.
// With Google sign-in on, the identity is the signed session from the server (@iith.ac.in only).
// Without it (local demo), an anonymous random id is kept in localStorage.

const KEY = 'pulse.user';
const SESSION_KEY = 'pulse.session';

function randomId() {
  return (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)) + '';
}

export function getSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (s?.token) return s;
  } catch {}
  return null;
}

export function saveSession(session) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {}
}

export function getUser() {
  const session = getSession();
  if (session) return { ...session.user, token: session.token };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved?.id) return saved;
  } catch {}
  const user = { id: randomId(), name: `Student ${Math.floor(1000 + Math.random() * 9000)}` };
  try {
    localStorage.setItem(KEY, JSON.stringify(user));
  } catch {}
  return user;
}

export function saveUser(user) {
  try {
    localStorage.setItem(KEY, JSON.stringify(user));
  } catch {}
}

let adminPin = null;
export const setAdminPin = (pin) => (adminPin = pin);
export const isAdmin = () => Boolean(adminPin) || Boolean(getSession()?.user.admin);

async function request(method, url, body) {
  const token = getSession()?.token;
  const res = await fetch(`/api${url}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(adminPin ? { 'x-admin-pin': adminPin } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) saveSession(null); // expired session: sign in again
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  patch: (url, body) => request('PATCH', url, body),
};
