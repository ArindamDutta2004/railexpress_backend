const PDFDocument = require('pdfkit');

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function money(value) {
  const amount = Number(value || 0);
  return `INR ${amount.toFixed(2)}`;
}

function getPassengerRows(booking) {
  const details = Array.isArray(booking.passengerDetails) ? booking.passengerDetails : [];
  if (details.length) return details;
  return [
    {
      name: booking.passengerName,
      dateOfBirth: booking.dateOfBirth,
      age: booking.age,
    },
  ];
}

function writeKeyValue(doc, label, value, x, y, width = 230) {
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#475569').text(label, x, y, { width });
  doc.font('Helvetica').fontSize(11).fillColor('#111827').text(String(value ?? '-'), x, y + 14, { width });
}

function writeHeader(doc, title, booking) {
  doc.rect(0, 0, doc.page.width, 95).fill('#0f766e');
  doc
    .fillColor('#ffffff')
    .font('Helvetica-Bold')
    .fontSize(24)
    .text('RailXpress', 48, 30);
  doc
    .font('Helvetica')
    .fontSize(12)
    .text(title, 48, 60);
  doc
    .fontSize(9)
    .text(`Booking ID: ${booking._id}`, 330, 34, { align: 'right', width: 210 })
    .text(`Generated: ${formatDate(new Date())}`, 330, 52, { align: 'right', width: 210 });
  doc.fillColor('#111827');
}

function writeJourneySection(doc, booking, y) {
  doc.roundedRect(48, y, 500, 120, 8).fillAndStroke('#f8fafc', '#dbeafe');
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(14).text('Journey Details', 68, y + 18);
  writeKeyValue(doc, 'From', booking.fromStation, 68, y + 48);
  writeKeyValue(doc, 'To', booking.toStation, 300, y + 48);
  writeKeyValue(doc, 'Journey Date', formatDate(booking.journeyDate), 68, y + 84);
  writeKeyValue(doc, 'Booking Type', String(booking.bookingType || '-').toUpperCase(), 300, y + 84);
}

function writePassengerSection(doc, booking, y) {
  const passengers = getPassengerRows(booking);
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(14).text('Passenger Details', 48, y);
  let rowY = y + 28;

  doc.rect(48, rowY, 500, 24).fill('#e0f2fe');
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(10);
  doc.text('Name', 60, rowY + 7, { width: 240 });
  doc.text('Age', 310, rowY + 7, { width: 60 });
  doc.text('Date of Birth', 390, rowY + 7, { width: 130 });
  rowY += 24;

  passengers.forEach((passenger, index) => {
    doc.rect(48, rowY, 500, 26).fill(index % 2 === 0 ? '#ffffff' : '#f8fafc');
    doc.fillColor('#111827').font('Helvetica').fontSize(10);
    doc.text(passenger.name || '-', 60, rowY + 8, { width: 240 });
    doc.text(String(passenger.age ?? '-'), 310, rowY + 8, { width: 60 });
    doc.text(formatDate(passenger.dateOfBirth), 390, rowY + 8, { width: 130 });
    rowY += 26;
  });

  return rowY + 18;
}

function writeTicket(doc, booking) {
  writeHeader(doc, 'Ticket Document', booking);
  writeJourneySection(doc, booking, 125);
  const afterPassengers = writePassengerSection(doc, booking, 280);

  doc.roundedRect(48, afterPassengers, 500, 92, 8).fillAndStroke('#f0fdf4', '#bbf7d0');
  doc.fillColor('#166534').font('Helvetica-Bold').fontSize(13).text('Booking Status', 68, afterPassengers + 18);
  writeKeyValue(doc, 'Payment Status', booking.paymentStatus, 68, afterPassengers + 46);
  writeKeyValue(doc, 'Booking Phase', booking.statusPhase2, 300, afterPassengers + 46);

  if (booking.preferredTrains?.length) {
    const prefY = afterPassengers + 120;
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(13).text('Preferred Trains', 48, prefY);
    doc.font('Helvetica').fontSize(10).fillColor('#334155');
    booking.preferredTrains.forEach((train, index) => {
      doc.text(`${index + 1}. ${train}`, 62, prefY + 24 + index * 16);
    });
  }
}

function writeBill(doc, booking) {
  writeHeader(doc, 'Payment Bill', booking);
  writeJourneySection(doc, booking, 125);

  const y = 280;
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(14).text('Payment Summary', 48, y);
  const rows = [
    ['Advance Amount', money(booking.advanceAmount)],
    ['Remaining Amount', money(booking.remainingAmount)],
    ['Total Amount', money(booking.totalAmount || Number(booking.advanceAmount || 0) + Number(booking.remainingAmount || 0))],
    ['Payment Status', booking.paymentStatus || '-'],
  ];

  let rowY = y + 30;
  rows.forEach(([label, value], index) => {
    doc.rect(48, rowY, 500, 34).fill(index % 2 === 0 ? '#ffffff' : '#f8fafc');
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(11).text(label, 68, rowY + 10, { width: 260 });
    doc.font('Helvetica').text(value, 370, rowY + 10, { width: 150, align: 'right' });
    rowY += 34;
  });

  doc.roundedRect(48, rowY + 28, 500, 86, 8).fillAndStroke('#fffbeb', '#fde68a');
  doc
    .fillColor('#92400e')
    .font('Helvetica-Bold')
    .fontSize(12)
    .text('Receipt Note', 68, rowY + 46);
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#78350f')
    .text(
      'This bill is generated from the verified booking and payment details stored in RailXpress.',
      68,
      rowY + 68,
      { width: 460 }
    );
}

function streamBookingPdf({ booking, type, res }) {
  const safeType = type === 'bill' ? 'bill' : 'ticket';
  const filename = `${safeType}-${booking._id}.pdf`;
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: false });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');

  doc.on('error', (err) => {
    console.error(`[pdf] ${safeType} generation stream error`, err);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Failed to generate PDF document' });
    } else {
      res.destroy(err);
    }
  });

  doc.pipe(res);
  if (safeType === 'bill') {
    writeBill(doc, booking);
  } else {
    writeTicket(doc, booking);
  }
  doc.end();
}

module.exports = {
  streamBookingPdf,
};
