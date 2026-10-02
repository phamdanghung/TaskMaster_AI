const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

const LOCAL_DB_PATH = path.join(__dirname, '../data/local_db.json');

function ensureLocalDb() {
  const dir = path.dirname(LOCAL_DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(LOCAL_DB_PATH)) {
    fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify({ tasks: [], settings: {} }, null, 2));
  }
}

function readLocalDb() {
  ensureLocalDb();
  try {
    const raw = fs.readFileSync(LOCAL_DB_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return { tasks: [], settings: {} };
  }
}

function writeLocalDb(data) {
  ensureLocalDb();
  fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(data, null, 2));
}

// Khởi tạo Firebase Admin nếu có cấu hình
let db = null;
try {
  const apps = admin.getApps ? admin.getApps() : [];
  if (!apps.length) {
    const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    let credential;

    if (serviceAccountStr) {
      try {
        credential = admin.credential.cert(JSON.parse(serviceAccountStr));
      } catch (e) {
        console.error("⚠️ Invalid FIREBASE_SERVICE_ACCOUNT_KEY JSON:", e.message);
      }
    } else if (process.env.FIREBASE_PROJECT_ID) {
      credential = admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      });
    }

    if (credential) {
      admin.initializeApp({ credential });
    }
  }

  const activeApps = admin.getApps ? admin.getApps() : [];
  if (activeApps.length) {
    db = getFirestore();
    console.log("🔥 Đã kết nối Firebase Firestore thành công!");
  } else {
    console.log("📁 Firebase chưa cấu hình. Đang sử dụng lưu trữ cục bộ (local_db.json)");
  }
} catch (err) {
  console.warn("⚠️ Firebase init fallback:", err.message);
}

module.exports = {
  async getAllTasks(filters = {}) {
    let tasks = [];
    if (db) {
      let query = db.collection('tasks');
      if (filters.status) query = query.where('status', '==', filters.status);
      if (filters.priority) query = query.where('priority', '==', filters.priority);
      if (filters.category) query = query.where('category', '==', filters.category);

      const snapshot = await query.get();
      snapshot.forEach(doc => {
        tasks.push({ id: doc.id, ...doc.data() });
      });
    } else {
      const local = readLocalDb();
      tasks = [...local.tasks];
      if (filters.status) tasks = tasks.filter(t => t.status === filters.status);
      if (filters.priority) tasks = tasks.filter(t => t.priority === filters.priority);
      if (filters.category) tasks = tasks.filter(t => t.category === filters.category);
    }

    tasks.sort((a, b) => {
      if (filters.sort === 'due_date') {
        return new Date(a.due_date || '9999-12-31') - new Date(b.due_date || '9999-12-31');
      } else if (filters.sort === 'priority') {
        const pMap = { high: 1, medium: 2, low: 3 };
        return (pMap[a.priority] || 4) - (pMap[b.priority] || 4);
      }
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
    return tasks;
  },

  async getTaskById(id) {
    if (db) {
      const doc = await db.collection('tasks').doc(id).get();
      return doc.exists ? { id: doc.id, ...doc.data() } : null;
    } else {
      const local = readLocalDb();
      return local.tasks.find(t => t.id === id) || null;
    }
  },

  async createTask(taskData) {
    const now = new Date();
    const newTask = {
      title: taskData.title,
      description: taskData.description || '',
      category: taskData.category || 'Công việc',
      priority: taskData.priority || 'medium',
      status: taskData.status || 'todo',
      due_date: taskData.due_date || null,
      reminder_time: taskData.reminder_time || null,
      reminded: 0,
      created_at: now.toISOString(),
      updated_at: now.toISOString()
    };

    if (db) {
      const ref = await db.collection('tasks').add(newTask);
      return { id: ref.id, ...newTask };
    } else {
      const local = readLocalDb();
      newTask.id = 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
      local.tasks.push(newTask);
      writeLocalDb(local);
      return newTask;
    }
  },

  async updateTask(id, taskData) {
    const updates = { ...taskData, updated_at: new Date().toISOString() };
    Object.keys(updates).forEach(key => updates[key] === undefined && delete updates[key]);

    if (db) {
      const ref = db.collection('tasks').doc(id);
      const doc = await ref.get();
      if (!doc.exists) return null;
      await ref.update(updates);
      const updatedDoc = await ref.get();
      return { id: updatedDoc.id, ...updatedDoc.data() };
    } else {
      const local = readLocalDb();
      const idx = local.tasks.findIndex(t => t.id === id);
      if (idx === -1) return null;
      local.tasks[idx] = { ...local.tasks[idx], ...updates };
      writeLocalDb(local);
      return local.tasks[idx];
    }
  },

  async markTaskDone(id) {
    return this.updateTask(id, { status: 'done', completed_at: new Date().toISOString() });
  },

  async deleteTask(id) {
    if (db) {
      await db.collection('tasks').doc(id).delete();
      return true;
    } else {
      const local = readLocalDb();
      const initialLen = local.tasks.length;
      local.tasks = local.tasks.filter(t => t.id !== id);
      writeLocalDb(local);
      return local.tasks.length < initialLen;
    }
  },

  async getDueTasksToRemind() {
    const now = new Date();
    const tenMinsLater = new Date(now.getTime() + 10 * 60000);
    const tasks = [];

    if (db) {
      const snapshot = await db.collection('tasks').where('status', '!=', 'done').get();
      snapshot.forEach(doc => {
        const data = doc.data();
        if (!data.reminded && data.reminder_time) {
          const remTime = new Date(data.reminder_time);
          if (remTime > now && remTime <= tenMinsLater) {
            tasks.push({ id: doc.id, ...data });
          }
        }
      });
    } else {
      const local = readLocalDb();
      local.tasks.filter(t => t.status !== 'done').forEach(data => {
        if (!data.reminded && data.reminder_time) {
          const remTime = new Date(data.reminder_time);
          if (remTime > now && remTime <= tenMinsLater) {
            tasks.push(data);
          }
        }
      });
    }
    return tasks;
  },

  async markTaskReminded(id) {
    return this.updateTask(id, { reminded: 1 });
  },

  async getStats() {
    const stats = { total: 0, todo: 0, in_progress: 0, done: 0, high_priority: 0, overdue: 0 };
    const now = new Date();
    const allTasks = await this.getAllTasks();

    allTasks.forEach(t => {
      stats.total++;
      if (t.status === 'todo') stats.todo++;
      if (t.status === 'in_progress') stats.in_progress++;
      if (t.status === 'done') stats.done++;
      if (t.priority === 'high' && t.status !== 'done') stats.high_priority++;
      if (t.status !== 'done' && t.due_date && new Date(t.due_date) < now) stats.overdue++;
    });
    return stats;
  },

  async getSetting(key) {
    if (db) {
      const doc = await db.collection('settings').doc('bot_settings').get();
      if (!doc.exists) return null;
      return doc.data()[key] || null;
    } else {
      const local = readLocalDb();
      return local.settings[key] || null;
    }
  },

  async saveSetting(key, value) {
    if (db) {
      const ref = db.collection('settings').doc('bot_settings');
      await ref.set({ [key]: value }, { merge: true });
    } else {
      const local = readLocalDb();
      local.settings[key] = value;
      writeLocalDb(local);
    }
  },

  async getAllSettings() {
    if (db) {
      const doc = await db.collection('settings').doc('bot_settings').get();
      return doc.exists ? doc.data() : {};
    } else {
      const local = readLocalDb();
      return local.settings || {};
    }
  }
};

