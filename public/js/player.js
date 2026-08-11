// Shared review-page logic: custom video/audio player with Frame.io-style
// timeline range selection, the image pan/zoom marker viewer, and the
// comment sidebar (create/edit/delete, bidirectional timeline sync).
//
// Used by both /app/workspaces/:id/media/:id (account holders, via
// media.html) and /review/:token/media/:id (guests, via review-media.html)
// — the two pages differ only in how they talk to the backend (session
// cookie vs. share token) and whether comments carry an author profile or
// a guest name, which is why all backend calls are injected as an
// `adapter` rather than hardcoded here. This is the single implementation
// of a genuinely large feature; duplicating it per page would have meant
// two copies of the same ~500 lines drifting out of sync.

import { escapeHtml, toast, fmtTime, timeAgo, initials, avatarColor, confirmDialog, icon } from './shared.js';

export function initReviewPage({ stageCard, commentsEl, commentCountEl, composerForm, bodyInput, anchorBadge, rangeControls, adapter, onMediaLoaded }) {
  let media = null;
  let comments = [];
  let annotation = null; // pending image marker { x, y, type }
  let activeCommentId = null;
  let pollTimer = null;
  let pollSignature = '';

  // Hooks the active player/viewer wires up so the shared comment list can
  // talk to it without caring which media kind is loaded.
  let renderTimelineMarkers = () => {};
  let seekTo = null;
  let pulseMarker = () => {};
  let buildCommentPayload = null;
  let resetComposer = () => {};

  // ------------------------------------------------------------------
  // Comment list rendering + timeline <-> sidebar sync
  // ------------------------------------------------------------------

  let userLockedCommentId = null;

  function setActiveComment(id, { scroll = true, isUserClick = false } = {}) {
    activeCommentId = id;
    if (isUserClick) userLockedCommentId = id;
    commentsEl.querySelectorAll('.comment-card').forEach(el => {
      const isActive = el.dataset.id === id;
      el.classList.toggle('active', isActive);
      if (isActive && scroll) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    document.querySelectorAll('.scrubber-marker, .marker-dot, .scrubber-range').forEach(el => {
      el.classList.toggle('active', el.dataset.id === id);
    });
  }

  function signatureOf(list) {
    return list.map(c => `${c.id}:${c.updated_at}`).join('|');
  }

  function renderComments() {
    commentCountEl.textContent = comments.length ? `${comments.length} comment${comments.length === 1 ? '' : 's'}` : '';
    if (!comments.length) {
      commentsEl.innerHTML = `<div class="empty-state"><div class="empty-icon">💬</div>No comments yet — be the first.</div>`;
      renderTimelineMarkers();
      return;
    }
    const topLevel = comments.filter(c => !c.parent_id);
    const repliesByParent = new Map();
    for (const c of comments) {
      if (!c.parent_id) continue;
      if (!repliesByParent.has(c.parent_id)) repliesByParent.set(c.parent_id, []);
      repliesByParent.get(c.parent_id).push(c);
    }
    commentsEl.innerHTML = topLevel
      .map((c, i) => {
        const replies = repliesByParent.get(c.id) || [];
        return `<div class="comment-thread" data-thread-id="${c.id}">
          ${commentCardHtml(c, { isReply: false, index: i + 1 })}
          <div class="reply-list">${replies.map(r => commentCardHtml(r, { isReply: true })).join('')}</div>
        </div>`;
      })
      .join('');
    commentsEl.querySelectorAll('.comment-card').forEach(wireCommentCard);
    renderTimelineMarkers();
  }

  function commentCardHtml(c, { isReply, index }) {
    const label = c.annotation
      ? 'MARKER'
      : c.range_start_ms != null && c.range_end_ms != null
        ? `${fmtTime(c.range_start_ms)}–${fmtTime(c.range_end_ms)}`
        : c.timestamp_ms != null
          ? fmtTime(c.timestamp_ms)
          : null;
    const author = c.profiles?.display_name || c.guest_name || 'Reviewer';
    const editedTag = c.updated_at && c.updated_at !== c.created_at ? ' <span class="comment-edited-tag text-muted">(edited)</span>' : '';
    const actions = `
      ${!isReply ? `<button type="button" class="comment-action-btn" data-action="reply" aria-label="Reply to comment" title="Reply">${icon('reply', { size: 12 })}</button>` : ''}
      ${c.canEdit ? `<button type="button" class="comment-action-btn" data-action="edit" aria-label="Edit comment" title="Edit">${icon('edit', { size: 12 })}</button>` : ''}
      ${c.canDelete ? `<button type="button" class="comment-action-btn danger" data-action="delete" aria-label="Delete comment" title="Delete">${icon('trash', { size: 12 })}</button>` : ''}
    `;
    return `<div class="comment-card${isReply ? ' reply-card' : ''}" data-id="${c.id}">
      <span class="comment-avatar" style="background:${avatarColor(author)}; color:#FFFFFF;">${escapeHtml(initials(author))}</span>
      <span class="comment-body-col" style="flex:1; min-width:0;">
        <div style="display:flex; align-items:center; justify-content:space-between; width:100%; gap:8px;">
          <span class="comment-author" style="font-weight:800; font-size:14px; letter-spacing:-0.2px; color:var(--color-text-primary);">${escapeHtml(author)}</span>
          <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
            ${label ? `<span class="comment-time-badge" style="background:color-mix(in srgb, var(--color-brand-accent) 16%, transparent); border:1px solid color-mix(in srgb, var(--color-brand-accent) 35%, transparent); color:var(--color-brand-accent); font-size:11px; font-weight:800; padding:3px 10px; border-radius:var(--radius-pill); font-variant-numeric:tabular-nums; letter-spacing:0.02em;">${escapeHtml(label)}</span>` : ''}
            <div class="comment-actions">
              ${actions}
            </div>
          </div>
        </div>
        <div style="margin-top:2px; line-height:1.45;">
          <span class="comment-text" data-role="text" style="font-size:13px; color:var(--color-text-primary); font-weight:500;">${escapeHtml(c.body)}</span>
          <span class="comment-meta" style="font-size:11px; color:var(--color-text-secondary); margin-left:6px; opacity:0.75;">${timeAgo(c.created_at)}${editedTag}</span>
        </div>
      </span>
    </div>`;
  }

  function wireCommentCard(card) {
    const id = card.dataset.id;
    const c = comments.find(x => x.id === id);
    if (!c) return;

    card.addEventListener('click', e => {
      if (e.target.closest('.comment-action-btn') || e.target.closest('.comment-edit-row') || e.target.closest('.reply-composer')) return;
      setActiveComment(c.id, { scroll: false, isUserClick: true });
      if (c.annotation) pulseMarker(c.id);
      const t = c.timestamp_ms ?? c.range_start_ms;
      if (t != null && seekTo) seekTo(t);
    });

    card.querySelector('[data-action="delete"]')?.addEventListener('click', async e => {
      e.stopPropagation();
      const isThread = !c.parent_id && (comments.some(x => x.parent_id === c.id));
      const ok = await confirmDialog({
        title: 'Delete comment?',
        body: isThread ? 'This removes the comment and all its replies for everyone. This can\'t be undone.' : 'This removes the comment for everyone. This can\'t be undone.',
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
      card.classList.add('deleting');
      try {
        await adapter.deleteComment(c.id);
        // Deleting a top-level comment also removes its replies (the
        // database cascades this on its own; mirror it in local state
        // immediately so the UI doesn't wait on the next poll).
        comments = comments.filter(x => x.id !== c.id && x.parent_id !== c.id);
        if (activeCommentId === c.id) activeCommentId = null;
        renderComments();
      } catch (err) {
        card.classList.remove('deleting');
        toast(err.message, { error: true });
      }
    });

    card.querySelector('[data-action="edit"]')?.addEventListener('click', e => {
      e.stopPropagation();
      startEdit(card, c);
    });

    card.querySelector('[data-action="reply"]')?.addEventListener('click', e => {
      e.stopPropagation();
      startReply(card, c);
    });
  }

  function startEdit(card, c) {
    const textEl = card.querySelector('[data-role="text"]');
    const original = c.body;
    textEl.outerHTML = `<span class="comment-edit-row" data-role="edit-row">
      <textarea maxlength="5000">${escapeHtml(original)}</textarea>
      <span class="comment-edit-actions">
        <button type="button" class="btn btn-cancel" data-action="cancel-edit" style="padding:5px 12px; font-size:12px;">Cancel</button>
        <button type="button" class="btn btn-primary" data-action="save-edit" style="padding:5px 12px; font-size:12px;">Save</button>
      </span>
    </span>`;
    const row = card.querySelector('[data-role="edit-row"]');
    const textarea = row.querySelector('textarea');
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    row.querySelector('[data-action="cancel-edit"]').addEventListener('click', e => {
      e.stopPropagation();
      renderComments();
    });
    row.querySelector('[data-action="save-edit"]').addEventListener('click', async e => {
      e.stopPropagation();
      const next = textarea.value.trim();
      if (!next || next === original) return renderComments();
      try {
        const updated = await adapter.editComment(c.id, next);
        comments = comments.map(x => (x.id === c.id ? updated : x));
        renderComments();
        setActiveComment(c.id, { scroll: false });
      } catch (err) {
        toast(err.message, { error: true });
      }
    });
  }

  function startReply(card, parent) {
    const thread = card.closest('.comment-thread');
    const replyList = thread.querySelector('.reply-list');
    // Only one reply composer open per thread at a time.
    thread.querySelector('.reply-composer')?.remove();

    const composer = document.createElement('div');
    composer.className = 'reply-composer';
    composer.innerHTML = `
      <textarea maxlength="5000" placeholder="Write a reply…"></textarea>
      <span class="comment-edit-actions">
        <button type="button" class="btn btn-cancel" data-action="cancel-reply" style="padding:5px 12px; font-size:12px;">Cancel</button>
        <button type="button" class="btn btn-primary" data-action="save-reply" style="padding:5px 12px; font-size:12px;">Reply</button>
      </span>`;
    replyList.prepend(composer);
    const textarea = composer.querySelector('textarea');
    textarea.focus();

    composer.querySelector('[data-action="cancel-reply"]').addEventListener('click', e => {
      e.stopPropagation();
      composer.remove();
    });
    composer.querySelector('[data-action="save-reply"]').addEventListener('click', async e => {
      e.stopPropagation();
      const text = textarea.value.trim();
      if (!text) return;
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const reply = await adapter.createComment({ mediaId: media.id, parentId: parent.id, body: text });
        comments = [...comments, reply];
        pollSignature = signatureOf(comments);
        renderComments();
        setActiveComment(parent.id, { scroll: false });
      } catch (err) {
        toast(err.message, { error: true });
        btn.disabled = false;
      }
    });
  }

  // ------------------------------------------------------------------
  // Video / audio: custom player with Frame.io-style range selection
  // ------------------------------------------------------------------

  function buildAvPlayer(src, kind) {
    const tag = kind === 'audio' ? 'audio' : 'video';
    stageCard.innerHTML = `
      <div class="player">
        <div class="player-stage${kind === 'audio' ? ' audio-stage' : ''}">
          ${kind === 'audio' ? `<div class="audio-art">${icon('music', { size: 32 })}</div>` : `<div class="center-play-btn" id="center-play-btn">${icon('play', { size: 24 })}</div>`}
          <${tag} id="av" ${kind === 'audio' ? 'style="display:none"' : ''} preload="metadata" src="${escapeHtml(src)}"></${tag}>
        </div>
        <div class="player-controls">
          <div class="scrubber-row">
            <span class="time-label" id="time-current">0:00</span>
            <div class="scrubber" id="scrubber" role="slider" aria-label="Seek" tabindex="0" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
              <div class="scrubber-track" id="scrubber-track">
                <div class="scrubber-buffered" id="scrubber-buffered"></div>
                <div class="scrubber-fill" id="scrubber-fill"></div>
                <div id="scrubber-ranges"></div>
                <div id="scrubber-pending"></div>
                <div id="scrubber-markers"></div>
                <div class="scrubber-handle" id="scrubber-handle"></div>
              </div>
            </div>
            <span class="time-label" id="time-duration">0:00</span>
          </div>
          <div class="player-buttons">
            <button type="button" class="player-btn" id="play-btn" aria-label="Play / Pause" title="Play / Pause (Space)">${icon('play', { size: 15 })}</button>
            <button type="button" class="player-btn" id="back-btn" aria-label="Back 5 seconds" title="Back 5s">${icon('rewind', { size: 15 })}</button>
            <button type="button" class="player-btn" id="fwd-btn" aria-label="Forward 5 seconds" title="Forward 5s">${icon('forward', { size: 15 })}</button>
            <button type="button" class="player-btn" id="loop-btn" aria-label="Toggle Loop" title="Toggle Loop">${icon('loop', { size: 15 })}</button>
            <div class="player-spacer"></div>
            <div class="volume-row" style="display:flex; align-items:center; gap:8px;">
              <span aria-hidden="true" style="color:var(--color-text-secondary); display:grid; place-items:center;">${icon('volume', { size: 15 })}</span>
              <input type="range" id="volume" min="0" max="1" step="0.05" value="1" aria-label="Volume" />
            </div>
            <button type="button" class="player-btn" id="fullscreen-btn" aria-label="Toggle Fullscreen" title="Toggle Fullscreen">${icon('fullscreen', { size: 15 })}</button>
          </div>
        </div>
      </div>`;

    const av = document.getElementById('av');
    const playBtn = document.getElementById('play-btn');
    const loopBtn = document.getElementById('loop-btn');
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    const scrubber = document.getElementById('scrubber');
    const track = document.getElementById('scrubber-track');
    const fill = document.getElementById('scrubber-fill');
    const buffered = document.getElementById('scrubber-buffered');
    const handle = document.getElementById('scrubber-handle');
    const markersEl = document.getElementById('scrubber-markers');
    const rangesEl = document.getElementById('scrubber-ranges');
    const pendingEl = document.getElementById('scrubber-pending');
    const timeCurrent = document.getElementById('time-current');
    const timeDuration = document.getElementById('time-duration');
    const volume = document.getElementById('volume');

    const playerEl = stageCard.querySelector('.player');
    let idleTimer = null;
    function resetIdleTimer() {
      if (!playerEl) return;
      playerEl.classList.remove('user-idle');
      clearTimeout(idleTimer);
      if (av && !av.paused) {
        idleTimer = setTimeout(() => {
          playerEl.classList.add('user-idle');
        }, 2500);
      }
    }
    if (playerEl) {
      playerEl.addEventListener('mousemove', resetIdleTimer);
      playerEl.addEventListener('pointermove', resetIdleTimer);
      playerEl.addEventListener('touchstart', resetIdleTimer);
    }

    const playerStage = stageCard.querySelector('.player-stage');
    if (playerStage && av) {
      playerStage.style.cursor = 'pointer';
      playerStage.addEventListener('click', e => {
        if (e.target.closest('.marker-dot, .zoom-toolbar, .scrubber, button, input')) return;
        if (av.paused) av.play().catch(() => {});
        else av.pause();
      });
    }

    let duration = 0;
    let scrubbing = false;
    let pendingRange = null; // { startMs, endMs }
    let pointerDownMs = null;

    const SNAP_MS = 100;
    const snap = ms => Math.round(ms / SNAP_MS) * SNAP_MS;
    const pct = ms => (duration ? Math.min(100, Math.max(0, (ms / 1000 / duration) * 100)) : 0);
    const msAt = clientX => {
      const r = track.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      return snap(ratio * duration * 1000);
    };

    function clearRange() {
      pendingRange = null;
      renderPending();
      updateAnchorBadge();
    }

    function updateAnchorBadge() {
      if (pendingRange && Math.abs(pendingRange.endMs - pendingRange.startMs) > 200) {
        const text = `Range: ${fmtTime(pendingRange.startMs)} → ${fmtTime(pendingRange.endMs)}`;
        if (anchorBadge.dataset.type !== 'range' || anchorBadge.dataset.rangeText !== text) {
          anchorBadge.dataset.type = 'range';
          anchorBadge.dataset.rangeText = text;
          anchorBadge.innerHTML = `<span>${text}</span> <button type="button" id="clear-range-chip" aria-label="Clear range" title="Clear range selection" style="background:transparent; border:none; color:var(--color-text-secondary); opacity:0.6; cursor:pointer; font-size:12px; font-weight:700; padding:0 4px; margin-left:6px; transition:all 0.15s ease;">✕</button>`;
          const clearChip = document.getElementById('clear-range-chip');
          if (clearChip) {
            clearChip.addEventListener('mouseenter', () => {
              clearChip.style.color = '#EF4444';
              clearChip.style.opacity = '1';
            });
            clearChip.addEventListener('mouseleave', () => {
              clearChip.style.color = 'var(--color-text-secondary)';
              clearChip.style.opacity = '0.6';
            });
            clearChip.addEventListener('click', e => {
              e.preventDefault();
              e.stopPropagation();
              clearRange();
            });
          }
        }
      } else {
        if (anchorBadge.dataset.type !== 'point' || anchorBadge.dataset.timeText !== fmtTime(av.currentTime * 1000)) {
          anchorBadge.dataset.type = 'point';
          anchorBadge.dataset.rangeText = '';
          anchorBadge.dataset.timeText = fmtTime(av.currentTime * 1000);
          anchorBadge.innerHTML = `<span>${fmtTime(av.currentTime * 1000)}</span>`;
        }
      }
    }

    function renderMarkers() {
      markersEl.innerHTML = comments
        .filter(c => c.timestamp_ms != null)
        .map(c => `<div class="scrubber-marker${c.id === activeCommentId ? ' active' : ''}" data-id="${c.id}" style="left:${pct(Number(c.timestamp_ms))}%" title="${escapeHtml((c.profiles?.display_name || c.guest_name || 'Reviewer') + ': ' + c.body.slice(0, 60))}"></div>`)
        .join('');
      rangesEl.innerHTML = comments
        .filter(c => c.range_start_ms != null)
        .map(c => `<div class="scrubber-range${c.id === activeCommentId ? ' active' : ''}" data-id="${c.id}" style="left:${pct(Number(c.range_start_ms))}%; width:${Math.max(0.5, pct(Number(c.range_end_ms)) - pct(Number(c.range_start_ms)))}%" title="${escapeHtml((c.profiles?.display_name || c.guest_name || 'Reviewer') + ': ' + c.body.slice(0, 60))}"></div>`)
        .join('');
      markersEl.querySelectorAll('.scrubber-marker').forEach(el => {
        el.addEventListener('click', e => {
          e.stopPropagation();
          const c = comments.find(x => x.id === el.dataset.id);
          if (c) {
            av.currentTime = Number(c.timestamp_ms) / 1000;
            av.pause();
            setActiveComment(c.id, { scroll: false, isUserClick: true });
          }
        });
      });
      rangesEl.querySelectorAll('.scrubber-range').forEach(el => {
        el.addEventListener('click', e => {
          e.stopPropagation();
          const c = comments.find(x => x.id === el.dataset.id);
          if (c) {
            av.currentTime = Number(c.range_start_ms) / 1000;
            av.pause();
            setActiveComment(c.id, { scroll: false, isUserClick: true });
          }
        });
      });
    }
    renderTimelineMarkers = renderMarkers;
    seekTo = ms => {
      av.currentTime = Number(ms) / 1000;
      av.pause();
    };

    function updateActiveFromTime() {
      if (userLockedCommentId && av.paused) {
        if (activeCommentId !== userLockedCommentId) setActiveComment(userLockedCommentId, { scroll: false });
        return;
      }
      const nowMs = av.currentTime * 1000;
      let best = null;
      for (const c of comments) {
        const start = Number(c.range_start_ms);
        const end = Number(c.range_end_ms);
        const ts = Number(c.timestamp_ms);
        if (c.range_start_ms != null && c.range_end_ms != null && nowMs >= start - 150 && nowMs <= end + 150) {
          best = c;
          break;
        }
        if (c.timestamp_ms != null && Math.abs(nowMs - ts) <= 500) {
          best = c;
        }
      }
      if (best) {
        userLockedCommentId = best.id;
        if (best.id !== activeCommentId) setActiveComment(best.id, { scroll: false });
      }
    }

    function render() {
      const cur = av.currentTime;
      const p = duration ? (cur / duration) * 100 : 0;
      fill.style.width = `${p}%`;
      handle.style.left = `${p}%`;
      scrubber.setAttribute('aria-valuenow', Math.round(p));
      timeCurrent.textContent = fmtTime(cur * 1000);
      const buf = av.buffered;
      if (buf.length && duration) buffered.style.width = `${(buf.end(buf.length - 1) / duration) * 100}%`;
    }

    av.addEventListener('loadedmetadata', () => {
      duration = av.duration || 0;
      timeDuration.textContent = fmtTime(duration * 1000);
      renderMarkers();
      render();
    });
    av.addEventListener('timeupdate', () => {
      if (!scrubbing) render();
      updateActiveFromTime();
      updateAnchorBadge();
    });
    av.addEventListener('progress', render);
    av.addEventListener('play', () => {
      playBtn.innerHTML = icon('pause', { size: 15 });
      playerEl?.classList.add('playing');
      resetIdleTimer();
    });
    av.addEventListener('pause', () => {
      playBtn.innerHTML = icon('play', { size: 15 });
      playerEl?.classList.remove('playing');
      playerEl?.classList.remove('user-idle');
      clearTimeout(idleTimer);
    });
    av.addEventListener('error', () => {
      stageCard.querySelector('.skeleton')?.remove();
      toast('This file could not be loaded.', { error: true });
    });

    playBtn.addEventListener('click', () => (av.paused ? av.play() : av.pause()));
    document.getElementById('back-btn').addEventListener('click', () => (av.currentTime = Math.max(0, av.currentTime - 5)));
    document.getElementById('fwd-btn').addEventListener('click', () => (av.currentTime = Math.min(duration, av.currentTime + 5)));
    
    // Loop toggle
    loopBtn.addEventListener('click', () => {
      av.loop = !av.loop;
      loopBtn.classList.toggle('active', av.loop);
      toast(av.loop ? 'Looping enabled' : 'Looping disabled');
    });

    // Fullscreen toggle
    fullscreenBtn.addEventListener('click', () => {
      const playerEl = stageCard.querySelector('.player') || stageCard;
      if (!document.fullscreenElement) {
        if (playerEl.requestFullscreen) playerEl.requestFullscreen();
        else if (playerEl.webkitRequestFullscreen) playerEl.webkitRequestFullscreen();
      } else {
        if (document.exitFullscreen) document.exitFullscreen();
      }
    });

    // Keyboard Spacebar Play / Pause Shortcut
    const handleSpacebar = e => {
      if (e.code === 'Space' || e.key === ' ') {
        const active = document.activeElement;
        const isInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
        if (isInput) return;
        e.preventDefault();
        if (av.paused) av.play().catch(() => {});
        else av.pause();
      }
    };
    window.addEventListener('keydown', handleSpacebar);

    volume.addEventListener('input', () => (av.volume = Number(volume.value)));

    scrubber.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight') av.currentTime = Math.min(duration, av.currentTime + 5);
      else if (e.key === 'ArrowLeft') av.currentTime = Math.max(0, av.currentTime - 5);
    });

    // Automatic Frame.io-style range creation: dragging scrubber track creates range
    let rangeDrag = null;

    function renderPending() {
      if (!pendingRange || Math.abs(pendingRange.endMs - pendingRange.startMs) <= 200) {
        pendingEl.innerHTML = '';
        return;
      }
      const left = pct(pendingRange.startMs);
      const width = Math.max(0.5, pct(pendingRange.endMs) - left);
      pendingEl.innerHTML = `
        <div class="scrubber-pending-range" style="left:${left}%; width:${width}%"></div>
        <div class="range-handle start" style="left:${left}%"></div>
        <div class="range-handle end" style="left:${left + width}%"></div>`;
      pendingEl.querySelector('.range-handle.start').addEventListener('pointerdown', e => {
        e.stopPropagation();
        rangeDrag = { kind: 'start' };
        pendingEl.setPointerCapture(e.pointerId);
      });
      pendingEl.querySelector('.range-handle.end').addEventListener('pointerdown', e => {
        e.stopPropagation();
        rangeDrag = { kind: 'end' };
        pendingEl.setPointerCapture(e.pointerId);
      });
      pendingEl.querySelector('.scrubber-pending-range').addEventListener('pointerdown', e => {
        e.stopPropagation();
        rangeDrag = { kind: 'move', grabMs: msAt(e.clientX) - pendingRange.startMs, span: pendingRange.endMs - pendingRange.startMs };
        pendingEl.setPointerCapture(e.pointerId);
      });
    }

    let clickHadRange = false;
    let didDragRange = false;

    scrubber.addEventListener('pointerdown', e => {
      scrubbing = true;
      didDragRange = false;
      clickHadRange = !!(pendingRange && Math.abs(pendingRange.endMs - pendingRange.startMs) > 200);
      pointerDownMs = msAt(e.clientX);
      scrubber.setPointerCapture(e.pointerId);
      av.currentTime = pointerDownMs / 1000;
      render();
    });

    window.addEventListener('pointermove', e => {
      if (!scrubbing && !rangeDrag) return;
      const ms = msAt(e.clientX);
      if (scrubbing && pointerDownMs != null) {
        if (Math.abs(ms - pointerDownMs) > 300) {
          // Dragged further than threshold => Automatically switch to Range selection!
          rangeDrag = { kind: 'create', anchorMs: pointerDownMs };
          didDragRange = true;
          scrubbing = false;
        } else {
          av.currentTime = ms / 1000;
          render();
        }
      }
      if (rangeDrag) {
        didDragRange = true;
        if (rangeDrag.kind === 'create') {
          pendingRange = { startMs: Math.min(rangeDrag.anchorMs, ms), endMs: Math.max(rangeDrag.anchorMs, ms) };
        } else if (rangeDrag.kind === 'start') {
          pendingRange.startMs = Math.max(0, Math.min(ms, pendingRange.endMs - SNAP_MS));
        } else if (rangeDrag.kind === 'end') {
          pendingRange.endMs = Math.min(duration * 1000, Math.max(ms, pendingRange.startMs + SNAP_MS));
        } else if (rangeDrag.kind === 'move') {
          const newStart = Math.max(0, Math.min(ms - rangeDrag.grabMs, duration * 1000 - rangeDrag.span));
          pendingRange = { startMs: newStart, endMs: newStart + rangeDrag.span };
        }
        av.currentTime = ms / 1000;
        renderPending();
        updateAnchorBadge();
      }
    });

    window.addEventListener('pointerup', () => {
      if (clickHadRange && !didDragRange) {
        // Clicking elsewhere on timeline clears active range selection automatically!
        clearRange();
      }
      scrubbing = false;
      pointerDownMs = null;
      rangeDrag = null;
      clickHadRange = false;
      didDragRange = false;
      updateAnchorBadge();
    });

    buildCommentPayload = body => {
      if (pendingRange && Math.abs(pendingRange.endMs - pendingRange.startMs) > 200) {
        return { mediaId: media.id, body, rangeStartMs: Math.round(pendingRange.startMs), rangeEndMs: Math.round(pendingRange.endMs) };
      }
      return { mediaId: media.id, body, timestampMs: Math.round(av.currentTime * 1000) };
    };

    resetComposer = () => {
      pendingRange = null;
      renderPending();
      updateAnchorBadge();
    };
  }

  // ------------------------------------------------------------------
  // Image: pan/zoom stage with marker placement + delete/renumber
  // ------------------------------------------------------------------

  function buildImageViewer(src) {
    stageCard.innerHTML = `
      <div class="image-stage" id="image-stage">
        <div class="image-frame" id="image-frame">
          <img id="review-image" src="${escapeHtml(src)}" alt="Review media" draggable="false" />
        </div>
        <div class="zoom-toolbar">
          <button type="button" id="zoom-out" aria-label="Zoom out">−</button>
          <span class="zoom-level" id="zoom-level">100%</span>
          <button type="button" id="zoom-in" aria-label="Zoom in">+</button>
          <button type="button" id="zoom-reset" aria-label="Reset zoom" title="Reset zoom">⤾</button>
        </div>
      </div>`;
    if (rangeControls) {
      rangeControls.wrap.hidden = true;
      rangeControls.modeRow.hidden = true;
    }

    const stage = document.getElementById('image-stage');
    const frame = document.getElementById('image-frame');
    const img = document.getElementById('review-image');
    const zoomLevel = document.getElementById('zoom-level');

    let zoom = 1;
    let panX = 0, panY = 0;

    // Size the frame to exactly match the image's rendered "contain" box
    // within the stage — zero letterboxing — so every marker positioned by
    // percentage inside it lines up with the actual pixel the reviewer
    // clicked, at any zoom level or window size.
    function sizeFrame() {
      if (!img.naturalWidth) return;
      const stageW = stage.clientWidth;
      const stageH = stage.clientHeight || 480;
      const imgRatio = img.naturalWidth / img.naturalHeight;
      const boxRatio = stageW / stageH;
      let w, h;
      if (imgRatio > boxRatio) {
        w = stageW;
        h = stageW / imgRatio;
      } else {
        h = stageH;
        w = stageH * imgRatio;
      }
      frame.style.width = `${w}px`;
      frame.style.height = `${h}px`;
      applyTransform();
    }

    function applyTransform() {
      frame.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
      stage.classList.toggle('zoomed', zoom > 1);
      zoomLevel.textContent = `${Math.round(zoom * 100)}%`;
    }

    function clampPan() {
      const maxOffset = ((zoom - 1) * frame.offsetWidth) / 2 + 40;
      panX = Math.max(-maxOffset, Math.min(maxOffset, panX));
      const maxOffsetY = ((zoom - 1) * frame.offsetHeight) / 2 + 40;
      panY = Math.max(-maxOffsetY, Math.min(maxOffsetY, panY));
    }

    function setZoom(next) {
      zoom = Math.min(4, Math.max(1, next));
      if (zoom === 1) { panX = 0; panY = 0; }
      clampPan();
      applyTransform();
    }

    img.addEventListener('load', sizeFrame);
    window.addEventListener('resize', sizeFrame);
    if (img.complete && img.naturalWidth) sizeFrame();
    img.addEventListener('error', () => {
      stage.innerHTML = `<div class="empty-state"><div class="empty-icon">🖼️</div>This image could not be loaded.</div>`;
    });

    document.getElementById('zoom-in').addEventListener('click', () => setZoom(zoom + 0.5));
    document.getElementById('zoom-out').addEventListener('click', () => setZoom(zoom - 0.5));
    document.getElementById('zoom-reset').addEventListener('click', () => setZoom(1));
    stage.addEventListener('wheel', e => { e.preventDefault(); setZoom(zoom + (e.deltaY < 0 ? 0.25 : -0.25)); }, { passive: false });

    let dragStart = null;
    let moved = false;
    frame.addEventListener('pointerdown', e => {
      dragStart = { x: e.clientX, y: e.clientY, panX, panY };
      moved = false;
      frame.setPointerCapture(e.pointerId);
    });
    frame.addEventListener('pointermove', e => {
      if (!dragStart) return;
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      if (zoom > 1 && moved) {
        panX = dragStart.panX + dx;
        panY = dragStart.panY + dy;
        clampPan();
        applyTransform();
        stage.classList.add('panning');
      }
    });
    frame.addEventListener('pointerup', e => {
      if (!moved) placeMarkerFromEvent(e);
      dragStart = null;
      stage.classList.remove('panning');
    });

    function placeMarkerFromEvent(e) {
      const r = frame.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      annotation = { x, y, type: 'pin' };
      renderPendingMarker();
      anchorBadge.textContent = 'Marker placed';
    }

    function renderPendingMarker() {
      frame.querySelectorAll('.marker-dot.pending').forEach(el => el.remove());
      if (!annotation) return;
      const dot = document.createElement('div');
      dot.className = 'marker-dot pending';
      dot.style.left = `${annotation.x * 100}%`;
      dot.style.top = `${annotation.y * 100}%`;
      dot.textContent = '+';
      frame.appendChild(dot);
    }

    function renderMarkers() {
      frame.querySelectorAll('.marker-dot:not(.pending)').forEach(el => el.remove());
      // Numbered by creation order, so deleting #2 correctly renumbers the
      // rest (#3 becomes #2) since this recomputes fresh every render.
      comments
        .filter(c => c.annotation)
        .forEach((c, i) => {
          const dot = document.createElement('div');
          dot.className = 'marker-dot' + (c.id === activeCommentId ? ' active' : '');
          dot.dataset.id = c.id;
          dot.style.left = `${c.annotation.x * 100}%`;
          dot.style.top = `${c.annotation.y * 100}%`;
          dot.textContent = i + 1;
          dot.title = (c.profiles?.display_name || c.guest_name || 'Reviewer') + ': ' + c.body.slice(0, 60);
          dot.addEventListener('click', ev => {
            ev.stopPropagation();
            setActiveComment(c.id);
          });
          frame.appendChild(dot);
        });
    }
    renderTimelineMarkers = renderMarkers;
    pulseMarker = id => frame.querySelector(`.marker-dot[data-id="${id}"]`)?.classList.add('active');
    buildCommentPayload = body => ({ mediaId: media.id, body, annotation });
    resetComposer = () => {
      annotation = null;
      frame.querySelectorAll('.marker-dot.pending').forEach(el => el.remove());
      anchorBadge.textContent = 'Click the image to add a marker';
    };

    anchorBadge.textContent = 'Click the image to add a marker';
  }

  // ------------------------------------------------------------------
  // Load + polling
  // ------------------------------------------------------------------

  async function load() {
    const data = await adapter.loadMedia();
    media = data.media;
    comments = data.comments;
    pollSignature = signatureOf(comments);
    document.title = `${media.name} — Relay`;
    const nameEl = document.getElementById('media-name');
    if (nameEl) nameEl.textContent = media.name;

    if (media.media_kind === 'video') buildAvPlayer(data.previewUrl, 'video');
    else if (media.media_kind === 'audio') buildAvPlayer(data.previewUrl, 'audio');
    else buildImageViewer(data.previewUrl);

    renderComments();
    startPolling();
    onMediaLoaded?.(media);
  }

  // Comments refresh via lightweight polling instead of a realtime
  // websocket subscription. Diffs by id+updated_at (not just count) so a
  // delete-plus-add landing in the same interval, or an edit to existing
  // text, is still caught — a plain length comparison would miss both.
  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      try {
        const data = await adapter.loadMedia();
        const nextSig = signatureOf(data.comments);
        if (nextSig !== pollSignature) {
          comments = data.comments;
          pollSignature = nextSig;
          renderComments();
        }
      } catch {}
    }, 4000);
  }
  window.addEventListener('beforeunload', () => clearInterval(pollTimer));

  composerForm.addEventListener('submit', async e => {
    e.preventDefault();
    const body = bodyInput.value.trim();
    if (!body || !buildCommentPayload) return;
    const payload = buildCommentPayload(body);
    const submitBtn = composerForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const comment = await adapter.createComment(payload);
      comments = [...comments, comment];
      pollSignature = signatureOf(comments);
      bodyInput.value = '';
      resetComposer();
      renderComments();
      setActiveComment(comment.id, { scroll: false });
    } catch (err) {
      toast(err.message, { error: true });
    } finally {
      submitBtn.disabled = false;
    }
  });

  return {
    start: () => load().catch(e => toast(e.message || "Couldn't load this file.", { error: true })),
  };
}
