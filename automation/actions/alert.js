// Failure alerts. No-ops when the bot token or chat id is missing (the wiped machine
// may not have a token yet). Never throws.
const { redact } = require('./lib/net');

async function sendAlert(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const chat = process.env.TELEGRAM_CHAT_ID || '';
  const body = redact(text).slice(0, 4000);
  if (!token || !chat) {
    console.log('Telegram alert skipped (TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set).');
    console.log(body);
    return false;
  }
  try {
    const res = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: body, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) {
      console.log('Telegram alert failed: HTTP ' + res.status);
      console.log(body);
      return false;
    }
    return true;
  } catch (e) {
    console.log('Telegram alert failed: ' + redact(e && e.message));
    console.log(body);
    return false;
  }
}

if (require.main === module) {
  const text = process.env.ALERT_TEXT || process.argv.slice(2).join('\n') || 'AIFeed Autopilot failed';
  sendAlert(text).then(ok => process.exit(0)).catch(() => process.exit(0));
}

module.exports = { sendAlert };
