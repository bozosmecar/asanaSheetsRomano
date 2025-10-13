import fetch from 'node-fetch';

const {
  SHEET_WEBHOOK_ENDPOINT,
  SECRET_KEY,
} = process.env;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  // Handle Asana webhook handshake verification
  const hookSecret = req.headers['x-hook-secret'];
  if (hookSecret) {
    res.setHeader('X-Hook-Secret', hookSecret);
    return res.status(200).send('Webhook Verified');
  }

  // Parse events from body
  const { events } = req.body || {};

  if (!events) {
    return res.status(400).send('No events found');
  }

  try {
    for (const event of events) {
      // Optionally log event
      console.log('Asana event:', event);

      // Forward the event to Google Apps Script webhook with secret authorization
      await fetch(SHEET_WEBHOOK_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SECRET_KEY}`,
        },
        body: JSON.stringify(event),
      });
    }

    res.status(200).send('Events Processed');
  } catch (err) {
    console.error('Error forwarding to sheet:', err);
    res.status(500).send('Internal Server Error');
  }
}
