'use strict';

const logger = require('./logger');

/**
 * Send an email alert.
 * In production: uses Azure Communication Services.
 * In dev (no AZURE_COMM_CONNECTION_STRING): logs to console only.
 */
async function sendEmail({ to, subject, body }) {
  if (!process.env.AZURE_COMM_CONNECTION_STRING) {
    logger.info({ to, subject, body }, '[DEV] Email alert (not sent — no Azure Comm config)');
    return { id: `dev-${Date.now()}`, status: 'dev_logged' };
  }

  try {
    const { EmailClient } = require('@azure/communication-email');
    const client = new EmailClient(process.env.AZURE_COMM_CONNECTION_STRING);

    const message = {
      senderAddress: process.env.ALERT_FROM_EMAIL || 'no-reply@ir-platform.local',
      recipients: { to: [{ address: to }] },
      content: { subject, plainText: body },
    };

    const poller = await client.beginSend(message);
    const result = await poller.pollUntilDone();
    logger.info({ to, subject, messageId: result.id }, 'Email sent via Azure Comm');
    return result;
  } catch (err) {
    logger.error({ err, to, subject }, 'Email send failed');
    throw err;
  }
}

module.exports = { sendEmail };
