require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const Anthropic = require('@anthropic-ai/sdk');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// --- Admin List ---
const ADMIN_IDS = new Set(["97660313", "108265666", "6190801722"]);
const isAdmin = (id) => ADMIN_IDS.has(String(id));

// --- DB Logic (JSONBin.io) ---
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${process.env.JSONBIN_ID}`;
const JSONBIN_HEADERS = {
    "Content-Type": "application/json",
    "X-Master-Key": process.env.JSONBIN_API_KEY
};

async function getDB() {
    try {
        const response = await fetch(JSONBIN_URL, { headers: JSONBIN_HEADERS });
        if (!response.ok) throw new Error(`DB Fetch Failed: ${response.statusText}`);
        const data = await response.json();

        if (!data.record) return { allowedUserIds: [], users: {} };
        if (!data.record.allowedUserIds) data.record.allowedUserIds = [];
        if (!data.record.users) data.record.users = {};

        console.log('✅ DB loaded:', JSON.stringify(data.record, null, 2));
        return data.record;
    } catch (err) {
        console.error('❌ DB Load Error:', err);
        return { allowedUserIds: [], users: {} };
    }
}

async function saveDB(data) {
    try {
        console.log('💾 Saving DB:', JSON.stringify(data, null, 2));
        const response = await fetch(JSONBIN_URL, {
            method: 'PUT',
            headers: JSONBIN_HEADERS,
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            console.error("❌ DB Save Failed:", response.statusText);
            return false;
        }
        console.log('✅ DB saved successfully');
        return true;
    } catch (err) {
        console.error("❌ DB Save Error:", err);
        return false;
    }
}

const DEFAULT_LIMIT = 8;

function ensureUser(db, userId) {
    if (!db.users) db.users = {};
    let migrated = false;

    if (!db.users[userId]) {
        db.users[userId] = { count: 0, limit: DEFAULT_LIMIT };
        migrated = true;
        console.log(`🆕 New user created: ${userId}`);
    } else if (db.users[userId].limit === undefined) {
        db.users[userId].limit = DEFAULT_LIMIT;
        migrated = true;
        console.log(`🔧 User migrated: ${userId}`);
    }

    return { db, migrated };
}

// --- Prompt (UNTOUCHED) ---
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
This template is a flexible guide. Follow it as closely as possible, but prioritize grammatically correct and natural English over strict adherence — especially in concluding and introduction sentences.

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

// --- Safe Multi-part Reply ---
async function safeReply(ctx, text) {
    const chunks = text.match(/.{1,3000}/gs) || [text];
    for (const chunk of chunks) {
        try {
            await ctx.reply(chunk.trim(), { parse_mode: 'Markdown' });
        } catch (e) {
            await ctx.reply(chunk.trim());
        }
    }
}

// --- Commands ---
bot.start((ctx) => ctx.reply('خوش آمدید! متن Essay خود را بفرستید.'));

bot.command('add_user', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply("❌ فقط ادمین‌ها دسترسی دارند.");

    const target = ctx.message.text.split(' ')[1];
    if (!target) return ctx.reply("فرمت: /add_user [ID]");

    try {
        const db = await getDB();

        if (!db.allowedUserIds.includes(target)) {
            db.allowedUserIds.push(target);
            await saveDB(db);
            ctx.reply(`✅ کاربر ${target} به لیست مجاز اضافه شد.`);
        } else {
            ctx.reply(`⚠️ کاربر ${target} قبلاً در لیست مجاز است.`);
        }
    } catch (e) {
        console.error(e);
        ctx.reply("⚠️ خطا در ذخیره اطلاعات.");
    }
});

bot.command('remove_user', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply("❌ فقط ادمین‌ها دسترسی دارند.");

    const target = ctx.message.text.split(' ')[1];
    if (!target) return ctx.reply("فرمت: /remove_user [ID]");

    try {
        const db = await getDB();

        const index = db.allowedUserIds.indexOf(target);
        if (index > -1) {
            db.allowedUserIds.splice(index, 1);
            await saveDB(db);
            ctx.reply(`✅ کاربر ${target} از لیست مجاز حذف شد.`);
        } else {
            ctx.reply(`⚠️ کاربر ${target} در لیست مجاز نیست.`);
        }
    } catch (e) {
        console.error(e);
        ctx.reply("⚠️ خطا در ذخیره اطلاعات.");
    }
});

bot.command('credit_status', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply("❌ فقط ادمین‌ها دسترسی دارند.");

    const target = ctx.message.text.split(' ')[1];
    if (!target) return ctx.reply("فرمت: /credit_status [ID]");

    try {
        const db = await getDB();

        // چک کن کاربر در لیست مجاز هست
        if (!db.allowedUserIds.includes(target) && !isAdmin(target)) {
            return ctx.reply(`❌ کاربر ${target} در لیست مجاز نیست.`);
        }

        const user = db.users?.[target];
        const used = user?.count ?? 0;
        const limit = user?.limit ?? DEFAULT_LIMIT;

        ctx.reply(
            `📊 وضعیت کاربر ${target}:\n\n` +
            `• وضعیت: ${user ? "✅ فعال" : "⏳ هنوز پیام نفرستاده"}\n` +
            `• استفاده شده: ${used}\n` +
            `• سقف: ${limit}\n` +
            `• باقی‌مانده: ${limit - used}`
        );
    } catch (e) {
        ctx.reply("⚠️ خطا در دریافت اطلاعات.");}
});


bot.command('credit_add', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply("❌ فقط ادمین‌ها دسترسی دارند.");

    const parts = ctx.message.text.split(' ');
    const target = parts[1];
    const n = parseInt(parts[2]);

    if (!target || isNaN(n)) return ctx.reply("فرمت: /credit_add [ID] [تعداد]");

    try {
        let db = await getDB();
        const result = ensureUser(db, target);
        db = result.db;

        db.users[target].limit = (db.users[target].limit ?? DEFAULT_LIMIT) + n;

        const saved = await saveDB(db);
        if (saved) {
            ctx.reply(
                `✅ ${n} اعتبار به کاربر ${target} اضافه شد.\n` +
                `سقف جدید: ${db.users[target].limit}`
            );
        } else {
            ctx.reply("⚠️ خطا در ذخیره اطلاعات.");
        }
    } catch (e) {
        console.error(e);
        ctx.reply("⚠️ خطا در ذخیره اطلاعات.");
    }
});

bot.command('credit_use', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply("❌ فقط ادمین‌ها دسترسی دارند.");

    const parts = ctx.message.text.split(' ');
    const target = parts[1];
    const n = parseInt(parts[2]);

    if (!target || isNaN(n)) return ctx.reply("فرمت: /credit_use [ID] [تعداد]");

    try {
        let db = await getDB();
        const result = ensureUser(db, target);
        db = result.db;

        db.users[target].count = (db.users[target].count ?? 0) + n;

        const saved = await saveDB(db);
        if (saved) {
            ctx.reply(`✅ count کاربر ${target} به ${db.users[target].count} رسید.`);
        } else {
            ctx.reply("⚠️ خطا در ذخیره اطلاعات.");
        }
    } catch (e) {
        console.error(e);
        ctx.reply("⚠️ خطا در ذخیره اطلاعات.");
    }
});

bot.command('credit_reset', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply("❌ فقط ادمین‌ها دسترسی دارند.");

    const target = ctx.message.text.split(' ')[1];
    if (!target) return ctx.reply("فرمت: /credit_reset [ID]");

    try {
        const db = await getDB();

        if (!db.users?.[target]) {
            return ctx.reply(`❌ کاربر ${target} در دیتابیس یافت نشد.`);
        }

        db.users[target] = { count: 0, limit: DEFAULT_LIMIT };

        const saved = await saveDB(db);
        if (saved) {
            ctx.reply(
                `✅ اعتبار کاربر ${target} ریست شد.\n` +
                `count: 0 | limit: ${DEFAULT_LIMIT}`
            );
        } else {
            ctx.reply("⚠️ خطا در ذخیره اطلاعات.");
        }
    } catch (e) {
        console.error(e);
        ctx.reply("⚠️ خطا در ذخیره اطلاعات.");
    }
});

// --- Text Handler ---
bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return;

    const userId = String(ctx.from.id);
    const text = ctx.message.text;

    // حداقل ۲۰ کلمه
    if (text.trim().split(/\s+/).length < 20) {
        return ctx.reply("لطفاً متن کامل Essay را بفرست.");
    }

    try {
        console.log(`📨 Message from user: ${userId}`);

        let db = await getDB();

        const hasAccess = isAdmin(userId) || db.allowedUserIds.includes(userId);
        if (!hasAccess) {
            console.log(`❌ Unauthorized access attempt: ${userId}`);
            return ctx.reply("❌ دسترسی غیرمجاز. لطفاً با ادمین تماس بگیرید.");
        }

        const result = ensureUser(db, userId);
        db = result.db;

        if (result.migrated) {
            console.log(`💾 Saving new user: ${userId}`);
            await saveDB(db);
        }

        const userLimit = db.users[userId].limit ?? DEFAULT_LIMIT;
        const userCount = db.users[userId].count ?? 0;

        console.log(`📊 User ${userId} - Count: ${userCount}, Limit: ${userLimit}`);

        if (!isAdmin(userId) && userCount >= userLimit) {
            console.log(`⛔ User ${userId} quota exceeded`);
            return ctx.reply(
                `❌ سهمیه شما تمام شده است.\n\n` +
                `استفاده شده: ${userCount}/${userLimit}\n` +
                `برای افزایش سهمیه با ادمین تماس بگیرید.`
            );
        }

        // جدید:
await ctx.sendChatAction('typing');
await ctx.reply("⏳ در حال بررسی مقاله شما... لطفاً چند لحظه صبر کنید.");

console.log(`🤖 Calling Claude API for user ${userId}...`);

const response = await anthropic.messages.create(
    {
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: text }],
    },
    {
        timeout: 120000  // 120 ثانیه به جای 90
    }
);


        console.log(`✅ Claude API response received for user ${userId}`);

        if (!isAdmin(userId)) {
            console.log(`📈 Incrementing count for user ${userId}: ${userCount} -> ${userCount + 1}`);
            db.users[userId].count = userCount + 1;

            const saved = await saveDB(db);
            if (saved) {
                console.log(`✅ Count saved successfully for user ${userId}`);
            } else {
                console.error(`❌ Failed to save count for user ${userId}`);
            }
        } else {
            console.log(`👑 Admin ${userId} - count not incremented`);
        }

        await safeReply(ctx, response.content[0].text);

    } catch (e) {
        console.error('❌ Error in text handler:', e);
        ctx.reply("⚠️ خطایی رخ داد. لطفاً دوباره تلاش کنید.");
    }
});

// --- Server ---
const PORT = process.env.PORT || 3000;
const webhookPath = `/bot${process.env.TELEGRAM_BOT_TOKEN}`;

app.get('/', (req, res) => res.send('OK'));

app.use(webhookPath, (req, res) => bot.handleUpdate(req.body, res));

app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Bot running on port ${PORT}`);
    console.log(`📡 Webhook: ${process.env.URL}${webhookPath}`);
    
    // setWebhook بعد از اینکه سرور بالا اومد
    await bot.telegram.setWebhook(`${process.env.URL}${webhookPath}`);
    console.log('✅ Webhook set successfully');
});

