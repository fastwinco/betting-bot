function parseSMS(smsBody) {
  if (!smsBody) return null;

  const text = smsBody.toLowerCase();

  // Sirf credit SMS process karo
  if (!isCreditSMS(text)) {
    console.log('⚠️ Debit SMS ignore kiya');
    return null;
  }

  const amount = extractAmount(smsBody);
  const utr    = extractUTR(smsBody);

  if (!amount) {
    console.log('⚠️ Amount nahi mila');
    return null;
  }

  if (!utr) {
    console.log('⚠️ UTR nahi mila');
    return null;
  }

  return { utr, amount, type: 'credit', raw: smsBody };
}

// ── CREDIT CHECK ──────────────────────────────────────────
function isCreditSMS(text) {
  const creditWords = [
    'credited', 'received', 'deposited',
    'added', 'credit', 'upi credit',
    'received rs', 'received inr',
    'money received', 'amount received',
    'paid to you', 'transferred to you'
  ];

  const debitWords = [
    'debited', 'deducted', 'withdrawn',
    'paid', 'sent', 'transferred from',
    'purchase', 'payment done'
  ];

  // Debit words hain to ignore karo
  const hasDebit = debitWords.some(w => text.includes(w));
  if (hasDebit) return false;

  // Credit words hain to process karo
  return creditWords.some(w => text.includes(w));
}

// ── AMOUNT EXTRACT ────────────────────────────────────────
function extractAmount(text) {
  const patterns = [
    // Rs.500 ya Rs 500
    /(?:rs\.?|inr|₹)\s*(\d+(?:,\d+)*(?:\.\d{1,2})?)/gi,
    // 500 Rs ya 500 INR
    /(\d+(?:,\d+)*(?:\.\d{1,2})?)\s*(?:rs\.?|inr|₹)/gi,
    // amount of Rs 500
    /amount\s+(?:of\s+)?(?:rs\.?|inr|₹)?\s*(\d+(?:,\d+)*(?:\.\d{1,2})?)/gi,
    // credited with 500
    /credited\s+(?:with\s+)?(?:rs\.?|inr|₹)?\s*(\d+(?:,\d+)*(?:\.\d{1,2})?)/gi,
    // received 500
    /received\s+(?:rs\.?|inr|₹)?\s*(\d+(?:,\d+)*(?:\.\d{1,2})?)/gi,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match) {
      const amount = parseFloat(match[1].replace(/,/g, ''));
      // Valid amount check
      if (amount >= 1 && amount <= 1000000) {
        return amount;
      }
    }
  }
  return null;
}

// ── UTR EXTRACT ───────────────────────────────────────────
function extractUTR(text) {
  const patterns = [
    // UPI Ref: 426789123456
    /upi\s*ref(?:erence)?\s*(?:no\.?|num\.?|#|:)?\s*([a-z0-9]{10,22})/gi,
    // UTR No: T2401011234567890
    /utr\s*(?:no\.?|num\.?|#|:)?\s*([a-z0-9]{10,22})/gi,
    // Ref No: 426789123456
    /ref(?:erence)?\s*(?:no\.?|num\.?|#|:)?\s*([a-z0-9]{10,22})/gi,
    // Txn ID: 426789123456
    /txn\s*(?:id|no\.?|#|:)?\s*([a-z0-9]{10,22})/gi,
    // Transaction ID
    /trans(?:action)?\s*(?:id|no\.?|#|:)?\s*([a-z0-9]{10,22})/gi,
    // IMPS/NEFT Ref
    /(?:imps|neft|rtgs)\s*ref\s*(?:no\.?|#|:)?\s*([a-z0-9]{10
