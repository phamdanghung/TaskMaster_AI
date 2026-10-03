const db = require('../../services/db');
const telegramBot = require('../../services/telegramBot');

module.exports = async (req, res) => {
  try {
    const dueTasks = await db.getDueTasksToRemind();
    const chatId = process.env.TELEGRAM_CHAT_ID || await db.getSetting('TELEGRAM_CHAT_ID');

    for (const task of dueTasks) {
      await db.markTaskReminded(task.id);
      if (chatId) {
        const priorityIcon = task.priority === 'high' ? '🚨 KHẨN CẤP' : task.priority === 'medium' ? '🟡 TRUNG BÌNH' : '🔵 THẤP';
        await telegramBot.sendMessage(chatId, 
          `⏰ <b>NHẮC NHỞ CÔNG VIỆC ĐẾN HẠN!</b>\n\n📌 <b>Tiêu đề:</b> ${task.title}\n🏷️ <b>Phân loại:</b> ${task.category}\n🔥 <b>Độ ưu tiên:</b> ${priorityIcon}\n📅 <b>Hạn chót:</b> ${task.due_date || 'Không có'}\n📝 <b>Mô tả:</b> ${task.description || 'Không có'}`,
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '✅ Đã hoàn thành ngay', callback_data: `done_${task.id}` }]
              ]
            }
          }
        ).catch(() => {});
      }
    }
    res.status(200).json({ success: true, reminded_count: dueTasks.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
