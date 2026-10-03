const db = require('../../services/db');
const telegramBot = require('../../services/telegramBot');
const aiService = require('../../services/aiService');

module.exports = async (req, res) => {
  try {
    const chatId = process.env.TELEGRAM_CHAT_ID || await db.getSetting('TELEGRAM_CHAT_ID');
    if (!chatId) return res.status(200).json({ success: false, error: 'No Telegram Chat ID registered' });

    const allTasks = await db.getAllTasks();
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();

    const todayTasks = allTasks.filter(t => t.due_date && t.due_date.startsWith(today));
    const overdueTasks = allTasks.filter(t => t.status !== 'done' && t.due_date && new Date(t.due_date) < now);

    const summaryMsg = await aiService.generateDailySummaryAlert(todayTasks, overdueTasks);
    await telegramBot.sendMessage(chatId, summaryMsg, { parse_mode: 'HTML' });
    res.status(200).json({ success: true, message: 'Daily summary report sent successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
