'use strict';
// node src/cli.js create-admin <email> <name>
// node src/cli.js unlock <email>
// node src/cli.js import-logs <path to blackboard dir>
const { loadConfig } = require('./app');
const fs = require('node:fs');
const { openDb } = require('./db');
const { createInvite } = require('./auth');

const [cmd, ...args] = process.argv.slice(2);
const config = loadConfig();
fs.mkdirSync(config.dataDir, { recursive: true });
const db = openDb(config.dbPath);
try {
  if (cmd === 'create-admin' && args.length === 2) {
    console.log(createInvite(db, config, { email: args[0], name: args[1], role: 'admin' }).url);
  } else if (cmd === 'unlock' && args.length === 1) {
    const em = args[0].trim().toLowerCase();
    const n = db.prepare('DELETE FROM login_fails WHERE email = ?').run(em).changes;
    console.log(`unlocked ${em} (${n} lockout record${n === 1 ? '' : 's'} cleared)`);
  } else if (cmd === 'import-logs' && args.length === 1) {
    const { importData } = require('./bb');
    console.log(JSON.stringify(importData(db, require('./importlogs').parseDir(args[0]))));
  } else {
    console.error('usage: node src/cli.js create-admin <email> <name>\n       node src/cli.js unlock <email>\n       node src/cli.js import-logs <blackboard dir>');
    process.exitCode = 1;
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  db.close();
}
