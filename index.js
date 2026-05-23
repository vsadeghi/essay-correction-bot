const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.get('/', (req, res) => res.send('Bot is running!'));

require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { webHook: true });
bot.setWebHook(`https://${process.env.RENDER_EXTERNAL_HOSTNAME}/bot${process.env.TELEGRAM_TOKEN}`);

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
