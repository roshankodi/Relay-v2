const SUPPORTED = {
  'video/mp4': 'video',
  'audio/mpeg': 'audio',
  'image/png': 'image',
  'image/jpeg': 'image',
};

export function driveTargetFromUrl(url) {
  if (typeof url !== 'string') throw new Error('URL must be a string');
  const fileMatch = url.match(/\/file\/d\/([\w-]+)/);
  if (fileMatch) return { type: 'file', id: fileMatch[1] };

  const folderMatch = url.match(/\/folders\/([\w-]+)/);
  if (folderMatch) return { type: 'folder', id: folderMatch[1] };

  const idMatch = url.match(/[?&]id=([\w-]+)/);
  if (idMatch) {
    if (url.includes('/file/') || url.includes('/uc')) return { type: 'file', id: idMatch[1] };
    return { type: 'folder', id: idMatch[1] };
  }

  throw new Error('The URL does not contain a valid Google Drive file or folder ID');
}

export function folderIdFromUrl(url) {
  return driveTargetFromUrl(url).id;
}

/**
 * Streams the real file bytes for a Drive file via the Drive v3 API
 * (`alt=media`), forwarding a Range header if present so video/audio
 * seeking works. This replaces the old `drive.google.com/uc?export=download`
 * link, which is unreliable for embedding: for anything above a small size
 * threshold, or unpredictably for images, Google serves an HTML "can't scan
 * this file for viruses" interstitial page instead of the raw bytes, which
 * is exactly what silently breaks <img>/<video> tags pointed at it directly.
 * Returns the raw fetch Response so the caller can pipe status/headers/body
 * straight through.
 */
export async function fetchDriveFile(fileId, rangeHeader) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_API_KEY is not configured');
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set('alt', 'media');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('supportsAllDrives', 'true');
  const headers = {};
  if (rangeHeader) headers.Range = rangeHeader;
  return fetch(url, { headers });
}

async function listChildren(folderId, pageToken) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_API_KEY is not configured');
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', `'${folderId}' in parents and trashed = false`);
  url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,modifiedTime,thumbnailLink,webContentLink,size)');
  url.searchParams.set('pageSize', '1000');
  url.searchParams.set('orderBy', 'folder,name');
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('includeItemsFromAllDrives', 'true');
  url.searchParams.set('key', apiKey);
  if (pageToken) url.searchParams.set('pageToken', pageToken);
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Drive API error (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** Recursively walks a public Drive folder and returns every supported media file. */
export async function scanPublicFolder(root) {
  const files = [];
  async function visit(folder, path = '', visited = new Set()) {
    if (visited.has(folder)) return;
    visited.add(folder);
    let pageToken;
    do {
      const data = await listChildren(folder, pageToken);
      pageToken = data.nextPageToken;
      for (const f of data.files ?? []) {
        if (!f.id || !f.name || !f.mimeType) continue;
        if (f.mimeType === 'application/vnd.google-apps.folder') {
          await visit(f.id, `${path}${f.name}/`, visited);
        } else if (SUPPORTED[f.mimeType]) {
          files.push({
            id: f.id,
            name: `${path}${f.name}`,
            mimeType: f.mimeType,
            modifiedTime: f.modifiedTime,
            thumbnailLink: f.thumbnailLink,
            webContentLink: f.webContentLink,
            size: f.size,
            kind: SUPPORTED[f.mimeType],
          });
        }
      }
    } while (pageToken);
  }
  await visit(root);
  return files;
}

export async function fetchSingleFile(fileId) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_API_KEY is not configured');
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set('fields', 'id,name,mimeType,modifiedTime,thumbnailLink,webContentLink,size');
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('key', apiKey);
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Drive API error (${res.status}): ${body.slice(0, 200)}`);
  }
  const f = await res.json();
  if (!f.id || !f.name || !f.mimeType) return [];
  if (!SUPPORTED[f.mimeType]) {
    throw new Error(`Unsupported file type (${f.mimeType}). Supported types: MP4, MP3, PNG, JPEG.`);
  }
  return [{
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    modifiedTime: f.modifiedTime,
    thumbnailLink: f.thumbnailLink,
    webContentLink: f.webContentLink,
    size: f.size,
    kind: SUPPORTED[f.mimeType],
  }];
}

export async function scanPublicDriveTarget(targetUrlOrId) {
  try {
    const target = driveTargetFromUrl(targetUrlOrId);
    if (target.type === 'file') return await fetchSingleFile(target.id);
    return await scanPublicFolder(target.id);
  } catch {
    // If targetUrlOrId was already an ID string rather than a URL
    return await scanPublicFolder(targetUrlOrId);
  }
}
