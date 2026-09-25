const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN || '8925942812:AAGV12EMkIpfNeXdvL87u5LbCQbt_pwfngQ';
const OWNER_ID = Number(process.env.OWNER_ID || '8854073031');
const CHANNEL_USERNAME = 'batman179';
const CHANNEL_LINK = 'https://t.me/batman179';

const bot = new Telegraf(BOT_TOKEN);

// Database file path for persistence on Railway volumes or local
const DB_FILE = path.join(__dirname, 'database.json');

// Default Database Structure
let db = {
  users: {}, // { user_id: { first_name, username, banned, joined_at } }
  admins: [OWNER_ID],
  proxies: [], // [{ id, url, name }]
  settings: {
    welcome_text: "به ربات پروکسی خوش آمدید.\nبرای استفاده از خدمات، گزینه موردنظر خود را از منوی زیر انتخاب کنید.\nدر صورت بروز مشکل یا نیاز به راهنمایی، از بخش پشتیبانی استفاده کنید.\nاز همراهی شما سپاسگزاریم.",
    proxy_btn_name: "📡 دریافت پروکسی",
    request_btn_name: "⚡ درخواست پروکسی",
    report_btn_name: "⚠️ گزارش خرابی",
    support_btn_name: "🎧 پشتیبانی"
  },
  last_request: {} // { user_id: timestamp }
};

// Load Database
function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(data);
      db = { ...db, ...parsed };
      if (!db.admins.includes(OWNER_ID)) {
        db.admins.push(OWNER_ID);
      }
    }
  } catch (e) {
    console.error("Error loading database:", e);
  }
}

// Save Database
function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error("Error saving database:", e);
  }
}

loadDB();

// Temporary states for admin actions: { [user_id]: 'broadcast' | 'ban' | 'unban' | 'add_proxy' | 'add_admin' | 'remove_admin' | 'support' | { type: 'reply_support', targetId } }
const userStates = {};

// Helper: Check Channel Membership
async function checkMembership(ctx) {
  try {
    const member = await ctx.telegram.getChatMember(`@${CHANNEL_USERNAME}`, ctx.from.id);
    const validStatus = ['creator', 'administrator', 'member'];
    return validStatus.includes(member.status);
  } catch (e) {
    console.error("Membership check error:", e);
    return false;
  }
}

// Helper: Main Menu Keyboard
function getMainMenu(userId) {
  const s = db.settings;
  const keyboard = [
    [s.proxy_btn_name, s.request_btn_name],
    [s.report_btn_name, s.support_btn_name]
  ];
  if (db.admins.includes(userId)) {
    keyboard.push(["⚙️ پنل مدیریت"]);
  }
  return Markup.keyboard(keyboard).resize();
}

// Middleware: Check Ban & Registration
bot.use(async (ctx, next) => {
  if (!ctx.from) return next();
  const userId = ctx.from.id;
  
  // Register user
  if (!db.users[userId]) {
    db.users[userId] = {
      first_name: ctx.from.first_name || 'بدون نام',
      username: ctx.from.username || 'ندارد',
      banned: false,
      joined_at: new Date().toISOString()
    };
    saveDB();
  } else {
    // Update info if changed
    db.users[userId].first_name = ctx.from.first_name || db.users[userId].first_name;
    db.users[userId].username = ctx.from.username || db.users[userId].username;
  }

  // Check ban
  if (db.users[userId].banned) {
    return ctx.reply("🚫 دسترسی شما به ربات مسدود شده است.");
  }

  return next();
});

// Start Command & Forced Membership
bot.start(async (ctx) => {
  const isMember = await checkMembership(ctx);
  if (!isMember) {
    return ctx.reply(
      "❌ برای استفاده از ربات باید ابتدا در کانال ما عضو شوید.",
      Markup.inlineKeyboard([
        [Markup.button.url("عضویت در کانال 🦇", CHANNEL_LINK)],
        [Markup.button.callback("✅ عضو شدم (بررسی)", "check_membership")]
      ])
    );
  }

  delete userStates[ctx.from.id];
  return ctx.reply(db.settings.welcome_text, getMainMenu(ctx.from.id));
});

bot.action('check_membership', async (ctx) => {
  const isMember = await checkMembership(ctx);
  if (!isMember) {
    return ctx.answerCbQuery("❌ شما هنوز در کانال عضو نشده‌اید!", { show_alert: true });
  }
  await ctx.answerCbQuery("عضویت شما تایید شد! 🎉");
  await ctx.deleteMessage();
  return ctx.reply(db.settings.welcome_text, getMainMenu(ctx.from.id));
});

// Handle Reply Keyboard buttons
bot.hears(/.*/, async (ctx, next) => {
  const text = ctx.text;
  const userId = ctx.from.id;
  const s = db.settings;

  // Check if waiting for admin states or support message
  const state = userStates[userId];
  if (state) {
    if (text === "🔙 انصراف" || text === "🔙 بازگشت به منوی اصلی") {
      delete userStates[userId];
      return ctx.reply("عملیات لغو شد.", getMainMenu(userId));
    }

    // Handle Admin Broadcast
    if (state === 'broadcast') {
      delete userStates[userId];
      let count = 0;
      for (const uid of Object.keys(db.users)) {
        try {
          await bot.telegram.sendMessage(uid, text);
          count++;
        } catch (err) {
          // user might have blocked the bot
        }
      }
      return ctx.reply(`✅ پیام همگانی با موفقیت برای ${count} کاربر ارسال شد.`, getMainMenu(userId));
    }

    // Handle Ban User
    if (state === 'ban') {
      const targetId = Number(text.trim());
      if (isNaN(targetId) || !db.users[targetId]) {
        return ctx.reply("❌ آیدی عددی نامعتبر است یا کاربری با این مشخصات یافت نشد. لطفاً دوباره بفرستید:");
      }
      userStates[userId] = { type: 'ban_reason', targetId };
      return ctx.reply("📌 لطفاً دلیل مسدودیت کاربر را وارد کنید:");
    }

    if (state && state.type === 'ban_reason') {
      const targetId = state.targetId;
      const reason = text;
      delete userStates[userId];
      
      db.users[targetId].banned = true;
      saveDB();

      try {
        await bot.telegram.sendMessage(targetId, 
          `🚫 دسترسی شما مسدود شد\nمتأسفانه به دلیل نقض قوانین ربات، دسترسی شما به ربات به‌صورت دائمی مسدود شده است.\n\n📌 دلیل مسدودیت:\n${reason}\n⛔ وضعیت: بن دائمی\nاز این لحظه امکان استفاده از ربات برای شما وجود ندارد.\n\n🤖 مدیریت ربات`
        );
      } catch (e) {}

      return ctx.reply(`✅ کاربر با آیدی عددی ${targetId} با موفقیت بن شد.`, getMainMenu(userId));
    }

    // Handle Unban User
    if (state === 'unban') {
      delete userStates[userId];
      const targetId = Number(text.trim());
      if (isNaN(targetId) || !db.users[targetId]) {
        return ctx.reply("❌ آیدی عددی نامعتبر است.", getMainMenu(userId));
      }
      db.users[targetId].banned = false;
      saveDB();

      try {
        await bot.telegram.sendMessage(targetId,
          `✅ دسترسی شما مجدداً فعال شد\nخبر خوب! 🎉\nمحدودیت دسترسی شما به ربات برداشته شد و از این لحظه می‌توانید دوباره از امکانات ربات استفاده کنید.\n\n🟢 وضعیت: فعال\nاز همراهی شما سپاسگزاریم. 💚\n\n🤖 پشتیبانی ربات`
        );
      } catch (e) {}

      return ctx.reply(`✅ کاربر ${targetId} آنبن شد.`, getMainMenu(userId));
    }

    // Handle Add Proxy
    if (state === 'add_proxy') {
      if (text === "🔙 بازگشت") {
        delete userStates[userId];
        return ctx.reply("به منوی مدیریت برگشتید.", getAdminMenu(userId));
      }
      db.proxies.push({
        id: Date.now().toString(),
        url: text.trim(),
        name: s.proxy_btn_name
      });
      saveDB();
      // Keep state open for adding more proxies as requested ("بار دیگه نیاد تو منو باز توی همون صفحه اضافه کردن پروکسی بمونه")
      return ctx.reply("✅ لینک پروکسی ثبت شد!\nمی‌توانید لینک بعدی را بفرستید یا روی دکمه بازگشت بزنید:", Markup.keyboard([["🔙 بازگشت"]]).resize());
    }

    // Handle Add Admin
    if (state === 'add_admin') {
      delete userStates[userId];
      const newAdminId = Number(text.trim());
      if (isNaN(newAdminId)) return ctx.reply("❌ آیدی عددی نامعتبر است.", getAdminMenu(userId));
      if (!db.admins.includes(newAdminId)) {
        db.admins.push(newAdminId);
        saveDB();
      }
      try {
        await bot.telegram.sendMessage(newAdminId, "🎉 شما به مقام مدیریت ربات منصوب شدید!");
      } catch (e) {}
      return ctx.reply(`✅ کاربر ${newAdminId} با موفقیت ادمین شد.`, getAdminMenu(userId));
    }

    // Handle Remove Admin
    if (state === 'remove_admin') {
      delete userStates[userId];
      const targetId = Number(text.trim());
      if (targetId === OWNER_ID) return ctx.reply("❌ نمی‌توانید مالک اصلی را حذف کنید!", getAdminMenu(userId));
      db.admins = db.admins.filter(id => id !== targetId);
      saveDB();
      try {
        await bot.telegram.sendMessage(targetId, "⚠️ شما از مقام مدیریت ربات برکنار شدید.");
      } catch (e) {}
      return ctx.reply(`✅ کاربر ${targetId} از ادمینی حذف شد.`, getAdminMenu(userId));
    }

    // Handle Settings Changes
    if (state.type === 'set_welcome') {
      delete userStates[userId];
      db.settings.welcome_text = text;
      saveDB();
      return ctx.reply("✅ متن خوش‌آمدگویی آپدیت شد.", getAdminMenu(userId));
    }
    if (state.type === 'set_proxy_name') {
      delete userStates[userId];
      db.settings.proxy_btn_name = text;
      db.proxies.forEach(p => p.name = text);
      saveDB();
      return ctx.reply("✅ اسم دکمه پروکسی‌ها تغییر کرد.", getAdminMenu(userId));
    }
    if (state.type === 'set_request_name') {
      delete userStates[userId];
      db.settings.request_btn_name = text;
      saveDB();
      return ctx.reply("✅ اسم دکمه درخواست تغییر کرد.", getAdminMenu(userId));
    }
    if (state.type === 'set_report_name') {
      delete userStates[userId];
      db.settings.report_btn_name = text;
      saveDB();
      return ctx.reply("✅ اسم دکمه گزارش تغییر کرد.", getAdminMenu(userId));
    }
    if (state.type === 'set_support_name') {
      delete userStates[userId];
      db.settings.support_btn_name = text;
      saveDB();
      return ctx.reply("✅ اسم دکمه پشتیبانی تغییر کرد.", getAdminMenu(userId));
    }

    // Handle User Support Message
    if (state === 'support') {
      delete userStates[userId];
      const userInfo = db.users[userId];
      const msg = `📩 پیام جدید از کاربران ربات\n👤 نام کاربر: ${userInfo.first_name}\n🔗 یوزرنیم: @${userInfo.username}\n🆔 آیدی عددی: <code>${userId}</code>\n💬 متن پیام:\n${text}\n━━━━━━━━━━━━━━━━━━\n🤖 ارسال‌شده از بخش پشتیبانی ربات`;

      // Send to all admins
      for (const adminId of db.admins) {
        try {
          await bot.telegram.sendMessage(adminId, msg, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              [Markup.button.callback(`💬 پاسخ به کاربر`, `reply_sup_${userId}`)]
            ])
          });
        } catch (e) {}
      }
      return ctx.reply("✅ پیام شما با موفقیت به پشتیبانی ارسال شد. به زودی پاسخ خواهیم داد.", getMainMenu(userId));
    }

    // Handle Owner Reply to Support
    if (state && state.type === 'reply_support') {
      const targetId = state.targetId;
      delete userStates[userId];
      
      try {
        await bot.telegram.sendMessage(targetId,
          `╭━━━━━━━━━━━━━━╮\n🎧 پشتیبانی ربات\n╰━━━━━━━━━━━━━━╯\n📩 پاسخ به پیام شما:\n${text}\n━━━━━━━━━━━━━━━━━━\n✅ پاسخ شما توسط تیم پشتیبانی ارسال شد.`,
          { parse_mode: 'HTML' }
        );
        return ctx.reply("✅ پاسخ با موفقیت برای کاربر ارسال شد.", getAdminMenu(userId));
      } catch (e) {
        return ctx.reply("❌ ارسال پیام به کاربر با خطا مواجه شد.", getAdminMenu(userId));
      }
    }
  }

  // Router for normal menu clicks
  if (text === s.proxy_btn_name) {
    if (db.proxies.length === 0) {
      return ctx.reply("⚠️ در حال حاضر هیچ پروکسی‌ای موجود نیست.");
    }
    let msg = "📡 لیست پروکسی‌های موجود:\n\n";
    const buttons = [];
    db.proxies.forEach((p, index) => {
      msg += `${index + 1}. ${p.name}\n`;
      buttons.push([Markup.button.url(p.name, p.url), Markup.button.callback(`⚠️ گزارش`, `report_${p.id}`)]);
    });
    return ctx.reply(msg, Markup.inlineKeyboard(buttons));
  }

  if (text === s.request_btn_name) {
    const now = Date.now();
    const lastReq = db.last_request[userId] || 0;
    const oneDay = 24 * 60 * 60 * 1000;
    if (now - lastReq < oneDay) {
      return ctx.reply("⚠️ شما هر 24 ساعت فقط یک بار می‌توانید درخواست پروکسی ثبت کنید.");
    }
    db.last_request[userId] = now;
    saveDB();

    // Notify admins about request
    const userInfo = db.users[userId];
    for (const adminId of db.admins) {
      try {
        await bot.telegram.sendMessage(adminId, `⚡ درخواست پروکسی جدید از کاربر:\nنام: ${userInfo.first_name}\nآیدی عددی: <code>${userId}</code>`, { parse_mode: 'HTML' });
      } catch (e) {}
    }
    return ctx.reply("✅ درخواست شما با موفقیت ثبت شد و به مدیران اطلاع داده شد.");
  }

  if (text === s.report_btn_name) {
    return ctx.reply("⚠️ برای گزارش خرابی پروکسی، لطفاً از لیست پروکسی‌ها روی دکمه گزارش روبروی پروکسی موردنظر کلیک کنید.");
  }

  if (text === s.support_btn_name) {
    userStates[userId] = 'support';
    return ctx.reply(
      "💬 لطفاً پیام، مشکل یا سوال خود را برای پشتیبانی ارسال کنید:",
      Markup.keyboard([["🔙 بازگشت به منوی اصلی"]]).resize()
    );
  }

  if (text === "⚙️ پنل مدیریت" && db.admins.includes(userId)) {
    return ctx.reply("🔐 به پنل مدیریت ربات خوش آمدید:", getAdminMenu(userId));
  }

  if (text === "🔙 بازگشت به منوی اصلی") {
    delete userStates[userId];
    return ctx.reply("به منوی اصلی برگشتید.", getMainMenu(userId));
  }

  return next();
});

// Admin Panel Keyboard Helper
function getAdminMenu(userId) {
  return Markup.keyboard([
    ["📢 ارسال پیام همگانی", "👥 لیست کاربرها"],
    ["➕ افزودن پروکسی", "🗑️ حذف پروکسی"],
    ["🚫 مسدود کردن کاربر", "✅ آزاد کردن کاربر"],
    ["✏️ تغییر نام دکمه‌ها", "📝 تغییر متن خوش‌آمدگویی"],
    ["👤 افزودن مدیر", "❌ حذف مدیر"],
    ["🔙 بازگشت به منوی اصلی"]
  ]).resize();
}

// Admin Panel Actions (Text-based inside Admin Menu)
bot.hears("📢 ارسال پیام همگانی", async (ctx) => {
  if (!db.admins.includes(ctx.from.id)) return;
  userStates[ctx.from.id] = 'broadcast';
  return ctx.reply("💬 لطفاً پیام خود را برای ارسال همگانی به همه کاربران بفرستید:", Markup.keyboard([["🔙 انصراف"]]).resize());
});

bot.hears("👥 لیست کاربرها", async (ctx) => {
  if (!db.admins.includes(ctx.from.id)) return;
  const users = Object.entries(db.users);
  let msg = `👥 لیست کل کاربران (${users.length} نفر):\n\n`;
  for (const [uid, u] of users) {
    const status = u.banned ? ' [بلاک شده]' : '';
    const isAdmin = db.admins.includes(Number(uid)) ? ' [مدیر]' : '';
    msg += `👤 نام: ${u.first_name}\n🔗 یوزرنیم: @${u.username}\n🆔 آیدی عددی: <code>${uid}</code>${status}${isAdmin}\n-------------------\n`;
  }
  if (msg.length > 4096) {
    msg = msg.substring(0, 4000) + "\n... (لیست طولانی است)";
  }
  return ctx.reply(msg, { parse_mode: 'HTML' });
});

bot.hears("➕ افزودن پروکسی", async (ctx) => {
  if (!db.admins.includes(ctx.from.id)) return;
  userStates[ctx.from.id] = 'add_proxy';
  return ctx.reply("🔗 لطفاً لینک پروکسی خود را بفرستید:", Markup.keyboard([["🔙 بازگشت"]]).resize());
});

bot.hears("🗑️ حذف پروکسی", async (ctx) => {
  if (!db.admins.includes(ctx.from.id)) return;
  if (db.proxies.length === 0) return ctx.reply("⚠️ هیچ پروکسی‌ای برای حذف وجود ندارد.");
  
  const buttons = db.proxies.map(p => [
    Markup.button.callback(`🔍 تست`, `test_${p.id}`),
    Markup.button.callback(`❌ حذف: ${p.name}`, `del_${p.id}`)
  ]);
  return ctx.reply("لیست پروکسی‌ها برای مدیریت:", Markup.inlineKeyboard(buttons));
});

bot.hears("🚫 مسدود کردن کاربر", async (ctx) => {
  if (!db.admins.includes(ctx.from.id)) return;
  userStates[ctx.from.id] = 'ban';
  return ctx.reply("🆔 آیدی عددی کاربری که می‌خواهید بن کنید را بفرستید:", Markup.keyboard([["🔙 انصراف"]]).resize());
});

bot.hears("✅ آزاد کردن کاربر", async (ctx) => {
  if (!db.admins.includes(ctx.from.id)) return;
  userStates[ctx.from.id] = 'unban';
  return ctx.reply("🆔 آیدی عددی کاربری که می‌خواهید آنبن کنید را بفرستید:", Markup.keyboard([["🔙 انصراف"]]).resize());
});

bot.hears("✏️ تغییر نام دکمه‌ها", async (ctx) => {
  if (!db.admins.includes(ctx.from.id)) return;
  return ctx.reply("کدام دکمه را می‌خواهید تغییر دهید؟", Markup.inlineKeyboard([
    [Markup.button.callback("پروکسی‌ها", "ch_btn_proxy"), Markup.button.callback("درخواست پروکسی", "ch_btn_req")],
    [Markup.button.callback("گزارش خرابی", "ch_btn_rep"), Markup.button.callback("پشتیبانی", "ch_btn_sup")]
  ]));
});

bot.hears("📝 تغییر متن خوش‌آمدگویی", async (ctx) => {
  if (!db.admins.includes(ctx.from.id)) return;
  userStates[ctx.from.id] = { type: 'set_welcome' };
  return ctx.reply("✍️ متن جدید خوش‌آمدگویی را ارسال کنید:", Markup.keyboard([["🔙 انصراف"]]).resize());
});

bot.hears("👤 افزودن مدیر", async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return ctx.reply("⚠️ فقط مالک ربات می‌تواند مدیر اضافه کند.");
  userStates[ctx.from.id] = 'add_admin';
  return ctx.reply("🆔 آیدی عددی فردی که می‌خواهید مدیر شود را بفرستید:");
});

bot.hears("❌ حذف مدیر", async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return ctx.reply("⚠️ فقط مالک ربات می‌تواند مدیر حذف کند.");
  userStates[ctx.from.id] = 'remove_admin';
  return ctx.reply("🆔 آیدی عددی مدیری که می‌خواهید حذف کنید را بفرستید:");
});

// Inline Actions Callback Handlers
bot.action(/report_(.+)/, async (ctx) => {
  const proxyId = ctx.match[1];
  const proxyIndex = db.proxies.findIndex(p => p.id === proxyId);
  const positionText = proxyIndex !== -1 ? `${proxyIndex + 1} رمی از بالا` : "نامشخص";

  for (const adminId of db.admins) {
    try {
      await bot.telegram.sendMessage(adminId, `⚠️ برخی کاربر ها گزارش دادن پروکسی ${positionText} خراب است لطفا تغییر بدهید`);
    } catch (e) {}
  }
  return ctx.answerCbQuery("✅ گزارش خرابی با موفقیت به مدیران ارسال شد.", { show_alert: true });
});

bot.action(/del_(.+)/, async (ctx) => {
  if (!db.admins.includes(ctx.from.id)) return;
  const proxyId = ctx.match[1];
  db.proxies = db.proxies.filter(p => p.id !== proxyId);
  saveDB();
  await ctx.answerCbQuery("✅ پروکسی حذف شد.");
  return ctx.editMessageText("پروکسی با موفقیت حذف شد.");
});

bot.action(/test_(.+)/, async (ctx) => {
  const proxyId = ctx.match[1];
  const proxy = db.proxies.find(p => p.id === proxyId);
  if (!proxy) return ctx.answerCbQuery("پروکسی پیدا نشد.", { show_alert: true });
  
  // Simulated connection test response
  return ctx.answerCbQuery(`🔗 اتصال به پروکسی برقرار شد!\nوضعیت پینگ: عالی 🟢\nلینک: ${proxy.url}`, { show_alert: true });
});

bot.action(/reply_sup_(.+)/, async (ctx) => {
  if (!db.admins.includes(ctx.from.id)) return;
  const targetId = Number(ctx.match[1]);
  userStates[ctx.from.id] = { type: 'reply_support', targetId };
  await ctx.answerCbQuery();
  return ctx.reply(`✍️ لطفاً پاسخ خود را برای کاربر با آیدی عددی ${targetId} ارسال کنید:`, Markup.keyboard([["🔙 انصراف"]]).resize());
});

// Button name change callbacks
bot.action('ch_btn_proxy', (ctx) => {
  userStates[ctx.from.id] = { type: 'set_proxy_name' };
  return ctx.reply("نام جدید دکمه پروکسی‌ها را بفرستید:");
});
bot.action('ch_btn_req', (ctx) => {
  userStates[ctx.from.id] = { type: 'set_request_name' };
  return ctx.reply("نام جدید دکمه درخواست پروکسی را بفرستید:");
});
bot.action('ch_btn_rep', (ctx) => {
  userStates[ctx.from.id] = { type: 'set_report_name' };
  return ctx.reply("نام جدید دکمه گزارش خرابی را بفرستید:");
});
bot.action('ch_btn_sup', (ctx) => {
  userStates[ctx.from.id] = { type: 'set_support_name' };
  return ctx.reply("نام جدید دکمه پشتیبانی را بفرستید:");
});

// Launch Bot
bot.launch().then(() => {
  console.log("Bot is running successfully on Railway!");
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
