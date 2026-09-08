const admin = require('firebase-admin');
const dotenv = require('dotenv');
dotenv.config();

// Khởi tạo Firebase Admin
if (!admin.apps.length) {
  const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  let credential;

  if (serviceAccountStr) {
    credential = admin.credential.cert(JSON.parse(serviceAccountStr));
  } else if (process.env.FIREBASE_PROJECT_ID) {
    credential = admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    });
  }

  if (credential) {
    admin.initializeApp({ credential });
  } else {
    console.warn("⚠️ Firebase credentials not found! Please set FIREBASE_SERVICE_ACCOUNT_KEY or FIREBASE_PROJECT_ID/EMAIL/KEY in .env");
  }
}

const db = admin.apps.length ? admin.firestore() : null;

module.exports = {
  async getAllTasks(filters = {}) {
    if (!db) return [];
    let query = db.collection('tasks');
    
    if (filters.status) query = query.where('status', '==', filters.status);
    if (filters.priority) query = query.where('priority', '==', filters.priority);
    if (filters.category) query = query.where('category', '==', filters.category);

    const snapshot = await query.get();
    let tasks = [];
    snapshot.forEach(doc => {
      tasks.push({ id: doc.id, ...doc.data() });
    });

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
    if (!db) return null;
    const doc = await db.collection('tasks').doc(id).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  },

  async createTask(taskData) {
    if (!db) throw new Error("Firebase not initialized");
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
    const ref = await db.collection('tasks').add(newTask);
    return { id: ref.id, ...newTask };
  },

  async updateTask(id, taskData) {
    if (!db) return null;
    const ref = db.collection('tasks').doc(id);
    const doc = await ref.get();
    if (!doc.exists) return null;

    const updates = { ...taskData, updated_at: new Date().toISOString() };
    Object.keys(updates).forEach(key => updates[key] === undefined && delete updates[key]);

    await ref.update(updates);
    const updatedDoc = await ref.get();
    return { id: updatedDoc.id, ...updatedDoc.data() };
  },

  async markTaskDone(id) {
    return this.updateTask(id, { status: 'done', completed_at: new Date().toISOString() });
  },

  async deleteTask(id) {
    if (!db) return false;
    await db.collection('tasks').doc(id).delete();
    return true;
  },

  async getDueTasksToRemind() {
    if (!db) return [];
    const now = new Date();
    const tenMinsLater = new Date(now.getTime() + 10 * 60000);

    const snapshot = await db.collection('tasks').where('status', '!=', 'done').get();
    const tasks = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (!data.reminded && data.reminder_time) {
        const remTime = new Date(data.reminder_time);
        if (remTime > now && remTime <= tenMinsLater) {
          tasks.push({ id: doc.id, ...data });
        }
      }
    });
    return tasks;
  },

  async markTaskReminded(id) {
    return this.updateTask(id, { reminded: 1 });
  },

  async getStats() {
    if (!db) return { total: 0, todo: 0, in_progress: 0, done: 0, high_priority: 0, overdue: 0 };
    const snapshot = await db.collection('tasks').get();
    const stats = { total: 0, todo: 0, in_progress: 0, done: 0, high_priority: 0, overdue: 0 };
    const now = new Date();

    snapshot.forEach(doc => {
      const t = doc.data();
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
    if (!db) return null;
    const doc = await db.collection('settings').doc('bot_settings').get();
    if (!doc.exists) return null;
    return doc.data()[key] || null;
  },

  async saveSetting(key, value) {
    if (!db) return;
    const ref = db.collection('settings').doc('bot_settings');
    await ref.set({ [key]: value }, { merge: true });
  },

  async getAllSettings() {
    if (!db) return {};
    const doc = await db.collection('settings').doc('bot_settings').get();
    return doc.exists ? doc.data() : {};
  }
};
