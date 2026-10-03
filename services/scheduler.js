const cron = require('node-cron');
const db = require('./db');
const telegramBot = require('./telegramBot');
const aiService = require('./aiService');

function startScheduler() {
  console.log('⏰ Scheduler Service đã khởi tạo (Kiểm tra nhắc nhở mỗi phút)...');

  cron.schedule('* * * * *', async () => {
    const dueTasks = await db.getDueTasksToRemind();
    if (dueTasks.length === 0) return;

    const bot = telegramBot.getBot();
    const chatId = process.env.TELEGRAM_CHAT_ID || await db.getSetting('TELEGRAM_CHAT_ID');

    for (const task of dueTasks) {
      await db.markTaskReminded(task.id);

      if (chatId) {
        const priorityIcon = task.priority === 'high' ? '🚨 KHẨN CẤP' : task.priority === 'medium' ? '🟡 TRUNG BÌNH' : '🔵 THẤP';
        
        telegramBot.sendMessage(chatId, 
          `⏰ <b>NHẮC NHỞ CÔNG VIỆC ĐẾN HẠN!</b>\n\n📌 <b>Tiêu đề:</b> ${task.title}\n🏷️ <b>Phân loại:</b> ${task.category}\n🔥 <b>Độ ưu tiên:</b> ${priorityIcon}\n📅 <b>Hạn chót:</b> ${task.due_date || 'Không có'}\n📝 <b>Mô tả:</b> ${task.description || 'Không có'}`,
          {
            parse_mode: 'HTML',
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
    const chatId = process.env.TELEGRAM_CHAT_ID || await db.getSetting('TELEGRAM_CHAT_ID');
    if (!chatId) return;

    const allTasks = await db.getAllTasks();
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    
    const todayTasks = allTasks.filter(t => t.due_date && t.due_date.startsWith(today));
    const overdueTasks = allTasks.filter(t => t.status !== 'done' && t.due_date && new Date(t.due_date) < now);

    const summaryMsg = await aiService.generateDailySummaryAlert(todayTasks, overdueTasks);

    telegramBot.sendMessage(chatId, summaryMsg, { parse_mode: 'HTML' })
       .catch(err => console.error('Morning alert push error:', err.message));
  });
}

module.exports = { startScheduler };
