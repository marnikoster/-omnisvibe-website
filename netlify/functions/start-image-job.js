const { getStore } = require('@netlify/blobs');
const crypto = require('crypto');

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { prompt, size, apiKey, refs } = JSON.parse(event.body);
    if (!prompt || !apiKey) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'prompt and apiKey required' }) };
    }

    const jobId = crypto.randomUUID();

    const store = getStore({
      name: 'katachi-jobs',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_AUTH_TOKEN
    });

    await store.setJSON(jobId, { status: 'pending', createdAt: Date.now() });

    const siteUrl = process.env.URL || 'https://keen-brioche-83e522.netlify.app';
    fetch(`${siteUrl}/.netlify/functions/generate-image-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, prompt, size, apiKey, refs })
    }).catch(() => {});

    return { statusCode: 200, headers, body: JSON.stringify({ jobId }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
