// Email functionality has been intentionally removed as per requirements.
// This file is kept as a placeholder so existing requires do not break
// if any legacy reference remains.

async function noopEmail() {
  return;
}

module.exports = {
  sendStatusEmailForBooking: noopEmail,
};

