// frontend/src/App.jsx
import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import api, { setAuthToken } from './api';
import WeekCalendar from './components/WeekCalendar';
import PatientList from './components/PatientList';
import PatientHandover from './components/PatientHandover';
import { parseImportFile, parseImportText, exportToExcel, exportToCSV } from './utils/excelHelper';

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
  const [printPatientType, setPrintPatientType] = useState("");

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

  // 匯入與匯出相關的 State 及 Ref
  const fileInputRef = useRef(null);
  const dbInputRef = useRef(null);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [importReport, setImportReport] = useState({
    successCount: 0,
    failedCount: 0,
    errors: [],
    addedTherapists: []
  });

  // UI/UX 增強狀態
  const [apptModalOpen, setApptModalOpen] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [gSheetsImportModalOpen, setGSheetsImportModalOpen] = useState(false);
  const [gSheetsUrl, setGSheetsUrl] = useState('');
  const [importTab, setImportTab] = useState('url'); // 'url' | 'text'
  const [importTextContent, setImportTextContent] = useState('');
  const [gSheetsImporting, setGSheetsImporting] = useState(false);

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
    
    // 檢查將佔用的每個星期（僅檢查開始時間那一格，且上限改為 2 人）
    for (const day of newApptDays) {
      // 算出在該星期的該開始時間，已有的預約人數
      const currentOccupancy = appointments.filter(a => {
        return a.day === day && a.start === newApptStartTime;
      }).length;
      
      if (currentOccupancy >= 2) {
        alert(`⚠️ 預約衝突！\n負責治療師在 ${DAY_LABELS[day]} ${newApptStartTime} 的預約人數已達上限（${currentOccupancy}/2），無法新增此排程。`);
        return; // 阻擋提交
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

      } else {
        const dayNames = { 1: "週一", 2: "週二", 3: "週三", 4: "週四", 5: "週五" };

        therapistsToPrint.forEach((therapist, index) => {
          const tAppts = printAppts.filter(a => {
            const matchesTherapist = a.therapistId === therapist.id;
            const matchesType = !printPatientType || a.patientType === printPatientType;
            return matchesTherapist && matchesType;
          });

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

  const handleExport = async (format, range) => {
    try {
      let exportAppts = [];
      if (range === 'all') {
        const res = await api.get('/api/appointments');
        exportAppts = res.data || [];
      } else {
        exportAppts = appointments;
      }

      if (exportAppts.length === 0) {
        alert('沒有可匯出的排程資料');
        return;
      }

      const fileName = range === 'all' ? '全體治療排程表' : `${selectedTherapistName}_治療排程表`;
      
      if (format === 'excel') {
        exportToExcel(exportAppts, therapists, fileName);
      } else {
        exportToCSV(exportAppts, therapists, fileName);
      }
    } catch (err) {
      console.error('Export failed', err);
      alert('匯出失敗：' + err.message);
    }
  };

  const handleExportDatabase = () => {
    try {
      const therapists = localStorage.getItem('therapists') || '[]';
      const appointments = localStorage.getItem('appointments') || '[]';
      
      const backupData = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        therapists: JSON.parse(therapists),
        appointments: JSON.parse(appointments)
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

        const confirmRestore = confirm(
          `⚠️ 警告！此操作將會覆蓋您目前電腦中的所有排程與治療師資料！\n` +
          `備份檔時間：${new Date(backupData.timestamp).toLocaleString()}\n` +
          `包含：${backupData.therapists.length} 位治療師、${backupData.appointments.length} 筆排程預約。\n\n` +
          `確定要繼續還原嗎？`
        );

        if (!confirmRestore) return;

        localStorage.setItem('therapists', JSON.stringify(backupData.therapists));
        localStorage.setItem('appointments', JSON.stringify(backupData.appointments));

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

    let latestTherapists = [];
    let latestAppointments = [];
    try {
      const tRes = await api.get('/api/therapists');
      latestTherapists = tRes.data || [];
      const aRes = await api.get('/api/appointments');
      latestAppointments = aRes.data || [];
    } catch (err) {
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

    const occupancyMap = {};

    latestAppointments.forEach(appt => {
      // 僅統計開始時間那一格的人數
      const key = `${appt.therapistId}|${appt.day}|${appt.start}`;
      occupancyMap[key] = (occupancyMap[key] || 0) + 1;
    });

    for (const row of parsedData) {
      let targetTherapistId = null;
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

      let collisionDetected = false;
      let collisionTime = '';

      const key = `${targetTherapistId}|${row.day}|${row.start}`;
      const currentOccupancy = occupancyMap[key] || 0;

      if (currentOccupancy >= 2) {
        collisionDetected = true;
        collisionTime = `${DAY_LABELS[row.day]} ${row.start}`;
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

        // 僅遞增開始時間那一格的計數
        const successKey = `${targetTherapistId}|${row.day}|${row.start}`;
        occupancyMap[successKey] = (occupancyMap[successKey] || 0) + 1;

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
          <button type="button" onClick={handleLoginDemo}>示範登入 admin</button>
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
              <button 
                type="button"
                onClick={handleReloadAll} 
                className="wc-btn" 
                style={{ padding: '8px', width: '100%', fontSize: '13px', background: '#334155', color: '#fff' }}
              >
                🔄 重新整理資料
              </button>

              <div className="print-actions-block" style={{ marginTop: '4px', borderTop: '1px solid #1e293b', paddingTop: '8px' }}>
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
                    className="ie-btn ie-btn-export-excel"
                    onClick={() => handleExport('excel', 'current')}
                  >
                    📊 匯出當前排程 (Excel)
                  </button>
                  <button 
                    type="button"
                    className="ie-btn ie-btn-export-csv"
                    onClick={() => handleExport('csv', 'current')}
                  >
                    📄 匯出當前排程 (CSV)
                  </button>
                  <button 
                    type="button"
                    className="ie-btn ie-btn-export-excel"
                    style={{ backgroundColor: '#166534' }}
                    onClick={() => handleExport('excel', 'all')}
                  >
                    🗂️ 匯出所有排程 (Excel)
                  </button>
                  <button 
                    type="button"
                    className="ie-btn ie-btn-export-csv"
                    style={{ backgroundColor: '#075985' }}
                    onClick={() => handleExport('csv', 'all')}
                  >
                    📝 匯出所有排程 (CSV)
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
            </h1>
            <div className="top-header-subtitle">
              {currentTab === 'schedule' && "檢視與排定每位治療師的每週工作日程 (單格限 4 人)"}
              {currentTab === 'patients' && "查詢與管理院內病患基本資料與類型"}
              {currentTab === 'handover' && "登錄及交付治療師與病人間的治療進度備註"}
            </div>
          </div>

          <div className="top-header-right">
            {(currentTab === 'schedule' || currentTab === 'handover') && (
              <div className="header-select-group">
                <label>選擇治療師</label>
                <select value={selectedTherapistId ?? ''} onChange={handleTherapistChange}>
                  {therapists.map(t => (
                    <option key={t.id} value={t.id}>{t.name || t.username}</option>
                  ))}
                  {!therapists.length && <option value="">無治療師</option>}
                </select>
              </div>
            )}
            
            <button type="button" className="header-btn-manage" onClick={() => setManageModalOpen(true)}>
              ⚙️ 管理治療師
            </button>

            {currentTab === 'schedule' && selectedTherapistId && (
              <button 
                type="button"
                className="header-btn-add-appt"
                onClick={() => setApptModalOpen(true)}
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
              ➕ 新增病人預約 — {selectedTherapistName}
            </h3>
            
            <form onSubmit={handleCreateAppointment}>
              <div className="appt-form-grid">
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
    </div>
  );
}
