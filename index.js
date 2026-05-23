const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('Bot is running!'));
app.listen(port, () => console.log(`Server is listening on port ${port}`));

require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ESSAY_LIMIT = Number(process.env.ESSAY_LIMIT || 8);
const SPREADSHEET_ID = '1lhogjschT9dDW8yZhaSdmhSzvVVtQ7Ih8ijn-mcwt34';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv`;

let allowedUserIds = new Set();

function parseFirstColumnCsvIds(csvText) {
  return csvText.split('\n').map(r => r.trim()).filter(Boolean)
    .map(r => r.split(',')[0].trim().replace(/^"|"$/g, ''))
    .filter(v => /^\d+$/.test(v));
}

async function syncWhitelist() {
  try {
    const response = await axios.get(SHEET_URL, { timeout: 15000 });
    allowedUserIds = new Set(parseFirstColumnCsvIds(response.data.toString()));
  } catch (err) { console.error('Whitelist sync failed'); }
}
setInterval(syncWhitelist, 60 * 60 * 1000);
syncWhitelist();

async function getDB() {
  const res = await axios.get(`https://api.jsonbin.io/v3/b/${process.env.JSONBIN_ID}/latest`, {
    headers: { 'X-Master-Key': process.env.JSONBIN_KEY }, timeout: 15000
  });
  return res.data.record || { users: {} };
}

async function saveDB(data) {
  await axios.put(`https://api.jsonbin.io/v3/b/${process.env.JSONBIN_ID}`, data, {
    headers: { 'Content-Type': 'application/json', 'X-Master-Key': process.env.JSONBIN_KEY }
  });
}

const SYSTEM_PROMPT = `تو یک استاد هوشمند و متخصص آزمون PTE هستی. هدف تو تصحیح مقالات با تمرکز بر نمره 6.5 است.
قوانین:
1. در ابتدا بررسی کن کاربر چه نوع Essay نوشته (مثلاً Agree/Disagree یا Advantage/Disadvantage). اگر نوع مقاله با متن همخوانی ندارد یا ساختار آن اشتباه است، حتماً تذکر بده.
2. زبان تحلیل‌ها فارسی باشد.
3. سخت‌گیری بر اساس استاندارد PTE برای نمره 6.5 باشد.
4. ساختار خروجی:
   - Step 0 – Essay Type Check (بررسی تطابق نوع مقاله با ساختار).
   - Step 1 – Pre‑Structure Analysis (بررسی رعایت استانداردهای PTE).
   - Step 2 – Sentence‑by‑Sentence ASI (🟩 جمله اصلی، 💬 تحلیل ساده برای نمره 6.5، ✍️ نسخه اصلاح شده).
   - Step 3 – Overall Summary (خلاصه وضعیت برای رسیدن به هدف).
5. Grammar Focus: فقط خطاهای گرامری تاثیرگذار بر نمره را بنویس.
6. Noun Phrase Bank: هفت عبارت اسمی عالی برای PTE (انگلیسی - فارسی).

نکته: از دادن نمره عددی (مثلاً 6.0) خودداری کن.`;

const inFlight = new Set();

bot.on('message', async (msg) => {
  const chatId = String(msg.chat.id);
  const userId = String(msg.from.id);
  if (!msg.text || msg.text.startsWith('/')) return;

  if (msg.text.trim().split(/\s+/).length < 20) return bot.sendMessage(chatId, "لطفاً متن کامل Essay را بفرست.");
  if (!allowedUserIds.has(userId)) return bot.sendMessage(chatId, "🚫 دسترسی ندارید.");
  if (inFlight.has(userId)) return bot.sendMessage(chatId, "⏳ در حال پردازش...");
  
  inFlight.add(userId);
  try {
    let db = await getDB();
    if (!db.users[userId]) db.users[userId] = { count: 0 };
    if (db.users[userId].count >= ESSAY_LIMIT) return bot.sendMessage(chatId, "❌ سهمیه ۸ تایی شما تمام شده است.");

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6", 
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: msg.text }]
    });

    const reply = response.content[0].text;
    db.users[userId].count += 1;
    await saveDB(db);

    const parts = reply.match(/.{1,3000}/gs);
    for (const part of parts) { await bot.sendMessage(chatId, part); }
  } catch (err) {
    bot.sendMessage(chatId, "❌ خطایی رخ داد.");
  } finally {
    inFlight.delete(userId);
  }
});
