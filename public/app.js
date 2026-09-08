// TaskMaster AI Client Application Logic

document.addEventListener('DOMContentLoaded', () => {
  // Telegram WebApp Integration
  if (window.Telegram && window.Telegram.WebApp) {
    const tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand();
  }

  // App State
  let currentTasks = [];
  let currentView = 'list';
  let activeFilters = { search: '', priority: '', category: '' };

  // DOM Elements
  const tasksContainer = document.getElementById('tasks-container');
  const statTotal = document.getElementById('stat-total');
  const statHigh = document.getElementById('stat-high');
  const statOverdue = document.getElementById('stat-overdue');
  const statDone = document.getElementById('stat-done');

  const btnFabAdd = document.getElementById('btn-fab-add');
  const modalTask = document.getElementById('modal-task');
  const formTask = document.getElementById('form-task');
  const btnCloseTaskModal = document.getElementById('btn-close-task-modal');
  const btnCancelTask = document.getElementById('btn-cancel-task');

  const modalSettings = document.getElementById('modal-settings');
  const formSettings = document.getElementById('form-settings');
  const btnOpenSettings = document.getElementById('btn-open-settings');
  const btnNavSettings = document.getElementById('nav-btn-settings');
  const btnCloseSettingsModal = document.getElementById('btn-close-settings-modal');
  const btnCancelSettings = document.getElementById('btn-cancel-settings');

  const searchInput = document.getElementById('search-input');
  const filterPriority = document.getElementById('filter-priority');
  const filterCategory = document.getElementById('filter-category');
  const viewButtons = document.querySelectorAll('.btn-view, .nav-item[data-view]');

  const aiTaskInput = document.getElementById('ai-task-input');
  const btnAiParse = document.getElementById('btn-ai-parse');
  const btnToggleTheme = document.getElementById('btn-toggle-theme');

  // Display Current Date
  const dateDisplay = document.getElementById('current-date-display');
  const today = new Date();
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  if (dateDisplay) dateDisplay.textContent = today.toLocaleDateString('vi-VN', options);

  // Initialize App
  fetchTasks();
  fetchStats();

  // Event Listeners
  if (btnFabAdd) btnFabAdd.addEventListener('click', () => openTaskModal());
  if (btnCloseTaskModal) btnCloseTaskModal.addEventListener('click', closeTaskModal);
  if (btnCancelTask) btnCancelTask.addEventListener('click', closeTaskModal);

  if (btnOpenSettings) btnOpenSettings.addEventListener('click', openSettingsModal);
  if (btnNavSettings) btnNavSettings.addEventListener('click', openSettingsModal);
  if (btnCloseSettingsModal) btnCloseSettingsModal.addEventListener('click', closeSettingsModal);
  if (btnCancelSettings) btnCancelSettings.addEventListener('click', closeSettingsModal);

  if (formTask) formTask.addEventListener('submit', handleTaskSubmit);
  if (formSettings) formSettings.addEventListener('submit', handleSettingsSubmit);

  if (btnAiParse) btnAiParse.addEventListener('click', handleAiParse);
  if (aiTaskInput) {
    aiTaskInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleAiParse();
    });
  }

  if (searchInput) searchInput.addEventListener('input', (e) => {
    activeFilters.search = e.target.value;
    fetchTasks();
  });

  if (filterPriority) filterPriority.addEventListener('change', (e) => {
    activeFilters.priority = e.target.value;
    fetchTasks();
  });

  if (filterCategory) filterCategory.addEventListener('change', (e) => {
    activeFilters.category = e.target.value;
    fetchTasks();
  });

  // View Switcher
  viewButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.getAttribute('data-view');
      if (view) switchView(view);
    });
  });

  // Dark/Light Theme Toggle
  if (btnToggleTheme) {
    btnToggleTheme.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      document.getElementById('theme-icon').textContent = next === 'dark' ? '🌙' : '☀️';
    });
  }

  // PWA Install Prompt
  let deferredPrompt;
  const btnPwa = document.getElementById('btn-pwa-install');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (btnPwa) btnPwa.style.display = 'inline-flex';
  });

  if (btnPwa) {
    btnPwa.addEventListener('click', () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(() => {
          deferredPrompt = null;
          btnPwa.style.display = 'none';
        });
      }
    });
  }

  // API Functions
  async function fetchTasks() {
    try {
      const queryParams = new URLSearchParams(activeFilters).toString();
      const res = await fetch(`/api/tasks?${queryParams}`);
      const data = await res.json();
      if (data.success) {
        currentTasks = data.tasks;
        renderTasks();
        renderKanban();
        renderCalendar();
      }
    } catch (err) {
      showToast('❌ Không thể tải danh sách công việc');
    }
  }

  async function fetchStats() {
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();
      if (data.success) {
        const s = data.stats;
        if (statTotal) statTotal.textContent = s.total;
        if (statHigh) statHigh.textContent = s.high_priority;
        if (statOverdue) statOverdue.textContent = s.overdue;
        if (statDone) statDone.textContent = s.done;
      }
    } catch (err) {}
  }

  // Render Functions
  function renderTasks() {
    if (!tasksContainer) return;
    tasksContainer.innerHTML = '';

    if (currentTasks.length === 0) {
      tasksContainer.innerHTML = `
        <div class="glass-card" style="grid-column: 1/-1; padding: 40px; text-align: center;">
          <div style="font-size: 3rem; margin-bottom: 12px;">🎉</div>
          <h3>Không có công việc nào!</h3>
          <p style="color: var(--text-muted); margin-top: 6px;">Bấm nút "+ Thêm việc mới" hoặc tạo bằng AI để thêm công việc vào ứng dụng.</p>
        </div>
      `;
      return;
    }

    currentTasks.forEach(task => {
      const isOverdue = task.status !== 'done' && task.due_date && new Date(task.due_date) < new Date();
      const priorityClass = `priority-${task.priority}`;
      const statusClass = `status-${task.status}`;

      const card = document.createElement('div');
      card.className = `task-card glass-card ${priorityClass} ${statusClass}`;

      const priorityLabel = task.priority === 'high' ? '🔴 Cao' : task.priority === 'medium' ? '🟡 Vừa' : '🔵 Thấp';

      card.innerHTML = `
        <div>
          <div class="task-header">
            <div class="task-badges">
              <span class="badge badge-cat">${task.category}</span>
              <span class="badge badge-${task.priority}">${priorityLabel}</span>
            </div>
          </div>
          <h3 class="task-title">${escapeHtml(task.title)}</h3>
          <p class="task-desc">${escapeHtml(task.description || 'Không có mô tả')}</p>
        </div>
        <div class="task-footer">
          <div class="task-due ${isOverdue ? 'overdue-text' : ''}">
            <span>⏰ ${task.due_date ? task.due_date : 'Chưa đặt hạn'}</span>
          </div>
          <div class="task-actions">
            ${task.status !== 'done' ? `<button class="btn-icon-small btn-done" title="Đã xong">✅</button>` : ''}
            <button class="btn-icon-small btn-edit" title="Sửa">✏️</button>
            <button class="btn-icon-small btn-delete" title="Xóa">🗑️</button>
          </div>
        </div>
      `;

      // Event Listeners for Actions
      const btnDone = card.querySelector('.btn-done');
      if (btnDone) btnDone.addEventListener('click', () => markTaskDone(task.id));

      const btnEdit = card.querySelector('.btn-edit');
      if (btnEdit) btnEdit.addEventListener('click', () => openTaskModal(task));

      const btnDelete = card.querySelector('.btn-delete');
      if (btnDelete) btnDelete.addEventListener('click', () => deleteTask(task.id));

      tasksContainer.appendChild(card);
    });
  }

  function renderKanban() {
    const listTodo = document.getElementById('kanban-todo-list');
    const listProgress = document.getElementById('kanban-progress-list');
    const listDone = document.getElementById('kanban-done-list');

    if (!listTodo || !listProgress || !listDone) return;

    listTodo.innerHTML = '';
    listProgress.innerHTML = '';
    listDone.innerHTML = '';

    const todoTasks = currentTasks.filter(t => t.status === 'todo');
    const progressTasks = currentTasks.filter(t => t.status === 'in_progress');
    const doneTasks = currentTasks.filter(t => t.status === 'done');

    document.getElementById('kanban-todo-count').textContent = todoTasks.length;
    document.getElementById('kanban-progress-count').textContent = progressTasks.length;
    document.getElementById('kanban-done-count').textContent = doneTasks.length;

    todoTasks.forEach(t => listTodo.appendChild(createKanbanCard(t)));
    progressTasks.forEach(t => listProgress.appendChild(createKanbanCard(t)));
    doneTasks.forEach(t => listDone.appendChild(createKanbanCard(t)));
  }

  function createKanbanCard(task) {
    const el = document.createElement('div');
    el.className = `task-card glass-card priority-${task.priority}`;
    el.style.padding = '12px';
    el.innerHTML = `
      <h4 style="font-size: 0.95rem; margin-bottom: 6px;">${escapeHtml(task.title)}</h4>
      <div style="font-size: 0.75rem; color: var(--text-muted); display: flex; justify-content: space-between;">
        <span>🏷️ ${task.category}</span>
        <span>⏰ ${task.due_date || 'Không có'}</span>
      </div>
      <div style="margin-top: 10px; display: flex; gap: 4px; justify-content: flex-end;">
        ${task.status === 'todo' ? `<button class="btn-icon-small btn-move" data-target="in_progress">➡️ Đang làm</button>` : ''}
        ${task.status === 'in_progress' ? `<button class="btn-icon-small btn-move" data-target="done">✅ Hoàn thành</button>` : ''}
      </div>
    `;

    const btnMove = el.querySelector('.btn-move');
    if (btnMove) {
      btnMove.addEventListener('click', () => {
        const nextStatus = btnMove.getAttribute('data-target');
        updateTaskStatus(task.id, nextStatus);
      });
    }

    return el;
  }

  function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    days.forEach(d => {
      const h = document.createElement('div');
      h.className = 'cal-day-header';
      h.textContent = d;
      grid.appendChild(h);
    });

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < firstDay; i++) {
      grid.appendChild(document.createElement('div'));
    }

    for (let day = 1; day <= totalDays; day++) {
      const cell = document.createElement('div');
      cell.className = 'cal-day-cell';
      if (day === now.getDate()) cell.classList.add('today');

      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const hasTask = currentTasks.some(t => t.due_date && t.due_date.startsWith(dateStr));

      cell.innerHTML = `
        <span style="font-weight: 600; font-size: 0.85rem;">${day}</span>
        ${hasTask ? '<div class="cal-has-tasks"></div>' : ''}
      `;

      cell.addEventListener('click', () => {
        activeFilters.date = dateStr;
        switchView('list');
        fetchTasks();
        showToast(`📅 Lọc công việc ngày ${dateStr}`);
      });

      grid.appendChild(cell);
    }
  }

  // Handlers
  async function handleTaskSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('task-id').value;
    const taskData = {
      title: document.getElementById('task-title-input').value,
      description: document.getElementById('task-desc-input').value,
      category: document.getElementById('task-category-input').value,
      priority: document.getElementById('task-priority-input').value,
      due_date: document.getElementById('task-due-input').value ? document.getElementById('task-due-input').value.replace('T', ' ') : null,
      reminder_time: document.getElementById('task-reminder-input').value ? document.getElementById('task-reminder-input').value.replace('T', ' ') : null
    };

    try {
      const url = id ? `/api/tasks/${id}` : '/api/tasks';
      const method = id ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taskData)
      });
      const data = await res.json();
      if (data.success) {
        showToast(id ? '✅ Đã cập nhật công việc!' : '✅ Đã thêm công việc mới!');
        closeTaskModal();
        fetchTasks();
        fetchStats();
      }
    } catch (err) {
      showToast('❌ Lỗi khi lưu công việc');
    }
  }

  async function handleAiParse() {
    const text = aiTaskInput.value.trim();
    if (!text) {
      showToast('⚠️ Vui lòng nhập nội dung công việc');
      return;
    }

    showToast('🧠 Trợ lý AI đang phân tích...');
    try {
      const res = await fetch('/api/parse-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const data = await res.json();
      if (data.success && data.parsed) {
        // Save direct
        const createRes = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data.parsed)
        });
        const createData = await createRes.json();
        if (createData.success) {
          showToast(`✅ AI đã tạo việc: "${createData.task.title}"`);
          aiTaskInput.value = '';
          fetchTasks();
          fetchStats();
        }
      }
    } catch (err) {
      showToast('❌ Lỗi khi trích xuất AI');
    }
  }

  async function markTaskDone(id) {
    try {
      const res = await fetch(`/api/tasks/${id}/done`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('🎉 Đã hoàn thành công việc!');
        fetchTasks();
        fetchStats();
      }
    } catch (err) {}
  }

  async function updateTaskStatus(id, status) {
    try {
      await fetch(`/api/tasks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      fetchTasks();
      fetchStats();
    } catch (err) {}
  }

  async function deleteTask(id) {
    if (!confirm('Bạn có chắc chắn muốn xóa công việc này?')) return;
    try {
      console.log('Đang xóa task id:', id);
      const res = await fetch('/api/tasks/' + id, { 
        method: 'DELETE',
        headers: { 'Cache-Control': 'no-cache' }
      });
      const data = await res.json();
      if (data.success) {
        showToast('🗑️ Đã xóa công việc');
        fetchTasks();
        fetchStats();
      } else {
        alert('Lỗi xóa công việc: ' + (data.error || 'Không xác định'));
      }
    } catch (err) {
      console.error('Lỗi khi xóa:', err);
      alert('Không thể kết nối đến máy chủ để xóa.');
    }
  }

  async function openSettingsModal() {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (data.success) {
        document.getElementById('setting-bot-token').value = data.settings.telegram_token || '';
        document.getElementById('setting-chat-id').value = data.settings.telegram_chat_id || '';
        document.getElementById('setting-gemini-key').value = data.settings.gemini_api_key || '';
      }
    } catch (err) {}
    modalSettings.classList.add('active');
  }

  function closeSettingsModal() { modalSettings.classList.remove('active'); }

  async function handleSettingsSubmit(e) {
    e.preventDefault();
    const settings = {
      telegram_token: document.getElementById('setting-bot-token').value,
      telegram_chat_id: document.getElementById('setting-chat-id').value,
      gemini_api_key: document.getElementById('setting-gemini-key').value
    };

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      const data = await res.json();
      if (data.success) {
        showToast('✅ Đã lưu cấu hình!');
        closeSettingsModal();
      }
    } catch (err) {
      showToast('❌ Không thể lưu cấu hình');
    }
  }

  function openTaskModal(task = null) {
    formTask.reset();
    document.getElementById('task-id').value = '';
    document.getElementById('modal-task-title').textContent = task ? '✏️ Chỉnh Sửa Công Việc' : '✨ Thêm Công Việc Mới';

    if (task) {
      document.getElementById('task-id').value = task.id;
      document.getElementById('task-title-input').value = task.title;
      document.getElementById('task-desc-input').value = task.description || '';
      document.getElementById('task-category-input').value = task.category || 'Công việc';
      document.getElementById('task-priority-input').value = task.priority || 'medium';
      if (task.due_date) document.getElementById('task-due-input').value = task.due_date.replace(' ', 'T');
      if (task.reminder_time) document.getElementById('task-reminder-input').value = task.reminder_time.replace(' ', 'T');
    }
    modalTask.classList.add('active');
  }

  function closeTaskModal() { modalTask.classList.remove('active'); }

  function switchView(viewName) {
    currentView = viewName;
    document.querySelectorAll('.view-pane').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.btn-view, .nav-item').forEach(el => el.classList.remove('active'));

    const targetPane = document.getElementById(`view-${viewName}`);
    if (targetPane) targetPane.classList.add('active');

    document.querySelectorAll(`[data-view="${viewName}"]`).forEach(el => el.classList.add('active'));
  }

  function showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
});