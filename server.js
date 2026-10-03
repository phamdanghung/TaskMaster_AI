require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const db = require('./services/db');
const aiService = require('./services/aiService');
const telegramBot = require('./services/telegramBot');
const scheduler = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/tasks', async (req, res) => {
  try {
    const tasks = await db.getAllTasks(req.query);
    res.json({ success: true, tasks });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/tasks/:id', async (req, res) => {
  try {
    const task = await db.getTaskById(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/tasks', async (req, res) => {
  try {
    const newTask = await db.createTask(req.body);
    res.json({ success: true, task: newTask });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/tasks/:id', async (req, res) => {
  try {
    const updated = await db.updateTask(req.params.id, req.body);
    if (!updated) return res.status(404).json({ success: false, error: 'Task not found' });
    res.json({ success: true, task: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/tasks/:id/done', async (req, res) => {
  try {
    const updated = await db.markTaskDone(req.params.id);
    res.json({ success: true, task: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const success = await db.deleteTask(req.params.id);
    res.json({ success });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const stats = await db.getStats();
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/debug-db', async (req, res) => {
  try {
    const dbModule = require('./services/db');
    const info = dbModule.getDebugInfo ? dbModule.getDebugInfo() : {};
    
    let firestoreTest = 'not_attempted';
    let firestoreError = null;

    try {
      const { getApps } = require('firebase-admin/app');
      const { getFirestore } = require('firebase-admin/firestore');
      const apps = getApps();
      if (apps.length) {
        const firestore = getFirestore();
        const snap = await firestore.collection('tasks').limit(1).get();
        firestoreTest = 'success_count_' + snap.size;
      } else {
        firestoreTest = 'no_firebase_apps_initialized';
      }
    } catch (e) {
      firestoreTest = 'firestore_error';
      firestoreError = e.message;
    }

    res.json({ success: true, info, firestoreTest, firestoreError });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/parse-ai', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ success: false, error: 'Text input required' });
    const parsed = await aiService.parseTaskFromText(text);
    res.json({ success: true, parsed });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/settings', async (req, res) => {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN || await db.getSetting('TELEGRAM_BOT_TOKEN') || '';
    const chatId = process.env.TELEGRAM_CHAT_ID || await db.getSetting('TELEGRAM_CHAT_ID') || '';
    const geminiKey = process.env.GEMINI_API_KEY || await db.getSetting('GEMINI_API_KEY') || '';

    res.json({
      success: true,
      settings: {
        telegram_token: token ? (token.slice(0, 6) + '...' + token.slice(-4)) : '',
        telegram_chat_id: chatId,
        gemini_api_key: geminiKey ? (geminiKey.slice(0, 4) + '...' + geminiKey.slice(-4)) : '',
        is_bot_active: !!telegramBot.getBot()
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const { telegram_token, telegram_chat_id, gemini_api_key } = req.body;
    if (telegram_token && !telegram_token.includes('...')) {
      await db.saveSetting('TELEGRAM_BOT_TOKEN', telegram_token);
      process.env.TELEGRAM_BOT_TOKEN = telegram_token;
    }
    if (telegram_chat_id) {
      await db.saveSetting('TELEGRAM_CHAT_ID', telegram_chat_id);
      process.env.TELEGRAM_CHAT_ID = telegram_chat_id;
    }
    if (gemini_api_key && !gemini_api_key.includes('...')) {
      await db.saveSetting('GEMINI_API_KEY', gemini_api_key);
      process.env.GEMINI_API_KEY = gemini_api_key;
    }

    telegramBot.initBot();
    res.json({ success: true, message: 'Cấu hình được lưu thành công!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const DEFAULT_TOKEN = '8696351743:AAGewjwkS3D2CyC8UB1Yd5z42VfpEGwIpWs';

app.post('/api/telegram-webhook', async (req, res) => {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN || await db.getSetting('TELEGRAM_BOT_TOKEN') || DEFAULT_TOKEN;
    if (req.body) {
      await telegramBot.handleWebhookUpdate(req.body, token);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Webhook processing error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.all('/api/set-telegram-webhook', async (req, res) => {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN || await db.getSetting('TELEGRAM_BOT_TOKEN') || DEFAULT_TOKEN;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const defaultUrl = `${protocol}://${host}/api/telegram-webhook`;
    const webhookUrl = req.query.url || req.body?.url || (process.env.WEB_APP_URL ? `${process.env.WEB_APP_URL}/api/telegram-webhook` : defaultUrl);

    if (!token) {
      return res.status(400).send(`
        <div style="font-family: sans-serif; padding: 40px; text-align: center; background: #0f172a; color: white; min-height: 100vh;">
          <h1 style="color: #ef4444;">⚠️ Chưa Cấu Hình Telegram Bot Token</h1>
          <p>Vui lòng cài đặt <code>TELEGRAM_BOT_TOKEN</code> trong Environment Variables trên Vercel hoặc mục Cấu hình.</p>
        </div>
      `);
    }

    const instance = telegramBot.getBotInstance(token);
    await instance.api.setWebhook(webhookUrl);

    if (req.headers.accept && req.headers.accept.includes('text/html')) {
      res.send(`
        <div style="font-family: sans-serif; padding: 40px; text-align: center; background: #0f172a; color: white; min-height: 100vh;">
          <h1 style="color: #10b981;">✅ Kích Hoạt Telegram Webhook Thành Công!</h1>
          <p style="font-size: 1.1rem; color: #cbd5e1;">Webhook URL: <code style="color: #38bdf8;">${webhookUrl}</code></p>
          <p style="color: #94a3b8; margin-top: 10px;">Bây giờ bạn có thể mở Telegram và gửi tin nhắn cho Bot ngay lập tức!</p>
          <a href="/" style="display: inline-block; margin-top: 24px; padding: 12px 24px; background: #6366f1; color: white; border-radius: 8px; text-decoration: none; font-weight: bold;">Mở TaskMaster Web App</a>
        </div>
      `);
    } else {
      res.json({ success: true, message: `✅ Đã đăng ký Webhook Telegram thành công tới: ${webhookUrl}` });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// For Vercel Serverless we need to export the app
module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 TaskMaster AI Server running at http://localhost:${PORT}`);
    telegramBot.initBot();
    scheduler.startScheduler();
  });
}
