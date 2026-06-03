const { getStore } = require('@netlify/blobs');
const https = require('https');
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

    // Store initial job state
    const store = getStore({
      name: 'katachi-jobs',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_AUTH_TOKEN
    });
    await store.set(jobId, JSON.stringify({ status: 'pending', createdAt: new Date().toISOString() }), {
      metadata: { contentType: 'application/json' }
    });
    console.log('Job stored in Blobs:', jobId);

    // Trigger background function using https.request (not fetch)
    const siteUrl = process.env.URL || 'https://keen-brioche-83e522.netlify.app';
    const bgUrl = new URL(`${siteUrl}/.netlify/functions/generate-image-background`);
    const bgBody = JSON.stringify({ jobId, prompt, size, apiKey, refs });

    const bgReq = https.request({
      hostname: bgUrl.hostname,
      path: bgUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bgBody)
      }
    }, (res) => {
      console.log('Background function triggered, status:', res.statusCode);
      res.resume(); // drain response
    });
    bgReq.on('error', (e) => console.error('Background trigger error:', e.message));
    bgReq.write(bgBody);
    bgReq.end();

    // Return jobId immediately — don't wait for background to complete
    return { statusCode: 200, headers, body: JSON.stringify({ jobId }) };

  } catch (err) {
    console.error('START JOB ERROR:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
