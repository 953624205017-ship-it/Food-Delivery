function showToast(message, type = 'default') {
  const root = document.getElementById('toast-root');
  if (!root) { alert(message); return; }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || 'Something went wrong.');
    err.data = data;
    throw err;
  }
  return data;
}

async function logoutUser(e) {
  if (e) e.preventDefault();
  try {
    const data = await apiPost('/api/auth/logout');
    window.location.href = data.redirect || '/login';
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function logoutAdmin(e) {
  if (e) e.preventDefault();
  try {
    const data = await apiPost('/api/admin/logout');
    window.location.href = data.redirect || '/admin/login';
  } catch (err) {
    showToast(err.message, 'error');
  }
}
