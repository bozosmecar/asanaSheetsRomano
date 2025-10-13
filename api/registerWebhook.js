import fetch from 'node-fetch';

const {
  ASANA_PAT,
  ASANA_RESOURCE_GID,
  ASANA_WEBHOOK_TARGET,
} = process.env;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const response = await fetch('https://app.asana.com/api/1.0/webhooks', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ASANA_PAT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        resource: ASANA_RESOURCE_GID,
        target: ASANA_WEBHOOK_TARGET,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data });
    }

    res.status(200).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
