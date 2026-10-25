/**
 * Hotel Little Jappan - Email Delivery Diagnostic & Test Tool
 *
 * Usage:
 *   node scripts/testEmailDelivery.js [recipient@example.com]
 *
 * Tests:
 * 1. Verifies that EMAIL_USER and EMAIL_APP_PASSWORD are set in .env
 * 2. Connects to Gmail SMTP and verifies credentials (auth check)
 * 3. Sends a real test email with a sample OTP to the recipient address
 * 4. Prints clear diagnostic troubleshooting if anything fails
 */

require('dotenv').config();
const { isEmailConfigured, verifySmtpConnection, sendOtpEmail } = require('../utils/emailService');

async function main() {
  console.log('====================================================');
  console.log('HOTEL LITTLE JAPPAN - GMAIL SMTP DELIVERY DIAGNOSTIC');
  console.log('====================================================\n');

  // Step 1: Check environment variables
  console.log('[Step 1] Checking environment variables:');
  const emailUser = (process.env.EMAIL_USER || '').trim();
  const emailPass = (process.env.EMAIL_APP_PASSWORD || '').replace(/\s+/g, '');

  if (!emailUser) {
    console.error('❌ EMAIL_USER is missing or empty in .env');
    console.log('   Add: EMAIL_USER=your_gmail_address@gmail.com');
    process.exit(1);
  }
  console.log(`✓ EMAIL_USER: ${emailUser}`);

  if (!emailPass) {
    console.error('❌ EMAIL_APP_PASSWORD is missing or empty in .env');
    console.log('   Add: EMAIL_APP_PASSWORD=your_16_character_app_password');
    process.exit(1);
  }
  console.log(`✓ EMAIL_APP_PASSWORD: [Configured - ${emailPass.length} characters]`);

  // Step 2: Verify SMTP connection with Gmail
  console.log('\n[Step 2] Connecting to Gmail SMTP server (smtp.gmail.com:465/587)...');
  try {
    const smtpCheck = await verifySmtpConnection();
    console.log(`✓ SMTP Connection OK: ${smtpCheck.message}`);
  } catch (err) {
    console.error(`❌ SMTP Authentication failed: ${err.message}`);
    console.log('\n--- TROUBLESHOOTING GMAIL SMTP ---');
    console.log('1. Make sure "2-Step Verification" is turned ON in your Google Account:');
    console.log('   https://myaccount.google.com/security');
    console.log('2. Generate a dedicated 16-character App Password (NOT your normal password):');
    console.log('   https://myaccount.google.com/apppasswords');
    console.log('3. Set EMAIL_APP_PASSWORD in .env without quotes or special symbols.');
    process.exit(1);
  }

  // Step 3: Send test email
  const recipient = (process.argv[2] || emailUser).trim();
  console.log(`\n[Step 3] Sending test verification email to: ${recipient}...`);

  try {
    const testOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const result = await sendOtpEmail({
      to: recipient,
      otp: testOtp,
      username: 'Test User',
      hotelName: process.env.HOTEL_NAME || 'HOTEL LITTLE JAPPAN',
    });

    console.log('✓ Email sent successfully!');
    console.log(`  Message ID: ${result.messageId}`);
    console.log(`  Accepted by: ${result.accepted.join(', ')}`);
    console.log('\n🎉 SUCCESS! Please check your inbox (and spam folder) at:', recipient);
    console.log('====================================================\n');
  } catch (err) {
    console.error(`❌ Failed to send email: ${err.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});

