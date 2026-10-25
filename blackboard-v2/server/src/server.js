'use strict';
const { createApp } = require('./app');
const { loadConfig } = require('./app');

const config = loadConfig();
const ctx = createApp(config);
ctx.listen(config.port, '127.0.0.1').then(() => {
  console.log(`blackboard-v2 listening on 127.0.0.1:${config.port}`);
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { ctx.db.close(); process.exit(0); });
}
