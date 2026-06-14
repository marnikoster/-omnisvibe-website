const https = require('https');

const MODEL = 'fal-ai/bytedance/seedance/v1/lite/image-to-video';

function falGet(path, apiKey) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'queue.fal.run',
      path,
      method: 'GET',
      headers: { 'Authorization': 'Key ' + apiKey }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

function tryParse(text) {
  try { return text.trim() ? JSON.parse(text) : null; }
  catch (_) { return null; }
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  }
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    const { requestId, apiKey } = JSON.parse(event.body);
    if (!requestId || !apiKey) return { statusCode: 400, headers, body: JSON.stringify({ error: 'requestId and apiKey required' }) };

    const statusRes = await falGet(`/${MODEL}/requests/${requestId}/status`, apiKey);
    console.log(`[check-video-status] HTTP ${statusRes.status} raw body: ${statusRes.body}`);

    const statusData = tryParse(statusRes.body);

    // Non-200, empty body, or unparseable → treat as still in progress
    if (statusRes.status !== 200 || !statusData) {
      return { statusCode: 200, headers, body: JSON.stringify({ status: 'IN_PROGRESS' }) };
    }

    if (statusData.status === 'COMPLETED') {
      const resultRes = await falGet(`/${MODEL}/requests/${requestId}`, apiKey);
      console.log(`[check-video-status] result HTTP ${resultRes.status} raw body: ${resultRes.body.substring(0, 300)}`);
      const result = tryParse(resultRes.body) || {};
      const videoUrl = result.video?.url || result.output?.video?.url || result.video_url || null;
      return { statusCode: 200, headers, body: JSON.stringify({ status: 'COMPLETED', videoUrl }) };
    }

    if (statusData.status === 'FAILED') {
      return { statusCode: 200, headers, body: JSON.stringify({ status: 'FAILED', error: statusData.error || 'Generation failed' }) };
    }

    // IN_QUEUE, IN_PROGRESS, or any other value — keep waiting
    return { statusCode: 200, headers, body: JSON.stringify({ status: statusData.status || 'IN_PROGRESS' }) };

  } catch (err) {
    console.log(`[check-video-status] caught error: ${err.message}`);
    // Don't 500 — return IN_PROGRESS so the frontend keeps polling
    return { statusCode: 200, headers, body: JSON.stringify({ status: 'IN_PROGRESS' }) };
  }
};
