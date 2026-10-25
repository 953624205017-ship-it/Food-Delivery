const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');
const path = require('path');
const fs = require('fs');

let adminApp = null;

/**
 * Initializes and returns the Firebase Admin SDK singleton instance.
 * Reads credentials securely from environment variables.
 *
 * Supported credential strategies (in order of priority):
 * 1. FIREBASE_SERVICE_ACCOUNT_PATH: path to service-account-key.json
 * 2. FIREBASE_SERVICE_ACCOUNT_JSON: inline JSON string of service account key
 * 3. FIREBASE_CLIENT_EMAIL & FIREBASE_PRIVATE_KEY: individual environment variables
 * 4. Application Default Credentials (e.g. GOOGLE_APPLICATION_CREDENTIALS)
 */
function getFirebaseAdmin() {
  if (adminApp) return adminApp;

  const existingApps = typeof admin.getApps === 'function' ? admin.getApps() : (admin.apps || []);
  if (existingApps.length > 0) {
    adminApp = existingApps[0];
    return adminApp;
  }

  // Read projectId early — needed across all strategies
  const projectId = process.env.FIREBASE_PROJECT_ID;

  // Strategy 1: Path to service account file
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (serviceAccountPath) {
    try {
      const resolvedPath = path.isAbsolute(serviceAccountPath)
        ? serviceAccountPath
        : path.resolve(process.cwd(), serviceAccountPath);

      if (fs.existsSync(resolvedPath)) {
        const fileContent = fs.readFileSync(resolvedPath, 'utf8');
        const serviceAccount = JSON.parse(fileContent);
        adminApp = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId: serviceAccount.project_id || projectId,
        });
        console.log('[firebase-admin] Initialized via service account file:', path.basename(resolvedPath));
        return adminApp;
      } else {
        console.warn(
          '[firebase-admin] FIREBASE_SERVICE_ACCOUNT_PATH is set but the file was not found at:',
          resolvedPath,
          '\n  -> Download the service account JSON from Firebase Console -> Project Settings -> Service accounts -> Generate new private key',
          '\n  -> Place it at that path, or use FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY in .env instead.'
        );
      }
    } catch (err) {
      console.warn('[firebase-admin] Error loading FIREBASE_SERVICE_ACCOUNT_PATH:', err.message);
    }
  }

  // Strategy 2: Inline JSON string
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson) {
    try {
      const serviceAccount = JSON.parse(serviceAccountJson);
      adminApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id || projectId,
      });
      console.log('[firebase-admin] Initialized via FIREBASE_SERVICE_ACCOUNT_JSON');
      return adminApp;
    } catch (err) {
      console.warn('[firebase-admin] Error parsing FIREBASE_SERVICE_ACCOUNT_JSON:', err.message);
    }
  }

  // Strategy 3: Individual environment variables
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (clientEmail && privateKey) {
    try {
      // Handle escaped newlines in PEM string
      if (privateKey.includes('\\n')) {
        privateKey = privateKey.replace(/\\n/g, '\n');
      }

      adminApp = admin.initializeApp({
        credential: admin.credential.cert({
          projectId: projectId || undefined,
          clientEmail,
          privateKey,
        }),
        projectId: projectId || undefined,
      });
      console.log('[firebase-admin] Initialized via individual environment variables (FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY)');
      return adminApp;
    } catch (err) {
      console.warn('[firebase-admin] Error initializing with individual credentials:', err.message);
    }
  }

  // Strategy 4: Application Default Credentials (e.g. GOOGLE_APPLICATION_CREDENTIALS)
  try {
    adminApp = admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: projectId || undefined,
    });
    console.log('[firebase-admin] Initialized via Application Default Credentials');
    return adminApp;
  } catch (err) {
    // Strategy 5: Project-only fallback (no real credential — token verification will fail,
    // but the app object is created so other Admin SDK features may still work)
    if (projectId) {
      try {
        adminApp = admin.initializeApp({ projectId });
        console.warn(
          '[firebase-admin] WARNING: Initialized with projectId only — NO valid service account credential found.',
          '\n  Firebase ID token verification will throw FIREBASE_NOT_CONFIGURED until you add credentials.',
          '\n  Fix: Set FIREBASE_SERVICE_ACCOUNT_PATH, FIREBASE_SERVICE_ACCOUNT_JSON,',
          'or FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY in .env'
        );
        return adminApp;
      } catch (fallbackErr) {
        console.warn('[firebase-admin] Could not initialize even with projectId fallback:', fallbackErr.message);
      }
    }

    console.warn(
      '[firebase-admin] Firebase Admin SDK is NOT initialized.',
      '\n  Firebase ID token verification will fail until credentials are provided in .env.',
      '\n  Fix: Download serviceAccountKey.json from Firebase Console -> Project Settings -> Service accounts',
      '\n  and set FIREBASE_SERVICE_ACCOUNT_PATH=./config/service-account-key.json in .env'
    );
    return null;
  }
}

/**
 * Verifies a Firebase ID token sent from the client.
 * Returns the decoded token containing user phone_number and uid.
 *
 * @param {string} idToken - The Firebase JWT ID token from the frontend
 * @returns {Promise<import('firebase-admin/auth').DecodedIdToken>} Decoded token
 */
async function verifyFirebaseIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    const err = new Error('Firebase ID token is required.');
    err.code = 'MISSING_TOKEN';
    throw err;
  }

  const app = getFirebaseAdmin();
  if (!app) {
    const err = new Error(
      'Firebase Admin SDK is not initialized. Backend cannot verify phone OTP tokens. ' +
      'Please add your Firebase service account credentials to .env (FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY).'
    );
    err.code = 'FIREBASE_NOT_CONFIGURED';
    throw err;
  }

  try {
    const auth = getAuth(app);
    const decodedToken = await auth.verifyIdToken(idToken);
    return decodedToken;
  } catch (err) {
    let message = 'Invalid or expired Firebase authentication token.';
    if (err.code === 'auth/id-token-expired') {
      message = 'Your login session has expired. Please verify your phone again.';
    } else if (err.code === 'auth/id-token-revoked') {
      message = 'Token has been revoked. Please sign in again.';
    } else if (err.code === 'auth/argument-error') {
      message = 'Malformed authentication token.';
    } else if (err.code === 'auth/project-not-found' || err.message?.includes('no project ID')) {
      message = 'Server Firebase project configuration is missing. Contact support.';
    }

    console.error('[firebase-admin] verifyIdToken failed:', err.code, err.message);
    const error = new Error(message);
    error.code = err.code || 'INVALID_TOKEN';
    error.originalMessage = err.message;
    throw error;
  }
}

module.exports = {
  getFirebaseAdmin,
  verifyFirebaseIdToken,
};
