const { getStore } = require('@netlify/blobs');

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const jobId = event.queryStringParameters?.jobId;
    if (!jobId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'jobId required' }) };
    }

    const store = getStore({
      name: 'katachi-jobs',
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_AUTH_TOKEN
    });

    const raw = await store.get(jobId);
    if (!raw) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'job not found' }) };
    }

    const job = JSON.parse(raw);
    return { statusCode: 200, headers, body: JSON.stringify(job) };

  } catch (err) {
    console.error('GET JOB ERROR:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
