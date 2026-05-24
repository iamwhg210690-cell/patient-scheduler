// frontend/src/App.jsx
import React, { useEffect, useState } from 'react';
import api, { setAuthToken } from './api';
import WeekCalendar from './WeekCalendar';

export default function App() {
  const [therapists, setTherapists] = useState([]);
  const [selectedTherapistId, setSelectedTherapistId] = useState(null);
  const [token, setToken] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('ps_token');
    if (saved) {
      setToken(saved);
      setAuthToken(saved);
    }
    fetchTherapists();
  }, []);

  async function fetchTherapists() {
    try {
      const res = await api.get('/api/therapists');
      setTherapists(res.data || []);
      if (!selectedTherapistId && res.data && res.data.length) {
        setSelectedTherapistId(res.data[0].id);
      }
    } catch (err) {
      console.error('fetchTherapists', err);
      alert('無法取得治療師清單，請確認後端是否啟動');
    }
  }

  async function handleLoginDemo() {
    try {
      const res = await api.post('/api/auth/login', {
        username: 'admin',
        password: 'password'
      });
      const t = res.data.token;
      setToken(t);
      setAuthToken(t);
      localStorage.setItem('ps_token', t);
      alert('登入成功');
    } catch (err) {
      console.error('login', err);
      alert('登入失敗');
    }
  }

  function handleTherapistChange(e) {
    setSelectedTherapistId(Number(e.target.value));
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <h2>Patient Scheduler</h2>

        <div className="login-block">
          <button onClick={handleLoginDemo}>示範登入 admin</button>
          <div className="token-indicator">{token ? '已登入' : '未登入'}</div>
        </div>

        <div className="therapist-select">
          <label>選擇治療師</label>
          <select value={selectedTherapistId ?? ''} onChange={handleTherapistChange}>
            {therapists.map(t => (
              <option key={t.id} value={t.id}>{t.name || t.username}</option>
            ))}
          </select>
        </div>

        <div className="actions">
          <button onClick={() => { fetchTherapists(); }}>重新載入治療師</button>
        </div>
      </aside>

      <main className="main">
        <WeekCalendar therapistId={selectedTherapistId} />
      </main>
    </div>
  );
}
