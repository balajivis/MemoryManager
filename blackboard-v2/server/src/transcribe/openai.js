'use strict';
const fs = require('node:fs');

module.exports = async function openai(filePath) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  const form = new FormData();
  form.append('model', 'whisper-1');
  form.append('file', new Blob([fs.readFileSync(filePath)], { type: 'audio/webm' }), 'audio.webm');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) throw new Error(`openai transcription failed: HTTP ${res.status}`);
  const json = await res.json();
  return String(json.text || '');
};
