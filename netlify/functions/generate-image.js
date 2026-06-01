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
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  try {
    const body = JSON.parse(event.body);
    const { prompt, size, apiKey } = body;

    if (!prompt) return { statusCode: 400, headers, body: JSON.stringify({ error: 'prompt required' }) };
    if (!apiKey) return { statusCode: 400, headers, body: JSON.stringify({ error: 'apiKey required' }) };

    // Truncate prompt to 3800 chars to stay within API limits
    const safePrompt = prompt.substring(0, 3800);

    const payload = JSON.stringify({
      model: 'gpt-image-1',
      prompt: safePrompt,
      n: 1,
      size: size || '1024x1024',
      quality: 'auto'
    });

    const result = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.openai.com',
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

    // Surface clean error message
    if (result.status !== 200) {
      let errMsg = `HTTP ${result.status}`;
      try {
        const parsed = JSON.parse(result.body);
        errMsg = parsed?.error?.message || parsed?.error?.code || result.body.substring(0, 200);
      } catch(e) {
        errMsg = result.body.substring(0, 200);
      }
      return {
        statusCode: result.status,
        headers,
        body: JSON.stringify({ error: errMsg })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: result.body
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || String(err) })
    };
  }
};
