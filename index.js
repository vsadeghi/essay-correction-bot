const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json()); // برای دریافت ریکوئست‌های تلگرام
app.get('/', (req, res) => res.send('Bot is running!'));

require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

// تنظیم Webhook به جای Polling
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { webHook: true });
bot.setWebHook(`https://${process.env.RENDER_EXTERNAL_HOSTNAME}/bot${process.env.TELEGRAM_TOKEN}`);

// مسیر اختصاصی برای دریافت آپدیت‌ها
app.post(`/bot${process.env.TELEGRAM_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.listen(port, () => console.log(`Server is listening on port ${port}`));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ESSAY_LIMIT = Number(process.env.ESSAY_LIMIT || 8);
const SPREADSHEET_ID = '1lhogjschT9dDW8yZhaSdmhSzvVVtQ7Ih8ijn-mcwt34';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv`;

let allowedUserIds = new Set();
async function syncWhitelist() {
  try {
    const response = await axios.get(SHEET_URL, { timeout: 15000 });
    allowedUserIds = new Set(response.data.split('\n').map(r => r.split(',')[0].replace(/"/g, '').trim()).filter(v => /^\d+$/.test(v)));
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

const SYSTEM_PROMPT = `تو یک استاد هوشمند PTE هستی. زبان تحلیل‌ها فارسی باشد. استاندارد نمره 6.5.
ساختار خروجی:
1. Essay Type Check
2. Pre‑Structure Analysis
3. Sentence‑by‑Sentence ASI (🟩 اصل، 💬 تحلیل، ✍️ اصلاح)
4. Overall Summary
5. Noun Phrase Bank (7 مورد). 
از نمره عددی استفاده نکن.`;

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

    db.users[userId].count += 1;
    await saveDB(db);
    const reply = response.content[0].text;
    const parts = reply.match(/.{1,3000}/gs);
    for (const part of parts) { await bot.sendMessage(chatId, part); }
  } catch (err) {
    bot.sendMessage(chatId, "❌ خطایی رخ داد.");
  } finally {
    inFlight.delete(userId);
  }
});
