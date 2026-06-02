const https = require('https');

// Netlify Background Function — runs up to 15 minutes
exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { prompt, size, apiKey, refs } = JSON.parse(event.body);
    if (!prompt || !apiKey) return { statusCode: 400, headers, body: JSON.stringify({ error: 'prompt and apiKey required' }) };

    const safePrompt = prompt.substring(0, 3800);
    let imageSize = '1024x1024';
    if (size === '1536x1024' || size === '16:9') imageSize = '1536x1024';
    if (size === '1024x1536' || size === '9:16') imageSize = '1024x1536';

    const activeRefs = Array.isArray(refs) ? refs.filter(Boolean).slice(0, 2) : [];

    if (activeRefs.length > 0) {
      const boundary = '----KatachiFormBoundary' + Date.now();
      const parts = [];

      const addField = (name, value) => {
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8'));
      };

      addField('model', 'gpt-image-2');
      addField('prompt', safePrompt);
      addField('n', '1');
      addField('size', imageSize);

      for (let i = 0; i < activeRefs.length; i++) {
        const ref = activeRefs[i];
        const match = ref.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) continue;
        const mime = match[1];
        const buf = Buffer.from(match[2], 'base64');
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image[]"; filename="ref${i}.png"\r\nContent-Type: ${mime}\r\n\r\n`, 'utf8'));
        parts.push(buf);
        parts.push(Buffer.from('\r\n', 'utf8'));
      }
      parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
      const body = Buffer.concat(parts);

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
          res.on('data', c => chunks.push(c));
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
          res.on('data', c => data += c);
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
