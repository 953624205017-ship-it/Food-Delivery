/**
 * Firebase Client / Web Configuration
 *
 * This configuration is sent to the browser to initialize the Firebase Web SDK
 * for Phone Authentication (reCAPTCHA and signInWithPhoneNumber).
 *
 * NOTE: Firebase Web API keys are client identifiers, NOT backend secret keys.
 * Secret service account keys should only be used server-side in config/firebaseAdmin.js.
 */

const firebaseWebConfig = {
  apiKey: process.env.FIREBASE_API_KEY || '',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.FIREBASE_APP_ID || '',
};

function isFirebaseWebConfigured() {
  return Boolean(firebaseWebConfig.apiKey && firebaseWebConfig.projectId);
}

module.exports = {
  firebaseWebConfig,
  isFirebaseWebConfigured,
};

