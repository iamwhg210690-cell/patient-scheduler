// frontend/src/App.jsx
import { useCallback, useEffect, useRef, useState } from 'react';
import api, { setAuthToken } from './api';
import WeekCalendar from './components/WeekCalendar';
import PatientList from './components/PatientList';
import PatientHandover from './components/PatientHandover';

const SLOT_MIN = 30;
const MORNING_START = 8;
const MORNING_END = 11;
const AFTERNOON_START = 13;
const AFTERNOON_END = 16;

const TIME_SLOTS = [
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', 
  '12:00', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00'
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
  slots.push({ hour: 12, minute: 0 });
  for (let h = AFTERNOON_START; h < AFTERNOON_END; h++) {
    for (let m = 0; m < 60; m += SLOT_MIN) slots.push({ hour: h, minute: m });
  }
  slots.push({ hour: AFTERNOON_END, minute: 0 });
  return slots;
}

const SLOTS = generateSlots();

export default function App() {
  const [therapists, setTherapists] = useState([]);
  const [selectedTherapistId, setSelectedTherapistId] = useState(null);
  const [token, setToken] = useState(() => {
    const saved = localStorage.getItem('ps_token');
    if (saved) {
      setAuthToken(saved);
    }
    return saved || '';
  });

  // 分頁切換狀態
  const [currentTab, setCurrentTab] = useState("schedule"); // schedule, patients, handover

  // 狀態提升：目前選擇治療師的預約資料與加載狀態
  const [appointments, setAppointments] = useState([]);
  const [apptLoading, setApptLoading] = useState(false);

  // 列印相關 State
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printType, setPrintType] = useState("schedule"); // schedule, handover
  const [printTherapistMode, setPrintTherapistMode] = useState("current"); // current, all
  const [printTherapistId, setPrintTherapistId] = useState("");

  // 新增預約表單 State (常駐 Sidebar 區)
  const [newApptPatient, setNewApptPatient] = useState("");
  const [newApptDays, setNewApptDays] = useState([1]); // 預設週一
  const [newApptStartTime, setNewApptStartTime] = useState("08:00");
  const [newApptDuration, setNewApptDuration] = useState(30);
  const [newApptPatientType, setNewApptPatientType] = useState("outpatient");

  // 管理 Modal 相關 State
  const [manageModalOpen, setManageModalOpen] = useState(false);
  const [newTherapistName, setNewTherapistName] = useState("");
  const [editingTherapistId, setEditingTherapistId] = useState(null);
  const [editingTherapistName, setEditingTherapistName] = useState("");

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
      console.error('fetchTherapists', err);
      alert('無法取得治療師清單，請確認後端是否啟動');
    }
  }, []);

  const fetchAppointments = useCallback(async () => {
    if (!selectedTherapistId) {
      setAppointments([]);
      return;
    }
    setApptLoading(true);
    try {
      const res = await api.get(`/api/appointments?therapistId=${selectedTherapistId}`);
      setAppointments(res.data || []);
    } catch (err) {
      console.error('fetchAppointments error', err);
      setAppointments([]);
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

  // 新增預約表單處理與即時衝突判定 (單格限4人)
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

    // --- 衝突判定邏輯 ---
    const startIdx = SLOTS.findIndex(s => formatTime(s.hour, s.minute) === newApptStartTime);
    if (startIdx === -1) {
      alert("無效的開始時間");
      return;
    }
    const span = Math.max(1, Math.round(newApptDuration / 30));
    
    // 檢查將佔用的每個星期及 30 分鐘 slot
    for (const day of newApptDays) {
      for (let i = 0; i < span; i++) {
        const currentSlotIdx = startIdx + i;
        if (currentSlotIdx >= SLOTS.length) {
          alert(`時長超出治療排程時間範圍！`);
          return;
        }
        
        const targetTimeStr = formatTime(SLOTS[currentSlotIdx].hour, SLOTS[currentSlotIdx].minute);
        
        // 算出在此 slot 內已有的人數
        const currentOccupancy = appointments.filter(a => {
          if (a.day !== day) return false;
          const aStartIdx = SLOTS.findIndex(s => formatTime(s.hour, s.minute) === a.start);
          const aSpan = Math.max(1, Math.round(a.duration / 30));
          return currentSlotIdx >= aStartIdx && currentSlotIdx < aStartIdx + aSpan;
        }).length;
        
        if (currentOccupancy >= 4) {
          alert(`⚠️ 預約衝突！\n負責治療師在 ${DAY_LABELS[day]} ${targetTimeStr} 的預約人數已達上限（${currentOccupancy}/4），無法新增此排程。`);
          return; // 阻擋提交
        }
      }
    }

    // 檢查通過，發送新增請求
    try {
      await api.post('/api/appointments', {
        therapistId: selectedTherapistId,
        patient: newApptPatient.trim(),
        start: newApptStartTime,
        duration: newApptDuration,
        days: newApptDays,
        patientType: newApptPatientType
      });
      
      // 重設表單
      setNewApptPatient("");
      setNewApptDays([1]);
      setNewApptStartTime("08:00");
      setNewApptDuration(30);
      setNewApptPatientType("outpatient");
      
      // 重新載入預約
      await fetchAppointments();
      alert("新增預約成功！");
    } catch (err) {
      console.error("Create appointment error", err);
      alert("新增失敗：" + (err.response?.data?.error || err.message));
    }
  }

  const handleReloadAll = async () => {
    await fetchTherapists();
    await fetchAppointments();
  };

  const handlePrintSubmit = async (e) => {
    e.preventDefault();
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
            }
            .print-section {
              margin-bottom: 25px;
            }
            .print-table {
              width: 100%;
              border-collapse: collapse;
              table-layout: fixed;
              margin-bottom: 10px;
            }
            .print-table th, .print-table td {
              border: 1px solid #475569;
              padding: 6px 4px;
              font-size: 11px;
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
              width: 60px;
              font-weight: bold;
              vertical-align: middle;
            }
            .appt-list {
              display: flex;
              flex-direction: column;
              gap: 2px;
              text-align: left;
            }
            .appt-item {
              padding: 2px 4px;
              border-radius: 3px;
              font-size: 10px;
              color: #fff;
              font-weight: bold;
              line-height: 1.1;
              box-shadow: 0 1px 1px rgba(0,0,0,0.1);
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
              margin-top: 10px;
            }
            .handover-table th, .handover-table td {
              border: 1px solid #475569;
              padding: 8px 10px;
              font-size: 12px;
              text-align: left;
              vertical-align: top;
            }
            .handover-table th {
              background-color: #f1f5f9;
              font-weight: bold;
              color: #334155;
            }
            .handover-table td.patient-col {
              font-weight: bold;
              width: 15%;
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
        
        therapistsToPrint.forEach((therapist, index) => {
          const tAppts = printAppts.filter(a => a.therapistId === therapist.id);
          
          const apptRanges = tAppts.map((a) => {
            const startIdx = SLOTS.findIndex((s) => formatTime(s.hour, s.minute) === a.start);
            const span = Math.max(1, Math.round(a.duration / 30));
            return {
              ...a,
              startIdx: startIdx !== -1 ? startIdx : 0,
              span,
            };
          });

          const getApptsInCellForPrint = (dayNum, slotIdx) => {
            return apptRanges
              .filter((a) => a.day === dayNum + 1 && slotIdx >= a.startIdx && slotIdx < a.startIdx + a.span)
              .slice(0, 4);
          };

          const morningSlots = SLOTS.slice(0, 8);
          const afternoonSlots = SLOTS.slice(8);

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
                                    <span class="appt-name">${appt.patient} (${appt.duration}分)</span>
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
                    const realSlotIdx = sIdx + 8;
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
                                    <span class="appt-name">${appt.patient} (${appt.duration}分)</span>
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

      } else {
        const dayNames = { 1: "週一", 2: "週二", 3: "週三", 4: "週四", 5: "週五" };

        therapistsToPrint.forEach((therapist, index) => {
          const tAppts = printAppts.filter(a => a.therapistId === therapist.id);

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
            const sorted = [...g.appointments].sort((a, b) => {
              if (a.day !== b.day) return a.day - b.day;
              return a.start.localeCompare(b.start);
            });
            const uniqueDays = Array.from(new Set(sorted.map(a => a.day))).sort();
            const frequencyStr = uniqueDays.map(d => dayNames[d]).join(", ");
            const timeDetailsStr = sorted.map(a => `${dayNames[a.day]} ${a.start}`).join(", ");
            return {
              patient: g.patient,
              frequencyStr,
              timeDetailsStr,
              handoverText: g.handoverText
            };
          });

          const sectionClass = index > 0 ? 'print-section page-break' : 'print-section';

          htmlContent += `
            <div class="${sectionClass}">
              <div class="header-title">物理治療排程系統 — 病人交班單 — ${therapist.name}</div>
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
                  ${handoverList.length === 0 ? `
                    <tr>
                      <td colspan="4" style="text-align: center; color: #666; padding: 20px;">此治療師名下目前無交班資料</td>
                    </tr>
                  ` : handoverList.map(h => `
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

  const selectedTherapist = therapists.find(t => t.id === selectedTherapistId);
  const selectedTherapistName = selectedTherapist ? selectedTherapist.name : '';

  return (
    <div className="app">
      <aside className="sidebar">
        <h2>物理治療排程系統</h2>

        <div className="login-block">
          <button onClick={handleLoginDemo}>示範登入 admin</button>
          <div className="token-indicator">{token ? '已登入' : '未登入'}</div>
        </div>

        {/* Tab 頁面切換選單 */}
        <div className="tab-menu">
          <button 
            className={`tab-btn ${currentTab === 'schedule' ? 'active' : ''}`}
            onClick={() => setCurrentTab('schedule')}
          >
            週排程表
          </button>
          <button 
            className={`tab-btn ${currentTab === 'patients' ? 'active' : ''}`}
            onClick={() => setCurrentTab('patients')}
          >
            病人清單
          </button>
          <button 
            className={`tab-btn ${currentTab === 'handover' ? 'active' : ''}`}
            onClick={() => setCurrentTab('handover')}
          >
            病人交班
          </button>
        </div>

        <div className="therapist-select">
          <label>選擇治療師</label>
          <select value={selectedTherapistId ?? ''} onChange={handleTherapistChange}>
            {therapists.map(t => (
              <option key={t.id} value={t.id}>{t.name || t.username}</option>
            ))}
            {!therapists.length && <option value="">無治療師</option>}
          </select>
          <button className="manage-btn" onClick={() => setManageModalOpen(true)}>
            管理治療師
          </button>
        </div>

        {/* 預約新增表單 (僅在週排程 Tab 且有選取治療師時顯示) */}
        {currentTab === 'schedule' && selectedTherapistId && (
          <div className="sidebar-form-block" style={{ marginTop: '20px', borderTop: '1px solid #cbd5e1', paddingTop: '16px' }}>
            <h4 style={{ fontSize: '14px', marginBottom: '10px', color: '#92400e', fontWeight: 'bold' }}>新增病人預約</h4>
            <form onSubmit={handleCreateAppointment} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div className="form-field" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#4b5563' }}>病人姓名</label>
                <input 
                  type="text" 
                  value={newApptPatient} 
                  onChange={e => setNewApptPatient(e.target.value)} 
                  placeholder="輸入姓名"
                  required
                  style={{ padding: '6px', fontSize: '13px', border: '1px solid #cbd5e1', borderRadius: '4px' }}
                />
              </div>

              <div className="form-field" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#4b5563' }}>預約星期</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {[1, 2, 3, 4, 5].map(d => (
                    <label key={d} style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '2px', cursor: 'pointer' }}>
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

              <div className="form-field" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#4b5563' }}>開始時間</label>
                <select 
                  value={newApptStartTime} 
                  onChange={e => setNewApptStartTime(e.target.value)}
                  style={{ padding: '6px', fontSize: '13px', border: '1px solid #cbd5e1', borderRadius: '4px' }}
                >
                  {TIME_SLOTS.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div className="form-field" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#4b5563' }}>時長</label>
                <select 
                  value={newApptDuration} 
                  onChange={e => setNewApptDuration(Number(e.target.value))}
                  style={{ padding: '6px', fontSize: '13px', border: '1px solid #cbd5e1', borderRadius: '4px' }}
                >
                  <option value={30}>30分鐘</option>
                  <option value={60}>60分鐘</option>
                  <option value={90}>90分鐘</option>
                </select>
              </div>

              <div className="form-field" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#4b5563' }}>病患類型</label>
                <select 
                  value={newApptPatientType} 
                  onChange={e => setNewApptPatientType(e.target.value)}
                  style={{ padding: '6px', fontSize: '13px', border: '1px solid #cbd5e1', borderRadius: '4px' }}
                >
                  <option value="outpatient">門診</option>
                  <option value="inpatient">住院</option>
                </select>
              </div>

              <button type="submit" className="wc-btn wc-btn-primary" style={{ padding: '8px', fontSize: '13px', marginTop: '4px', width: '100%' }}>
                新增預約
              </button>
            </form>
          </div>
        )}

        <div className="actions" style={{ marginTop: '16px' }}>
          <button onClick={handleReloadAll}>重新載入清單</button>
        </div>

        <div className="print-actions-block" style={{ marginTop: '20px', borderTop: '1px solid #cbd5e1', paddingTop: '16px' }}>
          <h4 style={{ fontSize: '14px', marginBottom: '10px', color: '#1e3a8a', fontWeight: 'bold' }}>報表列印</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button 
              className="wc-btn" 
              style={{ backgroundColor: '#1e40af', color: 'white', width: '100%', fontSize: '13px', padding: '8px', borderRadius: '6px', fontWeight: 'bold' }}
              onClick={() => {
                setPrintType('schedule');
                setPrintTherapistId(selectedTherapistId || (therapists[0]?.id || ''));
                setPrintTherapistMode('current');
                setPrintModalOpen(true);
              }}
            >
              🖨️ 列印週排程表
            </button>
            <button 
              className="wc-btn" 
              style={{ backgroundColor: '#0f766e', color: 'white', width: '100%', fontSize: '13px', padding: '8px', borderRadius: '6px', fontWeight: 'bold' }}
              onClick={() => {
                setPrintType('handover');
                setPrintTherapistId(selectedTherapistId || (therapists[0]?.id || ''));
                setPrintTherapistMode('current');
                setPrintModalOpen(true);
              }}
            >
              🖨️ 列印病人交班單
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        {currentTab === 'schedule' && (
          <WeekCalendar 
            therapistId={selectedTherapistId} 
            therapistName={selectedTherapistName} 
            appointments={appointments}
            loading={apptLoading}
          />
        )}
        {currentTab === 'patients' && <PatientList />}
        {currentTab === 'handover' && (
          <PatientHandover 
            therapistId={selectedTherapistId} 
            therapistName={selectedTherapistName} 
            appointments={appointments}
            loading={apptLoading}
            onSave={fetchAppointments}
          />
        )}
      </main>

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
    </div>
  );
}
