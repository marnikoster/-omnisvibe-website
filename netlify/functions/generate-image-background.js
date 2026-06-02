const { getStore } = require('@netlify/blobs');
const https = require('https');

const getBlobStore = () => getStore({
  name: 'katachi-jobs',
  siteID: process.env.NETLIFY_SITE_ID,
  token: process.env.NETLIFY_AUTH_TOKEN
});

const blobSet = async (store, key, data) => {
  await store.set(key, JSON.stringify(data), {
    metadata: { contentType: 'application/json' }
  });
};

exports.handler = async function(event) {
  let jobId;
  try {
    const { jobId: jid, prompt, size, apiKey, refs } = JSON.parse(event.body);
    jobId = jid;

    const store = getBlobStore();
    await blobSet(store, jobId, { status: 'processing', startedAt: Date.now() });

    const safePrompt = prompt.substring(0, 3800);
    let imageSize = '1024x1024';
    if (size === '1536x1024' || size === '16:9') imageSize = '1536x1024';
    if (size === '1024x1536' || size === '9:16') imageSize = '1024x1536';

    const activeRefs = Array.isArray(refs) ? refs.filter(Boolean).slice(0, 2) : [];
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

      result = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.openai.com', path: '/v1/images/edits', method: 'POST',
          headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Authorization': `Bearer ${apiKey}`, 'Content-Length': body.length }
        }, (res) => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString() })); });
        req.on('error', reject); req.write(body); req.end();
      });
    } else {
      const payload = JSON.stringify({ model: 'gpt-image-2', prompt: safePrompt, n: 1, size: imageSize });
      result = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.openai.com', path: '/v1/images/generations', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Content-Length': Buffer.byteLength(payload) }
        }, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d })); });
        req.on('error', reject); req.write(payload); req.end();
      });
    }

    const parsed = JSON.parse(result.body);
    if (result.status !== 200) {
      const errMsg = parsed?.error?.message || parsed?.error?.code || `HTTP ${result.status}`;
      await blobSet(store, jobId, { status: 'error', error: errMsg, completedAt: Date.now() });
      return { statusCode: 200, body: 'error stored' };
    }

    const b64 = parsed.data?.[0]?.b64_json;
    const url = parsed.data?.[0]?.url;
    await blobSet(store, jobId, {
      status: 'done',
      imageUrl: b64 ? `data:image/png;base64,${b64}` : url,
      completedAt: Date.now()
    });

    return { statusCode: 200, body: 'done' };

  } catch (err) {
    console.error('BACKGROUND ERROR:', err.message, err.stack);
    if (jobId) {
      try {
        const store = getBlobStore();
        await blobSet(store, jobId, { status: 'error', error: err.message, completedAt: Date.now() });
      } catch(e) { console.error('Failed to store error state:', e.message); }
    }
    return { statusCode: 500, body: err.message };
  }
};
