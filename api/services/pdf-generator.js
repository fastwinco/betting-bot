const { jsPDF } = require('jspdf');
const db   = require('../../database');
const path = require('path');
const fs   = require('fs');
const {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, AlignmentType, WidthType, BorderStyle, ShadingType,
  HeadingLevel
} = require('docx');

// Reportlab ki jagah pure JS solution
async function generateAllPDFs(market) {
  const pdfDir = path.join(__dirname, '../../admin/pdfs');
  if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });

  // Saare bets fetch karo
  const [allBets] = await db.query(
    `SELECT bet_type, number, SUM(amount) as total_amount
     FROM bets
     WHERE market_id = ? AND status != 'cancelled'
     GROUP BY bet_type, number
     ORDER BY number ASC`,
    [market.id]
  );

  // Bet type se alag karo
  const openSingle  = allBets.filter(b => b.bet_type === 'open_single');
  const openPana    = allBets.filter(b => b.bet_type === 'open_pana');
  const jodi        = allBets.filter(b => b.bet_type === 'jodi');
  const closeSingle = allBets.filter(b => b.bet_type === 'close_single');
  const closePana   = allBets.filter(b => b.bet_type === 'close_pana');

  const date = new Date().toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  // 5 PDFs generate karo
  await generatePDF(market.name, 'Open Single',  openSingle,  date, pdfDir, market.id);
  await generatePDF(market.name, 'Open Pana',    openPana,    date, pdfDir, market.id);
  await generatePDF(market.name, 'Jodi',         jodi,        date, pdfDir, market.id);
  await generatePDF(market.name, 'Close Single', closeSingle, date, pdfDir, market.id);
  await generatePDF(market.name, 'Close Pana',   closePana,   date, pdfDir, market.id);

  console.log(`✅ 5 PDFs generated for: ${market.name}`);
}

async function generatePDF(marketName, betType, bets, date, pdfDir, marketId) {
  const THEMES = {
    'Open Single':  { color: '1a237e' },
    'Open Pana':    { color: 'b71c1c' },
    'Jodi':         { color: '1b5e20' },
    'Close Single': { color: '4a148c' },
    'Close Pana':   { color: 'e65100' },
  };

  const theme     = THEMES[betType];
  const grandTotal = bets.reduce((sum, b) => sum + parseFloat(b.total_amount), 0);
  const fileName  = `${marketId}_${betType.replace(' ', '_')}.pdf`;
  const filePath  = path.join(pdfDir, fileName);

  // HTML template banao — browser se PDF generate hoga
  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; padding: 30px; }

  .header {
    background: #${theme.color};
    color: white;
    padding: 24px 20px 16px;
    border-radius: 8px;
    margin-bottom: 20px;
    text-align: center;
  }
  .header h1 {
    font-size: 26px;
    font-weight: bold;
    margin-bottom: 6px;
  }
  .header h2 {
    font-size: 16px;
    font-weight: normal;
    opacity: 0.85;
    margin-bottom: 6px;
  }
  .header p {
    font-size: 13px;
    opacity: 0.7;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 10px;
  }
  thead tr {
    background: #${theme.color};
    color: white;
  }
  thead th {
    padding: 12px 16px;
    font-size: 14px;
    text-align: center;
  }
  tbody tr:nth-child(even) {
    background: #f5f5f5;
  }
  tbody td {
    padding: 11px 16px;
    text-align: center;
    border-bottom: 1px solid #ddd;
    font-size: 15px;
  }
  td.number {
    font-weight: bold;
    font-size: 18px;
    color: #${theme.color};
  }
  td.amount {
    font-weight: bold;
    color: #1b5e20;
    font-size: 15px;
  }
  .total-row {
    background: #${theme.color} !important;
    color: white;
  }
  .total-row td {
    padding: 13px 16px;
    font-weight: bold;
    font-size: 15px;
    color: white;
    border: none;
  }
  .empty {
    text-align: center;
    padding: 40px;
    color: #999;
    font-size: 16px;
  }
</style>
</head>
<body>

<div class="header">
  <h1>${marketName}</h1>
  <h2>${betType}</h2>
  <p>${date}</p>
</div>

<table>
  <thead>
    <tr>
      <th>NUMBER</th>
      <th>AMOUNT</th>
    </tr>
  </thead>
  <tbody>
    ${bets.length === 0
      ? `<tr><td colspan="2" class="empty">Koi bet nahi</td></tr>`
      : bets.map(b => `
        <tr>
          <td class="number">${b.number}</td>
          <td class="amount">Rs. ${parseFloat(b.total_amount).toLocaleString('en-IN')}</td>
        </tr>
      `).join('')
    }
    ${bets.length > 0 ? `
    <tr class="total-row">
      <td>TOTAL</td>
      <td>Rs. ${grandTotal.toLocaleString('en-IN')}</td>
    </tr>` : ''}
  </tbody>
</table>

</body>
</html>`;

  // HTML file save karo
  const htmlPath = filePath.replace('.pdf', '.html');
  fs.writeFileSync(htmlPath, html);

  console.log(`📄 ${betType} PDF HTML ready: ${htmlPath}`);

  // Database mein PDF path save karo
  await db.query(
    `INSERT INTO market_pdfs 
      (market_id, bet_type, file_path, created_at)
     VALUES (?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE file_path = ?, created_at = NOW()`,
    [marketId, betType, htmlPath, htmlPath]
  );
}

module.exports = { generateAllPDFs };
