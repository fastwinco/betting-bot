const db = require('../../database');
require('dotenv').config();

async function declareResult(marketId, resultData) {
  const { single, jodi, openPana, closePana } = resultData;

  // Get all pending bets
  const [bets] = await db.query(
    `SELECT b.*, u.whatsapp_number
     FROM bets b JOIN users u ON b.user_id = u.id
     WHERE b.market_id = ? AND b.status = 'pending'`,
    [marketId]
  );

  let totalWinners = 0;
  let totalPayout  = 0;

  // Get bot instance
  let bot = null;
  try {
    const botModule = require('../../bot/index');
    bot = botModule.bot;
  } catch (e) {}

  for (const bet of bets) {
    const isWin = checkWin(bet, { single, jodi, openPana, closePana });

    if (isWin) {
      const winAmount = bet.possible_win;

      // Credit wallet
      await db.query(
        `UPDATE users SET
          wallet_balance = wallet_balance + ?,
          total_won = total_won + ?
         WHERE id = ?`,
        [winAmount, winAmount, bet.user_id]
      );

      // Update bet
      await db.query(
        `UPDATE bets SET status = 'won', actual_win = ? WHERE id = ?`,
        [winAmount, bet.id]
      );

      // Transaction record
      await db.query(
        `INSERT INTO transactions (user_id, type, amount, note, created_at)
         VALUES (?, 'win', ?, ?, NOW())`,
        [bet.user_id, winAmount, `Win: ${bet.bet_type} - ${bet.number}`]
      );

      // Get new balance
      const [updated] = await db.query(
        'SELECT wallet_balance FROM users WHERE id = ?',
        [bet.user_id]
      );

      // Notify winner on Telegram
      if (bot && bet.whatsapp_number) {
        try {
          await bot.sendMessage(bet.whatsapp_number,
            `🏆 *YOU WON!*\n` +
            `━━━━━━━━━━━━━━━━\n\n` +
            `🎮 ${bet.bet_type.replace(/_/g,' ').toUpperCase()}: *${bet.number}*\n` +
            `💰 Bet: Rs. ${bet.amount}\n` +
            `🎉 Won: *Rs. ${winAmount}*\n\n` +
            `💰 New Balance: *Rs. ${updated[0].wallet_balance}*\n\n` +
            `Keep playing! 🎯`,
            { parse_mode: 'Markdown' }
          );
          await new Promise(r => setTimeout(r, 150));
        } catch (e) {}
      }

      totalWinners++;
      totalPayout += parseFloat(winAmount);

    } else {
      // Update bet as lost
      await db.query(
        `UPDATE bets SET status = 'lost' WHERE id = ?`,
        [bet.id]
      );

      // Notify loser on Telegram
      if (bot && bet.whatsapp_number) {
        try {
          await bot.sendMessage(bet.whatsapp_number,
            `😞 *Result Declared*\n` +
            `━━━━━━━━━━━━━━━━\n\n` +
            `🎮 ${bet.bet_type.replace(/_/g,' ').toUpperCase()}: *${bet.number}*\n` +
            `Result: *${jodi || single}*\n\n` +
            `Better luck next time! 🤞\n` +
            `Place your next bet! 🎯`,
            { parse_mode: 'Markdown' }
          );
          await new Promise(r => setTimeout(r, 150));
        } catch (e) {}
      }
    }
  }

  // Broadcast result to all active users
  if (bot) {
    try {
      const [market] = await db.query(
        'SELECT * FROM markets WHERE id = ?', [marketId]
      );
      const [allUsers] = await db.query(
        `SELECT whatsapp_number FROM users WHERE status = 'active'`
      );

      const msg =
        `🎲 *RESULT DECLARED!*\n` +
        `━━━━━━━━━━━━━━━━\n\n` +
        `🏪 *${market[0].name}*\n\n` +
        `*OPEN*\n` +
        `Pana: *${openPana || '—'}* | Ank: *${single || '—'}*\n\n` +
        `*JODI: ${jodi || '—'}*\n\n` +
        `*CLOSE*\n` +
        `Pana: *${closePana || '—'}*\n\n` +
        `_Place your next bet!_ 🎯`;

      for (const u of allUsers) {
        try {
          await bot.sendMessage(u.whatsapp_number, msg, { parse_mode: 'Markdown' });
          await new Promise(r => setTimeout(r, 150));
        } catch (e) {}
      }
    } catch (e) {
      console.error('Broadcast error:', e.message);
    }
  }

  console.log(`✅ Result declared. Winners: ${totalWinners}, Payout: Rs.${totalPayout}`);
  return { totalWinners, totalPayout, totalBets: bets.length };
}

function checkWin(bet, result) {
  const { single, jodi, openPana, closePana } = result;

  switch (bet.bet_type) {
    case 'open_single':
      return single && single === bet.number;

    case 'close_single':
      if (!closePana) return false;
      const closeAnk = String(closePana.split('').reduce((a,b) => a + parseInt(b), 0) % 10);
      return closeAnk === bet.number;

    case 'jodi':
      return jodi && jodi === bet.number;

    case 'open_pana':
      return openPana && openPana === bet.number;

    case 'close_pana':
      return closePana && closePana === bet.number;

    default:
      return false;
  }
}

module.exports = { declareResult };
