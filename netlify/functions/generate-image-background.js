const { getStore } = require('@netlify/blobs');
const https = require('https');

exports.handler = async function(event) {
  let jobId;
  try {
    const { jobId: jid, prompt, size, apiKey, refs } = JSON.parse(event.body);
    jobId = jid;

    const store = getStore({ name: 'katachi-jobs', consistency: 'strong' });

    // Mark as processing
    await store.setJSON(jobId, { status: 'processing', startedAt: Date.now() });

    const safePrompt = prompt.substring(0, 3800);
    let imageSize = '1024x1024';
    if (size === '1536x1024' || size === '16:9') imageSize = '1536x1024';
    if (size === '1024x1536' || size === '9:16') imageSize = '1024x1536';

    const activeRefs = Array.isArray(refs) ? refs.filter(Boolean).slice(0, 2) : [];
    let result;

    if (activeRefs.length > 0) {
      // Use edits endpoint with reference images
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

      result = await new Promise((resolve, reject) => {
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

    } else {
      // No refs — use generations endpoint
      const payload = JSON.stringify({ model: 'gpt-image-2', prompt: safePrompt, n: 1, size: imageSize });
      result = await new Promise((resolve, reject) => {
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
    }

    const parsed = JSON.parse(result.body);

    if (result.status !== 200) {
      const errMsg = parsed?.error?.message || parsed?.error?.code || `HTTP ${result.status}`;
      await store.setJSON(jobId, { status: 'error', error: errMsg, completedAt: Date.now() });
      return { statusCode: 200, body: 'error stored' };
    }

    const b64 = parsed.data?.[0]?.b64_json;
    const url = parsed.data?.[0]?.url;
    const imageData = b64 ? `data:image/png;base64,${b64}` : url;

    await store.setJSON(jobId, {
      status: 'done',
      imageUrl: imageData,
      completedAt: Date.now()
    });

    return { statusCode: 200, body: 'done' };

  } catch (err) {
    if (jobId) {
      try {
        const store = getStore({ name: 'katachi-jobs', consistency: 'strong' });
        await store.setJSON(jobId, { status: 'error', error: err.message, completedAt: Date.now() });
      } catch(e) {}
    }
    return { statusCode: 500, body: err.message };
  }
};
