const https = require('https');

// Fallback model path used only if frontend doesn't supply FAL's canonical URLs.
// NOTE: FAL's status/result URLs drop the model subpath — they use
// fal-ai/bytedance/requests/{id} not fal-ai/bytedance/seedance/v1/lite/.../requests/{id}
const QUEUE_HOST = 'queue.fal.run';

function falGet(url, apiKey) {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + (parsed.search || ''),
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
    const { requestId, apiKey, statusUrl, responseUrl } = JSON.parse(event.body);
    if (!requestId || !apiKey) return { statusCode: 400, headers, body: JSON.stringify({ error: 'requestId and apiKey required' }) };
    if (!statusUrl || !responseUrl) return { statusCode: 400, headers, body: JSON.stringify({ error: 'statusUrl and responseUrl required — submit response must be forwarded' }) };

    const statusRes = await falGet(statusUrl, apiKey);
    console.log(`[check-video-status] HTTP ${statusRes.status} raw body: ${statusRes.body}`);

    const statusData = tryParse(statusRes.body);

    // Empty, unparseable, or non-200 → treat as still in progress
    if (statusRes.status !== 200 || !statusData) {
      return { statusCode: 200, headers, body: JSON.stringify({ status: 'IN_PROGRESS' }) };
    }

    if (statusData.status === 'COMPLETED') {
      const resultRes = await falGet(responseUrl, apiKey);
      console.log(`[check-video-status] result HTTP ${resultRes.status} raw body: ${resultRes.body.substring(0, 300)}`);
      const result = tryParse(resultRes.body) || {};
      const videoUrl = result.video?.url || result.output?.video?.url || result.video_url || null;
      return { statusCode: 200, headers, body: JSON.stringify({ status: 'COMPLETED', videoUrl }) };
    }

    if (statusData.status === 'FAILED') {
      return { statusCode: 200, headers, body: JSON.stringify({ status: 'FAILED', error: statusData.error || 'Generation failed' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ status: statusData.status || 'IN_PROGRESS' }) };

  } catch (err) {
    console.log(`[check-video-status] caught error: ${err.message}`);
    return { statusCode: 200, headers, body: JSON.stringify({ status: 'IN_PROGRESS' }) };
  }
};
