/**
 * Computes { isMine, canDelete, canEdit } for a comment against the current
 * viewer (account holder or guest), then strips guest_token — a capability
 * secret that must never reach any client (see
 * supabase/migrations/0002_sharing_and_guests.sql for what it's for). This
 * is the only place allowed to read that field off a comment row.
 */
export function sanitizeComment(row, viewer) {
  const isMine = viewer.userId ? row.author_id === viewer.userId : Boolean(viewer.guestToken) && row.guest_token === viewer.guestToken;
  const canDelete = isMine || viewer.isWorkspaceOwner;
  const { guest_token, ...rest } = row;
  return { ...rest, isMine, canDelete, canEdit: isMine };
}

export function sanitizeComments(rows, viewer) {
  return rows.map(r => sanitizeComment(r, viewer));
}
