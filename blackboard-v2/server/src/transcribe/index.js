'use strict';
// transcribe(filePath) -> string. Provider from TRANSCRIBE_PROVIDER (stub|openai|deepgram).
// The stub throws an error with code 'DISABLED' (no network).
const providers = {
  stub: () => require('./stub'),
  openai: () => require('./openai'),
  deepgram: () => require('./deepgram'),
};

async function transcribe(filePath) {
  const name = (process.env.TRANSCRIBE_PROVIDER || 'stub').toLowerCase();
  if (!providers[name]) throw new Error(`unknown TRANSCRIBE_PROVIDER: ${name}`);
  return providers[name]()(filePath);
}

module.exports = { transcribe };
