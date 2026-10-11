const PDFDocument = require('pdfkit');

const GOLD = '#C9A24B';
const DARK = '#1A1512';
const MUTED = '#6B6259';

/**
 * Streams a premium golden-themed invoice PDF for a paid order directly to
 * an HTTP response (or any writable stream).
 */
function streamBillPdf(order, user, res) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);

  const hotelName = process.env.HOTEL_NAME || 'HOTEL LITTLE JAPPAN';
  const ownerName = process.env.OWNER_NAME || 'Ashok Kumar S';

  // ----- Header -----
  doc.rect(0, 0, doc.page.width, 90).fill(DARK);
  doc
    .fillColor(GOLD)
    .font('Helvetica-Bold')
    .fontSize(22)
    .text(hotelName, 50, 30);
  doc
    .fillColor('#F4EFE6')
    .font('Helvetica')
    .fontSize(11)
    .text(`Owner: ${ownerName}`, 50, 58);

  doc.fillColor(DARK);
  doc.moveDown(4);

  const line = () => {
    doc
      .moveTo(50, doc.y)
      .lineTo(doc.page.width - 50, doc.y)
      .strokeColor(GOLD)
      .lineWidth(1)
      .stroke();
    doc.moveDown(0.7);
  };

  const section = (title) => {
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(DARK).text(title);
    line();
    doc.font('Helvetica').fontSize(10.5).fillColor(DARK);
  };

  // ----- Customer details -----
  section('CUSTOMER DETAILS');
  const addr = order.deliveryAddress || {};
  doc.text(`Customer Name: ${user.username}`);
  doc.text(`Phone: ${user.phone}`);
  doc.text(`Address: ${addr.address || ''}`);
  doc.text(`Street: ${addr.street || ''}`);
  doc.text(`Village: ${addr.village || ''}`);
  doc.text(`Pincode: ${addr.pincode || ''}`);

  // ----- Order details -----
  section('ORDER DETAILS');
  doc.text(`Order ID: ${order._id}`);
  doc.text(`Order Date: ${new Date(order.createdAt).toLocaleString('en-IN')}`);
  doc.moveDown(0.3);

  const colX = { name: 50, qty: 300, rate: 370, total: 450 };
  doc.font('Helvetica-Bold');
  doc.text('Food Name', colX.name, doc.y, { continued: false });
  const headerY = doc.y - doc.currentLineHeight();
  doc.text('Qty', colX.qty, headerY);
  doc.text('Rate', colX.rate, headerY);
  doc.text('Total', colX.total, headerY);
  doc.font('Helvetica');
  doc.moveDown(0.3);

  order.items.forEach((item) => {
    const y = doc.y;
    doc.text(item.name, colX.name, y, { width: 240 });
    doc.text(String(item.quantity), colX.qty, y);
    doc.text(`Rs.${item.unitPrice}`, colX.rate, y);
    doc.text(`Rs.${item.lineTotal}`, colX.total, y);
    doc.moveDown(0.4);
  });

  // ----- Payment details -----
  section('PAYMENT DETAILS');
  const provider = order.payment?.provider;
  if (provider === 'cod') {
    doc.text(`Payment ID: -`);
    doc.text(`Payment Method: Cash on Delivery`);
    doc.text(`Payment Status: Pending`);
    doc.text(`Amount to Pay: Rs.${order.totalAmount}`);
  } else if (provider === 'upi') {
    const isPaid = order.payment?.status === 'paid';
    doc.text(`Payment ID: -`);
    doc.text(`Payment Method: UPI`);
    doc.text(`Payment Status: ${isPaid ? 'Paid' : 'Pending Verification'}`);
    if (isPaid && order.payment?.paidAt) {
      doc.text(`Payment Date: ${new Date(order.payment.paidAt).toLocaleString('en-IN')}`);
    }
    doc.text(isPaid ? `Total Paid: Rs.${order.totalAmount}` : `Total Amount: Rs.${order.totalAmount}`);
  } else {
    doc.text(`Payment ID: ${order.payment?.razorpayPaymentId || '-'}`);
    doc.text(`Payment Method: Online (Razorpay)`);
    doc.text(`Payment Status: ${order.payment?.status || '-'}`);
    doc.text(
      `Payment Date: ${order.payment?.paidAt ? new Date(order.payment.paidAt).toLocaleString('en-IN') : '-'}`
    );
    doc.text(`Total Paid: Rs.${order.totalAmount}`);
  }

  // ----- Delivery details -----
  section('DELIVERY DETAILS');
  doc.text(`Delivery Distance: ${order.distanceKm != null ? order.distanceKm + ' KM' : '-'}`);
  doc.text(`Delivery Eligibility: ${order.eligibilityZoneLabel || '-'}`);

  // ----- Total -----
  doc.moveDown(1);
  const totalBoxY = doc.y;
  doc.rect(50, totalBoxY, doc.page.width - 100, 40).fill(GOLD);
  doc
    .fillColor(DARK)
    .font('Helvetica-Bold')
    .fontSize(14)
    .text(`TOTAL AMOUNT: Rs.${order.totalAmount}`, 60, totalBoxY + 12);
  doc.y = totalBoxY + 50;

  doc.moveDown(3);
  doc
    .fillColor(MUTED)
    .font('Helvetica-Oblique')
    .fontSize(10)
    .text(`Thank you for ordering from ${hotelName}`, { align: 'center' });

  doc.end();
}

module.exports = { streamBillPdf };
