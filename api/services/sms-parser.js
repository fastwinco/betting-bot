function parseSMS(smsBody) {
  if (!smsBody) return null;

  const text = smsBody.toLowerCase();

  if (!isCreditSMS(text)) {
    console.log('Debit SMS ignore kiya');
    return null;
  }

  const amount = extractAmount(smsBody);
  const utr    = extractUTR(smsBody);

  if (!amount) { console.log('Amount nahi mila'); return null; }
  if (!utr)    { console.log('UTR nahi mila');    return null; }

  return { utr, amount, type: 'credit', raw: smsBody };
}

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
    'sent', 'purchase', 'payment done'
  ];

  const hasDebit = debitWords.some(function(w) { return text.includes(w); });
  if (hasDebit) return false;

  return creditWords.some(function(w) { return text.includes(w); });
}

function extractAmount(text) {
  var patterns = [
    /(?:rs\.?|inr|\u20b9)\s*(\d+(?:,\d+)*(?:\.\d{1,2})?)/gi,
    /(\d+(?:,\d+)*(?:\.\d{1,2})?)\s*(?:rs\.?|inr)/gi,
    /amount\s+(?:of\s+)?(?:rs\.?|inr)?\s*(\d+(?:,\d+)*(?:\.\d{1,2})?)/gi,
    /credited\s+(?:with\s+)?(?:rs\.?|inr)?\s*(\d+(?:,\d+)*(?:\.\d{1,2})?)/gi,
    /received\s+(?:rs\.?|inr)?\s*(\d+(?:,\d+)*(?:\.\d{1,2})?)/gi,
  ];

  for (var i = 0; i < patterns.length; i++) {
    patterns[i].lastIndex = 0;
    var match = patterns[i].exec(text);
    if (match) {
      var amount = parseFloat(match[1].replace(/,/g, ''));
      if (amount >= 1 && amount <= 1000000) return amount;
    }
  }
  return null;
}

function extractUTR(text) {
  var patterns = [
    /upi\s*ref\s*(?:no|num|#|:)?\s*([a-z0-9]{10,22})/gi,
    /utr\s*(?:no|num|#|:)?\s*([a-z0-9]{10,22})/gi,
    /ref\s*(?:no|num|#|:)?\s*([a-z0-9]{10,22})/gi,
    /txn\s*(?:id|no|#|:)?\s*([a-z0-9]{10,22})/gi,
    /transaction\s*(?:id|no|#|:)?\s*([a-z0-9]{10,22})/gi,
    /\b([0-9]{12})\b/g,
  ];

  for (var i = 0; i < patterns.length; i++) {
    patterns[i].lastIndex = 0;
    var match = patterns[i].exec(text);
    if (match) return match[1].toUpperCase();
  }
  return null;
}

module.exports = { parseSMS };
