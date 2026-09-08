const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');
const aiService = require('./aiService');

let bot = null;

function initBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN || db.getSetting('TELEGRAM_BOT_TOKEN');
  if (!token || token.includes('your_telegram_bot_token')) {
    console.log('⚠️ Telegram Bot Token chưa được cấu hình. Vui lòng thêm token trong Cài đặt Web App hoặc file .env');
    return null;
  }

  try {
    bot = new TelegramBot(token, { polling: true });
    console.log('🤖 Telegram Bot đã khởi chạy thành công!');

    bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      db.setSetting('TELEGRAM_CHAT_ID', String(chatId));
      const webAppUrl = process.env.WEB_APP_URL || 'http://localhost:3000';

      bot.sendMessage(chatId, 
        `👋 *Cháu chào bác! TaskMaster AI đã sẵn sàng hỗ trợ bác.*

📱 *Cách dùng cực kỳ đơn giản:*
1️⃣ Gửi tin nhắn tiếng Việt bất kỳ (VD: *"Nhắc tôi 15h chiều nay họp khẩn với đối tác"*).
2️⃣ Nhắn lệnh /today để xem việc hôm nay.
3️⃣ Nhắn lệnh /app để mở Web App trực tiếp trên điện thoại!`, 
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📱 Mở Web App Quản Lý', web_app: { url: webAppUrl } }],
              [{ text: '📋 Việc hôm nay', callback_data: 'cmd_today' }, { text: '⏳ Việc chưa xong', callback_data: 'cmd_pending' }]
            ]
          }
        }
      );
    });

    bot.onText(/\/app/, (msg) => {
      const webAppUrl = process.env.WEB_APP_URL || 'http://localhost:3000';
      bot.sendMessage(msg.chat.id, '📱 Bấm vào nút bên dưới để mở giao diện quản lý:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚀 Mở TaskMaster Web App', web_app: { url: webAppUrl } }]
          ]
        }
      });
    });

    bot.onText(/\/today/, async (msg) => { sendTodayTasks(msg.chat.id); });
    bot.onText(/\/pending/, async (msg) => { sendPendingTasks(msg.chat.id); });

    bot.on('callback_query', async (query) => {
      const chatId = query.message.chat.id;
      const data = query.data;

      if (data.startsWith('done_')) {
        const taskId = parseInt(data.replace('done_', ''), 10);
        db.markTaskDone(taskId);
        bot.answerCallbackQuery(query.id, { text: '✅ Đã hoàn thành công việc!' });
        bot.editMessageText(`✅ *Đã đánh dấu hoàn thành công việc #${taskId}!*`, {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'Markdown'
        });
      } else if (data === 'cmd_today') {
        sendTodayTasks(chatId);
      } else if (data === 'cmd_pending') {
        sendPendingTasks(chatId);
      }
    });

    bot.on('message', async (msg) => {
      if (msg.text && !msg.text.startsWith('/')) {
        const chatId = msg.chat.id;
        db.setSetting('TELEGRAM_CHAT_ID', String(chatId));

        bot.sendMessage(chatId, '🧠 *AI đang phân tích công việc của bạn...*', { parse_mode: 'Markdown' });

        const parsed = await aiService.parseTaskFromText(msg.text);
        const newTask = db.createTask(parsed);

        const priorityIcon = newTask.priority === 'high' ? '🔴 Cao' : newTask.priority === 'medium' ? '🟡 Trung bình' : '🔵 Thấp';

        bot.sendMessage(chatId, 
          `✅ *ĐÃ TẠO CÔNG VIỆC MỚI!*

📌 *Tiêu đề:* ${newTask.title}
🏷️ *Phân loại:* ${newTask.category}
🎯 *Độ ưu tiên:* ${priorityIcon}
⏰ *Hạn chót:* ${newTask.due_date || 'Không cài đặt'}
🔔 *Thời gian nhắc:* ${newTask.reminder_time || 'Không cài đặt'}`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '✅ Đánh dấu xong', callback_data: `done_${newTask.id}` }]
              ]
            }
          }
        );
      }
    });

  } catch (err) {
    console.error('Error starting Telegram Bot:', err.message);
  }

  return bot;
}

function sendTodayTasks(chatId) {
  const tasks = db.getTodayTasks();
  if (tasks.length === 0) {
    bot.sendMessage(chatId, '🎉 *Hôm nay bạn không có công việc nào cần xử lý!*', { parse_mode: 'Markdown' });
    return;
  }

  let msg = `📋 *DANH SÁCH VIỆC HÔM NAY (${tasks.length} việc):*\n\n`;
  const keyboard = [];

  tasks.forEach((t, i) => {
    const icon = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🔵';
    msg += `${i + 1}. ${icon} *${t.title}*\n   ⏰ ${t.due_date || 'Chưa đặt hạn'}\n\n`;
    keyboard.push([{ text: `✅ Xong: ${t.title.slice(0, 20)}`, callback_data: `done_${t.id}` }]);
  });

  bot.sendMessage(chatId, msg, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  });
}

function sendPendingTasks(chatId) {
  const tasks = db.getAllTasks({ status: 'todo' });
  if (tasks.length === 0) {
    bot.sendMessage(chatId, '🎉 *Tất cả công việc đã được hoàn thành!*', { parse_mode: 'Markdown' });
    return;
  }

  let msg = `⏳ *DANH SÁCH CÔNG VIỆC ĐANG CHỜ (${tasks.length} việc):*\n\n`;
  const keyboard = [];

  tasks.slice(0, 10).forEach((t, i) => {
    const icon = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🔵';
    msg += `${i + 1}. ${icon} *${t.title}*\n   🏷️ ${t.category} | ⏰ ${t.due_date || 'Không có hạn'}\n\n`;
    keyboard.push([{ text: `✅ Xong: ${t.title.slice(0, 20)}`, callback_data: `done_${t.id}` }]);
  });

  bot.sendMessage(chatId, msg, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  });
}

module.exports = {
  initBot,
  getBot: () => bot
};