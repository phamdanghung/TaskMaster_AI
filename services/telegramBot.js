const { Bot } = require('node-telegram-bot-api');
const db = require('./db');
const aiService = require('./aiService');

let bot = null;

const DEFAULT_TOKEN = '8696351743:AAGewjwkS3D2CyC8UB1Yd5z42VfpEGwIpWs';
const DEFAULT_WEBHOOK_HOST = 'https://task-master-ai-beta-sand.vercel.app';

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function extractChatId(ctx) {
  if (!ctx) return null;
  if (typeof ctx === 'number' || typeof ctx === 'string') return ctx;
  if (ctx.chat && ctx.chat.id) return ctx.chat.id;
  if (ctx.message && ctx.message.chat && ctx.message.chat.id) return ctx.message.chat.id;
  if (ctx.update && ctx.update.message && ctx.update.message.chat && ctx.update.message.chat.id) return ctx.update.message.chat.id;
  return null;
}

async function ensureWebhook(token) {
  const activeToken = token || process.env.TELEGRAM_BOT_TOKEN || await db.getSetting('TELEGRAM_BOT_TOKEN') || DEFAULT_TOKEN;
  const webAppUrl = process.env.WEB_APP_URL || DEFAULT_WEBHOOK_HOST;
  const targetUrl = `${webAppUrl.replace(/\/$/, '')}/api/telegram-webhook`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${activeToken}/getWebhookInfo`);
    const data = await res.json();
    if (data.ok && data.result && data.result.url !== targetUrl) {
      console.log(`📌 Auto-registering Telegram Webhook: ${targetUrl}`);
      await fetch(`https://api.telegram.org/bot${activeToken}/setWebhook?url=${encodeURIComponent(targetUrl)}`);
    }
  } catch (e) {
    console.error("⚠️ Error ensuring Telegram Webhook:", e.message);
  }
}

function getBotInstance(token) {
  const activeToken = token || process.env.TELEGRAM_BOT_TOKEN || DEFAULT_TOKEN;
  if (bot) return bot;
  if (!activeToken) return null;

  bot = new Bot(activeToken);

  bot.command('start', async (ctx) => {
    const chatId = extractChatId(ctx);
    if (!chatId) return;
    await db.saveSetting('TELEGRAM_CHAT_ID', String(chatId));
    process.env.TELEGRAM_CHAT_ID = String(chatId);
    console.log(`🤖 Telegram Chat ID đã được tự động lưu: ${chatId}`);
    const webAppUrl = process.env.WEB_APP_URL || DEFAULT_WEBHOOK_HOST;

    const keyboard = [
      [{ text: '📋 Việc hôm nay', callback_data: 'cmd_today' }, { text: '⏳ Việc chưa xong', callback_data: 'cmd_pending' }],
      [{ text: '📊 Báo cáo tổng hợp', callback_data: 'cmd_baocao' }]
    ];
    if (webAppUrl.startsWith('https://')) {
      keyboard.unshift([{ text: '📱 Mở Web App Quản Lý', web_app: { url: webAppUrl } }]);
    }

    await sendMessage(chatId,
      `👋 <b>Chào bạn! TaskMaster AI đã sẵn sàng hỗ trợ bạn.</b>\n\n🆔 <b>Chat ID của bạn:</b> <code>${chatId}</code> <i>(Đã tự động kết nối với Web App!)</i>\n\n📌 <b>Cách dùng cực đơn giản:</b>\n1️⃣ Gửi tin nhắn tiếng Việt bất kỳ (VD: <i>"Nhắc tôi 15h chiều nay họp khẩn với đối tác"</i>).\n2️⃣ Nhấn lệnh /today hoặc /baocao để xem công việc & báo cáo.\n3️⃣ Gửi tin nhắn bất kỳ để AI tự động tạo task cho bạn!`, 
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      }
    );
  });

  bot.command('app', async (ctx) => {
    const chatId = extractChatId(ctx);
    const webAppUrl = process.env.WEB_APP_URL || DEFAULT_WEBHOOK_HOST;
    if (webAppUrl.startsWith('https://')) {
      await sendMessage(chatId, '📱 Bấm vào nút bên dưới để mở giao diện quản lý:', {
        reply_markup: {
          inline_keyboard: [[{ text: '🚀 Mở TaskMaster Web App', web_app: { url: webAppUrl } }]]
        }
      });
    } else {
      await sendMessage(chatId, `📱 Đường dẫn Web App: ${webAppUrl}`);
    }
  });

  bot.command('today', async (ctx) => { await sendTodayTasks(ctx); });
  bot.command('pending', async (ctx) => { await sendPendingTasks(ctx); });
  bot.command('baocao', async (ctx) => { await sendDailyReport(ctx); });
  bot.command('summary', async (ctx) => { await sendDailyReport(ctx); });
  bot.command('report', async (ctx) => { await sendDailyReport(ctx); });

  bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery ? ctx.callbackQuery.data : '';
    const chatId = extractChatId(ctx);

    if (data.startsWith('done_')) {
      const taskId = data.replace('done_', '');
      await db.markTaskDone(taskId);
      try { await ctx.answerCallbackQuery({ text: '✅ Đã hoàn thành công việc!' }); } catch (e) {}
      await sendMessage(chatId, `✅ <b>Đã đánh dấu hoàn thành công việc!</b>`, { parse_mode: 'HTML' });
    } else if (data === 'cmd_today') {
      await sendTodayTasks(ctx);
    } else if (data === 'cmd_pending') {
      await sendPendingTasks(ctx);
    } else if (data === 'cmd_baocao') {
      await sendDailyReport(ctx);
    }
  });

  bot.on('message', async (ctx) => {
    const text = ctx.message ? ctx.message.text : null;
    if (!text) return;

    const chatId = extractChatId(ctx);
    if (chatId) {
      await db.saveSetting('TELEGRAM_CHAT_ID', String(chatId));
      process.env.TELEGRAM_CHAT_ID = String(chatId);
    }

    const cleanText = text.trim().toLowerCase();

    // Directly handle command keywords with or without leading slash
    if (['/baocao', 'baocao', 'báo cáo', '/summary', 'summary', '/report', 'report', 'báo cáo công việc'].includes(cleanText)) {
      await sendDailyReport(ctx);
      return;
    }
    if (['/today', 'today', 'hôm nay', 'việc hôm nay'].includes(cleanText)) {
      await sendTodayTasks(ctx);
      return;
    }
    if (['/pending', 'pending', 'chưa xong', 'việc chưa xong'].includes(cleanText)) {
      await sendPendingTasks(ctx);
      return;
    }

    // Handle ordinary text -> AI Task Creation
    if (!text.startsWith('/')) {
      try {
        const parsed = await aiService.parseTaskFromText(text);
        const newTask = await db.createTask(parsed);

        const priorityIcon = newTask.priority === 'high' ? '🔴 Cao' : newTask.priority === 'medium' ? '🟡 Trung bình' : '🔵 Thấp';

        await sendMessage(chatId,
          `✅ <b>ĐÃ TẠO CÔNG VIỆC MỚI!</b>\n\n📌 <b>Tiêu đề:</b> ${escapeHtml(newTask.title)}\n🏷️ <b>Phân loại:</b> ${escapeHtml(newTask.category)}\n🔥 <b>Độ ưu tiên:</b> ${priorityIcon}\n📅 <b>Hạn chót:</b> ${escapeHtml(newTask.due_date || 'Không cài đặt')}\n⏰ <b>Thời gian nhắc:</b> ${escapeHtml(newTask.reminder_time || 'Không cài đặt')}`,
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '✅ Đánh dấu xong', callback_data: `done_${newTask.id}` }]
              ]
            }
          }
        );
      } catch (err) {
        console.error("Error processing Telegram message:", err.message);
        await sendMessage(chatId, `✅ <b>Đã nhận công việc:</b> ${escapeHtml(text)}`, { parse_mode: 'HTML' });
      }
    }
  });

  return bot;
}

async function initBot() {
  bot = null;
  const token = process.env.TELEGRAM_BOT_TOKEN || await db.getSetting('TELEGRAM_BOT_TOKEN') || DEFAULT_TOKEN;
  if (!token || token.includes('your_telegram_bot_token')) {
    console.log('⚠️ Telegram Bot Token chưa được cấu hình.');
    return null;
  }

  try {
    const instance = getBotInstance(token);
    await ensureWebhook(token);
    if (!process.env.VERCEL && process.env.USE_POLLING === 'true') {
      try { instance.startPolling(); } catch (e) {}
    }
    console.log('🤖 Telegram Bot đã khởi chạy thành công!');
  } catch (err) {
    console.error('Error starting Telegram Bot:', err.message);
  }

  return bot;
}

async function handleWebhookUpdate(update, token) {
  if (!update) return;

  const chatId = extractChatId(update);
  if (chatId) {
    await db.saveSetting('TELEGRAM_CHAT_ID', String(chatId));
    process.env.TELEGRAM_CHAT_ID = String(chatId);
  }

  const text = (update.message && update.message.text) ? update.message.text.trim() : null;
  if (text && chatId) {
    const cleanCmd = text.toLowerCase().split('@')[0];

    if (['/baocao', 'baocao', 'báo cáo', '/summary', 'summary', '/report', 'report', 'báo cáo công việc'].includes(cleanCmd)) {
      await sendDailyReport(chatId);
      return;
    }
    if (['/today', 'today', 'hôm nay', 'việc hôm nay'].includes(cleanCmd)) {
      await sendTodayTasks(chatId);
      return;
    }
    if (['/pending', 'pending', 'chưa xong', 'việc chưa xong'].includes(cleanCmd)) {
      await sendPendingTasks(chatId);
      return;
    }
  }

  const instance = getBotInstance(token);
  if (instance && instance.handleUpdate) {
    try { await instance.handleUpdate(update); } catch (e) {}
  }
}

async function sendTodayTasks(ctx) {
  const chatId = extractChatId(ctx);
  const allTasks = await db.getAllTasks();
  const today = new Date().toISOString().split('T')[0];
  const tasks = allTasks.filter(t => t.due_date && t.due_date.startsWith(today));
  
  if (tasks.length === 0) {
    return await sendMessage(chatId, '🎉 <b>Hôm nay bạn không có công việc nào cần xử lý!</b>', { parse_mode: 'HTML' });
  }

  let msg = `📋 <b>DANH SÁCH VIỆC HÔM NAY (${tasks.length} việc):</b>\n\n`;
  const keyboard = [];

  tasks.forEach((t, i) => {
    const icon = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🔵';
    msg += `${i + 1}. ${icon} <b>${escapeHtml(t.title)}</b>\n   ⏰ ${escapeHtml(t.due_date || 'Chưa đặt hạn')}\n\n`;
    keyboard.push([{ text: `✅ Xong: ${t.title.slice(0, 20)}`, callback_data: `done_${t.id}` }]);
  });

  return await sendMessage(chatId, msg, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function sendPendingTasks(ctx) {
  const chatId = extractChatId(ctx);
  const tasks = await db.getAllTasks({ status: 'todo' });
  if (tasks.length === 0) {
    return await sendMessage(chatId, '🎉 <b>Tất cả công việc đã được hoàn thành!</b>', { parse_mode: 'HTML' });
  }

  let msg = `⏳ <b>DANH SÁCH CÔNG VIỆC ĐANG CHỜ (${tasks.length} việc):</b>\n\n`;
  const keyboard = [];

  tasks.slice(0, 10).forEach((t, i) => {
    const icon = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🔵';
    msg += `${i + 1}. ${icon} <b>${escapeHtml(t.title)}</b>\n   🏷️ ${escapeHtml(t.category)} | 📅 ${escapeHtml(t.due_date || 'Không có hạn')}\n\n`;
    keyboard.push([{ text: `✅ Xong: ${t.title.slice(0, 20)}`, callback_data: `done_${t.id}` }]);
  });

  return await sendMessage(chatId, msg, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function sendDailyReport(ctx) {
  const chatId = extractChatId(ctx);
  try {
    const allTasks = await db.getAllTasks();
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();

    const todayTasks = allTasks.filter(t => t.due_date && t.due_date.startsWith(today));
    const overdueTasks = allTasks.filter(t => t.status !== 'done' && t.due_date && new Date(t.due_date) < now);

    const summaryMsg = await aiService.generateDailySummaryAlert(todayTasks, overdueTasks);
    return await sendMessage(chatId, summaryMsg, { parse_mode: 'HTML' });
  } catch (err) {
    console.error("Error in sendDailyReport:", err.message);
    return await sendMessage(chatId, "⚠️ <i>Có lỗi xảy ra khi tạo báo cáo công việc. Vui lòng thử lại sau!</i>", { parse_mode: 'HTML' });
  }
}

async function sendMessage(chatId, text, options = {}) {
  const activeChatId = chatId || process.env.TELEGRAM_CHAT_ID || await db.getSetting('TELEGRAM_CHAT_ID');
  const activeToken = process.env.TELEGRAM_BOT_TOKEN || await db.getSetting('TELEGRAM_BOT_TOKEN') || DEFAULT_TOKEN;

  if (!activeChatId || !activeToken) {
    console.warn("⚠️ Cannot send Telegram message: missing chatId or token.");
    return null;
  }

  try {
    const url = `https://api.telegram.org/bot${activeToken}/sendMessage`;
    const payload = {
      chat_id: activeChatId,
      text: text || '',
      reply_markup: options.reply_markup
    };
    if (options.parse_mode) payload.parse_mode = options.parse_mode;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.ok) {
      console.error("⚠️ Telegram API sendMessage error:", data.description);
      if (options.parse_mode && data.description) {
        console.log("Retrying Telegram sendMessage without parse_mode...");
        delete payload.parse_mode;
        const retryRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        return await retryRes.json();
      }
    }
    return data;
  } catch (err) {
    console.error("⚠️ Error sending Telegram message via fetch:", err.message);
    return null;
  }
}

module.exports = {
  initBot,
  getBotInstance,
  handleWebhookUpdate,
  sendDailyReport,
  sendTodayTasks,
  sendPendingTasks,
  sendMessage,
  ensureWebhook,
  getBot: () => bot
};
