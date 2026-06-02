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

    const store = getStore({ name: 'katachi-jobs', consistency: 'strong' });
    const job = await store.get(jobId, { type: 'json' });

    if (!job) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'job not found' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify(job) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
