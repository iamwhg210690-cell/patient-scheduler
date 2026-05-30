// frontend/src/api.js
import { auth } from './firebase';
import { signInWithEmailAndPassword } from 'firebase/auth';

// 初始化 localStorage 中的預設資料
function getStorage(key, defaultVal = []) {
  const data = localStorage.getItem(key);
  if (!data) {
    localStorage.setItem(key, JSON.stringify(defaultVal));
    return defaultVal;
  }
  try {
    return JSON.parse(data);
  } catch (e) {
    return defaultVal;
  }
}

function setStorage(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}

// 模擬 API 延遲 (毫秒)
const delay = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms));

const api = {
  defaults: {
    headers: {
      common: {}
    }
  },

  async get(url) {
    await delay();
    
    // 解析 query parameters
    const [path, queryStr] = url.split('?');
    const query = {};
    if (queryStr) {
      queryStr.split('&').forEach(param => {
        const [k, v] = param.split('=');
        query[k] = decodeURIComponent(v);
      });
    }

    if (path === '/api/therapists') {
      const therapists = getStorage('therapists', [
        { id: 't-default-1', name: '張治療師', username: 'chang' },
        { id: 't-default-2', name: '李治療師', username: 'lee' }
      ]);
      return { data: therapists };
    }
    
    if (path === '/api/appointments') {
      let appointments = getStorage('appointments', []);
      const therapists = getStorage('therapists', []);
      
      // 合併 therapistName
      appointments = appointments.map(appt => {
        const t = therapists.find(x => x.id === appt.therapistId);
        return {
          ...appt,
          therapistName: t ? (t.name || t.username) : appt.therapistId
        };
      });

      if (query.therapistId) {
        appointments = appointments.filter(a => a.therapistId === query.therapistId);
      }
      return { data: appointments };
    }
    
    throw new Error(`404 Not Found: GET ${url}`);
  },

  async post(url, body) {
    await delay();
    
    if (url === '/api/clear-data') {
      localStorage.setItem('appointments', '[]');
      localStorage.setItem('therapists', '[]');
      localStorage.setItem('ps_saturday_patients', '[]');
      localStorage.setItem('ps_saturday_weekday_appts', '[]');
      return { data: { message: '所有資料已清空' } };
    }
    
    if (url === '/api/auth/login') {
      const { username, password } = body || {};
      const email = username.includes('@') ? username : `${username}@example.com`;
      try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const token = await userCredential.user.getIdToken();
        return { data: { token } };
      } catch (e) {
        // 本機 file:// 環境或特定的不支援環境下，自動降級為本地帳密比對 (admin / password)
        const isFileProtocol = typeof window !== 'undefined' && window.location && window.location.protocol === 'file:';
        const isUnsupportedEnv = e.code === 'auth/operation-not-supported-in-this-environment' || e.message?.includes('not supported');
        
        if ((isFileProtocol || isUnsupportedEnv) && username === 'admin' && password === 'password') {
          console.warn('Firebase Auth 在此環境下不支援，自動降級為本地 admin/password 驗證登入。');
          return { data: { token: 'dev-token-local-fallback' } };
        }
        
        const err = new Error('帳號或密碼錯誤');
        err.response = { status: 401, data: { error: `${e.message} (${e.code || 'unknown'})` } };
        throw err;
      }
    }
    
    if (url === '/api/therapists') {
      const { name, username } = body || {};
      if (!name) {
        throw new Error('Missing therapist name');
      }
      const therapists = getStorage('therapists', []);
      const newT = { id: `t-${Date.now()}`, name, username: username || '' };
      therapists.push(newT);
      setStorage('therapists', therapists);
      return { data: newT };
    }
    
    if (url === '/api/appointments') {
      const { therapistId, patient, start, duration, days, patientType, otTime, stTime } = body;
      const appointments = getStorage('appointments', []);
      const created = [];
      
      days.forEach((day, idx) => {
        const newAppt = {
          id: `appt-${Date.now()}-${idx}`,
          therapistId,
          patient,
          start,
          duration: Number(duration),
          day: Number(day),
          patientType: patientType || 'outpatient',
          handoverText: '',
          otTime: otTime || '',
          stTime: stTime || ''
        };
        appointments.push(newAppt);
        created.push(newAppt);
      });
      
      setStorage('appointments', appointments);
      return { data: { success: created, message: `Created ${created.length} appointments` } };
    }
    
    throw new Error(`404 Not Found: POST ${url}`);
  },
 
  async put(url, body) {
    await delay();
    
    if (url.startsWith('/api/appointments/')) {
      const id = url.split('/').pop();
      const { patient, start, duration, day, patientType, handoverText, therapistId, otTime, stTime } = body;
      
      const appointments = getStorage('appointments', []);
      const idx = appointments.findIndex(a => a.id === id);
      if (idx === -1) {
        const err = new Error('Appointment not found');
        err.response = { status: 404 };
        throw err;
      }
      
      appointments[idx] = {
        ...appointments[idx],
        patient,
        start,
        duration: Number(duration),
        day: Number(day),
        patientType: patientType || 'outpatient',
        handoverText: handoverText ?? '',
        therapistId,
        otTime: otTime || '',
        stTime: stTime || ''
      };
      
      setStorage('appointments', appointments);
      return { data: { message: 'Appointment updated' } };
    }
    
    if (url.startsWith('/api/therapists/')) {
      const id = url.split('/').pop();
      const { name, username } = body;
      
      const therapists = getStorage('therapists', []);
      const idx = therapists.findIndex(t => t.id === id);
      if (idx === -1) {
        const err = new Error('Therapist not found');
        err.response = { status: 404 };
        throw err;
      }
      
      therapists[idx] = {
        ...therapists[idx],
        name,
        username: username || ''
      };
      
      setStorage('therapists', therapists);
      return { data: { id, name, username } };
    }
    
    throw new Error(`404 Not Found: PUT ${url}`);
  },

  async patch(url, body) {
    await delay();
    
    if (url.startsWith('/api/appointments/') && url.endsWith('/handover')) {
      const parts = url.split('/');
      const id = parts[parts.length - 2];
      const { handoverText } = body;
      
      const appointments = getStorage('appointments', []);
      const idx = appointments.findIndex(a => a.id === id);
      if (idx === -1) {
        const err = new Error('Appointment not found');
        err.response = { status: 404 };
        throw err;
      }
      
      appointments[idx].handoverText = handoverText ?? '';
      setStorage('appointments', appointments);
      return { data: { message: 'Handover text updated' } };
    }
    
    throw new Error(`404 Not Found: PATCH ${url}`);
  },

  async delete(url) {
    await delay();
    
    if (url.startsWith('/api/appointments/')) {
      const id = url.split('/').pop();
      let appointments = getStorage('appointments', []);
      const idx = appointments.findIndex(a => a.id === id);
      if (idx === -1) {
        const err = new Error('Appointment not found');
        err.response = { status: 404 };
        throw err;
      }
      appointments = appointments.filter(a => a.id !== id);
      setStorage('appointments', appointments);
      return { data: { message: 'Appointment deleted' } };
    }
    
    if (url.startsWith('/api/therapists/')) {
      const id = url.split('/').pop();
      let therapists = getStorage('therapists', []);
      let appointments = getStorage('appointments', []);
      
      const idx = therapists.findIndex(t => t.id === id);
      if (idx === -1) {
        const err = new Error('Therapist not found');
        err.response = { status: 404 };
        throw err;
      }
      
      therapists = therapists.filter(t => t.id !== id);
      appointments = appointments.filter(a => a.therapistId !== id);
      
      setStorage('therapists', therapists);
      setStorage('appointments', appointments);
      return { data: { message: 'Therapist and associated appointments deleted' } };
    }
    
    throw new Error(`404 Not Found: DELETE ${url}`);
  }
};

export function setAuthToken(token) {
  // Firebase Auth 中由 SDK 自動處理 Token 儲存與攜帶，此處為保持 API 相容性做 Mock
}

export default api;
