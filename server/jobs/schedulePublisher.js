const cron = require('node-cron');
const db = require('../db/client');

const publishDue = db.prepare(`
  UPDATE articles
  SET status = 'published', updated_at = CURRENT_TIMESTAMP
  WHERE status = 'scheduled' AND published_at <= datetime('now')
`);

function start() {
  // every minute
  cron.schedule('* * * * *', () => {
    const { changes } = publishDue.run();
    if (changes) console.log(`[scheduler] published ${changes} article(s)`);
    // TODO: when changes > 0, trigger static page rebuild / cache purge
  });
}

module.exports = { start };
