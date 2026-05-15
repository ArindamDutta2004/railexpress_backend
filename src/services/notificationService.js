const mongoose = require('mongoose');
const FcmToken = require('../models/FcmToken');
const Notification = require('../models/Notification');
const { getFirebaseAdmin } = require('../config/firebaseAdmin');

const CLIENT_BASE_URL =
  process.env.USER_FRONTEND_URL || process.env.FRONTEND_USER_URL || 'https://railexpress-user.onrender.com';
const NOTIFICATION_ICON_URL =
  process.env.NOTIFICATION_ICON_URL || new URL('/railxpress-icon.svg', CLIENT_BASE_URL).toString();

const BOOKING_EVENT_COPY = {
  booking_approved: {
    title: 'Booking In Progress',
    body: 'Your booking was approved. Please complete the advance payment.',
  },
  booking_cancelled: {
    title: 'Booking Cancelled',
    body: 'Your booking has been cancelled. Open RailXpress for refund details.',
  },
  advance_amount_set: {
    title: 'Advance Payment Pending',
    body: 'Advance payment details are ready for your booking.',
  },
  advance_payment_verified: {
    title: 'Payment Verified',
    body: 'Your advance payment has been verified. Booking is now in progress.',
  },
  booking_confirmed: {
    title: 'Ticket Confirmed',
    body: 'Your ticket booking is confirmed. Final payment may be required.',
  },
  final_payment_verified: {
    title: 'Payment Verified',
    body: 'Your final payment has been verified.',
  },
  ticket_pdf_uploaded: {
    title: 'PDF Uploaded',
    body: 'Your ticket PDF has been uploaded.',
  },
  bill_pdf_uploaded: {
    title: 'Bill Uploaded',
    body: 'Your bill PDF has been uploaded.',
  },
  booking_completed: {
    title: 'Booking Completed',
    body: 'Your RailXpress booking is complete.',
  },
  booking_not_done: {
    title: 'Booking Cancelled',
    body: 'Your requested ticket could not be booked. Open RailXpress for details.',
  },
  refund_verified: {
    title: 'Refund Verified',
    body: 'Your refund proof was verified by admin.',
  },
  refund_processed: {
    title: 'Refund Processed',
    body: 'Refund proof has been uploaded by admin.',
  },
  admin_message: {
    title: 'RailXpress Update',
    body: 'You have a new message from RailXpress.',
  },
};

function bookingUrl(bookingId) {
  const path = `/dashboard${bookingId ? `?bookingId=${bookingId}` : ''}`;
  return new URL(path, CLIENT_BASE_URL).toString();
}

function objectIdString(value) {
  if (!value) return null;
  return value.toString();
}

async function removeInvalidTokens(responses, tokens) {
  const invalidTokens = [];
  responses.forEach((response, index) => {
    const code = response.error?.code || '';
    if (
      code.includes('registration-token-not-registered') ||
      code.includes('invalid-registration-token') ||
      code.includes('invalid-argument')
    ) {
      invalidTokens.push(tokens[index]);
    }
  });

  if (invalidTokens.length) {
    await FcmToken.updateMany(
      { token: { $in: invalidTokens } },
      { $set: { disabledAt: new Date() } }
    );
    console.warn('[notification] disabled invalid FCM tokens', { count: invalidTokens.length });
  }
}

function deliveryErrors(responses, tokens) {
  return responses
    .map((response, index) => {
      if (!response.error) return null;
      return {
        code: response.error.code || 'unknown',
        message: response.error.message || 'FCM send failed',
        tokenSuffix: tokens[index] ? tokens[index].slice(-12) : '',
      };
    })
    .filter(Boolean)
    .slice(0, 10);
}

function stringifyData(data = {}) {
  return Object.entries(data).reduce((acc, [key, value]) => {
    if (value === undefined || value === null) return acc;
    acc[key] = String(value);
    return acc;
  }, {});
}

async function sendPushToUser(userId, notification) {
  const firebaseAdmin = getFirebaseAdmin();
  if (!firebaseAdmin) {
    return {
      successCount: 0,
      failureCount: 0,
      attemptedCount: 0,
      errors: [{ code: 'firebase-admin-not-configured', message: 'Firebase Admin SDK is not configured' }],
    };
  }

  const tokenDocs = await FcmToken.find({ userId, disabledAt: null }).select('token');
  const tokens = tokenDocs.map((doc) => doc.token).filter(Boolean);
  if (!tokens.length) {
    return {
      successCount: 0,
      failureCount: 0,
      attemptedCount: 0,
      errors: [{ code: 'no-active-fcm-tokens', message: 'User has no active FCM tokens' }],
    };
  }

  const targetUrl = notification.url || bookingUrl(notification.bookingId);
  const notificationId = notification._id.toString();
  const data = stringifyData({
    notificationId,
    bookingId: objectIdString(notification.bookingId) || '',
    eventType: notification.eventType,
    eventKey: notification.eventKey,
    title: notification.title,
    body: notification.body,
    url: targetUrl,
    click_action: targetUrl,
    icon: NOTIFICATION_ICON_URL,
    badge: NOTIFICATION_ICON_URL,
  });

  const message = {
    tokens,
    data,
    webpush: {
      headers: {
        TTL: '86400',
        Urgency: 'high',
      },
      fcmOptions: {
        link: targetUrl,
      },
    },
  };

  const response = await firebaseAdmin.messaging().sendEachForMulticast(message);
  await removeInvalidTokens(response.responses, tokens);
  const errors = deliveryErrors(response.responses, tokens);
  if (response.failureCount > 0) {
    console.warn('[notification] FCM delivery failures', {
      userId: String(userId),
      notificationId,
      eventType: notification.eventType,
      successCount: response.successCount,
      failureCount: response.failureCount,
      errors,
    });
  } else {
    console.info('[notification] FCM delivery sent', {
      userId: String(userId),
      notificationId,
      eventType: notification.eventType,
      successCount: response.successCount,
    });
  }

  return {
    successCount: response.successCount,
    failureCount: response.failureCount,
    attemptedCount: tokens.length,
    errors,
  };
}

async function createAndSendNotification({
  userId,
  bookingId = null,
  eventType,
  eventKey,
  title,
  body,
  url,
  data = {},
}) {
  if (!userId || !eventType || !eventKey) return null;

  const resolvedCopy = BOOKING_EVENT_COPY[eventType] || BOOKING_EVENT_COPY.admin_message;
  const resolvedTitle = title || resolvedCopy.title;
  const resolvedBody = body || resolvedCopy.body;
  const resolvedBookingId = bookingId && mongoose.Types.ObjectId.isValid(bookingId) ? bookingId : null;
  const resolvedUrl = url || bookingUrl(resolvedBookingId);

  let notification;
  try {
    notification = await Notification.create({
      userId,
      bookingId: resolvedBookingId,
      eventType,
      eventKey,
      title: resolvedTitle,
      body: resolvedBody,
      url: resolvedUrl,
      data,
    });
  } catch (err) {
    if (err?.code === 11000) {
      return null;
    }
    throw err;
  }

  try {
    const delivery = await sendPushToUser(userId, notification);
    notification.delivery = delivery;
    notification.deliveredAt = delivery.successCount > 0 ? new Date() : null;
    await notification.save({ validateBeforeSave: false });
  } catch (err) {
    console.error('[notification] FCM delivery failed', {
      userId: String(userId),
      bookingId: resolvedBookingId ? String(resolvedBookingId) : null,
      eventType,
      error: err.message,
    });
  }

  return notification;
}

async function notifyBookingUser(booking, eventType, options = {}) {
  if (!booking?.userId) return null;

  const bookingId = booking._id.toString();
  const step = booking.currentStep ? `step-${booking.currentStep}` : 'booking';
  const eventKey = options.eventKey || `${eventType}:${bookingId}:${step}`;

  return createAndSendNotification({
    userId: booking.userId,
    bookingId,
    eventType,
    eventKey,
    title: options.title,
    body: options.body,
    url: options.url || bookingUrl(bookingId),
    data: {
      bookingId,
      currentStep: String(booking.currentStep || ''),
      paymentStatus: String(booking.paymentStatus || ''),
      statusPhase1: String(booking.statusPhase1 || ''),
      statusPhase2: String(booking.statusPhase2 || ''),
      ...(options.data || {}),
    },
  });
}

module.exports = {
  BOOKING_EVENT_COPY,
  createAndSendNotification,
  notifyBookingUser,
};
