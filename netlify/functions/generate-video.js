const https = require('https');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  }
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    const { imageUrl, prompt, apiKey } = JSON.parse(event.body);
    if (!imageUrl || !apiKey) return { statusCode: 400, headers, body: JSON.stringify({ error: 'imageUrl and apiKey required' }) };
    const payload = JSON.stringify({ image_url: imageUrl, prompt: (prompt || '').substring(0, 200), duration: 5, resolution: '720p' });
    const result = await new Promise((resolve, reject) => {
      const req = https.request({ hostname: 'fal.run', path: '/fal-ai/bytedance/seedance/v1/lite/image-to-video', method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Key ' + apiKey, 'Content-Length': Buffer.byteLength(payload) } }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
    return { statusCode: result.status, headers, body: result.body };
  } catch(err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};