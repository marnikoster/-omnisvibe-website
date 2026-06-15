const https = require('https');

const FAST_MODEL    = 'fal-ai/seedance-2/fast/reference-to-video';
const QUALITY_MODEL = 'fal-ai/seedance-2/reference-to-video';

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  }
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    const { imageUrls, prompt, apiKey, quality, aspectRatio, duration, resolution } = JSON.parse(event.body);
    if (!imageUrls || !imageUrls.length || !apiKey) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'imageUrls and apiKey required' }) };
    }

    const model = quality ? QUALITY_MODEL : FAST_MODEL;
    const payload = JSON.stringify({
      image_urls:   imageUrls,
      prompt:       prompt || '',
      resolution:   resolution || '720p',
      aspect_ratio: aspectRatio || '16:9',
      duration:     duration ? String(duration) : '10'
    });

    const result = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'queue.fal.run',
        path:     '/' + model,
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json',
          'Authorization':  'Key ' + apiKey,
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    return { statusCode: result.status, headers, body: result.body };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
