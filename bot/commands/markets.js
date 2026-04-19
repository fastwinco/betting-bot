const db = require('../../database');

async function handle(sock, jid) {
  // Active markets fetch karo
  const [markets] = await db.query(
    `SELECT * FROM markets 
     WHERE status IN ('open', 'closed') 
     ORDER BY open_time ASC`
  );

  if (!markets.length) {
    await sock.sendMessage(jid, {
      text:
        `⏰ *Abhi koi market open nahi hai*\n\n` +
        `_Thodi der baad dobara check karo_\n\n` +
        `RESULTS bhejo latest results dekhne ke liye`
    });
    return;
  }

  let msg =
    `🕐 *Active Markets*\n` +
    `━━━━━━━━━━━━━━━━━━\n\n`;

  markets.forEach((m, i) => {
    const status =
      m.status === 'open'
        ? '🟢 Open'
        : '🔴 Closed';

    msg +=
      `${i + 1}. *${m.name}*\n` +
      `   Status: ${status}\n` +
      `   Open:  ${formatTime(m.open_time)}\n` +
      `   Close: ${formatTime(m.close_time)}\n` +
      `   Result: ${formatTime(m.result_time)}\n\n`;
  });

  msg +=
    `━━━━━━━━━━━━━━━━━━\n` +
    `Bet lagane ke liye *BET* bhejo 🎯`;

  await sock.sendMessage(jid, { text: msg });
}

function formatTime(timeStr) {
  if (!timeStr) return 'N/A';
  // HH:MM:SS ko 12 hour format mein convert karo
  const [hours, minutes] = timeStr.split(':');
  const h = parseInt(hours);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12  = h % 12 || 12;
  return `${h12}:${minutes} ${ampm}`;
}

module.exports = { handle };
