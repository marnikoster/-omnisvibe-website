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

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  }
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    const { requestId, apiKey } = JSON.parse(event.body);
    if (!requestId || !apiKey) return { statusCode: 400, headers, body: JSON.stringify({ error: 'requestId and apiKey required' }) };

    const statusRes = await falGet(`/${MODEL}/requests/${requestId}/status`, apiKey);
    if (statusRes.status !== 200) return { statusCode: statusRes.status, headers, body: statusRes.body };
    const statusData = JSON.parse(statusRes.body);

    if (statusData.status === 'COMPLETED') {
      const resultRes = await falGet(`/${MODEL}/requests/${requestId}`, apiKey);
      const result = JSON.parse(resultRes.body);
      const videoUrl = result.video?.url || result.output?.video?.url || result.video_url || null;
      return { statusCode: 200, headers, body: JSON.stringify({ status: 'COMPLETED', videoUrl }) };
    }

    if (statusData.status === 'FAILED') {
      return { statusCode: 200, headers, body: JSON.stringify({ status: 'FAILED', error: statusData.error || 'Generation failed' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ status: statusData.status || 'IN_PROGRESS' }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
