function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch (_err) {
    return value;
  }
}

function extractFileName(input) {
  const normalized = String(input || '').replace(/\\/g, '/');
  if (!normalized) return '';
  const noQuery = normalized.split('?')[0].split('#')[0];
  const parts = noQuery.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function normalizeStoredUploadPath(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const decoded = safeDecode(raw);
  const normalized = decoded.replace(/\\/g, '/');
  const lower = normalized.toLowerCase();

  if (lower.startsWith('generated:')) {
    return normalized;
  }

  const marker = '/uploads/';
  const markerIdx = lower.indexOf(marker);
  if (markerIdx !== -1) {
    const tail = normalized.slice(markerIdx + marker.length);
    const filename = extractFileName(tail);
    return filename ? `/uploads/${filename}` : null;
  }

  const relMarker = 'uploads/';
  const relIdx = lower.indexOf(relMarker);
  if (relIdx !== -1) {
    const tail = normalized.slice(relIdx + relMarker.length);
    const filename = extractFileName(tail);
    return filename ? `/uploads/${filename}` : null;
  }

  const filename = extractFileName(normalized);
  return filename ? `/uploads/${filename}` : null;
}

module.exports = {
  normalizeStoredUploadPath,
};
