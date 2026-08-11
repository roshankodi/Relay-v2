import { escapeHtml, getGuestIdentity, setGuestIdentity } from './shared.js';

/**
 * Shows the "who are you" dialog. Resolves with the identity if the guest
 * submits it, or null if they dismiss it (viewing still works without an
 * identity — it's only required to comment, at which point this gets
 * called again from the composer).
 */
export function openGuestIdentityDialog({ force = false } = {}) {
  const existing = getGuestIdentity();
  if (existing && !force) return Promise.resolve(existing);

  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'guest-dialog';
    dialog.innerHTML = `
      <div style="padding:24px;">
        <h2 style="font-size:18px; margin-bottom:4px;">Let others know who you are</h2>
        <p class="text-muted" style="font-size:13px; margin:0 0 18px;">
          Your name and email are shown to the workspace owner alongside your comments.
        </p>
        <form id="guest-form">
          <div class="field">
            <label for="guest-name">Full name</label>
            <input id="guest-name" required maxlength="100" value="${escapeHtml(existing?.name || '')}" autofocus />
          </div>
          <div class="field">
            <label for="guest-email">Email address</label>
            <input id="guest-email" type="email" required maxlength="320" value="${escapeHtml(existing?.email || '')}" />
          </div>
          <p class="error-text" id="guest-error" role="alert"></p>
          <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:4px;">
            <button type="button" class="btn btn-cancel" data-action="cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Save</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(dialog);

    const form = dialog.querySelector('#guest-form');
    const errorEl = dialog.querySelector('#guest-error');

    function close(result) {
      dialog.close();
      dialog.remove();
      resolve(result);
    }

    dialog.querySelector('[data-action="cancel"]').addEventListener('click', () => close(null));
    dialog.addEventListener('cancel', () => close(null));
    dialog.addEventListener('click', e => {
      if (e.target === dialog) close(null);
    });

    form.addEventListener('submit', e => {
      e.preventDefault();
      const name = dialog.querySelector('#guest-name').value.trim();
      const email = dialog.querySelector('#guest-email').value.trim();
      if (!name) return (errorEl.textContent = 'Enter your name.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return (errorEl.textContent = 'Enter a valid email address.');
      const identity = setGuestIdentity(name, email);
      close(identity);
    });

    dialog.showModal();
  });
}

/** Ensures an identity exists before letting a guest post — prompts if needed. */
export async function ensureGuestIdentity() {
  const existing = getGuestIdentity();
  if (existing) return existing;
  return openGuestIdentityDialog({ force: true });
}
