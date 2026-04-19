const db = require('../../database');

async function handle(sock, jid, user) {
  // Last 10 bets fetch karo
  const [bets] = await db.query(
    `SELECT b.*, m.name as market_name 
     FROM bets b
     JOIN markets m ON b.market_id = m.id
     WHERE b.user_id = ?
     ORDER BY b.placed_at DESC
     LIMIT 10`,
    [user.id]
  );

  if (!bets.length) {
    await sock.sendMessage(jid, {
      text:
        `📜 *Bet History*\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `Abhi tak koi bet nahi lagi.\n\n` +
        `_BET bhejo pehli bet lagane ke liye_ 🎯`
    });
    return;
  }

  // Stats
  const [stats] = await db.query(
    `SELECT
      COUNT(*) as total,
      COALESCE(SUM(amount), 0) as total_amount,
      COALESCE(SUM(actual_win), 0) as total_won,
      COUNT(CASE WHEN status = 'won'     THEN 1 END) as won,
      COUNT(CASE WHEN status = 'lost'    THEN 1 END) as lost,
      COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending
     FROM bets WHERE user_id = ?`,
    [user.id]
  );

  const s = stats[0];

  let msg =
    `📜 *Bet History* (Last 10)\n` +
    `━━━━━━━━━━━━━━━━━━\n\n`;

  bets.forEach((bet, i) => {
    const statusIcon =
      bet.status === 'won'     ? '✅' :
      bet.status === 'lost'    ? '❌' :
      bet.status === 'pending' ? '⏳' : '🚫';

    const betLabel =
      bet.bet_type === 'open_single'  ? 'Open Single'  :
      bet.bet_type === 'open_pana'    ? 'Open Pana'    :
      bet.bet_type === 'jodi'         ? 'Jodi'         :
      bet.bet_type === 'close_single' ? 'Close Single' :
      bet.bet_type === 'close_pana'   ? 'Close Pana'   : bet.bet_type;

    const winText =
      bet.status === 'won'
        ? ` → *Jeete Rs. ${bet.actual_win}*`
        : '';

    msg +=
      `${statusIcon} *${betLabel}* — ${bet.number}\n` +
      `   Rs. ${bet.amount} | ${bet.market_name}${winText}\n\n`;
  });

  msg +=
    `━━━━━━━━━━━━━━━━━━\n` +
    `📊 *Total Stats:*\n` +
    `• Kul Bets: ${s.total}\n` +
    `• Kul Lagaya: Rs. ${s.total_amount}\n` +
    `• Kul Jeeta: Rs. ${s.total_won}\n` +
    `• ✅ Jeet: ${s.won}  ` +
    `❌ Haar: ${s.lost}  ` +
    `⏳ Pending: ${s.pending}`;

  await sock.sendMessage(jid, { text: msg });
}

module.exports = { handle };
