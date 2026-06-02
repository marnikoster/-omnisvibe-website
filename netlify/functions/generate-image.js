const https = require('https');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const { prompt, size, apiKey } = JSON.parse(event.body);
    if (!prompt || !apiKey) return { statusCode: 400, headers, body: JSON.stringify({ error: 'prompt and apiKey required' }) };

    const safePrompt = prompt.substring(0, 3800);

    // Parse size — Grok Aurora uses width/height separately
    // Default 1024x1024, support 1536x1024 widescreen
    let width = 1024, height = 1024;
    if (size === '1536x1024') { width = 1536; height = 1024; }
    if (size === '1024x1536') { width = 1024; height = 1536; }

    const payload = JSON.stringify({
      model: 'grok-imagine-image-quality',
      prompt: safePrompt,
      n: 1,
      response_format: 'b64_json'
    });

    const result = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.x.ai',
        path: '/v1/images/generations',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
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

    if (result.status !== 200) {
      let errMsg = `HTTP ${result.status}`;
      try {
        const p = JSON.parse(result.body);
        errMsg = p.error?.message || p.error?.code || p.message || result.body.substring(0, 300);
      } catch(e) { errMsg = result.body.substring(0, 300); }
      return { statusCode: result.status, headers, body: JSON.stringify({ error: errMsg }) };
    }

    return { statusCode: 200, headers, body: result.body };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
