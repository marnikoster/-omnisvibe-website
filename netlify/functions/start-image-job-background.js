const { getStore } = require('@netlify/blobs');
const https = require('https');
const crypto = require('crypto');

// Netlify Background Function — runs up to 15 minutes
// Returns 202 immediately, processes in background
exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  let jobId = crypto.randomUUID(); // will be overridden by passed jobId
  console.log('Background job invoked');

  const getBlobStore = () => getStore({
    name: 'katachi-jobs',
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_AUTH_TOKEN
  });

  const blobSet = async (store, key, data) => {
    await store.set(key, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }), {
      metadata: { contentType: 'application/json' }
    });
  };

  try {
    const parsed = JSON.parse(event.body);
    const { prompt, size, apiKey, refs } = parsed;
    if (parsed.jobId) jobId = parsed.jobId;
    console.log('Using jobId:', jobId);
    if (!prompt || !apiKey) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'prompt and apiKey required' }) };
    }

    console.log('SITE_ID present:', !!process.env.NETLIFY_SITE_ID);
    console.log('TOKEN present:', !!process.env.NETLIFY_AUTH_TOKEN);

    const store = getBlobStore();

    // Store initial state — studio can start polling immediately
    await blobSet(store, jobId, { status: 'processing', stage: 'started' });
    console.log('Job stored in Blobs, jobId:', jobId);

    // Return jobId immediately — Netlify background function continues running after this
    // NOTE: In Netlify background functions the response is sent and execution continues
    const safePrompt = prompt.substring(0, 3800);
    let imageSize = '1024x1024';
    if (size === '1536x1024' || size === '16:9') imageSize = '1536x1024';
    if (size === '1024x1536' || size === '9:16') imageSize = '1024x1536';

    const activeRefs = Array.isArray(refs) ? refs.filter(Boolean).slice(0, 2) : [];

    await blobSet(store, jobId, { status: 'processing', stage: 'calling_openai', refCount: activeRefs.length });
    console.log('Calling OpenAI, refs:', activeRefs.length, 'size:', imageSize);

    let result;

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
        const match = activeRefs[i].match(/^data:([^;]+);base64,(.+)$/);
        if (!match) continue;
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image[]"; filename="ref${i}.png"\r\nContent-Type: ${match[1]}\r\n\r\n`, 'utf8'));
        parts.push(Buffer.from(match[2], 'base64'));
        parts.push(Buffer.from('\r\n', 'utf8'));
      }
      parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
      const body = Buffer.concat(parts);
      console.log('Sending edits request, body size:', body.length);

      result = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.openai.com', path: '/v1/images/edits', method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Authorization': `Bearer ${apiKey}`,
            'Content-Length': body.length
          }
        }, (res) => {
          const c = [];
          res.on('data', d => c.push(d));
          res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString() }));
        });
        req.on('error', reject);
        req.write(body);
        req.end();
      });

    } else {
      const payload = JSON.stringify({ model: 'gpt-image-2', prompt: safePrompt, n: 1, size: imageSize });
      console.log('Sending generations request');

      result = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.openai.com', path: '/v1/images/generations', method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'Content-Length': Buffer.byteLength(payload)
          }
        }, (res) => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => resolve({ status: res.statusCode, body: d }));
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
      });
    }

    console.log('OpenAI responded, HTTP status:', result.status);
    const parsed = JSON.parse(result.body);

    if (result.status !== 200) {
      const errMsg = parsed?.error?.message || parsed?.error?.code || `HTTP ${result.status}`;
      console.error('OpenAI error:', errMsg);
      await blobSet(store, jobId, { status: 'failed', error: errMsg });
      return { statusCode: 200, body: JSON.stringify({ jobId }) };
    }

    const b64 = parsed.data?.[0]?.b64_json;
    const url = parsed.data?.[0]?.url;
    const imageUrl = b64 ? `data:image/png;base64,${b64}` : url;

    if (!imageUrl) {
      await blobSet(store, jobId, { status: 'failed', error: 'No image in OpenAI response' });
      return { statusCode: 200, body: JSON.stringify({ jobId }) };
    }

    console.log('Image ready, storing in Blobs');
    await blobSet(store, jobId, { status: 'done', imageUrl });
    console.log('Job complete:', jobId);

    return { statusCode: 200, headers, body: JSON.stringify({ jobId }) };

  } catch (err) {
    console.error('FATAL ERROR:', err.message, err.stack);
    try {
      const store = getBlobStore();
      const blobSet = async (store, key, data) => {
        await store.set(key, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }), {
          metadata: { contentType: 'application/json' }
        });
      };
      await blobSet(store, jobId, { status: 'failed', error: err.message });
    } catch(e) {
      console.error('Failed to store error state:', e.message);
    }
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
