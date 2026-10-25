'use strict';
const fs = require('node:fs');

module.exports = async function deepgram(filePath) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error('DEEPGRAM_API_KEY is not set');
  const res = await fetch('https://api.deepgram.com/v1/listen?smart_format=true', {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/webm' },
    body: fs.readFileSync(filePath),
  });
  if (!res.ok) throw new Error(`deepgram transcription failed: HTTP ${res.status}`);
  const json = await res.json();
  const alt = json && json.results && json.results.channels && json.results.channels[0] &&
    json.results.channels[0].alternatives && json.results.channels[0].alternatives[0];
  return String((alt && alt.transcript) || '');
};
