const db = require('./db');
const aiService = require('./aiService');

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
  if (ctx.callback_query && ctx.callback_query.message && ctx.callback_query.message.chat) return ctx.callback_query.message.chat.id;
  if (ctx.update) return extractChatId(ctx.update);
  return null;
}

async function ensureWebhook(token) {
  const activeToken = token || process.env.TELEGRAM_BOT_TOKEN || await db.getSetting('TELEGRAM_BOT_TOKEN') || DEFAULT_TOKEN;
  let webAppUrl = process.env.WEB_APP_URL || DEFAULT_WEBHOOK_HOST;
  if (!webAppUrl || !webAppUrl.startsWith('https://')) {
    webAppUrl = DEFAULT_WEBHOOK_HOST;
  }
  const targetUrl = `${webAppUrl.replace(/\/$/, '')}/api/telegram-webhook`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${activeToken}/getWebhookInfo`);
    const data = await res.json();
    if (!data.ok || !data.result || data.result.url !== targetUrl) {
      console.log(`📌 Registering Telegram Webhook: ${targetUrl}`);
      await fetch(`https://api.telegram.org/bot${activeToken}/setWebhook?url=${encodeURIComponent(targetUrl)}`);
    }
  } catch (e) {
    console.error("⚠️ Error ensuring Telegram Webhook:", e.message);
  }
}

async function handleWebhookUpdate(update, token) {
  if (!update) return;

  const activeToken = token || process.env.TELEGRAM_BOT_TOKEN || await db.getSetting('TELEGRAM_BOT_TOKEN') || DEFAULT_TOKEN;
  const chatId = extractChatId(update);

  if (chatId) {
    await db.saveSetting('TELEGRAM_CHAT_ID', String(chatId));
    process.env.TELEGRAM_CHAT_ID = String(chatId);
  }

  // Handle Callback Queries (Button Clicks)
  if (update.callback_query) {
    const cb = update.callback_query;
    const data = cb.data || '';
    const cbChatId = cb.message && cb.message.chat ? cb.message.chat.id : chatId;

    if (data.startsWith('done_')) {
      const taskId = data.replace('done_', '');
      await db.markTaskDone(taskId);
      await answerCallbackQuery(cb.id, '✅ Đã hoàn thành công việc!', activeToken);
      await sendMessage(cbChatId, `✅ <b>Đã đánh dấu hoàn thành công việc!</b>`, { parse_mode: 'HTML' });
      return;
    } else if (data === 'cmd_today') {
      await answerCallbackQuery(cb.id, '', activeToken);
      await sendTodayTasks(cbChatId);
      return;
    } else if (data === 'cmd_pending') {
      await answerCallbackQuery(cb.id, '', activeToken);
      await sendPendingTasks(cbChatId);
      return;
    } else if (data === 'cmd_baocao') {
      await answerCallbackQuery(cb.id, '', activeToken);
      await sendDailyReport(cbChatId);
      return;
    }
  }

  // Handle Text Messages & Commands
  if (update.message && update.message.text && chatId) {
    const text = update.message.text.trim();
    const cleanCmd = text.toLowerCase().split('@')[0];

    if (cleanCmd === '/start') {
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
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } }
      );
      return;
    }

    if (cleanCmd === '/app') {
      const webAppUrl = process.env.WEB_APP_URL || DEFAULT_WEBHOOK_HOST;
      if (webAppUrl.startsWith('https://')) {
        await sendMessage(chatId, '📱 Bấm vào nút bên dưới để mở giao diện quản lý:', {
          reply_markup: { inline_keyboard: [[{ text: '🚀 Mở TaskMaster Web App', web_app: { url: webAppUrl } }]] }
        });
      } else {
        await sendMessage(chatId, `📱 Đường dẫn Web App: ${webAppUrl}`);
      }
      return;
    }

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

    // Standard Text -> AI Task Creation
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
              inline_keyboard: [[{ text: '✅ Đánh dấu xong', callback_data: `done_${newTask.id}` }]]
            }
          }
        );
      } catch (err) {
        console.error("Error processing Telegram message:", err.message);
        await sendMessage(chatId, `✅ <b>Đã nhận công việc:</b> ${escapeHtml(text)}`, { parse_mode: 'HTML' });
      }
    }
  }
}

async function answerCallbackQuery(callbackQueryId, text = '', token = null) {
  if (!callbackQueryId) return;
  const activeToken = token || process.env.TELEGRAM_BOT_TOKEN || await db.getSetting('TELEGRAM_BOT_TOKEN') || DEFAULT_TOKEN;
  try {
    await fetch(`https://api.telegram.org/bot${activeToken}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text })
    });
  } catch (e) {}
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

async function initBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN || await db.getSetting('TELEGRAM_BOT_TOKEN') || DEFAULT_TOKEN;
  await ensureWebhook(token);
  console.log('🤖 Telegram Bot đã kết nối thành công!');
  return true;
}

module.exports = {
  initBot,
  getBotInstance: () => null,
  handleWebhookUpdate,
  sendDailyReport,
  sendTodayTasks,
  sendPendingTasks,
  sendMessage,
  ensureWebhook
};
