const admin = require('firebase-admin');
const fs = require('fs');

function parseServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    return JSON.parse(
      Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
    );
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }

  const credentialsPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credentialsPath && fs.existsSync(credentialsPath)) {
    return require(credentialsPath);
  }

  return null;
}

let firebaseApp = null;

function getFirebaseAdmin() {
  if (firebaseApp) return admin;
  if (admin.apps.length) {
    firebaseApp = admin.app();
    return admin;
  }

  const serviceAccount = parseServiceAccount();
  if (!serviceAccount) {
    console.warn(
      '[firebase] Admin SDK credentials missing. Set FIREBASE_SERVICE_ACCOUNT_BASE64, FIREBASE_SERVICE_ACCOUNT_JSON, FIREBASE_SERVICE_ACCOUNT_PATH, or GOOGLE_APPLICATION_CREDENTIALS.'
    );
    return null;
  }

  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id || process.env.FIREBASE_PROJECT_ID,
  });

  console.log('[firebase] Admin SDK initialized');
  return admin;
}

module.exports = { getFirebaseAdmin };
