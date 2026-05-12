const db = require('../../database');
require('dotenv').config();

async function declareResult(marketId, resultData) {
  const { single, jodi, openPana, closePana } = resultData;

  const [bets] = await db.query(
    `SELECT b.*, u.whatsapp_number
     FROM bets b JOIN users u ON b.user_id = u.id
     WHERE b.market_id = ? AND b.status = 'pending'`,
    [marketId]
  );

  let totalWinners = 0;
  let totalPayout  = 0;

  let bot = null;
  try {
    const botModule = require('../../bot/index');
    bot = botModule.bot;
  } catch (e) {}

  // ── Process each bet ──────────────────────────
  for (const bet of bets) {
    const isWin = checkWin(bet, { single, jodi, openPana, closePana });

    if (isWin) {
      const winAmount = bet.possible_win;

      await db.query(
        `UPDATE users SET
          wallet_balance = wallet_balance + ?,
          total_won = total_won + ?
         WHERE id = ?`,
        [winAmount, winAmount, bet.user_id]
      );

      await db.query(
        `UPDATE bets SET status = 'won', actual_win = ? WHERE id = ?`,
        [winAmount, bet.id]
      );

      await db.query(
        `INSERT INTO transactions (user_id, type, amount, note, created_at)
         VALUES (?, 'win', ?, ?, NOW())`,
        [bet.user_id, winAmount, `Win: ${bet.bet_type} - ${bet.number}`]
      );

      const [updated] = await db.query(
        'SELECT wallet_balance FROM users WHERE id = ?',
        [bet.user_id]
      );

      // ✅ Only notify WINNERS
      if (bot && bet.whatsapp_number) {
        try {
          await bot.sendMessage(bet.whatsapp_number,
            `🏆 *YOU WON!*\n━━━━━━━━━━━━━━━━\n\n` +
            `🎮 ${bet.bet_type.replace(/_/g,' ').toUpperCase()}: *${bet.number}*\n` +
            `💰 Bet: Rs. ${bet.amount}\n` +
            `🎉 Won: *Rs. ${winAmount}*\n\n` +
            `👛 Balance: *Rs. ${updated[0].wallet_balance}*`,
            { parse_mode: 'Markdown' }
          );
          await new Promise(r => setTimeout(r, 200));
        } catch (e) {}
      }

      totalWinners++;
      totalPayout += parseFloat(winAmount);

    } else {
      // Just update status — NO notification
      await db.query(
        `UPDATE bets SET status = 'lost' WHERE id = ?`,
        [bet.id]
      );
    }
  }

  // ── Broadcast result to ALL users (one message) ──
  if (bot) {
    try {
      const [market] = await db.query(
        'SELECT * FROM markets WHERE id = ?', [marketId]
      );
      const [allUsers] = await db.query(
        `SELECT DISTINCT whatsapp_number FROM users WHERE status = 'active'`
      );

      const openAnk  = single || '—';
      const closeAnk = closePana
        ? String(closePana.split('').reduce((a,b) => a+parseInt(b), 0) % 10)
        : '—';

      // Build result string like: 122-5 or 122-52-255
let resultStr = '';
if (openPana)  resultStr += openPana;
if (openAnk)   resultStr += `-${openAnk}`;
if (jodi)      resultStr += `${openAnk ? '' : '-'}${jodi}`;
if (closePana) resultStr += `-${closePana}`;

const msg =
  `🎲 *${market[0].name}*\n` +
  `*${resultStr}*\n━━━━━━━━━━━━━━━━\n\n` +
  `\n🎯 Place your next bet!`;

      for (const u of allUsers) {
        try {
          await bot.sendMessage(u.whatsapp_number, msg, { parse_mode: 'Markdown' });
          await new Promise(r => setTimeout(r, 200));
        } catch (e) {}
      }
    } catch (e) {
      console.error('Broadcast error:', e.message);
    }
  }

  console.log(`✅ Result done. Winners: ${totalWinners}, Payout: Rs.${totalPayout}`);
  return { totalWinners, totalPayout, totalBets: bets.length };
}

function checkWin(bet, result) {
  const { single, jodi, openPana, closePana } = result;

  switch (bet.bet_type) {
    case 'open_single':
      return single && single === bet.number;

    case 'close_single':
      if (!closePana) return false;
      const closeAnk = String(
        closePana.split('').reduce((a,b) => a+parseInt(b), 0) % 10
      );
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
