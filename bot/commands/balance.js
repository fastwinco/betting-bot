const db = require('../../database');

async function handle(sock, jid, user) {
  // Latest balance fetch karo
  const [rows] = await db.query(
    'SELECT * FROM users WHERE id = ?', [user.id]
  );
  const u = rows[0];

  // Total bets aur wins
  const [betStats] = await db.query(
    `SELECT 
      COUNT(*) as total_bets,
      COALESCE(SUM(amount), 0) as total_bet_amount,
      COALESCE(SUM(actual_win), 0) as total_won,
      COUNT(CASE WHEN status = 'won' THEN 1 END) as won_count,
      COUNT(CASE WHEN status = 'lost' THEN 1 END) as lost_count,
      COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count
    FROM bets WHERE user_id = ?`,
    [u.id]
  );

  const stats = betStats[0];

  await sock.sendMessage(jid, {
    text:
      `👛 *Aapka Wallet*\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `💰 Balance: *Rs. ${u.wallet_balance}*\n\n` +
      `📊 *Betting Stats:*\n` +
      `• Total Bets: ${stats.total_bets}\n` +
      `• Total Lagaya: Rs. ${stats.total_bet_amount}\n` +
      `• Total Jeeta: Rs. ${stats.total_won}\n` +
      `• ✅ Jeet: ${stats.won_count}\n` +
      `• ❌ Haar: ${stats.lost_count}\n` +
      `• ⏳ Pending: ${stats.pending_count}\n\n` +
      `_MENU bhejo wapas jaane ke liye_`
  });
}

module.exports = { handle };
