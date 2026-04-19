const Tesseract = require('tesseract.js');
const sharp     = require('sharp');
const { parseSMS }        = require('./sms-parser');
const { verifyAndCredit } = require('./verification');
require('dotenv').config();

async function processScreenshot(buffer, phone, depositAmount, sock) {
  try {
    console.log(`📷 Screenshot processing for: ${phone}`);

    // ── STEP 1: Image enhance karo ────────────────────────
    const enhanced = await enhanceImage(buffer);

    // ── STEP 2: OCR run karo ──────────────────────────────
    const { data: { text } } = await Tesseract.recognize(
      enhanced,
      'eng',
      { logger: () => {} }
    );

    console.log(`📝 OCR text:\n${text}`);

    if (!text || text.trim().length < 10) {
      await sendMsg(sock, phone,
        `❌ *Screenshot read nahi hua*\n\n` +
        `Clear aur full screenshot bhejo.\n` +
        `_Ya UTR number manually type karo_`
      );
      return;
    }

    // ── STEP 3: Data extract karo ─────────────────────────
    const extracted = parseSMS(text);

    if (!extracted) {
      await sendMsg(sock, phone,
        `❌ *Payment details nahi mile*\n\n` +
        `Screenshot mein UTR aur amount\n` +
        `clearly dikhna chahiye.\n\n` +
        `_Ya UTR manually type karo_`
      );
      return;
    }

    console.log(`💰 Extracted: UTR=${extracted.utr}, Amount=${extracted.amount}`);

    // ── STEP 4: Amount match check ────────────────────────
    if (depositAmount) {
      const diff = Math.abs(extracted.amount - depositAmount);
      if (diff > 1) {
        await sendMsg(sock, phone,
          `❌ *Amount match nahi hua!*\n\n` +
          `Expected: Rs. ${depositAmount}\n` +
          `Screenshot mein: Rs. ${extracted.amount}\n\n` +
          `Sahi screenshot bhejo ya\n` +
          `support se contact karo.`
        );

        // Admin ko alert
        await alertAdmin(
          phone, depositAmount,
          extracted.amount, extracted.utr, sock
        );
        return;
      }
    }

    // ── STEP 5: Fake detection ────────────────────────────
    const fakeCheck = await detectFake(buffer, extracted, depositAmount);

    if (fakeCheck.isFake) {
      await sendMsg(sock, phone,
        `⚠️ *Screenshot verify nahi hua*\n\n` +
        `Reason: ${fakeCheck.reason}\n\n` +
        `Original screenshot bhejo ya\n` +
        `support se contact karo.`
      );

      await alertAdmin(
        phone, depositAmount,
        extracted.amount, extracted.utr,
        sock, fakeCheck.reason
      );
      return;
    }

    // ── STEP 6: Verify aur credit karo ───────────────────
    await sendMsg(sock, phone,
      `🔍 *Verifying...*\n` +
      `UTR: ${extracted.utr}\n` +
      `Amount: Rs. ${extracted.amount}\n\n` +
      `_Thoda wait karo..._`
    );

    await verifyAndCredit(extracted, 'screenshot', phone, sock);

  } catch (err) {
    console.error('OCR error:', err);
    await sendMsg(sock, phone,
      `❌ Screenshot process mein error aaya.\n` +
      `Dobara try karo ya UTR type karo.`
    );
  }
}

// ── IMAGE ENHANCE ─────────────────────────────────────────
async function enhanceImage(buffer) {
  return await sharp(buffer)
    .greyscale()
    .normalize()
    .sharpen()
    .resize(1400, null, { withoutEnlargement: false })
    .toBuffer();
}

// ── FAKE DETECTION ────────────────────────────────────────
async function detectFake(buffer, extracted, expectedAmount) {
  try {
    // Check 1: Image metadata
    const metadata = await sharp(buffer).metadata();

    // Photoshop ya editing software check
    const exifData = JSON.stringify(metadata.exif || '').toLowerCase();
    if (
      exifData.includes('photoshop') ||
      exifData.includes('gimp')      ||
      exifData.includes('paint')
    ) {
      return { isFake: true, reason: 'Image edited software detected' };
    }

    // Check 2: Image size bahut chota hai
    if (metadata.width < 200 || metadata.height < 200) {
      return { isFake: true, reason: 'Image size too small' };
    }

    // Check 3: Amount bahut zyada hai
    if (extracted.amount > 100000) {
      return { isFake: true, reason: 'Amount suspiciously large' };
    }

    return { isFake: false };

  } catch (err) {
    // Detection fail hone par allow karo
    return { isFake: false };
  }
}

// ── ADMIN ALERT ───────────────────────────────────────────
async function alertAdmin(phone, expected, got, utr, sock, reason) {
  const adminPhone = process.env.ADMIN_PHONE;
  if (!adminPhone || !sock) return;

  const adminJid = `${adminPhone}@s.whatsapp.net`;
  await sock.sendMessage(adminJid, {
    text:
      `⚠️ *Suspicious Screenshot!*\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `👤 User: ${phone}\n` +
      `💰 Expected: Rs. ${expected}\n` +
      `📷 Got: Rs. ${got}\n` +
      `🔢 UTR: ${utr}\n` +
      `❓ Reason: ${reason || 'Amount mismatch'}\n\n` +
      `Admin panel check karo!`
  });
}

// ── HELPER ────────────────────────────────────────────────
async function sendMsg(sock, phone, text) {
  const jid = `${phone}@s.whatsapp.net`;
  await sock.sendMessage(jid, { text });
}

module.exports = { processScreenshot };
