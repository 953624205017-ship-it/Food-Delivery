/**
 * Hotel Little Jappan - Firebase Phone Authentication Helper
 *
 * Correct reCAPTCHA lifecycle for invisible reCAPTCHA:
 *   - Create RecaptchaVerifier ONCE per container element.
 *   - On resend: call grecaptcha.reset(widgetId) — do NOT destroy and recreate.
 *   - Only destroy and recreate on a hard Firebase error (auth/captcha-check-failed,
 *     auth/operation-not-allowed, etc.) so the widget is fresh for the next attempt.
 *
 * "reCAPTCHA has already been rendered in this element" is caused by creating a
 * new RecaptchaVerifier on a container that already has a widget. The fix is to
 * reuse the existing verifier and reset its widget instead.
 */

(function (window) {
  'use strict';

  let firebaseApp = null;
  let auth = null;

  // Per-container state: { verifier, widgetId }
  // widgetId is the integer returned by verifier.render(), used for grecaptcha.reset()
  var rcState = {};

  // ─── Error messages ──────────────────────────────────────────────────────────

  function getFriendlyErrorMessage(err) {
    if (!err) return 'An unknown error occurred.';
    var code = err.code || '';

    // Always log the real code so the browser console shows the truth
    console.warn('[HotelFirebase] Error code:', code, '| message:', err.message || '');

    switch (code) {
      case 'auth/invalid-phone-number':
        return 'Please enter a valid 10-digit Indian mobile number.';
      case 'auth/missing-phone-number':
        return 'Phone number is required.';
      case 'auth/quota-exceeded':
        return 'SMS quota exceeded. Please try again later.';
      case 'auth/too-many-requests':
        return 'Too many OTP requests. Please wait a few minutes and try again.';
      case 'auth/captcha-check-failed':
        return 'reCAPTCHA check failed. Please reload the page and try again.';
      case 'auth/invalid-verification-code':
        return 'Incorrect OTP code. Please check and try again.';
      case 'auth/code-expired':
        return 'OTP has expired. Please request a new one.';
      case 'auth/network-request-failed':
        return 'Network error. Check your internet connection and try again.';
      case 'auth/app-not-authorized':
        return 'This domain is not in Firebase Authorized Domains. ' +
               'Go to Firebase Console \u2192 Authentication \u2192 Settings \u2192 Authorized domains and add localhost.';
      case 'auth/operation-not-allowed':
        return 'Phone sign-in is blocked by Firebase. Possible causes:\n' +
               '1. Phone provider is disabled \u2014 enable it in Firebase Console \u2192 Authentication \u2192 Sign-in method.\n' +
               '2. localhost is not in Authorized Domains \u2014 add it in Firebase Console \u2192 Authentication \u2192 Settings \u2192 Authorized domains.\n' +
               '3. Firebase project is on Spark plan and requires test numbers \u2014 add a test number in Firebase Console \u2192 Authentication \u2192 Sign-in method \u2192 Phone \u2192 Phone numbers for testing.\n' +
               '(Code: auth/operation-not-allowed)';
      case 'auth/billing-not-enabled':
        return 'Firebase Blaze (pay-as-you-go) plan is required to send SMS to real numbers. ' +
               'Upgrade at console.firebase.google.com, or add a test phone number in Firebase Console \u2192 Authentication \u2192 Sign-in method \u2192 Phone.';
      case 'auth/user-disabled':
        return 'This account has been disabled.';
      case 'auth/web-storage-unsupported':
        return 'Browser storage is blocked. Please allow cookies and try again.';
      case 'auth/missing-client-identifier':
        return 'reCAPTCHA verification missing. Make sure you are on an authorized domain and reload the page.';
      case 'auth/internal-error':
        return 'Firebase internal error. Open browser DevTools console for the full error. (Code: auth/internal-error)';
      default:
        // Show the raw message AND code so nothing is hidden
        return (err.message || 'Authentication error.') + ' (Code: ' + (code || 'unknown') + ')';
    }
  }

  // ─── Firebase initialization ─────────────────────────────────────────────────

  function initFirebase() {
    if (auth) return auth;

    var config = window.FIREBASE_CONFIG || {};
    if (!config.apiKey || !config.projectId) {
      console.warn('[HotelFirebase] FIREBASE_CONFIG is missing or incomplete:', config);
      return null;
    }

    if (!window.firebase) {
      console.error('[HotelFirebase] Firebase SDK not loaded. Check CDN <script> tags in the page.');
      return null;
    }

    try {
      if (!window.firebase.apps || !window.firebase.apps.length) {
        firebaseApp = window.firebase.initializeApp(config);
        console.log('[HotelFirebase] Firebase app initialized. Project:', config.projectId);
      } else {
        firebaseApp = window.firebase.app();
        console.log('[HotelFirebase] Reusing existing Firebase app. Project:', config.projectId);
      }

      auth = window.firebase.auth();
      auth.useDeviceLanguage();
      return auth;
    } catch (err) {
      console.error('[HotelFirebase] initializeApp failed:', err);
      return null;
    }
  }

  // ─── reCAPTCHA helpers ───────────────────────────────────────────────────────

  /**
   * Fully destroys the RecaptchaVerifier for a container and clears the DOM.
   * Only call this on hard errors — not between OTP resends.
   */
  function destroyVerifier(containerId) {
    var state = rcState[containerId];
    if (state) {
      try { state.verifier.clear(); } catch (_) {}
      delete rcState[containerId];
    }
    // Remove any leftover grecaptcha iframe/badge from the container
    var el = document.getElementById(containerId);
    if (el) el.innerHTML = '';
  }

  /**
   * Gets or creates the RecaptchaVerifier for `containerId`.
   * First call: creates and renders the widget (stores widgetId).
   * Subsequent calls: returns the existing verifier (caller resets widget separately).
   *
   * @returns {Promise<object>} The RecaptchaVerifier instance
   */
  async function getVerifier(containerId, size) {
    var authInstance = initFirebase();
    if (!authInstance) throw new Error('Firebase is not configured.');

    if (rcState[containerId]) {
      return rcState[containerId].verifier;
    }

    var el = document.getElementById(containerId);
    if (!el) throw new Error('reCAPTCHA container #' + containerId + ' not found in the page.');

    var verifier = new window.firebase.auth.RecaptchaVerifier(containerId, {
      size: size || 'invisible',
      callback: function () {
        // reCAPTCHA solved — signInWithPhoneNumber will proceed automatically
      },
      'expired-callback': function () {
        // Widget expired: reset it so the user can click again
        var state = rcState[containerId];
        if (state && state.widgetId !== null && window.grecaptcha) {
          try { window.grecaptcha.reset(state.widgetId); } catch (_) {}
        }
        if (typeof window.showToast === 'function') {
          window.showToast('reCAPTCHA expired. Please click Send OTP again.', 'error');
        }
      },
    });

    // Render the widget now so we have the widgetId for future resets
    var widgetId = null;
    try {
      widgetId = await verifier.render();
      console.log('[HotelFirebase] reCAPTCHA rendered. widgetId:', widgetId, 'container:', containerId);
    } catch (renderErr) {
      console.warn('[HotelFirebase] verifier.render() error (non-fatal):', renderErr.message);
    }

    rcState[containerId] = { verifier: verifier, widgetId: widgetId };
    return verifier;
  }

  /**
   * Resets the reCAPTCHA widget for a container between OTP sends.
   * This avoids the "reCAPTCHA has already been rendered" error.
   */
  function resetWidget(containerId) {
    var state = rcState[containerId];
    if (state && state.widgetId !== null && window.grecaptcha) {
      try {
        window.grecaptcha.reset(state.widgetId);
        console.log('[HotelFirebase] reCAPTCHA widget reset for container:', containerId);
      } catch (e) {
        console.warn('[HotelFirebase] grecaptcha.reset() failed:', e.message);
      }
    }
  }

  // ─── Phone number formatting ─────────────────────────────────────────────────

  function formatE164(raw) {
    var digits = String(raw || '').replace(/\D/g, '');
    var last10 = digits.slice(-10);
    return '+91' + last10;
  }

  function isValidIndianMobile(raw) {
    var digits = String(raw || '').replace(/\D/g, '');
    var last10 = digits.slice(-10);
    return last10.length === 10 && /^[6-9]/.test(last10);
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  /**
   * Sends a real SMS OTP via Firebase Phone Authentication.
   *
   * Lifecycle:
   *   First call  → creates RecaptchaVerifier, renders widget, calls signInWithPhoneNumber.
   *   Resend call → resets widget (no new verifier), calls signInWithPhoneNumber again.
   *   Error       → destroys verifier so next attempt starts completely fresh.
   *
   * @param {string} phoneNumber  10-digit Indian mobile number (or +91XXXXXXXXXX)
   * @param {string} containerId  ID of the reCAPTCHA container element
   * @returns {Promise<ConfirmationResult>}
   */
  async function sendPhoneOtp(phoneNumber, containerId) {
    containerId = containerId || 'recaptcha-container';

    var authInstance = initFirebase();
    if (!authInstance) {
      throw new Error('Firebase is not configured. Check that FIREBASE_* keys are set on the server.');
    }

    if (!isValidIndianMobile(phoneNumber)) {
      var err = new Error('Please enter a valid 10-digit Indian mobile number.');
      err.code = 'auth/invalid-phone-number';
      throw err;
    }

    var e164 = formatE164(phoneNumber);
    console.log('[HotelFirebase] Sending OTP to:', e164);

    // Reset the widget if one already exists (resend scenario)
    if (rcState[containerId]) {
      resetWidget(containerId);
    }

    var verifier;
    try {
      verifier = await getVerifier(containerId, 'invisible');
    } catch (verifierErr) {
      console.error('[HotelFirebase] Could not get reCAPTCHA verifier:', verifierErr.message);
      throw new Error(
        'Could not initialize reCAPTCHA. Make sure you are on an authorized domain ' +
        '(add localhost to Firebase Console \u2192 Authentication \u2192 Settings \u2192 Authorized domains).'
      );
    }

    try {
      var confirmationResult = await authInstance.signInWithPhoneNumber(e164, verifier);
      console.log('[HotelFirebase] OTP dispatched successfully to:', e164);
      return confirmationResult;
    } catch (err) {
      console.error('[HotelFirebase] signInWithPhoneNumber failed. Code:', err.code, '| Message:', err.message);

      // Hard error: destroy verifier so next attempt creates a completely fresh widget
      destroyVerifier(containerId);

      var friendlyErr = new Error(getFriendlyErrorMessage(err));
      friendlyErr.original = err;
      friendlyErr.code = err.code;
      throw friendlyErr;
    }
  }

  /**
   * Confirms the OTP the user entered and returns a Firebase ID token.
   *
   * @param {ConfirmationResult} confirmationResult  From sendPhoneOtp()
   * @param {string} code  The 6-digit OTP entered by the user
   * @returns {Promise<string>} Firebase ID token for backend verification
   */
  async function confirmPhoneOtp(confirmationResult, code) {
    if (!confirmationResult || typeof confirmationResult.confirm !== 'function') {
      throw new Error('No active OTP session. Please request a new OTP.');
    }

    var trimmedCode = String(code || '').trim();
    if (!trimmedCode || trimmedCode.length < 6) {
      throw new Error('Please enter the full 6-digit OTP code.');
    }

    try {
      var userCredential = await confirmationResult.confirm(trimmedCode);
      var idToken = await userCredential.user.getIdToken(true);
      console.log('[HotelFirebase] OTP confirmed. Firebase ID token obtained.');
      return idToken;
    } catch (err) {
      console.error('[HotelFirebase] OTP confirmation failed. Code:', err.code, '| Message:', err.message);
      var friendlyErr = new Error(getFriendlyErrorMessage(err));
      friendlyErr.original = err;
      friendlyErr.code = err.code;
      throw friendlyErr;
    }
  }

  // Expose public API
  window.HotelFirebase = {
    init: initFirebase,
    sendPhoneOtp: sendPhoneOtp,
    confirmPhoneOtp: confirmPhoneOtp,
    formatE164: formatE164,
    destroyVerifier: destroyVerifier,
    getErrorMessage: getFriendlyErrorMessage,
  };

}(window));
