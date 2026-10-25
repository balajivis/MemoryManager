'use strict';
module.exports = async function stub() {
  const e = new Error('transcription disabled');
  e.code = 'DISABLED';
  throw e;
};
