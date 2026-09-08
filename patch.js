const fs = require('fs'); let c = fs.readFileSync('D:/TaskMaster_AI/public/app.js', 'utf8'); c = c.replace(/async function deleteTask\(id\) \{[\s\S]*?\}\s*async function openSettingsModal\(\)/, \sync function deleteTask(id) {
  if (!confirm('Bạn có chắc chắn muốn xóa công việc này?')) return;
  try {
    console.log('Đang xóa task id:', id);
    const res = await fetch('/api/tasks/' + id, { method: 'DELETE', headers: { 'Cache-Control': 'no-cache' } });
    const data = await res.json();
    if (data.success) {
      showToast('🗑️ Đã xóa công việc');
      fetchTasks();
      fetchStats();
    } else {
      alert('Lỗi: ' + (data.error || 'Không xác định'));
    }
  } catch (err) {
    console.error(err);
    alert('Lỗi kết nối khi xóa.');
  }
}

async function openSettingsModal()\); fs.writeFileSync('D:/TaskMaster_AI/public/app.js', c);
