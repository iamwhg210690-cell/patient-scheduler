// frontend/src/App.jsx
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import axios from 'axios';
import api, { setAuthToken } from './api';
import WeekCalendar from './components/WeekCalendar';
import PatientList from './components/PatientList';
import PatientHandover from './components/PatientHandover';
import { parseImportFile, parseImportText, exportToExcel, exportToCSV, parseSaturdayImportFile, parseSaturdayImportText, parseSimpleWeekdayFile } from './utils/excelHelper';

// 引入 Firebase 相關模組
import { db, auth } from './firebase';
import { collection, query, where, onSnapshot, getDocs, doc, writeBatch } from 'firebase/firestore';

const SLOT_MIN = 30;
const MORNING_START = 8;
const MORNING_END = 11;
const AFTERNOON_START = 13;
const AFTERNOON_END = 16;

const TIME_SLOTS = [
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', 
  '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00'
];
const DAY_LABELS = { 1: "週一", 2: "週二", 3: "週三", 4: "週四", 5: "週五" };

function formatTime(hour, minute) {
  const h = String(hour).padStart(2, "0");
  const m = String(minute).padStart(2, "0");
  return `${h}:${m}`;
}

function generateSlots() {
  const slots = [];
  for (let h = MORNING_START; h < MORNING_END; h++) {
    for (let m = 0; m < 60; m += SLOT_MIN) slots.push({ hour: h, minute: m });
  }
  slots.push({ hour: MORNING_END, minute: 0 });
  for (let h = AFTERNOON_START; h < AFTERNOON_END; h++) {
    for (let m = 0; m < 60; m += SLOT_MIN) slots.push({ hour: h, minute: m });
  }
  slots.push({ hour: AFTERNOON_END, minute: 0 });
  return slots;
}

const SLOTS = generateSlots();

export default function App() {
  const [therapists, setTherapists] = useState(() => {
    try {
      const saved = localStorage.getItem('therapists');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.warn("Failed to parse therapists", e);
      return [];
    }
  });
  const [selectedTherapistId, setSelectedTherapistId] = useState(null);
  const [token, setToken] = useState(() => {
    try {
      const saved = localStorage.getItem('ps_token');
      if (saved) {
        setAuthToken(saved);
      }
      return saved || '';
    } catch (e) {
      console.warn("Failed to parse token from localStorage", e);
      return '';
    }
  });

  // 分頁切換狀態
  const [currentTab, setCurrentTab] = useState("schedule"); // schedule, patients, handover

  // 狀態提升：目前選擇治療師的預約資料與加載狀態
  const [rawAppointments, setRawAppointments] = useState(() => {
    try {
      const saved = localStorage.getItem('appointments');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.warn("Failed to parse appointments", e);
      return [];
    }
  });
  const [apptLoading, setApptLoading] = useState(false);

  // 透過 useMemo 將預約與負責治療師名稱合併，相容舊有程式碼
  const appointments = useMemo(() => {
    return rawAppointments.map(appt => {
      const t = therapists.find(x => x.id === appt.therapistId);
      return {
        ...appt,
        therapistName: t ? (t.name || t.username) : appt.therapistId
      };
    });
  }, [rawAppointments, therapists]);

  // 列印相關 State
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printType, setPrintType] = useState("schedule"); // schedule, handover
  const [printTherapistMode, setPrintTherapistMode] = useState("current"); // current, all
  const [printTherapistId, setPrintTherapistId] = useState("");
  const [printPatientType, setPrintPatientType] = useState("");
  const [printDays, setPrintDays] = useState([1, 2, 3, 4, 5]);

  // 新增預約表單 State (常駐 Sidebar 區)
  const [newApptPatient, setNewApptPatient] = useState("");
  const [newApptDays, setNewApptDays] = useState([1]); // 預設週一
  const [newApptStartTime, setNewApptStartTime] = useState("08:00");
  const [newApptDuration, setNewApptDuration] = useState(30);
  const [newApptPatientType, setNewApptPatientType] = useState("outpatient");
  const [newApptOtTime, setNewApptOtTime] = useState("");
  const [newApptStTime, setNewApptStTime] = useState("");
  const [selectedTherapistIdInModal, setSelectedTherapistIdInModal] = useState("");

  // 管理 Modal 相關 State
  const [manageModalOpen, setManageModalOpen] = useState(false);
  const [newTherapistName, setNewTherapistName] = useState("");
  const [editingTherapistId, setEditingTherapistId] = useState(null);
  const [editingTherapistName, setEditingTherapistName] = useState("");

  // 匯入與匯出相關的 State 及 Ref
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportTherapistMode, setExportTherapistMode] = useState("current"); // current, all
  const [exportTherapistId, setExportTherapistId] = useState("");
  const [exportPatientType, setExportPatientType] = useState(""); // "", "outpatient", "inpatient"
  const [exportFormat, setExportFormat] = useState("excel"); // excel, csv

  const fileInputRef = useRef(null);
  const dbInputRef = useRef(null);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [importReport, setImportReport] = useState({
    successCount: 0,
    failedCount: 0,
    errors: [],
    addedTherapists: []
  });

  // 週六住院病人排程小卡 State (改為從 LocalStorage 讀取)
  const [saturdayPatients, setSaturdayPatients] = useState(() => {
    try {
      const saved = localStorage.getItem('ps_saturday_patients');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.warn("Failed to parse saturday patients", e);
      return [];
    }
  });
  const saturdayFileInputRef = useRef(null);
  const [saturdayWeekdayAppts, setSaturdayWeekdayAppts] = useState(() => {
    try {
      const saved = localStorage.getItem('ps_saturday_weekday_appts');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.warn("Failed to parse saturday weekday appts", e);
      return [];
    }
  });
  const satWeekdayFileInputRef = useRef(null);
  const [satImportModalOpen, setSatImportModalOpen] = useState(false);
  const [satImportTextContent, setSatImportTextContent] = useState('');
  const [satImporting, setSatImporting] = useState(false);

  // 雙檔案合併匯入狀態
  const [doubleImportModalOpen, setDoubleImportModalOpen] = useState(false);
  const [satImportFile, setSatImportFile] = useState(null);
  const [weekImportFile, setWeekImportFile] = useState(null);

  // UI/UX 增強狀態
  const [apptModalOpen, setApptModalOpen] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [gSheetsImportModalOpen, setGSheetsImportModalOpen] = useState(false);
  const [gSheetsUrl, setGSheetsUrl] = useState('');
  const [importTab, setImportTab] = useState('url'); // 'url' | 'text'
  const [importTextContent, setImportTextContent] = useState('');
  const [gSheetsImporting, setGSheetsImporting] = useState(false);

  // 雲端手動同步相關狀態
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // 還原手動 fetch 載入方法，用於更新本地 UI
  const fetchTherapists = useCallback(async () => {
    try {
      const res = await api.get('/api/therapists');
      setTherapists(res.data || []);
      if (res.data && res.data.length) {
        setSelectedTherapistId(prev => {
          if (!prev) return res.data[0].id;
          const exists = res.data.some(t => t.id === prev);
          return exists ? prev : res.data[0].id;
        });
        setPrintTherapistId(prev => prev || res.data[0].id);
      } else {
        setSelectedTherapistId(null);
      }
    } catch (err) {
      console.error('fetchTherapists error', err);
    }
  }, []);

  const fetchAppointments = useCallback(async () => {
    if (!selectedTherapistId) {
      setRawAppointments([]);
      return;
    }
    setApptLoading(true);
    try {
      const url = selectedTherapistId === 'all'
        ? '/api/appointments'
        : `/api/appointments?therapistId=${selectedTherapistId}`;
      const res = await api.get(url);
      setRawAppointments(res.data || []);
    } catch (err) {
      console.error('fetchAppointments error', err);
      setRawAppointments([]);
    } finally {
      setApptLoading(false);
    }
  }, [selectedTherapistId]);

  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      fetchTherapists();
    }
  }, [fetchTherapists]);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  // --- Firebase Auth 登入狀態監聽 ---
  useEffect(() => {
    if (!auth) {
      console.warn("Firebase Auth 未載入，跳過監聽功能。");
      return;
    }
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        const t = await user.getIdToken();
        setToken(t);
        localStorage.setItem('ps_token', t);
      } else {
        setToken('');
        localStorage.removeItem('ps_token');
      }
    });
    return () => unsubscribe();
  }, []);

  // --- 雲端手動雙向同步邏輯 ---
  const handleDownloadFromCloud = async () => {
    if (!db) {
      alert("❌ 雲端資料庫初始化失敗，無法下載資料。");
      return;
    }
    const confirmDownload = confirm(
      "⚠️ 注意！下載雲端資料將會完全【覆蓋】您目前這台電腦上的所有排程與治療師資料！\n" +
      "您確定要下載嗎？"
    );
    if (!confirmDownload) return;
    
    setSyncing(true);
    try {
      // 1. 取得雲端 therapists
      const tSnap = await getDocs(collection(db, 'therapists'));
      const therapistsList = [];
      tSnap.forEach(d => therapistsList.push({ id: d.id, ...d.data() }));
      
      // 2. 取得雲端 appointments
      const aSnap = await getDocs(collection(db, 'appointments'));
      const apptList = [];
      aSnap.forEach(d => apptList.push({ id: d.id, ...d.data() }));
      
      // 3. 取得雲端 saturday_patients
      const sSnap = await getDocs(collection(db, 'saturday_patients'));
      const satList = [];
      sSnap.forEach(d => satList.push({ id: d.id, ...d.data() }));

      // 取得雲端 saturday_weekday_appointments
      const swSnap = await getDocs(collection(db, 'saturday_weekday_appointments'));
      const satWeekdayList = [];
      swSnap.forEach(d => satWeekdayList.push({ id: d.id, ...d.data() }));
      
      // 4. 寫入本地 localStorage
      localStorage.setItem('therapists', JSON.stringify(therapistsList));
      localStorage.setItem('appointments', JSON.stringify(apptList));
      localStorage.setItem('ps_saturday_patients', JSON.stringify(satList));
      localStorage.setItem('ps_saturday_weekday_appts', JSON.stringify(satWeekdayList));
      
      // 5. 更新 React 狀態
      setTherapists(therapistsList);
      setRawAppointments(apptList);
      setSaturdayPatients(satList);
      setSaturdayWeekdayAppts(satWeekdayList);
      
      alert(`📥 雲端資料同步下載成功！\n共載入：${therapistsList.length} 位治療師、${apptList.length} 筆預約、${satList.length} 筆週六小卡。`);
      setSyncModalOpen(false);
    } catch (err) {
      console.error("Download from cloud error", err);
      alert("下載同步失敗：" + err.message);
    } finally {
      setSyncing(false);
    }
  };

  const handleUploadToCloud = async () => {
    if (!db) {
      alert("❌ 雲端資料庫初始化失敗，無法上傳資料。");
      return;
    }
    const confirmUpload = confirm(
      "⚠️ 警告！此操作將會清空雲端資料庫中的所有資料，並以您本機「目前」的排程與治療師資料進行覆蓋！\n" +
      "其他正在使用線上版的同事將會看到您上傳的版本。您確定要上傳嗎？"
    );
    if (!confirmUpload) return;
    
    setSyncing(true);
    try {
      const localTs = JSON.parse(localStorage.getItem('therapists') || '[]');
      const localAppts = JSON.parse(localStorage.getItem('appointments') || '[]');
      const localSats = JSON.parse(localStorage.getItem('ps_saturday_patients') || '[]');
      const localSatWeekdays = JSON.parse(localStorage.getItem('ps_saturday_weekday_appts') || '[]');
      
      // 1. 清空雲端
      const batch = writeBatch(db);
      
      const tSnap = await getDocs(collection(db, 'therapists'));
      tSnap.forEach(d => batch.delete(d.ref));
      
      const aSnap = await getDocs(collection(db, 'appointments'));
      aSnap.forEach(d => batch.delete(d.ref));
      
      const sSnap = await getDocs(collection(db, 'saturday_patients'));
      sSnap.forEach(d => batch.delete(d.ref));

      const swSnap = await getDocs(collection(db, 'saturday_weekday_appointments'));
      swSnap.forEach(d => batch.delete(d.ref));
      
      await batch.commit(); // 先提交刪除
      
      // 2. 批次寫入新資料 (每 400 筆為一個 batch 寫入，解決 500 限制)
      const allWriteOps = [];
      
      localTs.forEach(item => {
        allWriteOps.push({ col: 'therapists', id: item.id, data: { name: item.name, username: item.username || '' } });
      });
      
      localAppts.forEach(item => {
        allWriteOps.push({
          col: 'appointments',
          id: item.id,
          data: {
            therapistId: item.therapistId,
            patient: item.patient,
            start: item.start,
            duration: Number(item.duration),
            day: Number(item.day),
            patientType: item.patientType || 'outpatient',
            handoverText: item.handoverText || '',
            otTime: item.otTime || '',
            stTime: item.stTime || ''
          }
        });
      });
      
      localSats.forEach(item => {
        allWriteOps.push({
          col: 'saturday_patients',
          id: item.id,
          data: {
            patient: item.patient || '',
            bed: item.bed || '',
            therapist: item.therapist || '',
            ptTime: item.ptTime || '',
            otTime: item.otTime || '',
            stTime: item.stTime || '',
            saturdayTime: item.saturdayTime || '',
            weekdayTime: item.weekdayTime || '',
            note: item.note || ''
          }
        });
      });

      localSatWeekdays.forEach(item => {
        allWriteOps.push({
          col: 'saturday_weekday_appointments',
          id: item.id || `sw-${Date.now()}-${Math.random()}`,
          data: {
            patient: item.patient || '',
            day: Number(item.day),
            start: item.start || '',
            duration: Number(item.duration || 30),
            patientType: item.patientType || 'outpatient'
          }
        });
      });
      
      // 分批寫入
      const CHUNK_SIZE = 400;
      for (let i = 0; i < allWriteOps.length; i += CHUNK_SIZE) {
        const chunk = allWriteOps.slice(i, i + CHUNK_SIZE);
        const writeBatchInstance = writeBatch(db);
        chunk.forEach(op => {
          const docRef = doc(db, op.col, op.id);
          writeBatchInstance.set(docRef, op.data);
        });
        await writeBatchInstance.commit();
      }
      
      alert(`📤 雲端資料同步上傳成功！\n共上傳：${localTs.length} 位治療師、${localAppts.length} 筆預約、${localSats.length} 筆週六小卡。`);
      setSyncModalOpen(false);
    } catch (err) {
      console.error("Upload to cloud error", err);
      alert("上傳同步失敗：" + err.message);
    } finally {
      setSyncing(false);
    }
  };

  async function handleLoginDemo() {
    if (token) {
      // 執行登出
      try {
        if (auth) {
          await auth.signOut();
        }
        setToken('');
        setAuthToken('');
        localStorage.removeItem('ps_token');
        alert('登出成功');
      } catch (err) {
        console.error('Logout error', err);
        alert('登出失敗：' + err.message);
      }
      return;
    }

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
      console.error('login error details', err);
      const errMsg = err.response?.data?.error || err.message || '未知錯誤';
      alert('登入失敗，原因：' + errMsg);
    }
  }

  function handleTherapistChange(e) {
    setSelectedTherapistId(e.target.value || null);
  }

  // 治療師維護相關處理
  async function handleAddTherapist(e) {
    e.preventDefault();
    if (!newTherapistName.trim()) return;
    try {
      await api.post('/api/therapists', { name: newTherapistName.trim() });
      setNewTherapistName("");
      await fetchTherapists();
    } catch (err) {
      console.error("Add therapist error", err);
      alert("新增失敗：" + (err.response?.data?.error || err.message));
    }
  }

  async function handleSaveEdit(id) {
    if (!editingTherapistName.trim()) return;
    try {
      await api.put(`/api/therapists/${id}`, { name: editingTherapistName.trim() });
      setEditingTherapistId(null);
      await fetchTherapists();
    } catch (err) {
      console.error("Edit therapist error", err);
      alert("修改失敗：" + (err.response?.data?.error || err.message));
    }
  }

  async function handleDeleteTherapist(id, name) {
    if (!confirm(`確定要刪除治療師「${name}」？此操作會一併刪除該治療師的所有預約排程！`)) return;
    try {
      await api.delete(`/api/therapists/${id}`);
      
      const updatedList = therapists.filter(t => t.id !== id);
      if (selectedTherapistId === id) {
        if (updatedList.length > 0) {
          setSelectedTherapistId(updatedList[0].id);
        } else {
          setSelectedTherapistId(null);
        }
      }
      
      await fetchTherapists();
    } catch (err) {
      console.error("Delete therapist error", err);
      alert("刪除失敗：" + (err.response?.data?.error || err.message));
    }
  }

  // 新增預約表單處理與即時衝突判定 (單格限2人)
  const toggleNewApptDay = (day) => {
    setNewApptDays(prev => 
      prev.includes(day)
        ? prev.filter(d => d !== day)
        : [...prev, day].sort()
    );
  };

  async function handleCreateAppointment(e) {
    e.preventDefault();
    if (!selectedTherapistId) {
      alert("請先選擇治療師");
      return;
    }
    if (newApptDays.length === 0) {
      alert("請至少選擇一天");
      return;
    }
    if (!newApptPatient.trim()) {
      alert("請輸入病人姓名");
      return;
    }

    const targetTherapistId = selectedTherapistId === 'all' ? selectedTherapistIdInModal : selectedTherapistId;
    if (!targetTherapistId) {
      alert("請選擇負責治療師");
      return;
    }

    // --- 衝突判定邏輯 ---
    const startIdx = SLOTS.findIndex(s => formatTime(s.hour, s.minute) === newApptStartTime);
    if (startIdx === -1) {
      alert("無效的開始時間");
      return;
    }
    
    const timeToMinutes = (tStr) => {
      const [h, m] = tStr.split(':').map(Number);
      return h * 60 + m;
    };

    const newStartMin = timeToMinutes(newApptStartTime);
    const newEndMin = newStartMin + Number(newApptDuration);

    // 找出所有被新預約覆蓋的 30 分鐘時間格
    const coveredSlots = SLOTS.filter(slot => {
      const slotStart = slot.hour * 60 + slot.minute;
      const slotEnd = slotStart + 30;
      return newStartMin < slotEnd && slotStart < newEndMin;
    });

    // 檢查將佔用的每個星期
    for (const day of newApptDays) {
      let collisionDetected = false;
      let collisionTimeStr = "";

      for (const slot of coveredSlots) {
        const slotStart = slot.hour * 60 + slot.minute;
        const slotEnd = slotStart + 30;

        const occupancy = appointments.filter(a => {
          if (a.day !== day || a.therapistId !== targetTherapistId) return false;
          const aStart = timeToMinutes(a.start);
          const aEnd = aStart + Number(a.duration);
          return aStart < slotEnd && slotStart < aEnd;
        }).length;

        if (occupancy >= 2) {
          collisionDetected = true;
          const pad = (num) => String(num).padStart(2, '0');
          collisionTimeStr = `${pad(slot.hour)}:${pad(slot.minute)}`;
          break;
        }
      }

      if (collisionDetected) {
        alert(`⚠️ 預約衝突！\n負責治療師在 ${DAY_LABELS[day]} ${collisionTimeStr} 的預約人數已達上限，無法新增此排程。`);
        return; // 阻擋提交
      }
    }

    // 檢查通過，發送新增請求
    try {
      await api.post('/api/appointments', {
        therapistId: targetTherapistId,
        patient: newApptPatient.trim(),
        start: newApptStartTime,
        duration: newApptDuration,
        days: newApptDays,
        patientType: newApptPatientType,
        otTime: newApptOtTime.trim(),
        stTime: newApptStTime.trim()
      });
      
      // 重設表單
      setNewApptPatient("");
      setNewApptDays([1]);
      setNewApptStartTime("08:00");
      setNewApptDuration(30);
      setNewApptPatientType("outpatient");
      setNewApptOtTime("");
      setNewApptStTime("");
      
      // 重新載入預約
      await fetchAppointments();
      alert("新增預約成功！");
      setApptModalOpen(false);
    } catch (err) {
      console.error("Create appointment error", err);
      alert("新增失敗：" + (err.response?.data?.error || err.message));
    }
  }

  const handleReloadAll = async () => {
    await fetchTherapists();
    await fetchAppointments();
  };

  const handleClearAllData = async () => {
    const confirmClear = confirm(
      "⚠️ 警告！此操作將會清空系統中所有的預約排程、病人交班備註以及治療師資料！\n" +
      "此操作無法復原。您確定要清空所有資料嗎？\n\n" +
      "點擊「確定」開始清空，點擊「取消」退出並保留資料。"
    );
    if (!confirmClear) return;

    try {
      await api.post('/api/clear-data');
      await fetchTherapists();
      await fetchAppointments();
      setSaturdayWeekdayAppts([]);
      setSaturdayPatients([]);
      alert("🗑️ 所有資料已成功清空！");
    } catch (err) {
      console.error("Clear data error", err);
      alert("清空資料失敗：" + (err.response?.data?.error || err.message));
    }
  };
  
  const handleClearSaturdayData = () => {
    const confirmClear = confirm(
      "⚠️ 警告！此操作將會清空所有的週六小卡病患資料與平日對照排程！\n" +
      "此操作無法復原。您確定要清空嗎？"
    );
    if (!confirmClear) return;

    setSaturdayPatients([]);
    setSaturdayWeekdayAppts([]);
    localStorage.setItem('ps_saturday_patients', '[]');
    localStorage.setItem('ps_saturday_weekday_appts', '[]');
    alert("🗑️ 週六住院小卡資料已成功清空！");
  };

  const handleDoubleExcelImport = async () => {
    if (!satImportFile) {
      alert("請選擇週六排程 Excel 檔案");
      return;
    }
    if (!weekImportFile) {
      alert("請選擇平日排程 Excel 檔案");
      return;
    }

    setSatImporting(true);
    try {
      // 1. 同時解析週六與平日排程 Excel 檔
      const [satParsed, weekParsed] = await Promise.all([
        parseSaturdayImportFile(satImportFile),
        parseSimpleWeekdayFile(weekImportFile)
      ]);

      if (satParsed.successData.length === 0 && satParsed.errorRows.length > 0) {
        alert("週六排程檔案解析失敗：" + satParsed.errorRows[0].error);
        return;
      }
      if (weekParsed.successData.length === 0 && weekParsed.errorRows.length > 0) {
        alert("平日排程檔案解析失敗：" + weekParsed.errorRows[0].error);
        return;
      }

      // 2. 更新與寫入 React State
      const mappedSats = satParsed.successData.map(item => ({
        id: item.id || `sat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        patient: item.patient || "",
        bed: item.bed || "",
        therapist: item.therapist || "",
        ptTime: item.ptTime || "",
        otTime: item.otTime || "",
        stTime: item.stTime || "",
        saturdayTime: item.saturdayTime || "",
        weekdayTime: item.weekdayTime || "",
        note: item.note || ""
      }));

      setSaturdayPatients(mappedSats);
      setSaturdayWeekdayAppts(weekParsed.successData);

      // 3. 寫入本地 localStorage
      localStorage.setItem('ps_saturday_patients', JSON.stringify(mappedSats));
      localStorage.setItem('ps_saturday_weekday_appts', JSON.stringify(weekParsed.successData));

      // 4. 顯示統計提示
      let reportMsg = `📥 雙檔案合併匯入成功！\n` +
        `已成功載入 ${mappedSats.length} 筆週六病患小卡，並與 ${weekParsed.successData.length} 筆平日排程完成同步比對！`;
      
      const errCount = satParsed.errorRows.length + weekParsed.errorRows.length;
      if (errCount > 0) {
        reportMsg += `\n(共有 ${errCount} 筆異常資料已被跳過，詳情請看 Console)`;
        if (satParsed.errorRows.length > 0) console.warn("週六解析異常：", satParsed.errorRows);
        if (weekParsed.errorRows.length > 0) console.warn("平日解析異常：", weekParsed.errorRows);
      }

      alert(reportMsg);

      // 5. 重設狀態與關閉 Modal
      setSatImportFile(null);
      setWeekImportFile(null);
      setDoubleImportModalOpen(false);
    } catch (err) {
      console.error("Double files import failed", err);
      alert("雙檔案匯入失敗：" + err.message);
    } finally {
      setSatImporting(false);
    }
  };

  const handlePrintSubmit = async (e) => {
    e.preventDefault();
    if (printType === 'handover' && printDays.length === 0) {
      alert("請至少選擇一個星期進行列印");
      return;
    }
    setPrintModalOpen(false);

    try {
      let printAppts = [];
      if (printTherapistMode === 'all') {
        const res = await api.get('/api/appointments');
        printAppts = res.data || [];
      } else {
        if (printTherapistId === selectedTherapistId) {
          printAppts = appointments;
        } else {
          const res = await api.get(`/api/appointments?therapistId=${printTherapistId}`);
          printAppts = res.data || [];
        }
      }

      const therapistsToPrint = printTherapistMode === 'all' 
        ? therapists 
        : therapists.filter(t => t.id === printTherapistId);

      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert("無法開啟列印視窗，請檢查瀏覽器是否封鎖了彈出型視窗。");
        return;
      }

      let htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>${printType === 'schedule' ? '週排程表列印' : '病人交班單列印'}</title>
          <style>
            @media print {
              @page {
                size: A4 landscape;
                margin: 0.5cm;
              }
              body {
                margin: 0;
                padding: 0;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
              .page-break {
                page-break-before: always;
                break-before: page;
              }
              /* 讓每一頁的列印區塊高度剛好充滿可列印頁面 (A4 橫向高度 210mm，扣掉 margin 後 192mm 最安全) */
              .print-section {
                height: 192mm;
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
                justify-content: flex-start;
                margin-bottom: 0 !important;
              }
              .print-table-merged, .print-table {
                flex: 1 1 auto;
                height: calc(100% - 40px); /* 扣掉 header-title 的高度 */
              }
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              color: #1e293b;
              background-color: #fff;
              padding: 10px;
            }
            .header-title {
              font-size: 18px;
              font-weight: bold;
              text-align: center;
              margin: 0 0 10px 0;
              color: #92400e;
              border-bottom: 2px solid #f59e0b;
              padding-bottom: 6px;
              height: 30px;
              line-height: 30px;
              box-sizing: border-box;
            }
            .header-title-handover {
              font-size: 32px;
              font-weight: bold;
              text-align: center;
              margin: 0 0 15px 0;
              color: #92400e;
              border-bottom: 3px solid #f59e0b;
              padding-bottom: 8px;
            }
            .print-section {
              margin-bottom: 25px;
            }
            .print-table, .print-table-merged {
              width: 100%;
              border-collapse: collapse;
              table-layout: fixed;
              margin-bottom: 10px;
            }
            .print-table th, .print-table td {
              border: 1px solid #475569;
              padding: 10px 8px;
              font-size: 16px;
              text-align: center;
              vertical-align: top;
              word-wrap: break-word;
            }
            .print-table th {
              background-color: #f1f5f9;
              font-weight: bold;
              color: #334155;
            }
            .print-table td.time-col {
              background-color: #f8fafc;
              width: 75px;
              font-weight: bold;
              vertical-align: middle;
              font-size: 16px;
            }
            .appt-list {
              display: flex;
              flex-direction: column;
              gap: 3px;
              text-align: left;
            }
            .appt-item {
              padding: 6px 8px; /* 內距放大 */
              border-radius: 3px;
              font-size: 15px; /* 個別排程病人字體放大 */
              color: #fff;
              font-weight: bold;
              line-height: 1.2;
              box-shadow: 0 1px 1px rgba(0,0,0,0.1);
            }
            /* 全體治療師合併表格專用放大樣式 */
            .print-table-merged th {
              font-size: 16px; /* 主治療師名字字體 */
              padding: 10px 4px;
            }
            .print-table-merged td {
              font-size: 13px;
              padding: 4px 2px; /* 縮小內距，配合卡片大小 */
              vertical-align: top; /* 向上對齊 */
            }
            .print-table-merged td.time-col {
              width: 60px; /* 將時間欄縮窄，釋放空間給其他天數欄 */
              font-size: 13px;
              vertical-align: middle;
            }
            .print-table-merged .appt-list {
              display: flex;
              flex-direction: column;
              gap: 4px;
              align-items: center;
              justify-content: flex-start; /* 向上對齊 */
              width: 100%;
              height: 100%;
              box-sizing: border-box;
              padding-top: 2px; /* 頂部微留間隙，避免貼邊 */
            }
            .print-table-merged .appt-item {
              height: 25px; /* 固定高度，確保所有卡片大小完全相同 */
              width: 96%;   /* 固定寬度比例，確保寬度完全一致 */
              box-sizing: border-box;
              display: flex;
              align-items: center;
              justify-content: center;
              border-radius: 3px;
              color: #fff;
              font-weight: bold;
              box-shadow: 0 1px 1px rgba(0,0,0,0.1);
              margin: 0 auto;
              padding: 0 2px;
            }
            .print-table-merged .appt-name {
              display: block;
              white-space: nowrap; /* 一律不折行，以維持單行顯示 */
              text-align: center;
              width: 100%;
              overflow: visible;
            }
            .merged-sub-header {
              background-color: #f8fafc !important;
              font-size: 13px; /* 星期標頭字體 */
              font-weight: bold;
              color: #475569;
              padding: 6px 2px !important;
            }
            .appt-item.outpatient {
              background-color: #2563eb !important;
              border-left: 3px solid #60a5fa;
            }
            .appt-item.inpatient {
              background-color: #059669 !important;
              border-left: 3px solid #34d399;
            }
            .appt-name {
              display: block;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .handover-table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 15px;
            }
            .handover-table th, .handover-table td {
              border: 1.5px solid #475569;
              padding: 12px 10px;
              font-size: 22px;
              text-align: left;
              vertical-align: top;
              line-height: 1.4;
            }
            .handover-table th {
              background-color: #f1f5f9;
              font-weight: bold;
              color: #334155;
              font-size: 24px;
            }
            .handover-table td.patient-col {
              font-weight: bold;
              width: 15%;
              font-size: 24px;
            }
            .handover-table td.freq-col {
              color: #b45309;
              font-weight: 600;
              width: 15%;
            }
            .handover-table td.time-col {
              width: 25%;
            }
            .handover-table td.text-col {
              width: 45%;
              white-space: pre-wrap;
            }
          </style>
        </head>
        <body>
      `;

      if (printType === 'schedule') {
        const dayLabelsForPrint = ["週一", "週二", "週三", "週四", "週五"];
        const morningSlots = SLOTS.slice(0, 7);
        const afternoonSlots = SLOTS.slice(7);

        if (printTherapistMode === 'all') {
          // 分組：每 3 位治療師一組
          const groups = [];
          for (let i = 0; i < therapistsToPrint.length; i += 3) {
            groups.push(therapistsToPrint.slice(i, i + 3));
          }

          groups.forEach((group, gIdx) => {
            const groupApptRanges = printAppts.map((a) => {
              const startIdx = SLOTS.findIndex((s) => formatTime(s.hour, s.minute) === a.start);
              return {
                ...a,
                startIdx: startIdx !== -1 ? startIdx : 0,
                span: 1,
              };
            });

            const getApptsInCellForGroupPrint = (tId, dayNum, slotIdx) => {
              return groupApptRanges
                .filter((a) => a.therapistId === tId && a.day === dayNum + 1 && slotIdx === a.startIdx)
                .slice(0, 2);
            };

            const sectionClass = gIdx > 0 ? 'print-section page-break' : 'print-section';
            const groupNames = group.map(t => t.name).join('、');

            // 1. 上午
            htmlContent += `
              <div class="${sectionClass}">
                <div class="header-title">物理治療排程系統 — 週排程表-全部治療師 (上午) — ${groupNames}</div>
                <table class="print-table print-table-merged">
                  <thead>
                    <tr>
                      <th rowspan="2" style="width: 60px; vertical-align: middle;">時間</th>
                      ${group.map(t => `<th colspan="5" style="font-size: 15px; font-weight: bold;">${t.name}</th>`).join('')}
                    </tr>
                    <tr>
                      ${group.map(() => 
                        dayLabelsForPrint.map(d => `<th class="merged-sub-header">${d}</th>`).join('')
                      ).join('')}
                    </tr>
                  </thead>
                  <tbody>
                    ${morningSlots.map((slot, sIdx) => {
                      const timeStr = formatTime(slot.hour, slot.minute);
                      return `
                        <tr>
                          <td class="time-col">${timeStr}</td>
                          ${group.map(t => {
                            return [0, 1, 2, 3, 4].map(dayIdx => {
                              const appts = getApptsInCellForGroupPrint(t.id, dayIdx, sIdx);
                              return `
                                <td>
                                  <div class="appt-list">
                                    ${appts.map(appt => {
                                      const name = appt.patient || '';
                                      let fontSize = '13px';
                                      if (name.length >= 5) {
                                        fontSize = '9px';
                                      } else if (name.length === 4) {
                                        fontSize = '11px';
                                      }
                                      return `
                                        <div class="appt-item ${appt.patientType || 'outpatient'}" style="font-size: ${fontSize};">
                                          <span class="appt-name">${name}</span>
                                        </div>
                                      `;
                                    }).join('')}
                                  </div>
                                </td>
                              `;
                            }).join('');
                          }).join('')}
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            `;

            // 2. 下午 (下午表格強制另起一頁)
            htmlContent += `
              <div class="print-section page-break">
                <div class="header-title">物理治療排程系統 — 週排程表-全部治療師 (下午) — ${groupNames}</div>
                <table class="print-table print-table-merged">
                  <thead>
                    <tr>
                      <th rowspan="2" style="width: 60px; vertical-align: middle;">時間</th>
                      ${group.map(t => `<th colspan="5" style="font-size: 15px; font-weight: bold;">${t.name}</th>`).join('')}
                    </tr>
                    <tr>
                      ${group.map(() => 
                        dayLabelsForPrint.map(d => `<th class="merged-sub-header">${d}</th>`).join('')
                      ).join('')}
                    </tr>
                  </thead>
                  <tbody>
                    ${afternoonSlots.map((slot, sIdx) => {
                      const realSlotIdx = sIdx + 7;
                      const timeStr = formatTime(slot.hour, slot.minute);
                      return `
                        <tr>
                          <td class="time-col">${timeStr}</td>
                          ${group.map(t => {
                            return [0, 1, 2, 3, 4].map(dayIdx => {
                              const appts = getApptsInCellForGroupPrint(t.id, dayIdx, realSlotIdx);
                              return `
                                <td>
                                  <div class="appt-list">
                                    ${appts.map(appt => {
                                      const name = appt.patient || '';
                                      let fontSize = '13px';
                                      if (name.length >= 5) {
                                        fontSize = '9px';
                                      } else if (name.length === 4) {
                                        fontSize = '11px';
                                      }
                                      return `
                                        <div class="appt-item ${appt.patientType || 'outpatient'}" style="font-size: ${fontSize};">
                                          <span class="appt-name">${name}</span>
                                        </div>
                                      `;
                                    }).join('')}
                                  </div>
                                </td>
                              `;
                            }).join('');
                          }).join('')}
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            `;
          });
        } else {
          // 個別治療師列印
          therapistsToPrint.forEach((therapist, index) => {
            const tAppts = printAppts.filter(a => a.therapistId === therapist.id);
            
            const apptRanges = tAppts.map((a) => {
              const startIdx = SLOTS.findIndex((s) => formatTime(s.hour, s.minute) === a.start);
              return {
                ...a,
                startIdx: startIdx !== -1 ? startIdx : 0,
                span: 1,
              };
            });

            const getApptsInCellForPrint = (dayNum, slotIdx) => {
              return apptRanges
                .filter((a) => a.day === dayNum + 1 && slotIdx === a.startIdx)
                .slice(0, 2);
            };

            const sectionClass = index > 0 ? 'print-section page-break' : 'print-section';

            // 上午
            htmlContent += `
              <div class="${sectionClass}">
                <div class="header-title">物理治療排程系統 — 週排程表 (上午) — ${therapist.name}</div>
                <table class="print-table">
                  <thead>
                    <tr>
                      <th style="width: 70px;">時間</th>
                      ${dayLabelsForPrint.map(d => `<th>${d}</th>`).join('')}
                    </tr>
                  </thead>
                  <tbody>
                    ${morningSlots.map((slot, sIdx) => {
                      const timeStr = formatTime(slot.hour, slot.minute);
                      return `
                        <tr>
                          <td class="time-col">${timeStr}</td>
                          ${[0, 1, 2, 3, 4].map(dayIdx => {
                            const appts = getApptsInCellForPrint(dayIdx, sIdx);
                            return `
                              <td>
                                <div class="appt-list">
                                  ${appts.map(appt => `
                                    <div class="appt-item ${appt.patientType || 'outpatient'}">
                                      <span class="appt-name">${appt.patient}</span>
                                    </div>
                                  `).join('')}
                                </div>
                              </td>
                            `;
                          }).join('')}
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            `;

            // 下午 (下午表格強制另起一頁)
            htmlContent += `
              <div class="print-section page-break">
                <div class="header-title">物理治療排程系統 — 週排程表 (下午) — ${therapist.name}</div>
                <table class="print-table">
                  <thead>
                    <tr>
                      <th style="width: 70px;">時間</th>
                      ${dayLabelsForPrint.map(d => `<th>${d}</th>`).join('')}
                    </tr>
                  </thead>
                  <tbody>
                    ${afternoonSlots.map((slot, sIdx) => {
                      const realSlotIdx = sIdx + 7;
                      const timeStr = formatTime(slot.hour, slot.minute);
                      return `
                        <tr>
                          <td class="time-col">${timeStr}</td>
                          ${[0, 1, 2, 3, 4].map(dayIdx => {
                            const appts = getApptsInCellForPrint(dayIdx, realSlotIdx);
                            return `
                              <td>
                                <div class="appt-list">
                                  ${appts.map(appt => `
                                    <div class="appt-item ${appt.patientType || 'outpatient'}">
                                      <span class="appt-name">${appt.patient}</span>
                                    </div>
                                  `).join('')}
                                </div>
                              </td>
                            `;
                          }).join('')}
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            `;
          });
        }

      } else {
        const dayNames = { 1: "週一", 2: "週二", 3: "週三", 4: "週四", 5: "週五" };
        let sectionCount = 0;

        therapistsToPrint.forEach((therapist) => {
          printDays.forEach((targetDay) => {
            const tAppts = printAppts.filter(a => {
              const matchesTherapist = a.therapistId === therapist.id;
              const matchesType = !printPatientType || a.patientType === printPatientType;
              const matchesDay = a.day === targetDay;
              return matchesTherapist && matchesType && matchesDay;
            });

            if (tAppts.length === 0) {
              return;
            }

            const groups = {};
            tAppts.forEach(appt => {
              const key = appt.patient.trim();
              if (!groups[key]) {
                groups[key] = {
                  patient: appt.patient,
                  handoverText: appt.handoverText || "",
                  appointments: []
                };
              }
              groups[key].appointments.push(appt);
              if (appt.handoverText && !groups[key].handoverText) {
                groups[key].handoverText = appt.handoverText;
              }
            });

            const handoverList = Object.values(groups).map(g => {
              const allPatientApptsForThisTherapist = printAppts.filter(a => 
                a.therapistId === therapist.id && a.patient.trim() === g.patient.trim()
              );
              const sortedAll = [...allPatientApptsForThisTherapist].sort((a, b) => {
                if (a.day !== b.day) return a.day - b.day;
                return a.start.localeCompare(b.start);
              });
              const uniqueDays = Array.from(new Set(sortedAll.map(a => a.day))).sort();
              const frequencyStr = uniqueDays.map(d => dayNames[d]).join(", ");
              
              const sortedToday = [...g.appointments].sort((a, b) => a.start.localeCompare(b.start));
              const timeDetailsStr = sortedToday.map(a => `${dayNames[a.day]} ${a.start}`).join(", ");
              
              return {
                patient: g.patient,
                frequencyStr,
                timeDetailsStr,
                handoverText: g.handoverText
              };
            });

            const sectionClass = sectionCount > 0 ? 'print-section page-break' : 'print-section';
            sectionCount++;

            htmlContent += `
              <div class="${sectionClass}">
                <div class="header-title-handover">物理治療排程系統 — 病人交班單 (${dayNames[targetDay]}) — ${therapist.name}</div>
                <table class="handover-table">
                  <thead>
                    <tr>
                      <th style="width: 15%;">病人姓名</th>
                      <th style="width: 15%;">治療頻率</th>
                      <th style="width: 25%;">排程時間</th>
                      <th style="width: 45%;">交班備註</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${handoverList.map(h => `
                      <tr>
                        <td class="patient-col">${h.patient}</td>
                        <td class="freq-col">${h.frequencyStr}</td>
                        <td class="time-col">${h.timeDetailsStr}</td>
                        <td class="text-col">${h.handoverText || '<span style="color: #94a3b8; font-style: italic;">無備註內容</span>'}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `;
          });
        });

        if (sectionCount === 0) {
          htmlContent += `
            <div class="print-section" style="text-align: center; padding: 50px;">
              <h2 style="color: #64748b; font-size: 28px;">選取的星期與條件範圍內，目前無任何病人排程與交班資料</h2>
            </div>
          `;
        }
      }

      htmlContent += `
        </body>
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 300);
          }
        </script>
        </html>
      `;

      printWindow.document.write(htmlContent);
      printWindow.document.close();

    } catch (err) {
      console.error("Failed to print reports", err);
      alert("載入列印資料失敗，請重試");
    }
  };

  const handleExportSubmit = async (e) => {
    if (e) e.preventDefault();
    setExportModalOpen(false);

    try {
      let exportAppts = [];
      if (exportTherapistMode === 'all') {
        const res = await api.get('/api/appointments');
        exportAppts = res.data || [];
      } else {
        const targetId = exportTherapistId || selectedTherapistId;
        if (!targetId) {
          alert('請選擇負責治療師');
          return;
        }
        const res = await api.get(`/api/appointments?therapistId=${targetId}`);
        exportAppts = res.data || [];
      }

      // 根據門診/住院進行篩選
      if (exportPatientType) {
        exportAppts = exportAppts.filter(a => a.patientType === exportPatientType);
      }

      if (exportAppts.length === 0) {
        alert('沒有符合篩選條件的排程資料可匯出');
        return;
      }

      const selectedT = therapists.find(t => t.id === (exportTherapistMode === 'all' ? '' : (exportTherapistId || selectedTherapistId)));
      const namePart = exportTherapistMode === 'all' ? '全體治療師' : (selectedT ? selectedT.name : '個別治療師');
      const typePart = exportPatientType === 'outpatient' ? '_門診' : (exportPatientType === 'inpatient' ? '_住院' : '');
      const fileName = `${namePart}_治療排程表${typePart}`;

      if (exportFormat === 'excel') {
        exportToExcel(exportAppts, therapists, fileName);
      } else {
        exportToCSV(exportAppts, therapists, fileName);
      }
    } catch (err) {
      console.error('Export failed', err);
      alert('匯出失敗：' + err.message);
    }
  };

  const updateSaturdayPatientsInFirestore = async (successData) => {
    const mapped = successData.map(item => ({
      id: item.id || `sat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      patient: item.patient || "",
      bed: item.bed || "",
      therapist: item.therapist || "",
      ptTime: item.ptTime || "",
      otTime: item.otTime || "",
      stTime: item.stTime || "",
      saturdayTime: item.saturdayTime || "",
      weekdayTime: item.weekdayTime || "",
      note: item.note || ""
    }));
    setSaturdayPatients(mapped);
    localStorage.setItem('ps_saturday_patients', JSON.stringify(mapped));
  };

  const handleSaturdayFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setSatImporting(true);
    try {
      const parsed = await parseSaturdayImportFile(file);
      if (parsed.successData.length === 0 && parsed.errorRows.length > 0) {
        alert('匯入失敗：' + parsed.errorRows[0].error);
        return;
      }

      await updateSaturdayPatientsInFirestore(parsed.successData);

      let reportMsg = `週六排程匯入成功！\n成功載入 ${parsed.successData.length} 筆病人小卡排程。`;
      if (parsed.errorRows.length > 0) {
        reportMsg += `\n有 ${parsed.errorRows.length} 筆資料解析失敗已跳過。`;
      }
      alert(reportMsg);
    } catch (err) {
      console.error('Import saturday excel failed', err);
      alert('解析 Excel 檔案失敗：' + err.message);
    } finally {
      setSatImporting(false);
    }
  };

  const handleSatWeekdayFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setSatImporting(true);
    try {
      const parsed = await parseImportFile(file);
      if (parsed.successData.length === 0 && parsed.errorRows.length > 0) {
        alert('匯入平日對照失敗：' + parsed.errorRows[0].error);
        return;
      }

      setSaturdayWeekdayAppts(parsed.successData);
      localStorage.setItem('ps_saturday_weekday_appts', JSON.stringify(parsed.successData));
      alert(`成功載入 ${parsed.successData.length} 筆平日對照排程。`);
    } catch (err) {
      console.error('Import weekday config failed', err);
      alert('解析 Excel 檔案失敗：' + err.message);
    } finally {
      setSatImporting(false);
    }
  };

  const handleSaturdayTextImport = async (e) => {
    if (e) e.preventDefault();
    if (!satImportTextContent.trim()) {
      alert('請貼上內容！');
      return;
    }

    setSatImporting(true);
    try {
      const parsed = await parseSaturdayImportText(satImportTextContent);
      if (parsed.successData.length === 0 && parsed.errorRows.length > 0) {
        alert('匯入失敗：' + parsed.errorRows[0].error);
        return;
      }

      await updateSaturdayPatientsInFirestore(parsed.successData);
      setSatImportModalOpen(false);
      setSatImportTextContent('');

      let reportMsg = `週六排程貼上匯入成功！\n成功載入 ${parsed.successData.length} 筆病人小卡排程。`;
      if (parsed.errorRows.length > 0) {
        reportMsg += `\n有 ${parsed.errorRows.length} 筆資料解析失敗已跳過。`;
      }
      alert(reportMsg);
    } catch (err) {
      console.error('Parse saturday text failed', err);
      alert('解析貼上內容失敗：' + err.message);
    } finally {
      setSatImporting(false);
    }
  };

  const handleSaturdayExportWord = () => {
    if (saturdayPatients.length === 0) {
      alert('目前無週六排程資料可匯出');
      return;
    }

    let html = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' 
            xmlns:w='urn:schemas-microsoft-com:office:word' 
            xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <title>週六住院病人排程小卡</title>
        <!--[if gte mso 9]>
        <xml>
          <w:WordDocument>
            <w:View>Print</w:View>
            <w:Zoom>100</w:Zoom>
            <w:DoNotOptimizeForBrowser/>
          </w:WordDocument>
        </xml>
        <![endif]-->
        <style>
          @page {
            size: A4 portrait;
            margin: 0.5cm;
          }
          body {
            font-family: "Microsoft JhengHei", "SimSun", sans-serif;
            color: #000;
          }
          .page-break {
            page-break-before: always;
            break-before: page;
          }
          .card-grid-table {
            width: 100%;
            border-collapse: collapse;
          }
          .card-cell {
            width: 50%;
            padding: 5px;
            vertical-align: top;
          }
          .card-container {
            border: 1.5pt solid #000000;
            font-size: 11pt;
            width: 100%;
            border-collapse: collapse;
          }
          .card-title {
            background-color: #e2e8f0;
            font-size: 14pt;
            font-weight: bold;
            text-align: center;
            padding: 4px;
            border-bottom: 1.5pt solid #000000;
          }
          .treatment-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 3px;
          }
          .treatment-table td {
            padding: 2px;
            border: none;
          }
          .note-cell {
            padding: 5px;
            height: 40px;
            vertical-align: top;
            font-size: 10.5pt;
            background-color: #f8fafc;
          }
        </style>
      </head>
      <body>
    `;

    for (let i = 0; i < saturdayPatients.length; i += 8) {
      const pagePatients = saturdayPatients.slice(i, i + 8);
      const isFirstPage = i === 0;

      html += `<table class="card-grid-table ${isFirstPage ? '' : 'page-break'}">`;
      
      for (let r = 0; r < 4; r++) {
        html += `<tr>`;
        for (let c = 0; c < 2; c++) {
          const item = pagePatients[r * 2 + c];
          html += `<td class="card-cell">`;
          if (item) {
            const satTimeRows = item.saturdayTime ? 
              `<tr><td style="font-size: 11pt; padding: 1px 0;"><b>週六時間：</b>${item.saturdayTime}</td></tr>` :
              `<tr><td style="font-size: 11pt; padding: 1px 0;"><b>物理 (PT)：</b>${item.ptTime || '—'}</td></tr>
               <tr><td style="font-size: 11pt; padding: 1px 0;"><b>職能 (OT)：</b>${item.otTime || '—'}</td></tr>
               <tr><td style="font-size: 11pt; padding: 1px 0;"><b>語言 (ST)：</b>${item.stTime || '—'}</td></tr>`;

            html += `
              <table class="card-container">
                <tr>
                  <td class="card-title" colspan="2">週六住院排程小卡</td>
                </tr>
                <tr>
                  <td style="width: 50%; padding: 4px; border-right: 1px solid #000000; border-bottom: 1px solid #000000; font-size: 11.5pt;">
                    <b>姓名：</b>${item.patient}
                  </td>
                  <td style="width: 50%; padding: 4px; border-bottom: 1px solid #000000; font-size: 11.5pt;">
                    <b>房床：</b>${item.bed || '—'}
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="padding: 4px; border-bottom: 1px solid #000000; font-size: 11.5pt;">
                    <b>負責治療師：</b>${item.therapist || '—'}
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="padding: 4px; border-bottom: 1px solid #000000;">
                    <table class="treatment-table">
                      ${satTimeRows}
                    </table>
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="padding: 4px; border-bottom: 1px solid #000000; font-size: 11pt; color: #c2410c; font-weight: bold;">
                    <b>注意事項：</b>請按照您小卡上安排的時間報到，週六和平常日(週一～五)的報到時間可能會不同
                  </td>
                </tr>
                <tr>
                  <td colspan="2" class="note-cell">
                    <b>備註：</b>${item.note || '無'}
                  </td>
                </tr>
              </table>
            `;
          } else {
            html += `<div style="height: 120px;"></div>`;
          }
          html += `</td>`;
        }
        html += `</tr>`;
      }
      html += `</table>`;
    }

    html += `</body></html>`;

    const blob = new Blob(['\ufeff' + html], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `週六住院病人排程小卡_${new Date().toISOString().slice(0, 10)}.doc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const getWeekdayTimeForPatient = useCallback((patientName) => {
    if (!patientName) return '';
    const dayNames = { 1: "週一", 2: "週二", 3: "週三", 4: "週四", 5: "週五" };
    const match = saturdayWeekdayAppts.filter(a => a.patient && a.patient.trim().toLowerCase() === patientName.trim().toLowerCase());
    if (match.length === 0) return '';
    const sorted = [...match].sort((a, b) => {
      if (a.day !== b.day) return a.day - b.day;
      return a.start.localeCompare(b.start);
    });
    return sorted.map(a => dayNames[a.day] ? `${dayNames[a.day]} ${a.start}` : a.start).join('、');
  }, [saturdayWeekdayAppts]);

  const handleSaturdayPrint = () => {
    if (saturdayPatients.length === 0) {
      alert('目前無週六排程資料可列印');
      return;
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert("無法開啟列印視窗，請檢查瀏覽器是否封鎖了彈出型視窗。");
      return;
    }

    let printHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>列印週六排程小卡</title>
        <style>
          @media print {
            @page {
              size: A4 portrait;
              margin: 0.5cm;
            }
            body {
              margin: 0;
              padding: 0;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .page-break {
              page-break-before: always;
              break-before: page;
            }
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Microsoft JhengHei", sans-serif;
            color: #1e293b;
            background-color: #fff;
            padding: 0;
          }
          .card-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            grid-template-rows: repeat(4, 1fr);
            gap: 10px;
            width: 100%;
            height: 275mm;
            page-break-inside: avoid;
            box-sizing: border-box;
          }
          .card {
            border: 2px solid #0f172a;
            border-radius: 8px;
            overflow: hidden;
            background: #fff;
            display: flex;
            flex-direction: column;
            box-sizing: border-box;
          }
          .card-header {
            background-color: #f1f5f9;
            padding: 6px;
            text-align: center;
            font-size: 24px;
            font-weight: bold;
            border-bottom: 2px solid #0f172a;
            color: #0f172a;
          }
          .card-body {
            padding: 8px 12px;
            display: flex;
            flex-direction: column;
            gap: 4px;
            font-size: 20px;
            flex: 1;
          }
          .card-row {
            display: flex;
            justify-content: space-between;
            border-bottom: 1px solid #e2e8f0;
            padding-bottom: 2px;
          }
          .card-row-full {
            border-bottom: 1px solid #e2e8f0;
            padding-bottom: 2px;
          }
          .treatment-list {
            background-color: #fafafa;
            border-radius: 4px;
            padding: 6px 10px;
            margin-top: 4px;
            display: flex;
            flex-direction: column;
            gap: 4px;
          }
          .treatment-item {
            margin: 0;
            font-size: 24px;
          }
        </style>
      </head>
      <body>
    `;

    for (let i = 0; i < saturdayPatients.length; i += 8) {
      const pagePatients = saturdayPatients.slice(i, i + 8);
      const pageClass = i > 0 ? 'card-grid page-break' : 'card-grid';

      printHtml += `<div class="${pageClass}">`;
      pagePatients.forEach(item => {
        const weekdayTimeVal = getWeekdayTimeForPatient(item.patient) || item.weekdayTime || '—';
        printHtml += `
          <div class="card">
            <div class="card-header">週六住院排程小卡</div>
            <div class="card-body">
              <div class="card-row">
                <span><b>姓名：</b>${item.patient}</span>
                <span><b>房床：</b>${item.bed || '—'}</span>
              </div>
              <div class="card-row-full" style="color: #c2410c; font-weight: bold; font-size: 16px;">
                <b>注意事項：</b>請按照您小卡上安排的時間報到，週六和平常日(週一～五)的報到時間可能會不同
              </div>
              <div class="treatment-list">
                <div class="treatment-item"><b>週一-週五時間：</b>${weekdayTimeVal}</div>
                ${item.saturdayTime ? `
                  <div class="treatment-item"><b>週六時間：</b>${item.saturdayTime}</div>
                ` : `
                  <div class="treatment-item"><b>物理週六：</b>${item.ptTime || '—'}</div>
                  ${(item.otTime || item.stTime) ? `
                    <div class="treatment-item"><b>職能週六：</b>${item.otTime || '—'}</div>
                    <div class="treatment-item"><b>語言週六：</b>${item.stTime || '—'}</div>
                  ` : ''}
                `}
              </div>
            </div>
          </div>
        `;
      });
      printHtml += `</div>`;
    }

    printHtml += `
      </body>
      <script>
        window.onload = function() {
          setTimeout(function() {
            window.print();
          }, 300);
        }
      </script>
      </html>
    `;

    printWindow.document.write(printHtml);
    printWindow.document.close();
  };

  const handleExportDatabase = () => {
    try {
      const therapists = localStorage.getItem('therapists') || '[]';
      const appointments = localStorage.getItem('appointments') || '[]';
      const saturdayPatients = localStorage.getItem('ps_saturday_patients') || '[]';
      const saturdayWeekdayAppts = localStorage.getItem('ps_saturday_weekday_appts') || '[]';
      
      const backupData = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        therapists: JSON.parse(therapists),
        appointments: JSON.parse(appointments),
        saturdayPatients: JSON.parse(saturdayPatients),
        saturdayWeekdayAppts: JSON.parse(saturdayWeekdayAppts)
      };

      const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(
        JSON.stringify(backupData, null, 2)
      )}`;
      
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', jsonString);
      downloadAnchor.setAttribute('download', `patient_scheduler_backup_${new Date().toISOString().slice(0,10)}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      
      alert('💾 系統資料庫備份成功！已下載備份 JSON 檔案。');
    } catch (err) {
      console.error('Database export failed', err);
      alert('備份失敗：' + err.message);
    }
  };

  const handleImportDatabase = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    e.target.value = '';

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const backupData = JSON.parse(event.target.result);
        
        if (!backupData || !Array.isArray(backupData.therapists) || !Array.isArray(backupData.appointments)) {
          alert('❌ 無效的備份檔案格式，還原失敗！');
          return;
        }

        const therapists = backupData.therapists || [];
        const appointments = backupData.appointments || [];
        const saturdayPatients = backupData.saturdayPatients || [];
        const saturdayWeekdayAppts = backupData.saturdayWeekdayAppts || [];

        const confirmRestore = confirm(
          `⚠️ 警告！此操作將會覆蓋您目前電腦中的所有排程與治療師資料！\n` +
          `備份檔時間：${new Date(backupData.timestamp).toLocaleString()}\n` +
          `包含：${therapists.length} 位治療師、${appointments.length} 筆排程預約、${saturdayPatients.length} 筆週六小卡。\n\n` +
          `確定要繼續還原嗎？`
        );

        if (!confirmRestore) return;

        localStorage.setItem('therapists', JSON.stringify(therapists));
        localStorage.setItem('appointments', JSON.stringify(appointments));
        localStorage.setItem('ps_saturday_patients', JSON.stringify(saturdayPatients));
        localStorage.setItem('ps_saturday_weekday_appts', JSON.stringify(saturdayWeekdayAppts));

        alert('📂 資料庫還原成功！網頁即將自動重新整理以套用資料。');
        window.location.reload();
      } catch (err) {
        console.error('Database import failed', err);
        alert('解析還原檔案失敗：' + err.message);
      }
    };
    reader.readAsText(file);
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    e.target.value = '';

    try {
      const parsed = await parseImportFile(file);
      
      if (parsed.successData.length === 0 && parsed.errorRows.length === 1 && parsed.errorRows[0].rowNum === 1) {
        alert(parsed.errorRows[0].error);
        return;
      }

      await processImport(parsed.successData, parsed.errorRows);
    } catch (err) {
      console.error('Import failed', err);
      alert('解析檔案失敗：' + err.message);
    }
  };

  const handleCopyToClipboard = async (range) => {
    try {
      let exportAppts = [];
      if (range === 'all') {
        const res = await api.get('/api/appointments');
        exportAppts = res.data || [];
      } else {
        exportAppts = appointments;
      }

      if (exportAppts.length === 0) {
        alert('沒有可複製的排程資料');
        return;
      }

      const headers = ['治療師姓名', '病人姓名', '預約星期', '開始時間', '時長(分鐘)', '病患類型', '交班備註'];
      const dayNames = { 1: '週一', 2: '週二', 3: '週三', 4: '週四', 5: '週五' };
      const typeNames = { 'outpatient': '門診', 'inpatient': '住院' };

      const rows = exportAppts.map(appt => {
        const therapist = therapists.find(t => t.id === appt.therapistId);
        return [
          therapist ? (therapist.name || therapist.username) : '未分配',
          appt.patient,
          dayNames[appt.day] || `週${appt.day}`,
          appt.start,
          appt.duration,
          typeNames[appt.patientType] || '門診',
          appt.handoverText || ''
        ].join('\t');
      });

      const tsvContent = [headers.join('\t'), ...rows].join('\n');
      await navigator.clipboard.writeText(tsvContent);
      alert('📋 排程資料已成功複製到剪貼簿！\n您現在可以直接在 Google 試算表 (或 Excel) 中選擇任一個單格並直接按 Ctrl+V (或 Cmd+V) 貼上。');
    } catch (err) {
      console.error('Clipboard copy failed', err);
      alert('複製失敗：' + err.message);
    }
  };

  const handleImportGSheetsUrl = async (e) => {
    e.preventDefault();

    if (importTab === 'text') {
      if (!importTextContent.trim()) {
        alert('請貼上試算表內容！');
        return;
      }
      setGSheetsImporting(true);
      try {
        const parsed = await parseImportText(importTextContent);
        if (parsed.successData.length === 0 && parsed.errorRows.length === 1 && parsed.errorRows[0].rowNum === 1) {
          alert(parsed.errorRows[0].error);
          setGSheetsImporting(false);
          return;
        }
        setGSheetsImportModalOpen(false);
        setImportTextContent('');
        await processImport(parsed.successData, parsed.errorRows);
      } catch (err) {
        console.error('Text import failed', err);
        alert('解析貼上內容失敗：' + err.message);
      } finally {
        setGSheetsImporting(false);
      }
      return;
    }

    // 網址下載模式
    if (!gSheetsUrl.trim()) return;

    setGSheetsImporting(true);
    try {
      let fetchUrl = gSheetsUrl.trim();
      
      // 精密 Google Sheets 下載網址轉換
      if (fetchUrl.includes('docs.google.com/spreadsheets')) {
        // 1. 若本身包含 csv 輸出，則直接使用
        if (fetchUrl.includes('output=csv') || fetchUrl.includes('/pub?')) {
          // 不變
        } 
        // 2. 若為發布到網路的網頁版連結 (包含 /d/e/ 開頭且以 /pubhtml 或 /pub 結尾)
        else if (fetchUrl.includes('/d/e/')) {
          // 例如：https://docs.google.com/spreadsheets/d/e/2PACX-xxxx/pubhtml
          fetchUrl = fetchUrl.replace(/\/pubhtml$/, '/pub?output=csv')
                             .replace(/\/pub$/, '/pub?output=csv');
          
          if (!fetchUrl.includes('output=csv')) {
            const matchPub = fetchUrl.match(/\/d\/e\/([a-zA-Z0-9-_]+)/);
            if (matchPub && matchPub[1]) {
              fetchUrl = `https://docs.google.com/spreadsheets/d/e/${matchPub[1]}/pub?output=csv`;
            }
          }
        } 
        // 3. 一般共用連結
        else {
          const match = fetchUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
          if (match && match[1]) {
            fetchUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`;
          } else {
            alert('無法解析 Google 試算表 ID。請確認連結格式。');
            setGSheetsImporting(false);
            return;
          }
        }
      }

      const axiosRes = await axios.get(fetchUrl, { responseType: 'blob' });
      const blob = axiosRes.data;

      const parsed = await parseImportFile(blob);
      
      if (parsed.successData.length === 0 && parsed.errorRows.length === 1 && parsed.errorRows[0].rowNum === 1) {
        alert(parsed.errorRows[0].error);
        setGSheetsImporting(false);
        return;
      }

      setGSheetsImportModalOpen(false);
      setGSheetsUrl('');
      await processImport(parsed.successData, parsed.errorRows);
    } catch (err) {
      console.error('Google Sheets import failed', err);
      
      // 提供友善的替代操作指引
      alert(
        '從 Google 試算表下載失敗！\n錯誤原因：' + (err.response?.data?.error || err.message) + '\n\n' +
        '💡 溫馨提示：可能是瀏覽器或本機網路環境限制了跨域下載 (CORS)。\n' +
        '您可以點選視窗上方的「直接貼上內容」頁籤，全選複製試算表內容後貼上，即可免網路、100% 成功完成匯入！'
      );
    } finally {
      setGSheetsImporting(false);
    }
  };

  const processImport = async (parsedData, initialErrors) => {
    if (parsedData.length === 0 && initialErrors.length === 0) {
      alert('檔案中沒有找到有效的排程資料');
      return;
    }

    let latestTherapists;
    let latestAppointments;
    try {
      const tRes = await api.get('/api/therapists');
      latestTherapists = tRes.data || [];
      const aRes = await api.get('/api/appointments');
      latestAppointments = aRes.data || [];
    } catch {
      alert('無法取得系統最新資料，匯入終止');
      return;
    }

    const currentTherapistNames = latestTherapists.map(t => (t.name || '').trim().toLowerCase());
    const newTherapistNames = [];
    
    parsedData.forEach(row => {
      if (row.therapistName) {
        const nameTrim = row.therapistName.trim();
        if (nameTrim && !currentTherapistNames.includes(nameTrim.toLowerCase()) && !newTherapistNames.includes(nameTrim)) {
          newTherapistNames.push(nameTrim);
        }
      }
    });

    const addedTherapists = [];
    const therapistMap = {};
    latestTherapists.forEach(t => {
      therapistMap[(t.name || '').trim().toLowerCase()] = t.id;
    });

    if (newTherapistNames.length > 0) {
      const confirmCreate = confirm(
        `偵測到檔案中包含 ${newTherapistNames.length} 位系統尚未建立的治療師：\n` +
        `「${newTherapistNames.join(', ')}」\n\n` +
        `點擊「確定」將會自動新增這些治療師並繼續匯入排程，點擊「取消」將終止匯入。`
      );
      
      if (!confirmCreate) return;

      try {
        for (const name of newTherapistNames) {
          const res = await api.post('/api/therapists', { name });
          const newT = res.data;
          therapistMap[name.toLowerCase()] = newT.id;
          addedTherapists.push(name);
        }
        await fetchTherapists();
      } catch (err) {
        alert('建立治療師失敗，匯入終止：' + err.message);
        return;
      }
    }

    const errors = [...initialErrors];
    let successCount = 0;
    let failedCount = errors.length;

    const currentAppts = [...latestAppointments];

    for (const row of parsedData) {
      let targetTherapistId;
      if (row.therapistName) {
        targetTherapistId = therapistMap[row.therapistName.trim().toLowerCase()];
      } else {
        targetTherapistId = selectedTherapistId;
      }
 
      if (!targetTherapistId) {
        errors.push({
          rowNum: row.rowNum,
          patient: row.patient,
          error: '未指定治療師，且系統中目前無選取的預設治療師'
        });
        failedCount++;
        continue;
      }
 
      const startIdx = SLOTS.findIndex(s => formatTime(s.hour, s.minute) === row.start);
      if (startIdx === -1) {
        errors.push({
          rowNum: row.rowNum,
          patient: row.patient,
          error: `開始時間 "${row.start}" 不在系統排程時間內`
        });
        failedCount++;
        continue;
      }
 
      const timeToMinutes = (tStr) => {
        const [h, m] = tStr.split(':').map(Number);
        return h * 60 + m;
      };
 
      const newStartMin = timeToMinutes(row.start);
      const newEndMin = newStartMin + Number(row.duration);
 
      // 找出所有被該預約覆蓋的 30 分鐘時間格
      const coveredSlots = SLOTS.filter(slot => {
        const slotStart = slot.hour * 60 + slot.minute;
        const slotEnd = slotStart + 30;
        return newStartMin < slotEnd && slotStart < newEndMin;
      });
 
      let collisionDetected = false;
      let collisionTime = '';
 
      // 檢查每一個被覆蓋的時間格
      for (const slot of coveredSlots) {
        const slotStart = slot.hour * 60 + slot.minute;
        const slotEnd = slotStart + 30;
 
        const occupancy = currentAppts.filter(a => {
          if (a.day !== row.day || a.therapistId !== targetTherapistId) return false;
          const aStart = timeToMinutes(a.start);
          const aEnd = aStart + Number(a.duration);
          return aStart < slotEnd && slotStart < aEnd;
        }).length;
 
        if (occupancy >= 2) {
          collisionDetected = true;
          const pad = (num) => String(num).padStart(2, '0');
          collisionTime = `${DAY_LABELS[row.day]} ${pad(slot.hour)}:${pad(slot.minute)}`;
          break;
        }
      }
 
      if (collisionDetected) {
        errors.push({
          rowNum: row.rowNum,
          patient: row.patient,
          error: `時段人數已達上限 (2人) 衝突於 [${collisionTime}]`
        });
        failedCount++;
        continue;
      }
 
      try {
        const apptRes = await api.post('/api/appointments', {
          therapistId: targetTherapistId,
          patient: row.patient,
          start: row.start,
          duration: row.duration,
          days: [row.day],
          patientType: row.patientType
        });
 
        if (row.handoverText) {
          const createdAppt = apptRes.data.success?.[0];
          if (createdAppt && createdAppt.id) {
            await api.patch(`/api/appointments/${createdAppt.id}/handover`, {
              handoverText: row.handoverText
            });
          }
        }
 
        // 把新增成功的預約放入對照陣列，以便後續比對
        const createdAppt = apptRes.data.success?.[0];
        if (createdAppt) {
          currentAppts.push(createdAppt);
        } else {
          currentAppts.push({
            therapistId: targetTherapistId,
            day: row.day,
            start: row.start,
            duration: row.duration
          });
        }
 
        successCount++;
      } catch (err) {
        errors.push({
          rowNum: row.rowNum,
          patient: row.patient,
          error: '寫入資料庫失敗：' + (err.response?.data?.error || err.message)
        });
        failedCount++;
      }
    }

    await fetchAppointments();
    
    errors.sort((a, b) => a.rowNum - b.rowNum);

    setImportReport({
      successCount,
      failedCount,
      errors,
      addedTherapists
    });
    setReportModalOpen(true);
  };

  const selectedTherapist = therapists.find(t => t.id === selectedTherapistId);
  const selectedTherapistName = selectedTherapist ? selectedTherapist.name : '';

  return (
    <div className="app">
      <aside className="sidebar">
        <h2>物理治療排程系統</h2>

        <div className="login-block">
          <button type="button" onClick={handleLoginDemo}>
            {token ? '登出系統' : '示範登入 admin'}
          </button>
          <div className="token-indicator">{token ? '已登入' : '未登入'}</div>
        </div>

        {/* Tab 頁面切換選單 */}
        <div className="tab-menu">
          <button 
            type="button"
            className={`tab-btn ${currentTab === 'schedule' ? 'active' : ''}`}
            onClick={() => setCurrentTab('schedule')}
          >
            📅 週排程表
          </button>
          <button 
            type="button"
            className={`tab-btn ${currentTab === 'patients' ? 'active' : ''}`}
            onClick={() => setCurrentTab('patients')}
          >
            👥 病人清單
          </button>
          <button 
            type="button"
            className={`tab-btn ${currentTab === 'handover' ? 'active' : ''}`}
            onClick={() => setCurrentTab('handover')}
          >
            📝 病人交班
          </button>
          <button 
            type="button"
            className={`tab-btn ${currentTab === 'saturday' ? 'active' : ''}`}
            onClick={() => setCurrentTab('saturday')}
          >
            💳 週六住院小卡
          </button>
        </div>

        <div style={{ padding: '0 12px', marginTop: '12px', marginBottom: '12px' }}>
          <button 
            type="button"
            onClick={handleReloadAll} 
            className="wc-btn" 
            style={{ padding: '10px', width: '100%', fontSize: '14px', background: '#334155', color: '#fff', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
          >
            🔄 重新整理資料
          </button>
        </div>

        {/* 摺疊面板 (系統工具與報表) */}
        <div className="sidebar-collapse-section">
          <div 
            className="sidebar-collapse-header"
            onClick={() => setToolsExpanded(!toolsExpanded)}
          >
            <span>🛠️ 系統工具與報表</span>
            <span className={`sidebar-collapse-arrow ${toolsExpanded ? 'expanded' : ''}`}>▶</span>
          </div>
          
          {toolsExpanded && (
            <div className="sidebar-collapse-body">
              <div className="print-actions-block" style={{ marginTop: '0px', paddingTop: '0px' }}>
                <button 
                  type="button"
                  className="wc-btn" 
                  style={{ backgroundColor: '#1e40af', color: 'white', width: '100%', fontSize: '12px', padding: '8px', borderRadius: '6px', fontWeight: 'bold' }}
                  onClick={() => {
                    setPrintType('schedule');
                    setPrintTherapistId(selectedTherapistId || (therapists[0]?.id || ''));
                    setPrintTherapistMode('current');
                    setPrintPatientType('');
                    setPrintModalOpen(true);
                  }}
                >
                  🖨️ 列印週排程表
                </button>
                <button 
                  type="button"
                  className="wc-btn" 
                  style={{ backgroundColor: '#0f766e', color: 'white', width: '100%', fontSize: '12px', padding: '8px', borderRadius: '6px', fontWeight: 'bold', marginTop: '6px' }}
                  onClick={() => {
                    setPrintType('handover');
                    setPrintTherapistId(selectedTherapistId || (therapists[0]?.id || ''));
                    setPrintTherapistMode('current');
                    setPrintPatientType('');
                    setPrintDays([1, 2, 3, 4, 5]);
                    setPrintModalOpen(true);
                  }}
                >
                  🖨️ 列印病人交班單
                </button>
              </div>

              <div className="import-export-block" style={{ marginTop: '4px', borderTop: '1px solid #1e293b', paddingTop: '8px' }}>
                <div className="ie-btn-group">
                  <button 
                    type="button"
                    className="ie-btn"
                    style={{ backgroundColor: '#1e40af', color: 'white', fontWeight: 'bold' }}
                    onClick={() => {
                      setExportTherapistId(selectedTherapistId === 'all' ? (therapists[0]?.id || '') : selectedTherapistId);
                      setExportTherapistMode(selectedTherapistId === 'all' ? 'all' : 'current');
                      setExportPatientType('');
                      setExportFormat('excel');
                      setExportModalOpen(true);
                    }}
                  >
                    📤 匯出排程資料 (可篩選)
                  </button>
                  
                  <button 
                    type="button"
                    className="ie-btn ie-btn-import"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    📥 匯入排程檔案
                  </button>
                  <button 
                    type="button"
                    className="ie-btn"
                    style={{ backgroundColor: '#15803d' }}
                    onClick={() => handleCopyToClipboard('current')}
                  >
                    📋 複製目前排程 (貼上 Google)
                  </button>
                  <button 
                    type="button"
                    className="ie-btn"
                    style={{ backgroundColor: '#166534' }}
                    onClick={() => handleCopyToClipboard('all')}
                  >
                    📋 複製全體排程 (貼上 Google)
                  </button>
                  <button 
                    type="button"
                    className="ie-btn"
                    style={{ backgroundColor: '#1e3a8a' }}
                    onClick={() => setGSheetsImportModalOpen(true)}
                  >
                    🌐 讀取 Google 試算表網址匯入
                  </button>
                  <button 
                    type="button"
                    className="ie-btn"
                    style={{ backgroundColor: '#d97706', marginTop: '4px' }}
                    onClick={handleExportDatabase}
                  >
                    💾 備份資料庫 (JSON)
                  </button>
                  <button 
                    type="button"
                    className="ie-btn"
                    style={{ backgroundColor: '#b45309' }}
                    onClick={() => dbInputRef.current?.click()}
                  >
                    📂 還原資料庫 (JSON)
                  </button>
                  <input 
                    type="file"
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    accept=".xlsx, .xls, .csv"
                    onChange={handleFileChange}
                  />
                  <input 
                    type="file"
                    ref={dbInputRef}
                    style={{ display: 'none' }}
                    accept=".json"
                    onChange={handleImportDatabase}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>

      <div className="main-wrapper">
        <header className="top-header">
          <div className="top-header-left">
            <h1 className="top-header-title">
              {currentTab === 'schedule' && "📅 週排程表"}
              {currentTab === 'patients' && "👥 病人清單"}
              {currentTab === 'handover' && "📝 病人交班備註"}
              {currentTab === 'saturday' && "💳 週六住院小卡"}
            </h1>
            <div className="top-header-subtitle">
              {currentTab === 'schedule' && "檢視與排定每位治療師的每週工作日程 (單格限 2 人)"}
              {currentTab === 'patients' && "查詢與管理院內病患基本資料與類型"}
              {currentTab === 'handover' && "登錄及交付治療師與病人間的治療進度備註"}
              {currentTab === 'saturday' && "匯入週六住院排程，一鍵生成或直接列印病人小卡"}
            </div>
          </div>

          <div className="top-header-right">
            {(currentTab === 'schedule' || currentTab === 'handover') && (
              <div className="header-select-group">
                <label>選擇治療師</label>
                <select value={selectedTherapistId ?? ''} onChange={handleTherapistChange}>
                  {currentTab === 'schedule' && <option value="all">全部治療師</option>}
                  {therapists.map(t => (
                    <option key={t.id} value={t.id}>{t.name || t.username}</option>
                  ))}
                  {!therapists.length && <option value="">無治療師</option>}
                </select>
              </div>
            )}

            {currentTab === 'saturday' && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  type="button" 
                  className="header-btn-manage" 
                  style={{ backgroundColor: '#2563eb', color: 'white' }}
                  onClick={() => setDoubleImportModalOpen(true)}
                >
                  📥 雙檔案合併匯入
                </button>
                <button 
                  type="button" 
                  className="header-btn-manage"
                  style={{ backgroundColor: '#1e3a8a', color: 'white' }}
                  onClick={() => setSatImportModalOpen(true)}
                >
                  📋 貼上內容匯入
                </button>
                <button 
                  type="button" 
                  className="header-btn-manage"
                  style={{ backgroundColor: '#166534', color: 'white' }}
                  onClick={handleSaturdayExportWord}
                >
                  📝 下載 Word 小卡
                </button>
                <button 
                  type="button" 
                  className="header-btn-add-appt"
                  style={{ backgroundColor: '#0f766e', color: 'white' }}
                  onClick={handleSaturdayPrint}
                >
                  🖨️ 列印病人小卡
                </button>
                <button 
                  type="button" 
                  className="header-btn-clear"
                  style={{ backgroundColor: '#dc2626', color: 'white' }}
                  onClick={handleClearSaturdayData}
                >
                  🗑️ 清空週六資料
                </button>
              </div>
            )}
            
            {currentTab !== 'saturday' && (
              <button 
                type="button" 
                className="header-btn-manage" 
                style={{ backgroundColor: '#0284c7', color: 'white' }}
                onClick={() => setSyncModalOpen(true)}
              >
                🔄 雲端資料同步
              </button>
            )}

            {currentTab !== 'saturday' && (
              <button type="button" className="header-btn-manage" onClick={() => setManageModalOpen(true)}>
                ⚙️ 管理治療師
              </button>
            )}

            {currentTab !== 'saturday' && (
              <button type="button" className="header-btn-clear" onClick={handleClearAllData}>
                🗑️ 清空資料
              </button>
            )}

            {currentTab === 'schedule' && selectedTherapistId && (
              <button 
                type="button"
                className="header-btn-add-appt"
                onClick={() => {
                  setApptModalOpen(true);
                  setSelectedTherapistIdInModal(selectedTherapistId === 'all' ? (therapists[0]?.id || '') : selectedTherapistId);
                }}
              >
                ➕ 新增病人預約
              </button>
            )}
          </div>
        </header>

        <main className="main">
          {currentTab === 'schedule' && (
            <WeekCalendar 
              therapistId={selectedTherapistId} 
              therapistName={selectedTherapistName} 
              appointments={appointments}
              loading={apptLoading}
              therapists={therapists}
            />
          )}
          {currentTab === 'patients' && (
            <PatientList 
              appointments={appointments}
              therapists={therapists}
              onUpdate={fetchAppointments}
            />
          )}
          {currentTab === 'handover' && (
            <PatientHandover 
              therapistId={selectedTherapistId} 
              therapistName={selectedTherapistName} 
              appointments={appointments}
              loading={apptLoading}
              onSave={fetchAppointments}
            />
          )}
          {currentTab === 'saturday' && (
            <div className="wc-outer" style={{ padding: 0 }}>
              <div className="wc-container" style={{ width: '100%' }}>
                <div className="wc-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>週六病人小卡預覽</span>
                  <span style={{ fontSize: '12px', color: '#475569' }}>共 {saturdayPatients.length} 位病人</span>
                </div>
                
                {saturdayPatients.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '60px 20px', color: '#6b4a2a' }}>
                    <h3 style={{ fontSize: '18px', marginBottom: '8px' }}>目前尚無週六排程資料</h3>
                    <p style={{ fontSize: '13px', color: '#854d0e', backgroundColor: '#fef9c3', padding: '12px', borderRadius: '8px', display: 'inline-block', maxWidth: '400px', margin: '0 auto', borderLeft: '4px solid #eab308' }}>
                      💡 <b>快速開始：</b>請點擊右上方「📥 匯入週六 Excel」按鈕，選擇包含病人排程的 Excel/CSV 檔案，或使用「📋 貼上內容匯入」直接貼上試算表內容！
                    </p>
                  </div>
                ) : (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: '20px',
                    padding: '10px 0'
                  }}>
                    {saturdayPatients.map((item, idx) => {
                      const weekdayTimeVal = getWeekdayTimeForPatient(item.patient) || item.weekdayTime || '—';
                      return (
                        <div key={idx} style={{
                          border: '1.5px solid #cbd5e1',
                          borderRadius: '8px',
                          overflow: 'hidden',
                          backgroundColor: 'white',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
                          display: 'flex',
                          flexDirection: 'column'
                        }}>
                          <div style={{
                            backgroundColor: '#f1f5f9',
                            padding: '10px 12px',
                            borderBottom: '1px solid #cbd5e1',
                            fontWeight: 'bold',
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: '14px'
                          }}>
                            <span>👤 {item.patient}</span>
                            <span style={{ color: '#0f766e' }}>🏥 {item.bed || '—'}</span>
                          </div>
                          <div style={{ padding: '12px', flex: 1, fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <div style={{ color: '#c2410c', fontWeight: 'bold' }}><b>注意事項：</b>請按照您小卡上安排的時間報到，週六和平常日(週一～五)的報到時間可能會不同</div>
                            <div style={{
                              backgroundColor: '#f8fafc',
                              padding: '8px',
                              borderRadius: '6px',
                              border: '1px solid #e2e8f0',
                              marginTop: '4px'
                            }}>
                              <div style={{ margin: '2px 0', fontSize: '14px' }}><b>週一-週五時間：</b>{weekdayTimeVal}</div>
                              {item.saturdayTime ? (
                                <div style={{ margin: '2px 0', fontSize: '14px' }}><b>週六時間：</b>{item.saturdayTime}</div>
                              ) : (
                                <>
                                  <div style={{ margin: '2px 0', fontSize: '14px' }}><b>物理週六：</b>{item.ptTime || '—'}</div>
                                  {(item.otTime || item.stTime) && (
                                    <>
                                      <div style={{ margin: '2px 0', fontSize: '14px' }}><b>職能週六：</b>{item.otTime || '—'}</div>
                                      <div style={{ margin: '2px 0', fontSize: '14px' }}><b>語言週六：</b>{item.stTime || '—'}</div>
                                    </>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* 治療師維護 Modal */}
      {manageModalOpen && (
        <div className="wc-modal-backdrop" onClick={() => setManageModalOpen(false)}>
          <div className="wc-modal" onClick={(e) => e.stopPropagation()}>
            <h3>治療師維護</h3>
            
            {/* 新增表單 */}
            <form onSubmit={handleAddTherapist} className="add-therapist-form">
              <input 
                type="text" 
                placeholder="輸入新治療師姓名" 
                value={newTherapistName} 
                onChange={e => setNewTherapistName(e.target.value)} 
                required
              />
              <button type="submit">新增</button>
            </form>

            {/* 治療師清單 */}
            <div className="therapist-list">
              {therapists.length === 0 ? (
                <div style={{ textAlign: "center", color: "#666", padding: "10px 0" }}>無治療師資料</div>
              ) : (
                therapists.map(t => (
                  <div key={t.id} className="therapist-item">
                    {editingTherapistId === t.id ? (
                      <input 
                        type="text" 
                        className="therapist-item-input"
                        value={editingTherapistName} 
                        onChange={e => setEditingTherapistName(e.target.value)} 
                        required
                      />
                    ) : (
                      <span className="therapist-item-name">{t.name}</span>
                    )}

                    <div className="therapist-item-actions">
                      {editingTherapistId === t.id ? (
                        <>
                          <button 
                            className="btn-mini btn-mini-success"
                            onClick={() => handleSaveEdit(t.id)}
                          >
                            儲存
                          </button>
                          <button 
                            className="btn-mini btn-mini-secondary"
                            onClick={() => setEditingTherapistId(null)}
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <>
                          <button 
                            className="btn-mini btn-mini-secondary"
                            onClick={() => {
                              setEditingTherapistId(t.id);
                              setEditingTherapistName(t.name);
                            }}
                          >
                            編輯
                          </button>
                          <button 
                            className="btn-mini btn-mini-danger"
                            onClick={() => handleDeleteTherapist(t.id, t.name)}
                          >
                            刪除
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="wc-form-actions">
              <button 
                type="button" 
                className="wc-btn wc-btn-secondary" 
                onClick={() => setManageModalOpen(false)}
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 匯出設定 Modal */}
      {exportModalOpen && (
        <div className="wc-modal-backdrop" onClick={() => setExportModalOpen(false)}>
          <div className="wc-modal" style={{ width: '400px' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '18px', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px', marginBottom: '16px', color: '#1e3a8a' }}>
              📤 匯出排程資料
            </h3>
            
            <form onSubmit={handleExportSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="form-field" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#4b5563' }}>匯出範圍</label>
                <div style={{ display: 'flex', gap: '16px', marginTop: '4px' }}>
                  <label style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', color: '#1e293b' }}>
                    <input 
                      type="radio" 
                      name="exportTherapistMode" 
                      value="current"
                      checked={exportTherapistMode === 'current'}
                      onChange={() => setExportTherapistMode('current')}
                    />
                    個別治療師
                  </label>
                  <label style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', color: '#1e293b' }}>
                    <input 
                      type="radio" 
                      name="exportTherapistMode" 
                      value="all"
                      checked={exportTherapistMode === 'all'}
                      onChange={() => setExportTherapistMode('all')}
                    />
                    全部治療師
                  </label>
                </div>
              </div>

              {exportTherapistMode === 'current' && (
                <div className="form-field" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#4b5563' }}>選擇治療師</label>
                  <select 
                    value={exportTherapistId} 
                    onChange={e => setExportTherapistId(e.target.value)}
                    style={{ padding: '6px', fontSize: '13px', border: '1px solid #cbd5e1', borderRadius: '4px', width: '100%', background: 'white' }}
                  >
                    {therapists.map(t => (
                       <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="form-field" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#4b5563' }}>病人種類</label>
                <select 
                  value={exportPatientType} 
                  onChange={e => setExportPatientType(e.target.value)}
                  style={{ padding: '6px', fontSize: '13px', border: '1px solid #cbd5e1', borderRadius: '4px', width: '100%', background: 'white' }}
                >
                  <option value="">全部</option>
                  <option value="outpatient">門診 (Outpatient)</option>
                  <option value="inpatient">住院 (Inpatient)</option>
                </select>
              </div>

              <div className="form-field" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#4b5563' }}>匯出格式</label>
                <select 
                  value={exportFormat} 
                  onChange={e => setExportFormat(e.target.value)}
                  style={{ padding: '6px', fontSize: '13px', border: '1px solid #cbd5e1', borderRadius: '4px', width: '100%', background: 'white' }}
                >
                  <option value="excel">Excel 試算表 (.xlsx)</option>
                  <option value="csv">CSV 純文字檔 (.csv)</option>
                </select>
              </div>

              <div className="wc-form-actions" style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' }}>
                <button 
                  type="button" 
                  className="wc-btn wc-btn-secondary" 
                  onClick={() => setExportModalOpen(false)}
                  style={{ backgroundColor: '#e5e7eb', color: '#374151' }}
                >
                  取消
                </button>
                <button 
                  type="submit" 
                  className="wc-btn wc-btn-primary"
                  style={{ backgroundColor: '#1e40af', color: 'white' }}
                >
                  開始匯出
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 列印設定 Modal */}
      {printModalOpen && (
        <div className="wc-modal-backdrop" onClick={() => setPrintModalOpen(false)}>
          <div className="wc-modal" style={{ width: '400px' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '18px', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px', marginBottom: '16px', color: '#1e3a8a' }}>
              列印設定 — {printType === 'schedule' ? '週排程表' : '病人交班單'}
            </h3>
            
            <form onSubmit={handlePrintSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="form-field" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#4b5563' }}>列印範圍</label>
                <div style={{ display: 'flex', gap: '16px', marginTop: '4px' }}>
                  <label style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', color: '#1e293b' }}>
                    <input 
                      type="radio" 
                      name="therapistMode" 
                      value="current"
                      checked={printTherapistMode === 'current'}
                      onChange={() => setPrintTherapistMode('current')}
                    />
                    個別治療師
                  </label>
                  <label style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', color: '#1e293b' }}>
                    <input 
                      type="radio" 
                      name="therapistMode" 
                      value="all"
                      checked={printTherapistMode === 'all'}
                      onChange={() => setPrintTherapistMode('all')}
                    />
                    全部治療師
                  </label>
                </div>
              </div>

              {printTherapistMode === 'current' && (
                <div className="form-field" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#4b5563' }}>選擇治療師</label>
                  <select 
                    value={printTherapistId} 
                    onChange={e => setPrintTherapistId(e.target.value)}
                    style={{ padding: '6px', fontSize: '13px', border: '1px solid #cbd5e1', borderRadius: '4px', width: '100%', background: 'white' }}
                  >
                    {therapists.map(t => (
                       <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {printType === 'handover' && (
                <>
                  <div className="form-field" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#4b5563' }}>選擇星期 (可複選)</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '4px' }}>
                      {[1, 2, 3, 4, 5].map(day => (
                        <label key={day} style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', color: '#1e293b' }}>
                          <input 
                            type="checkbox"
                            checked={printDays.includes(day)}
                            onChange={() => {
                              setPrintDays(prev => 
                                prev.includes(day)
                                  ? prev.filter(d => d !== day)
                                  : [...prev, day].sort()
                              );
                            }}
                          />
                          {DAY_LABELS[day]}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="form-field" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#4b5563' }}>病人種類</label>
                    <select 
                      value={printPatientType} 
                      onChange={e => setPrintPatientType(e.target.value)}
                      style={{ padding: '6px', fontSize: '13px', border: '1px solid #cbd5e1', borderRadius: '4px', width: '100%', background: 'white' }}
                    >
                      <option value="">全部</option>
                      <option value="outpatient">門診</option>
                      <option value="inpatient">住院</option>
                    </select>
                  </div>
                </>
              )}

              <div style={{ fontSize: '11px', color: '#1e3a8a', backgroundColor: '#eff6ff', padding: '10px', borderRadius: '6px', marginTop: '4px', borderLeft: '3px solid #2563eb' }}>
                💡 <b>列印說明：</b>本報表將以 <b>A4 橫印 (Landscape)</b>、窄邊距排版輸出。週排程表將自動分為「上午一頁、下午一頁」，方便雙面列印。
              </div>

              <div className="wc-form-actions" style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' }}>
                <button 
                  type="button" 
                  className="wc-btn wc-btn-secondary" 
                  onClick={() => setPrintModalOpen(false)}
                  style={{ backgroundColor: '#e5e7eb', color: '#374151' }}
                >
                  取消
                </button>
                <button 
                  type="submit" 
                  className="wc-btn wc-btn-primary"
                  style={{ backgroundColor: '#1e40af', color: 'white' }}
                >
                  開始列印
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 新增預約 Modal */}
      {apptModalOpen && (
        <div className="wc-modal-backdrop" onClick={() => setApptModalOpen(false)}>
          <div className="wc-modal" style={{ width: '500px' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ color: 'var(--primary)' }}>
              ➕ 新增病人預約 — {selectedTherapistId === 'all' ? '全部治療師' : selectedTherapistName}
            </h3>
            
            <form onSubmit={handleCreateAppointment}>
              <div className="appt-form-grid">
                {selectedTherapistId === 'all' && (
                  <div className="form-field appt-form-full">
                    <label className="appt-form-label">負責治療師</label>
                    <select
                      value={selectedTherapistIdInModal}
                      onChange={e => setSelectedTherapistIdInModal(e.target.value)}
                      style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                      required
                    >
                      <option value="">請選擇治療師</option>
                      {therapists.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="form-field appt-form-full">
                  <label className="appt-form-label">病人姓名</label>
                  <input 
                    type="text" 
                    className="appt-form-input"
                    value={newApptPatient} 
                    onChange={e => setNewApptPatient(e.target.value)} 
                    placeholder="例如：王小明"
                    required
                  />
                </div>

                <div className="form-field appt-form-full">
                  <label className="appt-form-label">預約星期 (複選)</label>
                  <div className="days-checkbox-group">
                    {[1, 2, 3, 4, 5].map(d => (
                      <label key={d} className="days-checkbox-label">
                        <input 
                          type="checkbox" 
                          checked={newApptDays.includes(d)} 
                          onChange={() => toggleNewApptDay(d)}
                        />
                        {DAY_LABELS[d]}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="form-field">
                  <label className="appt-form-label">開始時間</label>
                  <select 
                    value={newApptStartTime} 
                    onChange={e => setNewApptStartTime(e.target.value)}
                    style={{ width: '100%' }}
                  >
                    {TIME_SLOTS.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>

                <div className="form-field">
                  <label className="appt-form-label">時長</label>
                  <select 
                    value={newApptDuration} 
                    onChange={e => setNewApptDuration(Number(e.target.value))}
                    style={{ width: '100%' }}
                  >
                    <option value={30}>30 分鐘</option>
                    <option value={60}>60 分鐘</option>
                    <option value={90}>90 分鐘</option>
                  </select>
                </div>

                <div className="form-field appt-form-full">
                  <label className="appt-form-label">病患類型</label>
                  <select 
                    value={newApptPatientType} 
                    onChange={e => setNewApptPatientType(e.target.value)}
                    style={{ width: '100%' }}
                  >
                    <option value="outpatient">門診 (Outpatient)</option>
                    <option value="inpatient">住院 (Inpatient)</option>
                  </select>
                </div>

                <div className="form-field">
                  <label className="appt-form-label">職能治療時段 (限20字)</label>
                  <input 
                    type="text" 
                    className="appt-form-input"
                    value={newApptOtTime} 
                    onChange={e => setNewApptOtTime(e.target.value)} 
                    placeholder="例如：09:00"
                    maxLength={20}
                  />
                </div>

                <div className="form-field">
                  <label className="appt-form-label">語言治療時段 (限20字)</label>
                  <input 
                    type="text" 
                    className="appt-form-input"
                    value={newApptStTime} 
                    onChange={e => setNewApptStTime(e.target.value)} 
                    placeholder="例如：待排"
                    maxLength={20}
                  />
                </div>
              </div>

              <div className="wc-form-actions">
                <button 
                  type="button" 
                  className="wc-btn wc-btn-secondary" 
                  onClick={() => setApptModalOpen(false)}
                >
                  取消
                </button>
                <button type="submit" className="wc-btn">
                  確認新增
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Google 試算表與貼上匯入 Modal */}
      {gSheetsImportModalOpen && (
        <div className="wc-modal-backdrop" onClick={() => setGSheetsImportModalOpen(false)}>
          <div className="wc-modal" style={{ width: '560px' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ color: 'var(--primary)', borderBottom: '1px solid #cbd5e1', paddingBottom: '8px', marginBottom: '12px' }}>
              🌐 雲端與複製貼上匯入排程
            </h3>

            {/* 頁籤選單 */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
              <button
                type="button"
                className={`tab-btn ${importTab === 'url' ? 'active' : ''}`}
                style={{ padding: '6px 12px', fontSize: '13px', borderRadius: '6px', border: '1px solid #cbd5e1', cursor: 'pointer', background: importTab === 'url' ? '#2563eb' : '#f8fafc', color: importTab === 'url' ? '#fff' : '#475569', fontWeight: 'bold' }}
                onClick={() => setImportTab('url')}
              >
                🔗 讀取雲端網址
              </button>
              <button
                type="button"
                className={`tab-btn ${importTab === 'text' ? 'active' : ''}`}
                style={{ padding: '6px 12px', fontSize: '13px', borderRadius: '6px', border: '1px solid #cbd5e1', cursor: 'pointer', background: importTab === 'text' ? '#2563eb' : '#f8fafc', color: importTab === 'text' ? '#fff' : '#475569', fontWeight: 'bold' }}
                onClick={() => setImportTab('text')}
              >
                📋 直接貼上內容 (100% 成功)
              </button>
            </div>
            
            <form onSubmit={handleImportGSheetsUrl}>
              {importTab === 'url' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div className="form-field">
                    <label className="appt-form-label">Google 試算表網址</label>
                    <input 
                      type="url" 
                      className="appt-form-input"
                      value={gSheetsUrl} 
                      onChange={e => setGSheetsUrl(e.target.value)} 
                      placeholder="請貼上「共用連結」或「發布至網路的網頁連結」"
                      required
                      style={{ width: '100%' }}
                      disabled={gSheetsImporting}
                    />
                  </div>

                  <div style={{ fontSize: '11px', color: '#1e3a8a', backgroundColor: '#eff6ff', padding: '12px', borderRadius: '8px', borderLeft: '4px solid #2563eb', lineHeight: '1.5', textAlign: 'left' }}>
                    💡 <b>設定方式與說明：</b>
                    <div style={{ marginTop: '4px' }}>
                      1. <b>使用共用連結（最推薦）</b>：在 Google 試算表右上方點擊「共用」，將存取權設為<b>「知道連結的任何人均可檢視」</b>，然後複製連結貼在上方。
                    </div>
                    <div style={{ marginTop: '2px' }}>
                      2. <b>使用發布網址</b>：在試算表點擊「檔案」&gt;「分享」&gt;「發布到網路」，選取「整份文件」與<b>「網頁」或「CSV」</b>，發布後將連結貼在上方。
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div className="form-field">
                    <label className="appt-form-label">請在此貼上試算表內容 (支援 TSV/CSV 格式)</label>
                    <textarea
                      className="handover-textarea"
                      value={importTextContent}
                      onChange={e => setImportTextContent(e.target.value)}
                      placeholder="操作方式：&#13;1. 請打開您的 Google 試算表&#13;2. 按下鍵盤 Ctrl + A (或 Cmd + A) 全選，再按 Ctrl + C 複製&#13;3. 點選此處並按 Ctrl + V 貼上，最後按下下方開始匯入！"
                      style={{ width: '100%', height: '160px', fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }}
                      required
                      disabled={gSheetsImporting}
                    />
                  </div>

                  <div style={{ fontSize: '11px', color: '#166534', backgroundColor: '#f0fdf4', padding: '10px', borderRadius: '8px', borderLeft: '4px solid #16a34a', lineHeight: '1.4', textAlign: 'left' }}>
                    💡 <b>離線貼上特色：</b>完全不需要網路請求與跨域 CORS 設定，100% 避開瀏覽器 Network Error 的限制，是跨電腦同步與快速匯入排程最可靠的方式。
                  </div>
                </div>
              )}

              <div className="wc-form-actions" style={{ marginTop: '16px' }}>
                <button 
                  type="button" 
                  className="wc-btn wc-btn-secondary" 
                  onClick={() => setGSheetsImportModalOpen(false)}
                  disabled={gSheetsImporting}
                >
                  取消
                </button>
                <button type="submit" className="wc-btn" disabled={gSheetsImporting}>
                  {gSheetsImporting ? '讀取並匯入中...' : '開始匯入'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 匯入報告 Modal */}
      {reportModalOpen && (
        <div className="wc-modal-backdrop" onClick={() => setReportModalOpen(false)}>
          <div className="wc-modal" style={{ width: '500px' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '18px', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px', marginBottom: '16px', color: '#0f766e' }}>
              📊 檔案匯入報告
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', gap: '16px', fontSize: '14px' }}>
                <div>成功匯入：<span className="report-success">{importReport.successCount} 筆</span></div>
                <div>失敗/跳過：<span className="report-failed" style={{ color: '#dc2626', fontWeight: 600 }}>{importReport.failedCount} 筆</span></div>
              </div>

              {importReport.addedTherapists.length > 0 && (
                <div style={{ fontSize: '13px', backgroundColor: '#f0fdf4', borderLeft: '3px solid #16a34a', padding: '8px', borderRadius: '4px', marginTop: '4px' }}>
                  <b>🆕 自動新增的治療師：</b>
                  <div style={{ marginTop: '2px', color: '#166534' }}>
                    {importReport.addedTherapists.join(', ')}
                  </div>
                </div>
              )}

              {importReport.errors.length > 0 && (
                <div style={{ marginTop: '8px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#4b5563' }}>失敗/衝突明細：</label>
                  <div className="report-content">
                    {importReport.errors.map((err, idx) => (
                      <div key={idx} className="report-item">
                        <span style={{ fontWeight: 'bold', color: '#64748b' }}>第 {err.rowNum} 列</span> (病人: {err.patient})：
                        <span className="report-error" style={{ marginLeft: '4px' }}>{err.error}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ fontSize: '11px', color: '#475569', marginTop: '8px' }}>
                💡 <b>說明：</b>匯入失敗的排程已被安全跳過，不會影響資料庫中的現有排程。您可以修正檔案後重新匯入。
              </div>

              <div className="wc-form-actions" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
                <button 
                  type="button" 
                  className="wc-btn wc-btn-secondary" 
                  onClick={() => setReportModalOpen(false)}
                  style={{ backgroundColor: '#e5e7eb', color: '#374151' }}
                >
                  確認
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 雙檔案合併匯入 Modal */}
      {doubleImportModalOpen && (
        <div className="wc-modal-backdrop" onClick={() => !satImporting && setDoubleImportModalOpen(false)}>
          <div className="wc-modal" style={{ width: '500px' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '18px', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px', marginBottom: '12px', color: '#2563eb', display: 'flex', alignItems: 'center', gap: '8px' }}>
              📥 雙檔案合併匯入（週六與平日排程）
            </h3>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '16px', lineHeight: '1.5' }}>
              請分別選取週六住院排程 Excel 與平常日預約排程 Excel 檔案。系統將解析兩份檔案並透過「病患姓名」將週六小卡的平日時間對齊與合併。
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* 週六排程檔案 */}
              <div style={{ border: '1px dashed #cbd5e1', borderRadius: '8px', padding: '16px', backgroundColor: '#f8fafc' }}>
                <label style={{ display: 'block', fontWeight: 'bold', fontSize: '14px', marginBottom: '8px', color: '#1e293b' }}>
                  1. 週六住院排程 Excel 檔案 (.xlsx, .xls, .csv) <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    className="wc-btn"
                    style={{ backgroundColor: '#2563eb', color: 'white', padding: '6px 12px', fontSize: '13px' }}
                    onClick={() => {
                      const inp = document.createElement('input');
                      inp.type = 'file';
                      inp.accept = '.xlsx, .xls, .csv';
                      inp.onchange = (e) => {
                        const file = e.target.files?.[0];
                        if (file) setSatImportFile(file);
                      };
                      inp.click();
                    }}
                  >
                    瀏覽選擇檔案
                  </button>
                  <span style={{ fontSize: '13px', color: satImportFile ? '#0f766e' : '#64748b', fontWeight: satImportFile ? 'bold' : 'normal' }}>
                    {satImportFile ? `已選擇: ${satImportFile.name}` : '尚未選擇檔案'}
                  </span>
                </div>
              </div>

              {/* 平日排程檔案 */}
              <div style={{ border: '1px dashed #cbd5e1', borderRadius: '8px', padding: '16px', backgroundColor: '#f8fafc' }}>
                <label style={{ display: 'block', fontWeight: 'bold', fontSize: '14px', marginBottom: '8px', color: '#1e293b' }}>
                  2. 平日預約排程 Excel 檔案 (.xlsx, .xls, .csv) <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    className="wc-btn"
                    style={{ backgroundColor: '#0f766e', color: 'white', padding: '6px 12px', fontSize: '13px' }}
                    onClick={() => {
                      const inp = document.createElement('input');
                      inp.type = 'file';
                      inp.accept = '.xlsx, .xls, .csv';
                      inp.onchange = (e) => {
                        const file = e.target.files?.[0];
                        if (file) setWeekImportFile(file);
                      };
                      inp.click();
                    }}
                  >
                    瀏覽選擇檔案
                  </button>
                  <span style={{ fontSize: '13px', color: weekImportFile ? '#0f766e' : '#64748b', fontWeight: weekImportFile ? 'bold' : 'normal' }}>
                    {weekImportFile ? `已選擇: ${weekImportFile.name}` : '尚未選擇檔案'}
                  </span>
                </div>
              </div>
            </div>

            <div className="wc-form-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px', borderTop: '1px solid #e2e8f0', paddingTop: '12px' }}>
              <button
                type="button"
                className="wc-btn wc-btn-secondary"
                disabled={satImporting}
                onClick={() => {
                  setSatImportFile(null);
                  setWeekImportFile(null);
                  setDoubleImportModalOpen(false);
                }}
                style={{ backgroundColor: '#e5e7eb', color: '#374151' }}
              >
                取消
              </button>
              <button
                type="button"
                className="wc-btn"
                disabled={satImporting || !satImportFile || !weekImportFile}
                onClick={handleDoubleExcelImport}
                style={{
                  backgroundColor: (!satImportFile || !weekImportFile || satImporting) ? '#cbd5e1' : '#2563eb',
                  color: 'white',
                  cursor: (!satImportFile || !weekImportFile || satImporting) ? 'not-allowed' : 'pointer'
                }}
              >
                {satImporting ? '⏳ 正在解析與合併...' : '🚀 開始匯入與比對'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 週六排程貼上匯入 Modal */}
      {satImportModalOpen && (
        <div className="wc-modal-backdrop" onClick={() => setSatImportModalOpen(false)}>
          <div className="wc-modal" style={{ width: '560px' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ color: 'var(--primary)', borderBottom: '1px solid #cbd5e1', paddingBottom: '8px', marginBottom: '12px' }}>
              📋 貼上內容匯入週六排程
            </h3>
            
            <form onSubmit={handleSaturdayTextImport}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div className="form-field">
                  <label className="appt-form-label">請在此貼上週六試算表內容 (支援 TSV/CSV 格式)</label>
                  <textarea
                    className="handover-textarea"
                    value={satImportTextContent}
                    onChange={e => setSatImportTextContent(e.target.value)}
                    placeholder="操作方式：&#13;1. 請打開您的週六排程試算表 (Excel)&#13;2. 按下鍵盤 Ctrl + A (或 Cmd + A) 全選，再按 Ctrl + C 複製&#13;3. 點選此處並按 Ctrl + V 貼上，最後按下下方開始匯入！"
                    style={{ width: '100%', height: '180px', fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }}
                    required
                    disabled={satImporting}
                  />
                </div>

                <div style={{ fontSize: '11px', color: '#166534', backgroundColor: '#f0fdf4', padding: '10px', borderRadius: '8px', borderLeft: '4px solid #16a34a', lineHeight: '1.4', textAlign: 'left' }}>
                  💡 <b>說明：</b>標題列必須包含「病人姓名」，亦支援「房號/床號」、「負責治療師」、「物理治療」、「職能治療」、「語言治療」與「備註」。
                </div>
              </div>

              <div className="wc-form-actions" style={{ marginTop: '16px' }}>
                <button 
                  type="button" 
                  className="wc-btn wc-btn-secondary" 
                  onClick={() => setSatImportModalOpen(false)}
                  disabled={satImporting}
                >
                  取消
                </button>
                <button type="submit" className="wc-btn" disabled={satImporting}>
                  開始匯入
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 隱藏的週六排程 Excel 匯入元件 */}
      <input 
        type="file"
        ref={saturdayFileInputRef}
        style={{ display: 'none' }}
        accept=".xlsx, .xls, .csv"
        onChange={handleSaturdayFileChange}
      />

      {/* 隱藏的平日對照 Excel 匯入元件 */}
      <input 
        type="file"
        ref={satWeekdayFileInputRef}
        style={{ display: 'none' }}
        accept=".xlsx, .xls, .csv"
        onChange={handleSatWeekdayFileChange}
      />

      {/* 雲端資料同步 Modal */}
      {syncModalOpen && (
        <div className="wc-modal-backdrop" onClick={() => !syncing && setSyncModalOpen(false)}>
          <div className="wc-modal" style={{ width: '450px' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '18px', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px', marginBottom: '12px', color: '#0284c7' }}>
              🔄 雲端資料同步控制台
            </h3>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '16px', lineHeight: '1.5' }}>
              系統平常在本地運行，不會消耗雲端讀寫量。若需要與其他裝置同步，請在此處手動操作：
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button
                type="button"
                className="wc-btn"
                style={{ backgroundColor: '#0284c7', color: 'white', padding: '12px', height: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                onClick={handleDownloadFromCloud}
                disabled={syncing}
              >
                {syncing ? '同步中...' : '📥 從雲端下載覆蓋本地'}
              </button>
              <button
                type="button"
                className="wc-btn"
                style={{ backgroundColor: '#eab308', color: 'white', padding: '12px', height: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                onClick={handleUploadToCloud}
                disabled={syncing}
              >
                {syncing ? '同步中...' : '📤 將本地資料上傳覆蓋雲端'}
              </button>
            </div>

            <div className="wc-form-actions" style={{ marginTop: '20px' }}>
              <button
                type="button"
                className="wc-btn wc-btn-secondary"
                onClick={() => setSyncModalOpen(false)}
                disabled={syncing}
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
