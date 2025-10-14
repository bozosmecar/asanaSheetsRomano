try {
  console.log('postinstall-check: checking for node-fetch...');
  const resolved = require.resolve('node-fetch');
  console.log('postinstall-check: node-fetch resolved at', resolved);
} catch (err) {
  console.error('postinstall-check: node-fetch NOT found:', err && err.message);
}

try {
  const fs = require('fs');
  const entries = fs.readdirSync('node_modules').slice(0, 40);
  console.log('postinstall-check: node_modules top entries:', entries.join(', '));
} catch (e) {
  console.error('postinstall-check: unable to read node_modules:', e && e.message);
}
