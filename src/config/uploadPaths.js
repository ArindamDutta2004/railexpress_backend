const path = require('path');
const fs = require('fs');

/**
 * Single source of truth for uploaded files (PDFs, refund QR images).
 * Must match: express.static root + multer destination.
 * Set UPLOAD_ROOT on cloud hosts if you attach a persistent disk (e.g. Render disk).
 */
const RENDER_DISK_ROOT = '/var/data';
const FALLBACK_LOCAL_UPLOADS = path.resolve(__dirname, '..', '..', 'uploads');

const UPLOADS_DIR = process.env.UPLOAD_ROOT
  ? path.resolve(process.env.UPLOAD_ROOT)
  : (process.env.RENDER && fs.existsSync(RENDER_DISK_ROOT))
      ? path.join(RENDER_DISK_ROOT, 'uploads')
      : FALLBACK_LOCAL_UPLOADS;

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  return UPLOADS_DIR;
}

module.exports = {
  UPLOADS_DIR,
  ensureUploadsDir,
};
