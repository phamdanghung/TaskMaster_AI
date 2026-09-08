const { GoogleGenerativeAI } = require('@google/generative-ai');

function getGeminiModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
}

function fallbackParseTask(text) {
  const now = new Date();
  let priority = 'medium';
  let category = 'Công việc';
  
  const lower = text.toLowerCase();
  if (lower.includes('gấp') || lower.includes('khẩn') || lower.includes('quan trọng') || lower.includes('ưu tiên cao')) {
    priority = 'high';
  } else if (lower.includes('nhẹ') || lower.includes('khi nào rảnh') || lower.includes('thấp')) {
    priority = 'low';
  }

  if (lower.includes('họp') || lower.includes('gặp')) category = 'Lịch họp';
  else if (lower.includes('mua') || lower.includes('đi chợ') || lower.includes('siêu thị')) category = 'Cá nhân';
  else if (lower.includes('tập') || lower.includes('bác sĩ') || lower.includes('thuốc')) category = 'Sức khỏe';

  let hour = 17;
  let minute = 0;
  const timeMatch = lower.match(/(\d{1,2})h(\d{1,2})?|(\d{1,2}):(\d{1,2})/);
  if (timeMatch) {
    if (timeMatch[1]) {
      hour = parseInt(timeMatch[1], 10);
      if (timeMatch[2]) minute = parseInt(timeMatch[2], 10);
    } else if (timeMatch[3]) {
      hour = parseInt(timeMatch[3], 10);
      minute = parseInt(timeMatch[4], 10);
    }
  }

  let taskDate = new Date(now);
  if (lower.includes('ngày mai') || lower.includes('sáng mai') || lower.includes('chiều mai')) {
    taskDate.setDate(taskDate.getDate() + 1);
  }

  const yyyy = taskDate.getFullYear();
  const mm = String(taskDate.getMonth() + 1).padStart(2, '0');
  const dd = String(taskDate.getDate()).padStart(2, '0');
  const hh = String(hour).padStart(2, '0');
  const minStr = String(minute).padStart(2, '0');

  const due_date = `${yyyy}-${mm}-${dd} ${hh}:${minStr}`;

  let title = text.replace(/nhắc (tôi|mình)?/gi, '')
                  .replace(/vào lúc \d+h\d*/gi, '')
                  .replace(/lúc \d+:\d+/gi, '')
                  .trim();
  if (!title) title = text;

  return {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    description: 'Tạo tự động qua Telegram',
    category,
    priority,
    due_date,
    reminder_time: due_date
  };
}

module.exports = {
  async parseTaskFromText(userMessage) {
    const model = getGeminiModel();
    if (!model) {
      return fallbackParseTask(userMessage);
    }

    try {
      const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 16);
      const prompt = `
Bạn là trợ lý AI quản lý công việc cá nhân cực kỳ thông minh.
Thời gian hiện tại: ${nowStr}.
Phân tích tin nhắn của người dùng: "${userMessage}"

Trả về ĐÚNG định dạng JSON thuần túy (không kèm markdown \`\`\`json):
{
  "title": "Tiêu đề công việc ngắn gọn",
  "description": "Mô tả nếu có",
  "category": "Một trong các nhãn: Công việc, Lịch họp, Cá nhân, Sức khỏe, Khẩn cấp",
  "priority": "high / medium / low",
  "due_date": "YYYY-MM-DD HH:mm",
  "reminder_time": "YYYY-MM-DD HH:mm"
}
`;
      const result = await model.generateContent(prompt);
      const cleaned = result.response.text().trim().replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '');
      return JSON.parse(cleaned);
    } catch (err) {
      console.error('Gemini error:', err.message);
      return fallbackParseTask(userMessage);
    }
  },

  async generateDailySummaryAlert(todayTasks, overdueTasks) {
    const model = getGeminiModel();
    if (!model) {
      let msg = '☀️ *BÁO CÁO CÔNG VIỆC BUỔI SÁNG*\n\n';
      if (overdueTasks.length > 0) {
        msg += `⚠️ *CẢNH BÁO ${overdueTasks.length} VIỆC QUÁ HẠN:*\n`;
        overdueTasks.forEach(t => {
          msg += `• ${t.title} (${t.due_date})\n`;
        });
        msg += '\n';
      }

      msg += `📋 *DỰ ĐỊNH HÔM NAY (${todayTasks.length} việc):*\n`;
      if (todayTasks.length === 0) {
        msg += '🎉 Bạn không có việc nào đặt lịch hôm nay. Hãy thêm việc mới nếu cần nhé!';
      } else {
        todayTasks.forEach((t, i) => {
          const icon = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🔵';
          msg += `${i + 1}. ${icon} *${t.title}* - ${t.due_date || 'Không có hạn'}\n`;
        });
      }
      return msg;
    }

    try {
      const prompt = `
Bạn là trợ lý AI quản lý thời gian cá nhân thân thiện và thúc đẩy động lực.
Hãy viết 1 tin nhắn thông báo buổi sáng ngắn gọn, truyền năng lượng cho người dùng trên Telegram (Telegram markdown *bold*):

Danh sách việc quá hạn: ${JSON.stringify(overdueTasks)}
Danh sách việc hôm nay: ${JSON.stringify(todayTasks)}

Highlight việc ưu tiên cao 🔴 và việc quá hạn ⚠️. Chúc người dùng một ngày làm việc tuyệt vời!
`;
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      return '☀️ Chúc bạn một ngày mới tốt lành! Hãy kiểm tra ứng dụng TaskMaster AI để xem công việc nhé.';
    }
  }
};