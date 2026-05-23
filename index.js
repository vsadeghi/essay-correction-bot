/**
 * ASI Bot (PTE Essay Correction) — Final version
 * - Webhook (Render)
 * - Whitelist from Google Sheet
 * - Admins bypass whitelist
 * - Usage limit stored in JSONBin as: { users: { [userId]: { count: number } } }
 * - Admin credit commands:
 *    /credit_status <userId>
 *    /credit_reset <userId>
 *    /credit_add <userId> <n>   (reduces used count by n, min 0)
 */

require('dotenv').config();

const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

const app = express();
app.use(express.json());

// ---------- Config ----------
const port = process.env.PORT || 3000;

const ESSAY_LIMIT = Number(process.env.ESSAY_LIMIT || 8);

// Admin IDs
const ADMIN_IDS = new Set(["97660313", "108265666", "6190801722"]);
const isAdmin = (id) => ADMIN_IDS.has(String(id));

// Google Sheet whitelist
const SPREADSHEET_ID = '1lhogjschT9dDW8yZhaSdmhSzvVVtQ7Ih8ijn-mcwt34';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv`;

// ---------- Clients ----------
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { webHook: true });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ---------- Webhook / Routes ----------
app.get('/', (req, res) => res.send('Bot is running!'));

bot.setWebHook(`https://${process.env.RENDER_EXTERNAL_HOSTNAME}/bot${process.env.TELEGRAM_TOKEN}`);

app.post(`/bot${process.env.TELEGRAM_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.listen(port, () => console.log(`Server is listening on port ${port}`));

// ---------- Whitelist Sync ----------
let allowedUserIds = new Set();

async function syncWhitelist() {
  try {
    const response = await axios.get(SHEET_URL, { timeout: 15000 });
    const ids = response.data
      .split('\n')
      .map(r => r.split(',')[0].replace(/"/g, '').trim())
      .filter(v => /^\d+$/.test(v));

    allowedUserIds = new Set(ids);
    console.log(`Whitelist synced: ${allowedUserIds.size} users`);
  } catch (err) {
    console.error('Whitelist sync failed:', err.message || err);
  }
}

syncWhitelist();
setInterval(syncWhitelist, 60 * 60 * 1000);

// ---------- JSONBin DB (DO NOT change schema) ----------
async function getDB() {
  const res = await axios.get(
    `https://api.jsonbin.io/v3/b/${process.env.JSONBIN_ID}/latest`,
    { headers: { 'X-Master-Key': process.env.JSONBIN_KEY }, timeout: 15000 }
  );
  return res.data.record || { users: {} };
}

async function saveDB(data) {
  await axios.put(
    `https://api.jsonbin.io/v3/b/${process.env.JSONBIN_ID}`,
    data,
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': process.env.JSONBIN_KEY
      },
      timeout: 15000
    }
  );
}

function ensureUser(db, userId) {
  if (!db.users) db.users = {};
  if (!db.users[userId]) db.users[userId] = { count: 0 };
  if (typeof db.users[userId].count !== 'number') db.users[userId].count = Number(db.users[userId].count || 0);
  return db;
}

// ---------- Prompt ----------
const SYSTEM_PROMPT = `تو یک استاد مهربان و متخصص آزمون PTE هستی که از متد ASI v3.3 استفاده می‌کنی. دانش‌آموز فارسی‌زبان است.

[قوانین حیاتی PTE]
۱. تمپلت‌ها: جملات پیش‌فرض تمپلت را به عنوان "بخش‌های صحیح و استاندارد" بپذیر و هیچ‌گونه اصلاح یا پیشنهادی برای آن‌ها نده. 
۲. هدف تصحیح: تمرکز فقط بر روی جملات تولیدی دانش‌آموز (جاهای خالی تمپلت).
۳. سطح زبانی: پیشنهادات ارتقا باید در سطح نمره 6.5 تا 7 باشند؛ از کلمات بیش از حد پیچیده پرهیز کن تا دانش‌آموز بتواند آن‌ها را یاد بگیرد.
۴. لحن: دوستانه، دلگرم‌کننده و در جهت "تأیید و ارتقا".
۵. فرمت تلگرام: به هیچ وجه از جداول (|) استفاده نکن. همه چیز را با ایموجی و لیست‌بندی مرتب کن.

وقتی دانش‌آموز مقاله فرستاد، دقیقاً طبق این مراحل عمل کن:

STEP 1 – تحلیل ساختاری (به فارسی)
الف) نوع مقاله (Cause–Effect / Problem–Solution / Advantage–Disadvantage / Discuss Both Views).
ب) آیا موضوع به درستی درک شده است؟
ج) بررسی ساختار (Introduction, Body 1, Body 2, Conclusion). نقاط قوت و موارد ساختاری را ذکر کن.

STEP 2 – تحلیل جمله به جمله (فقط جملات دست‌نویس دانش‌آموز)
برای هر جمله تولیدی دانش‌آموز بنویس:
🔹 Original: [جمله اصلی دانش‌آموز]
💬 تحلیل: [توضیح دوستانه درباره گرامر، واژگان یا منطق جمله]
✍️ اصلاح پیشنهادی: [بازنویسی جمله به صورت طبیعی و با نمره 6.5-7]

STEP 3 – بازخورد نهایی استاد
خلاصه‌ای از نقاط قوت، نقاط قابل بهبود و نمره تخمینی (در مقیاس PTE).

STEP 4 – بانک عبارات کاربردی (Noun Phrase Bank)
۱۰ ترکیب اسمی یا عبارات کاربردی مرتبط با موضوع مقاله برای تقویت واژگان (Noun Phrase - معنی فارسی).

STEP 5 – یادگیری گرامر
بر اساس خطاهای دانش‌آموز، ۴ نکته گرامری را به صورت ساده و با یک مثال توضیح بده.

STEP 6 – مدل مقاله استاندارد (بر اساس تمپلت)
یک مقاله بهبودیافته (تا ۲۷۰ کلمه) با استفاده از الگوی زیر بنویس:

[مقدمه ۴۰-۵۰ کلمه]
【Topic】 has become important in 【ContextNP】.
It affects 【GroupNP】 by 【ImpactNP1】 and 【ImpactNP2】.
This essay will discuss this topic.

[بدنه ۱ (۹۰-۱۰۰ کلمه)]
One main reason is 【PointNP1】.
This is because 【ReasonNP】.
For example, 【ExampleNP】.
Therefore, 【Mini-Conclusion】.

[بدنه ۲ (۹۰-۱۰۰ کلمه)]
On the other hand, another important point is 【PointNP2】.
This happens because 【ReasonNP】.
For instance, 【ExampleNP】.
Therefore, 【Mini-Conclusion】.

[نتیجه‌گیری ۲۵-۳۵ کلمه]
In conclusion, 【Topic】 has different aspects.
To improve outcomes, 【ActionNP1】 and 【ActionNP2】 should be prioritized in society.`;

// ---------- Helpers ----------
const inFlight = new Set();

function splitTelegram(text, chunkSize = 3000) {
  const chunks = text.match(new RegExp(`.{1,${chunkSize}}`, 'gs'));
  return chunks || [text];
}

async function sendLongMessage(chatId, text) {
  for (const part of splitTelegram(text, 3000)) {
    await bot.sendMessage(chatId, part);
  }
}

// ---------- Admin Commands ----------
bot.onText(/\/credit_status (\d+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;

  const targetUserId = String(match[1]);

  try {
    const db = await getDB();
    const used = db.users?.[targetUserId]?.count ?? 0;
    const left = Math.max(0, ESSAY_LIMIT - used);

    return bot.sendMessage(
      msg.chat.id,
      `ℹ️ وضعیت کاربر\nUser: ${targetUserId}\nUsed: ${used}\nLeft: ${left}\nLimit: ${ESSAY_LIMIT}`
    );
  } catch (err) {
    console.error(err);
    return bot.sendMessage(msg.chat.id, "❌ خطا در دریافت وضعیت (JSONBin).");
  }
});

bot.onText(/\/credit_reset (\d+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;

  const targetUserId = String(match[1]);

  try {
    const db = ensureUser(await getDB(), targetUserId);
    db.users[targetUserId].count = 0;

    await saveDB(db);
    return bot.sendMessage(
      msg.chat.id,
      `✅ شارژ کامل انجام شد\nUser: ${targetUserId}\ncount → 0\nLimit: ${ESSAY_LIMIT}`
    );
  } catch (err) {
    console.error(err);
    return bot.sendMessage(msg.chat.id, "❌ خطا در شارژ (JSONBin).");
  }
});

bot.onText(/\/credit_add (\d+) (\d+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;

  const targetUserId = String(match[1]);
  const n = Math.max(0, parseInt(match[2], 10));

  try {
    const db = ensureUser(await getDB(), targetUserId);

    const before = Number(db.users[targetUserId].count || 0);
    db.users[targetUserId].count = Math.max(0, before - n);

    await saveDB(db);

    const after = db.users[targetUserId].count;
    return bot.sendMessage(
      msg.chat.id,
      `✅ شارژ انجام شد\nUser: ${targetUserId}\nUsed: ${before} → ${after}\n(+${n} essay credit)`
    );
  } catch (err) {
    console.error(err);
    return bot.sendMessage(msg.chat.id, "❌ خطا در شارژ (JSONBin).");
  }
});

// ---------- Main Handler (Essay) ----------
bot.on('message', async (msg) => {
  const chatId = String(msg.chat.id);
  const userId = String(msg.from.id);
  const text = msg.text;

  // ignore non-text
  if (!text) return;

  // commands are handled by onText above
  if (text.startsWith('/')) return;

  // basic validation
  if (text.trim().split(/\s+/).length < 20) {
    return bot.sendMessage(chatId, "لطفاً متن کامل Essay را بفرست.");
  }

  // ✅ whitelist check (admins bypass whitelist)
  if (!isAdmin(userId) && !allowedUserIds.has(userId)) {
    return bot.sendMessage(chatId, "🚫 دسترسی ندارید.");
  }

  if (inFlight.has(userId)) {
    return bot.sendMessage(chatId, "⏳ در حال پردازش...");
  }

  inFlight.add(userId);
  try {
    const db = ensureUser(await getDB(), userId);

    if (db.users[userId].count >= ESSAY_LIMIT) {
      return bot.sendMessage(chatId, "❌ سهمیه ۸ تایی شما تمام شده است.");
    }

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: text }]
    });

    // increment usage after successful generation
    db.users[userId].count += 1;
    await saveDB(db);

    const reply = response?.content?.[0]?.text || "❌ پاسخی دریافت نشد.";
    await sendLongMessage(chatId, reply);

  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "❌ خطایی رخ داد.");
  } finally {
    inFlight.delete(userId);
  }
});
