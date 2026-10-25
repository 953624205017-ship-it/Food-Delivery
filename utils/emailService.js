const nodemailer = require('nodemailer');

const EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES || 5);

/**
 * Validates whether email configuration is present in environment.
 * @returns {boolean}
 */
function isEmailConfigured() {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_APP_PASSWORD;
  return Boolean(user && pass && user.trim() && pass.trim());
}

/**
 * Creates and returns a configured Nodemailer transporter using Gmail SMTP.
 * Strips any spaces from Gmail App Password if pasted with spaces (e.g. "abcd efgh ijkl mnop").
 */
function createTransporter() {
  const user = (process.env.EMAIL_USER || '').trim();
  const pass = (process.env.EMAIL_APP_PASSWORD || '').replace(/\s+/g, '');

  if (!user || !pass) {
    const err = new Error(
      'Email service is not configured. Please set EMAIL_USER and EMAIL_APP_PASSWORD in your .env file.'
    );
    err.code = 'EMAIL_NOT_CONFIGURED';
    throw err;
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: user,
      pass: pass,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

/**
 * Tests connection to the Gmail SMTP server.
 * @returns {Promise<{ success: boolean, message?: string }>}
 */
async function verifySmtpConnection() {
  const transporter = createTransporter();
  try {
    await transporter.verify();
    return { success: true, message: 'SMTP connection established successfully.' };
  } catch (err) {
    let friendlyMessage = err.message || 'SMTP verification failed.';
    if (err.code === 'EAUTH' || err.responseCode === 535) {
      friendlyMessage =
        'Gmail authentication failed. Please make sure Google 2-Step Verification is enabled and use a 16-character Gmail App Password (not your normal Google account password).';
    }
    const error = new Error(friendlyMessage);
    error.code = err.code || 'SMTP_ERROR';
    error.original = err;
    throw error;
  }
}

/**
 * Sends a styled HTML email with the 6-digit OTP code to the recipient.
 */
async function sendOtpEmail({ to, otp, username = '', hotelName = 'HOTEL LITTLE JAPPAN' }) {
  if (!to || typeof to !== 'string' || !/^\S+@\S+\.\S+$/.test(to.trim())) {
    const err = new Error('A valid recipient email address is required.');
    err.code = 'INVALID_RECIPIENT';
    throw err;
  }

  if (!otp || String(otp).length !== 6) {
    const err = new Error('Invalid OTP code.');
    err.code = 'INVALID_OTP';
    throw err;
  }

  const transporter = createTransporter();
  const senderEmail = (process.env.EMAIL_USER || '').trim();

  const subject = `${otp} is your verification code for ${hotelName}`;

  const textContent = `
HOTEL LITTLE JAPPAN - Email Verification

Hello${username ? ' ' + username : ''},

Your verification code is: ${otp}

This code will expire in ${EXPIRY_MINUTES} minutes.
Please enter this code on the registration page to verify your email address.

Security notice: Never share this code with anyone.

If you did not attempt to register at Hotel Little Jappan, please ignore this email.
`.trim();

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Verification Code - ${hotelName}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0d0f12; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #f5f6f8;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #0d0f12; padding: 30px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" max-width="520" cellspacing="0" cellpadding="0" border="0" style="max-width: 520px; background-color: #171a21; border: 1px solid #2a2f3d; border-radius: 12px; overflow: hidden;">
          <tr>
            <td style="padding: 28px 30px 20px 30px; text-align: center; border-bottom: 1px solid #222736;">
              <div style="font-size: 11px; letter-spacing: 2.5px; color: #d4af37; font-weight: 700; text-transform: uppercase;">${hotelName}</div>
              <h1 style="margin: 8px 0 0 0; font-size: 20px; color: #ffffff; font-weight: 600;">Email Verification</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 30px 30px 20px 30px;">
              <p style="margin: 0 0 16px 0; font-size: 15px; color: #c3c8d4;">
                Hello${username ? ' <strong style="color: #ffffff;">' + escapeHtml(username) + '</strong>' : ''},
              </p>
              <p style="margin: 0 0 24px 0; font-size: 14px; color: #9aa1b2;">
                Use the verification code below to activate your account:
              </p>
              <div style="text-align: center; margin: 24px 0;">
                <div style="display: inline-block; background: #0d0f12; border: 2px solid #d4af37; border-radius: 10px; padding: 16px 36px;">
                  <span style="font-family: monospace; font-size: 34px; font-weight: 700; letter-spacing: 10px; color: #d4af37;">
                    ${otp}
                  </span>
                </div>
              </div>
              <p style="text-align: center; margin: 0 0 24px 0; font-size: 13px; color: #e5a93c;">
                ⏱️ This code expires in <strong>${EXPIRY_MINUTES} minutes</strong>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 30px; text-align: center; border-top: 1px solid #222736; background-color: #12141a;">
              <p style="margin: 0; font-size: 11px; color: #6e7687;">&copy; ${new Date().getFullYear()} ${hotelName}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();

  const info = await transporter.sendMail({
    from: `"${hotelName}" <${senderEmail}>`,
    to: to.trim().toLowerCase(),
    subject: subject,
    text: textContent,
    html: htmlContent,
  });

  return { success: true, messageId: info.messageId, accepted: info.accepted };
}

/**
 * Sends an email notification for order events (placed, paid, status updated, cancelled).
 * Non-blocking: logs safely on error without interrupting order processing.
 *
 * @param {object} params
 * @param {object} params.order - The Order document
 * @param {object} params.user - The User document (with email)
 * @param {string} params.type - 'ORDER_PLACED' | 'PAYMENT_CONFIRMED' | 'STATUS_UPDATED' | 'ORDER_CANCELLED'
 * @param {string} [params.customMessage] - Optional extra note
 * @returns {Promise<{ success: boolean, skipped?: boolean, error?: string }>}
 */
async function sendOrderNotificationEmail({ order, user, type = 'ORDER_PLACED', customMessage = '' }) {
  if (!isEmailConfigured()) {
    console.log(`[email] SMTP not configured; skipping order notification email for Order #${order?._id}`);
    return { success: false, skipped: true, reason: 'SMTP_NOT_CONFIGURED' };
  }

  const recipientEmail = (user?.email || '').trim().toLowerCase();
  if (!recipientEmail || !/^\S+@\S+\.\S+$/.test(recipientEmail)) {
    console.log(`[email] User #${user?._id || order?.user} has no valid email address; skipping notification.`);
    return { success: false, skipped: true, reason: 'NO_RECIPIENT_EMAIL' };
  }

  const hotelName = process.env.HOTEL_NAME || 'HOTEL LITTLE JAPPAN';
  const shortId = String(order._id).slice(-6).toUpperCase();

  let subjectTitle = 'Order Notification';
  let badgeColor = '#d4af37';
  let statusText = order.status;

  switch (type) {
    case 'ORDER_PLACED':
      subjectTitle = `Order Placed Successfully (#${shortId})`;
      badgeColor = '#2563eb';
      break;
    case 'PAYMENT_CONFIRMED':
      subjectTitle = `Payment Confirmed for Order #${shortId}`;
      badgeColor = '#16a34a';
      break;
    case 'STATUS_UPDATED':
      subjectTitle = `Order Status: ${order.status} (#${shortId})`;
      badgeColor = '#d97706';
      break;
    case 'ORDER_CANCELLED':
      subjectTitle = `Order #${shortId} has been Cancelled`;
      badgeColor = '#dc2626';
      break;
    default:
      subjectTitle = `Update on Order #${shortId}`;
  }

  // Build items rows
  const itemsRows = (order.items || [])
    .map(
      (item) => `
    <tr>
      <td style="padding: 10px; border-bottom: 1px solid #2a2f3d; color: #f5f6f8;">
        <strong>${escapeHtml(item.name)}</strong>
      </td>
      <td style="padding: 10px; border-bottom: 1px solid #2a2f3d; text-align: center; color: #c3c8d4;">
        ${item.quantity}
      </td>
      <td style="padding: 10px; border-bottom: 1px solid #2a2f3d; text-align: right; color: #c3c8d4;">
        ₹${Number(item.unitPrice).toFixed(2)}
      </td>
      <td style="padding: 10px; border-bottom: 1px solid #2a2f3d; text-align: right; color: #d4af37; font-weight: 600;">
        ₹${Number(item.lineTotal).toFixed(2)}
      </td>
    </tr>`
    )
    .join('');

  const deliveryCharge = Math.max(0, (order.totalAmount || 0) - (order.subtotal || 0));
  const addressStr = order.deliveryAddress?.formattedAddress ||
    [order.deliveryAddress?.address, order.deliveryAddress?.village, order.deliveryAddress?.pincode]
      .filter(Boolean)
      .join(', ') || 'Saved Delivery Address';

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(subjectTitle)} - ${hotelName}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0d0f12; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #f5f6f8;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #0d0f12; padding: 30px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 580px; background-color: #171a21; border: 1px solid #2a2f3d; border-radius: 12px; overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="padding: 24px 30px; text-align: center; border-bottom: 1px solid #222736;">
              <div style="font-size: 11px; letter-spacing: 2.5px; color: #d4af37; font-weight: 700; text-transform: uppercase;">${hotelName}</div>
              <h1 style="margin: 6px 0 0 0; font-size: 20px; color: #ffffff;">${escapeHtml(subjectTitle)}</h1>
            </td>
          </tr>

          <!-- Status Banner -->
          <tr>
            <td style="padding: 20px 30px 10px 30px;">
              <div style="background-color: #12141a; border-radius: 8px; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; border: 1px solid #262c3d;">
                <div>
                  <div style="font-size: 12px; color: #8e95a5;">Order Number</div>
                  <div style="font-size: 18px; font-weight: 700; color: #d4af37; letter-spacing: 1px;">#${shortId}</div>
                </div>
                <div style="text-align: right;">
                  <div style="font-size: 12px; color: #8e95a5;">Current Status</div>
                  <span style="display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 700; background: ${badgeColor}22; color: ${badgeColor}; border: 1px solid ${badgeColor};">
                    ${escapeHtml(statusText)}
                  </span>
                </div>
              </div>
              ${customMessage ? `<p style="margin: 14px 0 0 0; font-size: 14px; color: #e5a93c;">${escapeHtml(customMessage)}</p>` : ''}
            </td>
          </tr>

          <!-- Items Table -->
          <tr>
            <td style="padding: 10px 30px;">
              <h3 style="font-size: 14px; color: #8e95a5; text-transform: uppercase; letter-spacing: 1px; margin: 16px 0 8px 0;">Order Summary</h3>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse: collapse; font-size: 14px;">
                <thead>
                  <tr style="background-color: #1f2430; color: #9aa1b2; font-size: 12px; text-transform: uppercase;">
                    <th style="padding: 8px 10px; text-align: left;">Item</th>
                    <th style="padding: 8px 10px; text-align: center;">Qty</th>
                    <th style="padding: 8px 10px; text-align: right;">Price</th>
                    <th style="padding: 8px 10px; text-align: right;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsRows}
                </tbody>
              </table>

              <!-- Totals -->
              <div style="margin-top: 14px; padding-top: 10px; border-top: 1px solid #2a2f3d;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size: 14px; color: #c3c8d4;">
                  <tr>
                    <td style="padding: 4px 0;">Subtotal:</td>
                    <td style="padding: 4px 0; text-align: right;">₹${Number(order.subtotal || 0).toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0;">Delivery Fee (${escapeHtml(order.eligibilityZoneLabel || 'Standard')}):</td>
                    <td style="padding: 4px 0; text-align: right;">₹${Number(deliveryCharge).toFixed(2)}</td>
                  </tr>
                  <tr style="font-size: 16px; font-weight: 700; color: #ffffff;">
                    <td style="padding: 8px 0 0 0; border-top: 1px solid #2a2f3d;">Total Amount:</td>
                    <td style="padding: 8px 0 0 0; border-top: 1px solid #2a2f3d; text-align: right; color: #d4af37;">
                      ₹${Number(order.totalAmount || 0).toFixed(2)}
                    </td>
                  </tr>
                </table>
              </div>
            </td>
          </tr>

          <!-- Delivery Address & Payment Info -->
          <tr>
            <td style="padding: 10px 30px 24px 30px;">
              <div style="background-color: #12141a; border-radius: 8px; padding: 14px 18px; margin-top: 14px; font-size: 13px;">
                <div style="color: #8e95a5; margin-bottom: 4px; font-weight: 600;">Delivery Address:</div>
                <div style="color: #f5f6f8; line-height: 1.4;">${escapeHtml(addressStr)}</div>
                <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #222736; color: #8e95a5;">
                  Payment: <strong style="color: #ffffff; text-transform: uppercase;">${escapeHtml(order.payment?.provider || 'Pending')}</strong>
                  (${escapeHtml(order.payment?.status || 'Pending')})
                </div>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 18px 30px; text-align: center; border-top: 1px solid #222736; background-color: #12141a; font-size: 11px; color: #6e7687;">
              Thank you for choosing ${hotelName}! For any queries, call us at ${process.env.OWNER_PHONE || 'our support line'}.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();

  try {
    const transporter = createTransporter();
    const senderEmail = (process.env.EMAIL_USER || '').trim();

    const info = await transporter.sendMail({
      from: `"${hotelName}" <${senderEmail}>`,
      to: recipientEmail,
      subject: `${subjectTitle} · ${hotelName}`,
      html: htmlContent,
    });

    console.log(`[email] Order notification (${type}) sent to ${recipientEmail} for Order #${shortId}. MsgId: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[email] Failed to send order notification (${type}) for Order #${shortId}:`, err.message);
    return { success: false, error: err.message };
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  isEmailConfigured,
  createTransporter,
  verifySmtpConnection,
  sendOtpEmail,
  sendOrderNotificationEmail,
  EXPIRY_MINUTES,
};
