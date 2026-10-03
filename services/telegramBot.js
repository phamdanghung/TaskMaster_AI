const { Bot } = require('node-telegram-bot-api');
const db = require('./db');
const aiService = require('./aiService');

let bot = null;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getBotInstance(token) {
  if (bot) return bot;
  if (!token) return null;

  bot = new Bot(token);

  bot.command('start', async (ctx) => {
    const chatId = ctx.chat.id;
    await db.saveSetting('TELEGRAM_CHAT_ID', String(chatId));
    process.env.TELEGRAM_CHAT_ID = String(chatId);
    console.log(`🤖 Telegram Chat ID đã được tự động lưu: ${chatId}`);
    const webAppUrl = process.env.WEB_APP_URL || 'http://localhost:3000';

    const keyboard = [
      [{ text: '📋 Việc hôm nay', callback_data: 'cmd_today' }, { text: '⏳ Việc chưa xong', callback_data: 'cmd_pending' }]
    ];
    if (webAppUrl.startsWith('https://')) {
      keyboard.unshift([{ text: '📱 Mở Web App Quản Lý', web_app: { url: webAppUrl } }]);
    }

    await ctx.reply(
      `👋 <b>Chào bạn! TaskMaster AI đã sẵn sàng hỗ trợ bạn.</b>\n\n🆔 <b>Chat ID của bạn:</b> <code>${chatId}</code> <i>(Đã tự động kết nối với Web App!)</i>\n\n📌 <b>Cách dùng cực đơn giản:</b>\n1️⃣ Gửi tin nhắn tiếng Việt bất kỳ (VD: <i>"Nhắc tôi 15h chiều nay họp khẩn với đối tác"</i>).\n2️⃣ Nhấn lệnh /today để xem việc hôm nay.\n3️⃣ Gửi tin nhắn bất kỳ để AI tự động tạo task cho bạn!`, 
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: keyboard
        }
      }
    );
  });

  bot.command('app', async (ctx) => {
    const webAppUrl = process.env.WEB_APP_URL || 'http://localhost:3000';
    if (webAppUrl.startsWith('https://')) {
      await ctx.reply('📱 Bấm vào nút bên dưới để mở giao diện quản lý:', {
        reply_markup: {
          inline_keyboard: [[{ text: '🚀 Mở TaskMaster Web App', web_app: { url: webAppUrl } }]]
        }
      });
    } else {
      await ctx.reply(`📱 Đường dẫn Web App: ${webAppUrl}`);
    }
  });

  bot.command('today', async (ctx) => { await sendTodayTasks(ctx); });
  bot.command('pending', async (ctx) => { await sendPendingTasks(ctx); });

  bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery ? ctx.callbackQuery.data : '';

    if (data.startsWith('done_')) {
      const taskId = data.replace('done_', '');
      await db.markTaskDone(taskId);
      await ctx.answerCallbackQuery({ text: '✅ Đã hoàn thành công việc!' });
      await ctx.editMessageText(`✅ <b>Đã đánh dấu hoàn thành công việc!</b>`, { parse_mode: 'HTML' });
    } else if (data === 'cmd_today') {
      await sendTodayTasks(ctx);
    } else if (data === 'cmd_pending') {
      await sendPendingTasks(ctx);
    }
  });

  bot.on('message', async (ctx) => {
    const text = ctx.message ? ctx.message.text : null;
    if (text && !text.startsWith('/')) {
      const chatId = ctx.chat.id;
      try {
        await db.saveSetting('TELEGRAM_CHAT_ID', String(chatId));
        process.env.TELEGRAM_CHAT_ID = String(chatId);

        const parsed = await aiService.parseTaskFromText(text);
        const newTask = await db.createTask(parsed);

        const priorityIcon = newTask.priority === 'high' ? '🔴 Cao' : newTask.priority === 'medium' ? '🟡 Trung bình' : '🔵 Thấp';

        await ctx.reply(
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
        await ctx.reply(`✅ <b>Đã nhận công việc:</b> ${escapeHtml(text)}`, { parse_mode: 'HTML' });
      }
    }
  });

  return bot;
}

async function initBot() {
  if (bot) {
    try { bot.stop(); } catch (e) {}
    bot = null;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN || await db.getSetting('TELEGRAM_BOT_TOKEN');
  if (!token || token.includes('your_telegram_bot_token')) {
    console.log('⚠️ Telegram Bot Token chưa được cấu hình.');
    return null;
  }

  try {
    const instance = getBotInstance(token);
    instance.startPolling();
    console.log('🤖 Telegram Bot đã khởi chạy thành công (Polling Mode)!');
  } catch (err) {
    console.error('Error starting Telegram Bot:', err.message);
  }

  return bot;
}

async function handleWebhookUpdate(update, token) {
  const instance = getBotInstance(token);
  if (instance && instance.handleUpdate) {
    await instance.handleUpdate(update);
  }
}

async function sendTodayTasks(ctx) {
  const allTasks = await db.getAllTasks();
  const today = new Date().toISOString().split('T')[0];
  const tasks = allTasks.filter(t => t.due_date && t.due_date.startsWith(today));
  
  if (tasks.length === 0) {
    await ctx.reply('🎉 <b>Hôm nay bạn không có công việc nào cần xử lý!</b>', { parse_mode: 'HTML' });
    return;
  }

  let msg = `📋 <b>DANH SÁCH VIỆC HÔM NAY (${tasks.length} việc):</b>\n\n`;
  const keyboard = [];

  tasks.forEach((t, i) => {
    const icon = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🔵';
    msg += `${i + 1}. ${icon} <b>${escapeHtml(t.title)}</b>\n   ⏰ ${escapeHtml(t.due_date || 'Chưa đặt hạn')}\n\n`;
    keyboard.push([{ text: `✅ Xong: ${t.title.slice(0, 20)}`, callback_data: `done_${t.id}` }]);
  });

  await ctx.reply(msg, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function sendPendingTasks(ctx) {
  const tasks = await db.getAllTasks({ status: 'todo' });
  if (tasks.length === 0) {
    await ctx.reply('🎉 <b>Tất cả công việc đã được hoàn thành!</b>', { parse_mode: 'HTML' });
    return;
  }

  let msg = `⏳ <b>DANH SÁCH CÔNG VIỆC ĐANG CHỜ (${tasks.length} việc):</b>\n\n`;
  const keyboard = [];

  tasks.slice(0, 10).forEach((t, i) => {
    const icon = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🔵';
    msg += `${i + 1}. ${icon} <b>${escapeHtml(t.title)}</b>\n   🏷️ ${escapeHtml(t.category)} | 📅 ${escapeHtml(t.due_date || 'Không có hạn')}\n\n`;
    keyboard.push([{ text: `✅ Xong: ${t.title.slice(0, 20)}`, callback_data: `done_${t.id}` }]);
  });

  await ctx.reply(msg, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function sendMessage(chatId, text, options = {}) {
  if (bot && bot.api) {
    return bot.api.sendMessage(chatId, text, options);
  }
  return null;
}

module.exports = {
  initBot,
  getBotInstance,
  handleWebhookUpdate,
  sendMessage,
  getBot: () => bot
};
