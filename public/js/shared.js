// Flash-free theme: apply saved/system preference before first paint.
(function initTheme() {
  try {
    const saved = localStorage.getItem('theme');
    const dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', dark);
  } catch {}
})();

export function toggleTheme() {
  const dark = !document.documentElement.classList.contains('dark');
  document.documentElement.classList.toggle('dark', dark);
  try {
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  } catch {}
}

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function toast(message, { error = false } = {}) {
  let region = document.querySelector('.toast-region');
  if (!region) {
    region = document.createElement('div');
    region.className = 'toast-region';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
  }
  while (region.children.length >= 2) {
    region.firstElementChild.remove();
  }
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' error' : '');
  el.textContent = message;
  region.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtTime(ms) {
  if (ms == null) return 'General';
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

const AVATAR_COLORS = ['#4f46e5', '#0891b2', '#c2410c', '#65a30d', '#be185d', '#7c3aed', '#0d9488', '#b45309'];

export function avatarColor(seed) {
  const s = String(seed || '');
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export async function requireSession() {
  try {
    return await api('/api/session'); // { user, profile }
  } catch {
    window.location.href = '/login';
    return null;
  }
}

/**
 * A styled confirmation dialog (native <dialog>, matches the app's design
 * tokens) used in place of the browser's plain confirm(). Resolves true if
 * the person confirmed, false if they cancelled or dismissed it.
 */
export function confirmDialog({ title, body, confirmLabel = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'confirm-dialog';
    dialog.innerHTML = `
      <div style="padding:22px;">
        <h2 style="font-size:17px; margin-bottom:8px;">${escapeHtml(title)}</h2>
        <p class="text-muted" style="font-size:14px; margin:0 0 20px;">${escapeHtml(body)}</p>
        <div style="display:flex; justify-content:flex-end; gap:8px;">
          <button type="button" class="btn btn-cancel" data-action="cancel">Cancel</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-action="confirm">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(dialog);
    dialog.addEventListener('click', e => {
      if (e.target === dialog) finish(false); // backdrop click
    });
    dialog.addEventListener('cancel', () => finish(false)); // Esc key
    dialog.querySelector('[data-action="cancel"]').addEventListener('click', () => finish(false));
    dialog.querySelector('[data-action="confirm"]').addEventListener('click', () => finish(true));
    function finish(result) {
      dialog.close();
      dialog.remove();
      resolve(result);
    }
    dialog.showModal();
  });
}

// ------------------------------------------------------------------
// Guest identity — for share-link reviewers who don't have an account.
// Name/email are what the workspace owner sees; the token is a private
// capability secret proving "this browser owns this comment" to the
// server (see supabase/migrations/0002_sharing_and_guests.sql). All of it
// lives in localStorage, scoped to this browser only — there is no server
// account behind it.
// ------------------------------------------------------------------

const GUEST_KEY = 'relay_guest_identity';

export function getGuestIdentity() {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    if (!raw) return null;
    const identity = JSON.parse(raw);
    // Self-heals anyone who picked up a broken token before this fix (a
    // prior version generated 72-character tokens, over the server's
    // 64-character limit, so every request they made would fail
    // validation forever otherwise) — treat it as "no identity yet" so
    // the normal first-time flow re-prompts and regenerates a valid one.
    if (typeof identity?.token !== 'string' || identity.token.length < 16 || identity.token.length > 64) return null;
    return identity;
  } catch {
    return null;
  }
}

// Generates a URL-safe random token via the Web Crypto API (available in
// every modern browser, no dependency needed). 18 bytes -> 24 base64url
// characters — comfortably under the server's 64-character limit for
// guestToken, unlike a naive crypto.randomUUID() concatenation (36 chars
// each) which silently produced a 72-character token that failed
// validation on every single request.
function randomToken(byteLength = 18) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function setGuestIdentity(name, email) {
  const existing = getGuestIdentity();
  const existingToken = existing?.token && existing.token.length >= 16 && existing.token.length <= 64 ? existing.token : null;
  const identity = { name, email, token: existingToken || randomToken() };
  try {
    localStorage.setItem(GUEST_KEY, JSON.stringify(identity));
  } catch {}
  return identity;
}

// ------------------------------------------------------------------
// A small, cohesive line-icon set (stroke = currentColor, so CSS controls
// color per context) — replaces emoji, which render inconsistently
// across OS/browser and don't read as one coherent design system.
// ------------------------------------------------------------------

const ICON_PATHS = {
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l1.5 2h6A1.5 1.5 0 0 1 17.5 8.5v8A1.5 1.5 0 0 1 16 18H4.5A1.5 1.5 0 0 1 3 16.5v-10Z"/>',
  link: '<path d="M9 12a3.5 3.5 0 0 0 5 0l2-2a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M11 8a3.5 3.5 0 0 0-5 0l-2 2a3.5 3.5 0 0 0 5 5l1-1"/>',
  chat: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5v6A1.5 1.5 0 0 1 14.5 13H9l-3.5 3v-3H5.5A1.5 1.5 0 0 1 4 11.5v-6Z"/>',
  video: '<rect x="3" y="6" width="12" height="9" rx="1.5"/><path d="M15 9.5 20 7v7l-5-2.5Z"/>',
  image: '<rect x="3" y="4" width="15" height="13" rx="1.5"/><circle cx="8" cy="9" r="1.5"/><path d="M4 15l4.5-4.5L11 13l3-3 3.5 3.5"/>',
  music: '<circle cx="6.5" cy="16" r="2.5"/><circle cx="15.5" cy="14" r="2.5"/><path d="M9 16V5.5L18 4v10"/>',
  file: '<path d="M6 3.5h6L16 8v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1Z"/><path d="M12 3.5V8h4"/>',
  share: '<circle cx="6" cy="10" r="2"/><circle cx="15" cy="5" r="2"/><circle cx="15" cy="15" r="2"/><path d="M7.7 9l5.6-3M7.7 11l5.6 3"/>',
  sync: '<path d="M4 10a6 6 0 0 1 10.2-4.3L16 7.5"/><path d="M16 4v3.5h-3.5"/><path d="M16 10a6 6 0 0 1-10.2 4.3L4 12.5"/><path d="M4 16v-3.5h3.5"/>',
  moon: '<path d="M15.5 12.8A6.5 6.5 0 0 1 7.2 4.5a6.5 6.5 0 1 0 8.3 8.3Z"/>',
  sun: '<circle cx="10" cy="10" r="3.2"/><path d="M10 3v1.6M10 15.4V17M17 10h-1.6M4.6 10H3M14.8 5.2l-1.1 1.1M6.3 13.7l-1.1 1.1M14.8 14.8l-1.1-1.1M6.3 6.3 5.2 5.2"/>',
  dots: '<circle cx="10" cy="4.5" r="1.3"/><circle cx="10" cy="10" r="1.3"/><circle cx="10" cy="15.5" r="1.3"/>',
  trash: '<path d="M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6m-6.5 0 .6 10a1.5 1.5 0 0 0 1.5 1.4h4.8a1.5 1.5 0 0 0 1.5-1.4L14.5 6"/>',
  reply: '<path d="M6 8L2 12l4 4"/><path d="M2 12h11a4 4 0 0 0 4-4V6"/>',
  edit: '<path d="M13.5 3.5l3 3L6.5 16.5H3.5v-3L13.5 3.5z"/>',
  menu: '<path d="M4 6h12M4 10h12M4 14h12"/>',
  close: '<path d="M5 5l10 10M15 5L5 15"/>',
  check: '<path d="M4 10.5l3.5 3.5L16 5.5"/>',
  sparkle: '<path d="M10 2.5c.6 2.9 1.6 3.9 4.5 4.5-2.9.6-3.9 1.6-4.5 4.5-.6-2.9-1.6-3.9-4.5-4.5 2.9-.6 3.9-1.6 4.5-4.5Z"/><path d="M16 13c.3 1.2.7 1.6 1.9 1.9-1.2.3-1.6.7-1.9 1.9-.3-1.2-.7-1.6-1.9-1.9 1.2-.3 1.6-.7 1.9-1.9Z"/>',
  play: '<path d="M6 4l10 6-10 6V4z"/>',
  pause: '<rect x="5" y="4" width="3.5" height="12" rx="1"/><rect x="11.5" y="4" width="3.5" height="12" rx="1"/>',
  rewind: '<path d="M10 6l-6 4 6 4V6zm7 0l-6 4 6 4V6z"/>',
  forward: '<path d="M4 6l6 4-6 4V6zm7 0l6 4-6 4V6z"/>',
  loop: '<path d="M14 6H7a3 3 0 0 0-3 3v2m0 0l-2-2m2 2l2-2m0 7h7a3 3 0 0 0 3-3v-2m0 0l2 2m-2-2l-2 2"/>',
  volume: '<path d="M11 4.5L6.5 8H3.5A1 1 0 0 0 2.5 9v2a1 1 0 0 0 1 1h3L11 15.5V4.5z"/><path d="M14.5 7a4 4 0 0 1 0 6M17 4.5a7.5 7.5 0 0 1 0 11"/>',
  volumeMute: '<path d="M11 4.5L6.5 8H3.5A1 1 0 0 0 2.5 9v2a1 1 0 0 0 1 1h3L11 15.5V4.5z"/><path d="M14 8l5 5M19 8l-5 5"/>',
  fullscreen: '<path d="M4 7V4h3M13 4h3v3M4 13v3h3M16 13v3h-3"/>',
};

/** Returns an inline SVG icon string. `stroke` icons use currentColor
 * outlines (folder/link/chat/media/share/sync/moon/sun/dots/trash);
 * `sparkle` is filled. Sized via the `size` option, colored via CSS
 * (parent's `color`). */
export function icon(name, { size = 18 } = {}) {
  const path = ICON_PATHS[name];
  if (!path) return '';
  const filled = name === 'sparkle';
  return `<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}
