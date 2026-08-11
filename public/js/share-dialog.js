import { api, toast, confirmDialog } from './shared.js';

/**
 * Builds and wires a share dialog for a workspace. When `mediaPath` is
 * given, the displayed/copied link points directly at that media item
 * (`/review/:token/media/:id`) instead of the workspace grid
 * (`/review/:token`) — but note both are backed by the *same* workspace
 * share token (see supabase/migrations/0002_sharing_and_guests.sql): a
 * "share this video" link and a "share this workspace" link grant the
 * same underlying access, just open to a different starting page. True
 * per-file-only isolation (hiding the rest of the workspace from someone
 * with a media link) would need a new share-scope column, which the
 * brief for this change asked not to add. This is documented here and in
 * the UI copy so it's a known, deliberate tradeoff rather than a silent
 * gap.
 */
export function initShareDialog({ workspaceId, mediaPath, title, description }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'share-dialog';
  dialog.innerHTML = `
    <div style="padding:24px;">
      <h2 style="font-size:18px; margin-bottom:4px;">${title}</h2>
      <p class="text-muted" style="font-size:13px; margin:0 0 16px;">${description}</p>

      <div class="share-status-row">
        <span class="share-status-badge" data-role="badge"><span class="dot"></span><span data-role="status-text">Loading…</span></span>
        <label class="switch">
          <input type="checkbox" data-role="toggle" aria-label="Enable public sharing" />
          <span class="track"></span>
        </label>
      </div>

      <div data-role="link-section" hidden>
        <div class="share-link-row">
          <input type="text" data-role="link-input" readonly />
          <button class="btn btn-primary" data-role="copy-btn" style="flex-shrink:0;">Copy link</button>
        </div>
        <button class="btn btn-ghost" data-role="regenerate-btn" style="margin-top:10px; font-size:12px; padding:6px 10px;">Regenerate link (revokes the old one)</button>
      </div>

      <div style="display:flex; justify-content:flex-end; margin-top:20px;">
        <button type="button" class="btn btn-cancel" data-role="close-btn">Done</button>
      </div>
    </div>`;
  document.body.appendChild(dialog);

  const toggle = dialog.querySelector('[data-role="toggle"]');
  const badge = dialog.querySelector('[data-role="badge"]');
  const statusText = dialog.querySelector('[data-role="status-text"]');
  const linkSection = dialog.querySelector('[data-role="link-section"]');
  const linkInput = dialog.querySelector('[data-role="link-input"]');

  function linkFor(baseUrl) {
    if (!baseUrl || !mediaPath) return baseUrl;
    // baseUrl looks like `${origin}/review/:token` — splice the media path in.
    return `${baseUrl}${mediaPath}`;
  }

  function paint(shareEnabled, shareUrl) {
    toggle.checked = shareEnabled;
    badge.classList.toggle('on', shareEnabled);
    badge.classList.toggle('off', !shareEnabled);
    statusText.textContent = shareEnabled ? 'Public link is on' : 'Public link is off';
    linkSection.hidden = !shareEnabled;
    if (shareUrl) linkInput.value = linkFor(shareUrl);
  }

  dialog.querySelector('[data-role="close-btn"]').addEventListener('click', () => dialog.close());

  toggle.addEventListener('change', async () => {
    const enabling = toggle.checked;
    toggle.disabled = true;
    try {
      const result = enabling
        ? await api(`/api/workspaces/${workspaceId}/share`, { method: 'POST' })
        : await api(`/api/workspaces/${workspaceId}/share`, { method: 'DELETE' });
      paint(result.shareEnabled, result.shareUrl);
      toast(enabling ? 'Public sharing is on' : 'Public sharing is off');
    } catch (e) {
      toggle.checked = !enabling;
      toast(e.message, { error: true });
    } finally {
      toggle.disabled = false;
    }
  });

  dialog.querySelector('[data-role="regenerate-btn"]').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Regenerate share link?',
      body: 'The current link will stop working immediately for anyone using it.',
      confirmLabel: 'Regenerate',
    });
    if (!ok) return;
    try {
      const result = await api(`/api/workspaces/${workspaceId}/share`, { method: 'POST' });
      paint(result.shareEnabled, result.shareUrl);
      toast('Link regenerated');
    } catch (e) {
      toast(e.message, { error: true });
    }
  });

  dialog.querySelector('[data-role="copy-btn"]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(linkInput.value);
      toast('Link copied');
    } catch {
      linkInput.select();
      toast('Select and copy the link');
    }
  });

  return {
    async open() {
      dialog.showModal();
      try {
        const { shareEnabled, shareUrl } = await api(`/api/workspaces/${workspaceId}/share`);
        paint(shareEnabled, shareUrl);
      } catch (e) {
        toast(e.message, { error: true });
      }
    },
  };
}
