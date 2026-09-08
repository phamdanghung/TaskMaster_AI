const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'tasks.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT DEFAULT 'Công việc',
    priority TEXT CHECK(priority IN ('high', 'medium', 'low')) DEFAULT 'medium',
    status TEXT CHECK(status IN ('todo', 'in_progress', 'done')) DEFAULT 'todo',
    due_date TEXT,
    reminder_time TEXT,
    reminded INTEGER DEFAULT 0,
    completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS bot_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

const count = db.prepare('SELECT COUNT(*) as cnt FROM tasks').get().cnt;
if (count === 0) {
  const insertStmt = db.prepare(`
    INSERT INTO tasks (title, description, category, priority, status, due_date, reminder_time)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const todayStr = `${year}-${month}-${day}`;
  
  const time1 = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const due1 = `${todayStr} ${String(time1.getHours()).padStart(2, '0')}:${String(time1.getMinutes()).padStart(2, '0')}`;
  
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  const due2 = `${tomorrowStr} 10:00`;

  insertStmt.run(
    'Họp khởi động dự án với đối tác',
    'Thảo luận về hợp đồng và yêu cầu kỹ thuật chi tiết',
    'Lịch họp',
    'high',
    'todo',
    due1,
    due1
  );

  insertStmt.run(
    'Báo cáo tiến độ công việc tuần',
    'Tổng hợp các việc đã hoàn thành và gửi sếp qua Email',
    'Công việc',
    'medium',
    'in_progress',
    due2,
    due2
  );

  insertStmt.run(
    'Mua quà sinh nhật cho bạn',
    'Ghé cửa hàng tiện lợi mua bánh kem',
    'Cá nhân',
    'low',
    'todo',
    `${todayStr} 18:00`,
    `${todayStr} 17:30`
  );
}

module.exports = {
  db,

  getAllTasks(filters = {}) {
    let sql = 'SELECT * FROM tasks WHERE 1=1';
    const params = [];

    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters.priority) {
      sql += ' AND priority = ?';
      params.push(filters.priority);
    }
    if (filters.category) {
      sql += ' AND category = ?';
      params.push(filters.category);
    }
    if (filters.search) {
      sql += ' AND (title LIKE ? OR description LIKE ?)';
      params.push(`%${filters.search}%`, `%${filters.search}%`);
    }
    if (filters.date) {
      sql += ' AND (due_date LIKE ? OR created_at LIKE ?)';
      params.push(`${filters.date}%`, `${filters.date}%`);
    }

    sql += ' ORDER BY CASE priority WHEN \'high\' THEN 1 WHEN \'medium\' THEN 2 WHEN \'low\' THEN 3 END, due_date ASC, id DESC';
    return db.prepare(sql).all(...params);
  },

  getTaskById(id) {
    return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  },

  createTask(data) {
    const stmt = db.prepare(`
      INSERT INTO tasks (title, description, category, priority, status, due_date, reminder_time)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      data.title,
      data.description || '',
      data.category || 'Công việc',
      data.priority || 'medium',
      data.status || 'todo',
      data.due_date || null,
      data.reminder_time || data.due_date || null
    );
    return this.getTaskById(info.lastInsertRowid);
  },

  updateTask(id, data) {
    const existing = this.getTaskById(id);
    if (!existing) return null;

    const title = data.title !== undefined ? data.title : existing.title;
    const description = data.description !== undefined ? data.description : existing.description;
    const category = data.category !== undefined ? data.category : existing.category;
    const priority = data.priority !== undefined ? data.priority : existing.priority;
    const status = data.status !== undefined ? data.status : existing.status;
    const due_date = data.due_date !== undefined ? data.due_date : existing.due_date;
    const reminder_time = data.reminder_time !== undefined ? data.reminder_time : existing.reminder_time;
    let completed_at = existing.completed_at;

    if (status === 'done' && existing.status !== 'done') {
      const now = new Date();
      completed_at = now.toISOString().replace('T', ' ').slice(0, 19);
    } else if (status !== 'done') {
      completed_at = null;
    }

    let reminded = existing.reminded;
    if (reminder_time !== existing.reminder_time) {
      reminded = 0;
    }

    const stmt = db.prepare(`
      UPDATE tasks 
      SET title = ?, description = ?, category = ?, priority = ?, status = ?, 
          due_date = ?, reminder_time = ?, reminded = ?, completed_at = ?,
          updated_at = (datetime('now', 'localtime'))
      WHERE id = ?
    `);
    stmt.run(title, description, category, priority, status, due_date, reminder_time, reminded, completed_at, id);
    return this.getTaskById(id);
  },

  deleteTask(id) {
    const stmt = db.prepare('DELETE FROM tasks WHERE id = ?');
    const info = stmt.run(id);
    return info.changes > 0;
  },

  markTaskDone(id) {
    return this.updateTask(id, { status: 'done' });
  },

  getDueTasksToRemind() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    const nowStr = `${year}-${month}-${day} ${hours}:${mins}`;
    
    const stmt = db.prepare(`
      SELECT * FROM tasks 
      WHERE status != 'done' 
        AND reminded = 0 
        AND reminder_time IS NOT NULL 
        AND reminder_time != ''
        AND reminder_time <= ?
    `);
    return stmt.all(nowStr);
  },

  markTaskReminded(id) {
    db.prepare('UPDATE tasks SET reminded = 1 WHERE id = ?').run(id);
  },

  getOverdueTasks() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    const nowStr = `${year}-${month}-${day} ${hours}:${mins}`;

    const stmt = db.prepare(`
      SELECT * FROM tasks 
      WHERE status != 'done' 
        AND due_date IS NOT NULL 
        AND due_date != ''
        AND due_date < ?
      ORDER BY due_date ASC
    `);
    return stmt.all(nowStr);
  },

  getTodayTasks() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`;

    const stmt = db.prepare(`
      SELECT * FROM tasks 
      WHERE status != 'done' 
        AND (due_date LIKE ? OR due_date IS NULL OR due_date = '')
      ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, due_date ASC
    `);
    return stmt.all(`${todayStr}%`);
  },

  getStats() {
    const total = db.prepare('SELECT COUNT(*) as count FROM tasks').get().count;
    const todo = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'todo'").get().count;
    const in_progress = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'in_progress'").get().count;
    const done = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'done'").get().count;
    const high_priority = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE priority = 'high' AND status != 'done'").get().count;
    
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    const nowStr = `${year}-${month}-${day} ${hours}:${mins}`;
    const overdue = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status != 'done' AND due_date IS NOT NULL AND due_date != '' AND due_date < ?").get(nowStr).count;

    return { total, todo, in_progress, done, high_priority, overdue };
  },

  getSetting(key) {
    const row = db.prepare('SELECT value FROM bot_settings WHERE key = ?').get(key);
    return row ? row.value : null;
  },

  setSetting(key, value) {
    db.prepare('INSERT INTO bot_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?').run(key, value, value);
  }
};