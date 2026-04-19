const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const { handleMessage } = require('./handler');
require('dotenv').config();

// Global sock — dusri files use kar sakti hain
let sock;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./bot/sessions');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: 'silent' }),
    browser: ['BettingBot', 'Chrome', '1.0'],
  });

  // Creds save karo
  sock.ev.on('creds.update', saveCreds);

  // Connection status
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('📱 QR Code aaya — scan karo WhatsApp se!');
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;

      console.log('❌ Connection band hua. Code:', code);

      if (shouldReconnect) {
        console.log('🔄 Reconnect ho raha hai...');
        setTimeout(startBot, 5000);
      } else {
        console.log('🚫 Logged out — sessions delete karo aur dobara shuru karo.');
      }
    }

    if (connection === 'open') {
      console.log('✅ WhatsApp Bot connected!');
    }
  });

  // Messages handle karo
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.key.fromMe && msg.message) {
        try {
          await handleMessage(sock, msg);
        } catch (err) {
          console.error('Message handle error:', err);
        }
      }
    }
  });
}

function getSock() {
  return sock;
}

startBot();
module.exports = { getSock };
