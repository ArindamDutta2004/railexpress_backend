const QRCode = require('qrcode');

function getEnv(name, fallback) {
  return process.env[name] || fallback;
}

async function generateUpiQrDataUri({ bookingId, amount, title }) {
  const upiId = getEnv('UPI_ID', 'sumankhan2909@oksbi');
  const upiName = getEnv('UPI_NAME', 'Railway Ticket Booking');

  // Using UPI payment URI allows QR apps to open the correct pay screen.
  // Reference includes bookingId for traceability.
  const tn = encodeURIComponent(title || 'Railway Payment');
  const tr = encodeURIComponent(bookingId || 'payment');
  const am = Number(amount) || 0;

  const upiPayUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(
    upiName
  )}&am=${am}&cu=INR&tn=${tn}&tr=${tr}`;

  // Return a base64 PNG data URL for direct use in <img src="..."/>.
  return QRCode.toDataURL(upiPayUrl, { errorCorrectionLevel: 'M', margin: 1, scale: 6 });
}

module.exports = {
  generateUpiQrDataUri,
};

