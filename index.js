require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SPREADSHEET_ID = '1lhogjschT9dDW8yZhaSdmhSzvVVtQ7Ih8ijn-mcwt34';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv`;

// تابع بررسی مجاز بودن کاربر
async function isUserAuthorized(userId) {
    try {
        const response = await axios.get(SHEET_URL);
        const data = response.data.toString();
        return data.includes(userId.toString());
    } catch (error) {
        console.error("خطا در خواندن شیت:", error);
        return false;
    }
}

const SYSTEM_PROMPT = `تو یک استاد مهربان و راهنمای PTE هستی. وظیفه تو تصحیح مقالات است.
قوانین:
1. زبان تحلیل‌ها فقط فارسی باشد.
2. هدف تو کمک به رسیدن به نمره 7 است. جملات صحیح و روان را تغییر نده.
3. ساختار خروجی شامل:
   - Step 1 – Pre‑Structure Analysis
   - Step 2 – Sentence‑by‑Sentence ASI (🟩 جمله اصلی، 💬 تحلیل فارسی، ✍️ نسخه اصلاح شده - فقط برای اصلاح خطاهای جدی)
   - Step 3 – Overall Summary (خلاصه وضعیت، بدون نمره دهی عددی).
4. در پایان تحلیل حتماً دو بخش زیر را بنویس:
   - Grammar Focus: اگر اشتباه گرامری بزرگی بود توضیح بده.
   - Noun Phrase Bank: هفت عبارت اسمی (Noun Phrase) کاربردی و سطح بالا مرتبط با موضوع مقاله پیشنهاد بده (به فرمت: انگلیسی - معادل فارسی).

نکته: از دادن نمره تخمینی آیلتس خودداری کن.`;

async function sendLargeMessage(chatId, text) {
    const parts = text.match(new RegExp(`.{1,3000}`, 'gs'));
    if (parts) {
        for (const part of parts) {
            await bot.sendMessage(chatId, part);
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }
}

bot.on('message', async (msg) => {
    const chatId = msg.chat.id.toString();
    const userId = msg.from.id;
    const userEssay = msg.text;

    if (!userEssay || userEssay.startsWith('/')) return;

    // بررسی دسترسی
    const authorized = await isUserAuthorized(userId);
    if (!authorized) {
        bot.sendMessage(chatId, "🚫 شما اجازه دسترسی به این ربات را ندارید. لطفاً با ادمین تماس بگیرید.");
        return;
    }

    bot.sendMessage(chatId, "⏳ در حال بررسی مقاله شما...");

    try {
        const response = await anthropic.messages.create({
            model: "claude-sonnet-4-6", 
            max_tokens: 4000,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: userEssay }]
        });

        const reply = response.content.filter(b => b.type === "text").map(b => b.text).join("");
        await sendLargeMessage(chatId, reply);
    } catch (error) {
        console.error("خطای کلاود:", error);
        bot.sendMessage(chatId, "❌ خطایی در پردازش رخ داد.");
    }
});
