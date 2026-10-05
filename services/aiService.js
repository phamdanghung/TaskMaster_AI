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

  if (lower.includes('họp') || lower.includes('gặp') || lower.includes('xem')) category = 'Lịch họp';
  else if (lower.includes('mua') || lower.includes('đi chợ') || lower.includes('siêu thị') || lower.includes('ăn')) category = 'Cá nhân';
  else if (lower.includes('tập') || lower.includes('bác sĩ') || lower.includes('thuốc')) category = 'Sức khỏe';

  let hour = 9;
  let minute = 0;

  const hourMatch = lower.match(/(\d{1,2})\s*(?:h|giờ|:|sáng|chiều|tối)/i) || lower.match(/(\d{1,2})\s+(?:sáng|chiều|tối)/i);
  if (hourMatch) {
    let parsedHour = parseInt(hourMatch[1], 10);
    if ((lower.includes('chiều') || lower.includes('tối')) && parsedHour < 12) {
      parsedHour += 12;
    }
    hour = parsedHour;

    const minMatch = lower.match(/(?:h|giờ|:)\s*(\d{1,2})/i);
    if (minMatch && minMatch[1]) {
      minute = parseInt(minMatch[1], 10);
    }
  }

  let taskDate = new Date(now);
  if (lower.includes('ngày mai') || lower.includes('sáng mai') || lower.includes('chiều mai') || lower.includes('tối mai')) {
    taskDate.setDate(taskDate.getDate() + 1);
  }

  const yyyy = taskDate.getFullYear();
  const mm = String(taskDate.getMonth() + 1).padStart(2, '0');
  const dd = String(taskDate.getDate()).padStart(2, '0');
  const hh = String(hour).padStart(2, '0');
  const minStr = String(minute).padStart(2, '0');

  const due_date = `${yyyy}-${mm}-${dd} ${hh}:${minStr}`;

  let title = text
    .replace(/nhắc\s+(tôi|mình|em|anh)?/gi, '')
    .replace(/(vào\s+)?(lúc\s+)?\d{1,2}\s*(h|giờ|:)?\s*(\d{1,2})?\s*(sáng|chiều|tối)?\s*(nay|mai)?/gi, '')
    .replace(/(ngày\s+)?(hôm\s+nay|hôm\s+qua|ngày\s+mai|sáng\s+mai|chiều\s+mai|tối\s+mai)/gi, '')
    .trim()
    .replace(/^[\s,.-]+|[\s,.-]+$/g, '');

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
      let msg = '☀️ <b>BÁO CÁO CÔNG VIỆC BUỔI SÁNG</b>\n\n';
      if (overdueTasks.length > 0) {
        msg += `⚠️ <b>CẢNH BÁO ${overdueTasks.length} VIỆC QUÁ HẠN:</b>\n`;
        overdueTasks.forEach(t => {
          msg += `• ${t.title} (${t.due_date})\n`;
        });
        msg += '\n';
      }

      msg += `📋 <b>DỰ ĐỊNH HÔM NAY (${todayTasks.length} việc):</b>\n`;
      if (todayTasks.length === 0) {
        msg += '🎉 Bạn không có việc nào đặt lịch hôm nay. Hãy thêm việc mới nếu cần nhé!';
      } else {
        todayTasks.forEach((t, i) => {
          const icon = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🔵';
          msg += `${i + 1}. ${icon} <b>${t.title}</b> - ${t.due_date || 'Không có hạn'}\n`;
        });
      }
      return msg;
    }

    try {
      const prompt = `
Bạn là trợ lý AI quản lý thời gian cá nhân thân thiện và thúc đẩy động lực.
Hãy viết 1 tin nhắn thông báo buổi sáng ngắn gọn, truyền năng lượng cho người dùng trên Telegram (chỉ dùng thẻ HTML <b>in đậm</b>, <i>in nghiêng</i>, KHÔNG dùng markdown *):

Danh sách việc quá hạn: ${JSON.stringify(overdueTasks)}
Danh sách việc hôm nay: ${JSON.stringify(todayTasks)}

Highlight việc ưu tiên cao 🔴 và việc quá hạn ⚠️. Chúc người dùng một ngày làm việc tuyệt vời!
`;
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      return '☀️ <b>BÁO CÁO BUỔI SÁNG</b>\n\nChúc bạn một ngày mới tốt lành! Hãy kiểm tra ứng dụng TaskMaster AI để xem công việc nhé.';
    }
  }
};