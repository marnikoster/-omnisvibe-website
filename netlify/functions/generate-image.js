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
    const { prompt, size, apiKey, refs } = JSON.parse(event.body);
    if (!prompt || !apiKey) return { statusCode: 400, headers, body: JSON.stringify({ error: 'prompt and apiKey required' }) };

    const safePrompt = prompt.substring(0, 3800);
    let imageSize = '1024x1024';
    if (size === '1536x1024' || size === '16:9' || size === 'landscape') imageSize = '1536x1024';
    if (size === '1024x1536' || size === '9:16' || size === 'portrait') imageSize = '1024x1536';

    const activeRefs = Array.isArray(refs) ? refs.filter(Boolean).slice(0, 4) : [];

    if (activeRefs.length > 0) {
      // Use multipart/form-data with edits endpoint
      const boundary = '----KatachiFormBoundary' + Date.now();
      const parts = [];

      const addField = (name, value) => {
        parts.push(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}`
        );
      };

      addField('model', 'gpt-image-2');
      addField('prompt', safePrompt);
      addField('n', '1');
      addField('size', imageSize);

      for (let i = 0; i < activeRefs.length; i++) {
        const ref = activeRefs[i];
        const matches = ref.match(/^data:([^;]+);base64,(.+)$/);
        if (!matches) continue;
        const mime = matches[1];
        const b64 = matches[2];
        const buf = Buffer.from(b64, 'base64');
        parts.push(
          `--${boundary}\r\nContent-Disposition: form-data; name="image[]"; filename="ref${i}.png"\r\nContent-Type: ${mime}\r\n`
        );
        parts.push(buf);
      }

      const encoder = new TextEncoder ? new (require('util').TextEncoder)() : { encode: s => Buffer.from(s) };
      const chunks = [];
      for (const part of parts) {
        if (typeof part === 'string') {
          chunks.push(Buffer.from(part + '\r\n', 'utf8'));
        } else {
          chunks.push(part);
          chunks.push(Buffer.from('\r\n', 'utf8'));
        }
      }
      chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
      const body = Buffer.concat(chunks);

      const result = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.openai.com',
          path: '/v1/images/edits',
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Authorization': `Bearer ${apiKey}`,
            'Content-Length': body.length
          }
        }, (res) => {
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
        });
        req.on('error', reject);
        req.write(body);
        req.end();
      });

      if (result.status !== 200) {
        let errMsg = `HTTP ${result.status}`;
        try { const p = JSON.parse(result.body); errMsg = p.error?.message || p.error?.code || result.body.substring(0, 300); } catch(e) {}
        return { statusCode: result.status, headers, body: JSON.stringify({ error: errMsg }) };
      }
      return { statusCode: 200, headers, body: result.body };

    } else {
      // No refs — use generations endpoint
      const payload = JSON.stringify({ model: 'gpt-image-2', prompt: safePrompt, n: 1, size: imageSize });
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

      if (result.status !== 200) {
        let errMsg = `HTTP ${result.status}`;
        try { const p = JSON.parse(result.body); errMsg = p.error?.message || p.error?.code || result.body.substring(0, 300); } catch(e) {}
        return { statusCode: result.status, headers, body: JSON.stringify({ error: errMsg }) };
      }
      return { statusCode: 200, headers, body: result.body };
    }

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
