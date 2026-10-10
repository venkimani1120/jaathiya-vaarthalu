const cron = require('node-cron');
const db = require('../db/client');
const whatsapp = require('../whatsapp');

// Pulls the configured WhatsApp groups every WHATSAPP_POLL_MINUTES (default 2). Off unless WAHA_URL and WHATSAPP_GROUPS are set.
function start() {
  if (!whatsapp.enabled(whatsapp.config())) return;
  const every = Math.min(59, Math.max(1, Number(process.env.WHATSAPP_POLL_MINUTES) || 2));
  cron.schedule(`*/${every} * * * *`, () => whatsapp.pull({ db }));
  whatsapp.pull({ db });
  console.log(`[whatsapp] pulling ${whatsapp.config().groups.length} group(s) every ${every} min`);
}

module.exports = { start };
