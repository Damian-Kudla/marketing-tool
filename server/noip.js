// No-IP Updater Script (mit noip-client)
// Installiere vorher: npm install noip-client
require('dotenv').config({ path: '../.env' });
const NoIP = require('noip-client');
const { DateTime } = require('luxon');

const hostname = process.env.NOIP_HOSTNAME;
const username = process.env.NOIP_USERNAME;
const password = process.env.NOIP_PASSWORD;

if (!hostname || !username || !password) {
  console.error('No-IP Credentials fehlen! Bitte NOIP_HOSTNAME, NOIP_USERNAME und NOIP_PASSWORD in der .env Datei setzen.');
  process.exit(1);
}

const client = new NoIP({ hostname, username, password });

function getBerlinTimestamp() {
  return DateTime.now().setZone('Europe/Berlin').toISO();
}

async function updateLoop() {
  try {
    await client.update();
    console.log(`[${getBerlinTimestamp()}] No-IP Update erfolgreich für Host: ${hostname}`);
  } catch (err) {
    console.error(`[${getBerlinTimestamp()}] Fehler beim No-IP Update:`, err);
  }
}

console.log(`No-IP Updater läuft für Host: ${hostname}`);
updateLoop();
setInterval(updateLoop, 5 * 60 * 1000); // alle 5 Minuten
