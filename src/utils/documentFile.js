const fs = require('fs');
const path = require('path');
const { UPLOADS_DIR } = require('../config/uploadPaths');

function getUploadFileName(storedPath) {
  const normalized = String(storedPath || '').replace(/\\/g, '/').trim();
  if (!normalized || normalized.startsWith('generated:')) return null;

  const noQuery = normalized.split('?')[0].split('#')[0];
  const parts = noQuery.split('/').filter(Boolean);
  const fileName = parts[parts.length - 1];
  if (!fileName || fileName.includes('..')) return null;
  return fileName;
}

function getUploadFilePath(storedPath) {
  const fileName = getUploadFileName(storedPath);
  if (!fileName) return null;

  const resolved = path.resolve(UPLOADS_DIR, fileName);
  const uploadsRoot = path.resolve(UPLOADS_DIR);
  if (resolved !== uploadsRoot && resolved.startsWith(`${uploadsRoot}${path.sep}`)) {
    return resolved;
  }
  return null;
}

function getExistingUploadFilePath(storedPath) {
  const filePath = getUploadFilePath(storedPath);
  if (!filePath || !fs.existsSync(filePath)) return null;
  return filePath;
}

function deleteUploadFileIfExists(storedPath) {
  const filePath = getUploadFilePath(storedPath);
  if (!filePath || !fs.existsSync(filePath)) return;

  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    console.error('Failed to delete replaced upload file:', err);
  }
}

function downloadStoredPdf({ res, storedPath, fileName }) {
  const filePath = getExistingUploadFilePath(storedPath);
  if (!filePath) {
    return res.status(404).json({ message: 'Uploaded PDF file not found' });
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Cache-Control', 'private, no-store');

  return res.download(filePath, fileName, (err) => {
    if (!err) return;
    console.error('PDF download error:', err);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Failed to download uploaded PDF' });
    }
  });
}

module.exports = {
  deleteUploadFileIfExists,
  downloadStoredPdf,
  getExistingUploadFilePath,
  getUploadFileName,
  getUploadFilePath,
};
