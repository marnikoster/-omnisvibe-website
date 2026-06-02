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

    console.log('SITE_ID present:', !!process.env.NETLIFY_SITE_ID);
    console.log('TOKEN present:', !!process.env.NETLIFY_AUTH_TOKEN);

    const jobId = crypto.randomUUID();

    const store = getStore({
      name: 'katachi-jobs',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_AUTH_TOKEN
    });

    await store.set(jobId, JSON.stringify({ status: 'pending', createdAt: Date.now() }), {
      metadata: { contentType: 'application/json' }
    });

    const siteUrl = process.env.URL || 'https://keen-brioche-83e522.netlify.app';
    fetch(`${siteUrl}/.netlify/functions/generate-image-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, prompt, size, apiKey, refs })
    }).catch((e) => console.error('Background fire error:', e.message));

    return { statusCode: 200, headers, body: JSON.stringify({ jobId }) };

  } catch (err) {
    console.error('START JOB ERROR:', err.message, err.stack);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
