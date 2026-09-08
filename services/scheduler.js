const cron = require('node-cron');
const db = require('./db');
const telegramBot = require('./telegramBot');
const aiService = require('./aiService');

function startScheduler() {
  console.log('⏰ Scheduler Service đã khởi tạo (Kiểm tra nhắc nhở mỗi phút)...');

  cron.schedule('* * * * *', async () => {
    const dueTasks = db.getDueTasksToRemind();
    if (dueTasks.length === 0) return;

    const bot = telegramBot.getBot();
    const chatId = process.env.TELEGRAM_CHAT_ID || db.getSetting('TELEGRAM_CHAT_ID');

    for (const task of dueTasks) {
      db.markTaskReminded(task.id);

      if (bot && chatId) {
        const priorityIcon = task.priority === 'high' ? '🚨 KHẨN CẤP' : task.priority === 'medium' ? '🟡 TRUNG BÌNH' : '🔵 THẤP';
        
        bot.sendMessage(chatId, 
          `🔔 *NHẮC NHỞ CÔNG VIỆC ĐẾN HẠN!*

📌 *Tiêu đề:* ${task.title}
🏷️ *Phân loại:* ${task.category}
🎯 *Độ ưu tiên:* ${priorityIcon}
⏰ *Hạn chót:* ${task.due_date || 'Không có'}
📝 *Mô tả:* ${task.description || 'Không có'}`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '✅ Đã hoàn thành ngay', callback_data: `done_${task.id}` }]
              ]
            }
          }
        ).catch(err => console.error('Telegram push error:', err.message));
      }
    }
  });

  cron.schedule('0 8 * * *', async () => {
    const bot = telegramBot.getBot();
    const chatId = process.env.TELEGRAM_CHAT_ID || db.getSetting('TELEGRAM_CHAT_ID');
    if (!bot || !chatId) return;

    const todayTasks = db.getTodayTasks();
    const overdueTasks = db.getOverdueTasks();
    const summaryMsg = await aiService.generateDailySummaryAlert(todayTasks, overdueTasks);

    bot.sendMessage(chatId, summaryMsg, { parse_mode: 'Markdown' })
       .catch(err => console.error('Morning alert push error:', err.message));
  });
}

module.exports = { startScheduler };