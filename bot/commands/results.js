const db = require('../../database');

async function handle(sock, jid) {
  // Last 5 resulted markets fetch karo
  const [markets] = await db.query(
    `SELECT * FROM markets 
     WHERE status = 'resulted'
     ORDER BY resulted_at DESC
     LIMIT 5`
  );

  if (!markets.length) {
    await sock.sendMessage(jid, {
      text:
        `📊 *Results*\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `Abhi tak koi result declare\n` +
        `nahi hua hai.\n\n` +
        `_Thodi der baad dobara check karo_`
    });
    return;
  }

  let msg =
    `📊 *Latest Results*\n` +
    `━━━━━━━━━━━━━━━━━━\n\n`;

  markets.forEach((m) => {
    const date = new Date(m.resulted_at).toLocaleDateString('en-IN', {
      day:   'numeric',
      month: 'short',
      year:  'numeric'
    });

    msg +=
      `🏪 *${m.name}*\n` +
      `📅 ${date}\n\n`;

    // Open result
    if (m.result_open_pana) {
      const openSum = digitSum(m.result_open_pana);
      msg +=
        `*OPEN*\n` +
        `Pana: *${m.result_open_pana}*\n` +
        `Single: *${openSum}*\n\n`;
    }

    // Jodi
    if (m.result_jodi) {
      msg += `*JODI: ${m.result_jodi}*\n\n`;
    }

    // Close result
    if (m.result_close_pana) {
      const closeSum = digitSum(m.result_close_pana);
      msg +=
        `*CLOSE*\n` +
        `Pana: *${m.result_close_pana}*\n` +
        `Single: *${closeSum}*\n`;
    }

    msg += `\n━━━━━━━━━━━━━━━━━━\n\n`;
  });

  msg += `_BET bhejo nayi bet lagane ke liye_ 🎯`;

  await sock.sendMessage(jid, { text: msg });
}

// Pana ke digits ka sum nikalo (last digit)
function digitSum(pana) {
  if (!pana) return '-';
  const sum = pana.split('').reduce((a, b) => a + parseInt(b), 0);
  return sum % 10;
}

module.exports = { handle };
