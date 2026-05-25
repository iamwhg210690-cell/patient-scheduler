import { useState, useEffect, useCallback, useMemo } from "react";
import api from "../api";

const TIME_SLOTS = [
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', 
  '12:00', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00'
];

const SLOT_MIN = 30;
const MORNING_START = 8;
const MORNING_END = 11;
const AFTERNOON_START = 13;
const AFTERNOON_END = 16;

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

export default function PatientList() {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [therapists, setTherapists] = useState([]);

  // 搜尋過濾條件
  const [search, setSearch] = useState("");
  const [selectedDay, setSelectedDay] = useState("");
  const [selectedTherapistId, setSelectedTherapistId] = useState("");

  // 編輯與詳細資料 Modal 控制
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedPatientGroup, setSelectedPatientGroup] = useState(null);

  // 編輯單筆預約與病患姓名的相關 State
  const [editingApptId, setEditingApptId] = useState(null);
  const [editForm, setEditForm] = useState({
    day: 1,
    start: "08:00",
    duration: 30,
    patientType: "outpatient",
    therapistId: "",
  });
  const [editPatientName, setEditPatientName] = useState("");

  const dayLabels = { 1: "週一", 2: "週二", 3: "週三", 4: "週四", 5: "週五" };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [apptRes, therapistRes] = await Promise.all([
        api.get("/api/appointments"),
        api.get("/api/therapists"),
      ]);
      setAppointments(apptRes.data || []);
      setTherapists(therapistRes.data || []);
    } catch (err) {
      console.error("Failed to fetch data for patient list", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 核心邏輯：將預約資料依「病患姓名」進行分群 (Group By)
  const patientGroups = useMemo(() => {
    const groups = {};
    
    appointments.forEach((appt) => {
      const key = appt.patient.trim();
      if (!groups[key]) {
        groups[key] = {
          patient: appt.patient,
          therapistIds: new Set(),
          therapistNames: new Set(),
          patientType: appt.patientType || "outpatient",
          appointments: [],
        };
      }
      
      groups[key].appointments.push(appt);
      groups[key].therapistIds.add(appt.therapistId);
      if (appt.therapistName) {
        groups[key].therapistNames.add(appt.therapistName);
      } else {
        groups[key].therapistNames.add(appt.therapistId);
      }
    });

    // 轉換成方便渲染的格式
    return Object.values(groups).map((group) => {
      // 排序預約時間（星期升序，時間升序）
      const sortedAppts = [...group.appointments].sort((a, b) => {
        if (a.day !== b.day) return a.day - b.day;
        return a.start.localeCompare(b.start);
      });

      // 計算治療頻率，例如 [1, 3, 5] -> "週一, 週三, 週五"
      const uniqueDays = Array.from(new Set(sortedAppts.map((a) => a.day))).sort();
      const frequencyStr = uniqueDays.map((d) => dayLabels[d]).join(", ");

      return {
        patient: group.patient,
        therapistIds: Array.from(group.therapistIds),
        therapistNamesStr: Array.from(group.therapistNames).join(", "),
        patientType: group.patientType,
        frequencyStr,
        appointments: sortedAppts,
      };
    });
  }, [appointments]);

  // 搜尋與篩選邏輯
  const filteredPatients = useMemo(() => {
    return patientGroups.filter((pg) => {
      // 關鍵字搜尋 (病人姓名 或 負責治療師的姓名)
      const matchesKeyword =
        pg.patient.toLowerCase().includes(search.toLowerCase()) ||
        pg.therapistNamesStr.toLowerCase().includes(search.toLowerCase());

      // 星期篩選：只要病人的任何一筆預約落在該星期，即符合
      const matchesDay =
        selectedDay === "" || pg.appointments.some((a) => String(a.day) === String(selectedDay));

      // 負責治療師篩選：只要病人的任何一筆預約包含該治療師，即符合
      const matchesTherapist =
        selectedTherapistId === "" || pg.therapistIds.includes(selectedTherapistId);

      return matchesKeyword && matchesDay && matchesTherapist;
    });
  }, [patientGroups, search, selectedDay, selectedTherapistId]);

  function openDetail(patientGroup) {
    setSelectedPatientGroup(patientGroup);
    setEditPatientName(patientGroup.patient);
    setEditingApptId(null); // 重設編輯列狀態
    setDetailModalOpen(true);
  }

  // 1. 批量更新病患姓名
  const handleUpdatePatientName = async () => {
    if (!editPatientName.trim()) {
      alert("請輸入病人姓名");
      return;
    }
    const oldName = selectedPatientGroup.patient;
    const newName = editPatientName.trim();
    if (oldName === newName) return;

    if (!confirm(`確定要將病患姓名由「${oldName}」修改為「${newName}」嗎？\n這會一併更新該病人的所有排程預約。`)) {
      return;
    }

    try {
      setLoading(true);
      const promises = selectedPatientGroup.appointments.map((a) =>
        api.put(`/api/appointments/${a.id}`, {
          patient: newName,
          start: a.start,
          duration: a.duration,
          day: a.day,
          patientType: a.patientType || "outpatient",
          handoverText: a.handoverText || "",
          therapistId: a.therapistId,
        })
      );
      await Promise.all(promises);
      alert("病人姓名更新成功！");
      await loadData();
      
      // 更新目前 Modal 內狀態
      const updatedAppts = selectedPatientGroup.appointments.map(a => ({ ...a, patient: newName }));
      setSelectedPatientGroup({
        ...selectedPatientGroup,
        patient: newName,
        appointments: updatedAppts
      });
    } catch (err) {
      console.error("Failed to update patient name", err);
      alert("修改姓名失敗，請重試");
    } finally {
      setLoading(false);
    }
  };

  // 2. 啟動行內編輯
  const startEditAppt = (appt) => {
    setEditingApptId(appt.id);
    setEditForm({
      day: appt.day,
      start: appt.start,
      duration: appt.duration,
      patientType: appt.patientType || "outpatient",
      therapistId: appt.therapistId,
    });
  };

  // 3. 儲存單筆編輯（含衝突檢測）
  const handleSaveApptEdit = async (appt) => {
    const { day, start, duration, patientType, therapistId } = editForm;

    // 衝突判定
    const startIdx = SLOTS.findIndex(s => formatTime(s.hour, s.minute) === start);
    if (startIdx === -1) {
      alert("無效的開始時間");
      return;
    }
    const span = Math.max(1, Math.round(duration / 30));

    // 檢查將佔用的每個 30 分鐘 slot
    for (let i = 0; i < span; i++) {
      const currentSlotIdx = startIdx + i;
      if (currentSlotIdx >= SLOTS.length) {
        alert("時長超出排程時間範圍！");
        return;
      }

      const targetTimeStr = formatTime(SLOTS[currentSlotIdx].hour, SLOTS[currentSlotIdx].minute);

      // 算出在此 slot 內已有的人數 (排除目前正在編輯的這一筆 appt.id)
      const currentOccupancy = appointments.filter(a => {
        if (a.id === appt.id) return false; // 排除自己
        if (a.day !== day) return false;
        if (a.therapistId !== therapistId) return false;
        
        const aStartIdx = SLOTS.findIndex(s => formatTime(s.hour, s.minute) === a.start);
        const aSpan = Math.max(1, Math.round(a.duration / 30));
        return currentSlotIdx >= aStartIdx && currentSlotIdx < aStartIdx + aSpan;
      }).length;

      if (currentOccupancy >= 4) {
        const tName = therapists.find(t => t.id === therapistId)?.name || therapistId;
        alert(`⚠️ 預約衝突！\n治療師「${tName}」在 ${dayLabels[day]} ${targetTimeStr} 的預約人數已達上限（${currentOccupancy}/4），無法儲存此變更。`);
        return; // 阻擋儲存
      }
    }

    try {
      setLoading(true);
      await api.put(`/api/appointments/${appt.id}`, {
        patient: selectedPatientGroup.patient,
        start,
        duration,
        day,
        patientType,
        handoverText: appt.handoverText || "",
        therapistId
      });
      alert("預約排程更新成功！");
      setEditingApptId(null);
      await loadData();
      
      // 更新 Modal 表格狀態
      const updatedAppts = selectedPatientGroup.appointments.map(a => 
        a.id === appt.id 
          ? { ...a, day, start, duration, patientType, therapistId, therapistName: therapists.find(t => t.id === therapistId)?.name || therapistId } 
          : a
      );
      
      const sortedAppts = [...updatedAppts].sort((a, b) => {
        if (a.day !== b.day) return a.day - b.day;
        return a.start.localeCompare(b.start);
      });
      
      const uniqueDays = Array.from(new Set(sortedAppts.map((a) => a.day))).sort();
      const frequencyStr = uniqueDays.map((d) => dayLabels[d]).join(", ");
      const therapistNames = new Set(sortedAppts.map(a => a.therapistName || a.therapistId));
      const therapistNamesStr = Array.from(therapistNames).join(", ");
      const therapistIds = Array.from(new Set(sortedAppts.map(a => a.therapistId)));

      setSelectedPatientGroup({
        ...selectedPatientGroup,
        frequencyStr,
        therapistNamesStr,
        therapistIds,
        appointments: sortedAppts
      });
    } catch (err) {
      console.error("Failed to update appointment", err);
      alert("儲存變更失敗：" + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  // 4. 刪除單個預約
  const handleDeleteAppt = async (apptId) => {
    if (!confirm("確定要刪除此筆排程嗎？此操作將無法還原！")) return;

    try {
      setLoading(true);
      await api.delete(`/api/appointments/${apptId}`);
      alert("預約已成功刪除！");
      await loadData();

      // 更新目前 Modal 內清單
      const updatedAppts = selectedPatientGroup.appointments.filter(a => a.id !== apptId);
      if (updatedAppts.length === 0) {
        // 如果該病患無任何預約，直接關閉 Modal
        setDetailModalOpen(false);
        return;
      }

      const sortedAppts = [...updatedAppts].sort((a, b) => {
        if (a.day !== b.day) return a.day - b.day;
        return a.start.localeCompare(b.start);
      });

      const uniqueDays = Array.from(new Set(sortedAppts.map((a) => a.day))).sort();
      const frequencyStr = uniqueDays.map((d) => dayLabels[d]).join(", ");
      const therapistNames = new Set(sortedAppts.map(a => a.therapistName || a.therapistId));
      const therapistNamesStr = Array.from(therapistNames).join(", ");
      const therapistIds = Array.from(new Set(sortedAppts.map(a => a.therapistId)));

      setSelectedPatientGroup({
        ...selectedPatientGroup,
        frequencyStr,
        therapistNamesStr,
        therapistIds,
        appointments: sortedAppts
      });
    } catch (err) {
      console.error("Failed to delete appointment", err);
      alert("刪除預約失敗，請重試");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="wc-outer" style={{ padding: 0 }}>
      <div className="wc-container">
        <div className="wc-title">病人清單</div>

        {/* 篩選工具列 */}
        <div className="filter-bar">
          <div className="filter-group">
            <label>關鍵字搜尋</label>
            <input
              type="text"
              placeholder="搜尋病人姓名或負責治療師..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="filter-input"
            />
          </div>

          <div className="filter-group">
            <label>預約星期</label>
            <select
              value={selectedDay}
              onChange={(e) => setSelectedDay(e.target.value)}
              className="filter-input"
            >
              <option value="">全部</option>
              <option value="1">週一</option>
              <option value="2">週二</option>
              <option value="3">週三</option>
              <option value="4">週四</option>
              <option value="5">週五</option>
            </select>
          </div>

          <div className="filter-group">
            <label>負責治療師</label>
            <select
              value={selectedTherapistId}
              onChange={(e) => setSelectedTherapistId(e.target.value)}
              className="filter-input"
            >
              <option value="">全部</option>
              {therapists.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 列表表格 */}
        {loading && appointments.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px", color: "#b45309", fontWeight: "bold" }}>
            載入中...
          </div>
        ) : (
          <div className="patient-table-wrapper">
            <table className="patient-table">
              <thead>
                <tr>
                  <th style={{ width: "20%" }}>病人姓名</th>
                  <th style={{ width: "25%" }}>負責治療師</th>
                  <th style={{ width: "25%" }}>治療頻率</th>
                  <th style={{ width: "15%" }}>病患類型</th>
                  <th style={{ width: "15%" }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredPatients.length === 0 ? (
                  <tr>
                    <td colSpan="5" style={{ textAlign: "center", padding: "30px", color: "#666" }}>
                      無符合條件的病人資料
                    </td>
                  </tr>
                ) : (
                  filteredPatients.map((pg) => (
                    <tr key={pg.patient}>
                      <td style={{ fontWeight: "bold" }}>{pg.patient}</td>
                      <td>{pg.therapistNamesStr}</td>
                      <td style={{ color: "#b45309", fontWeight: "600" }}>{pg.frequencyStr}</td>
                      <td>
                        <span
                          className={`badge-mini ${
                            pg.patientType === "inpatient"
                              ? "badge-inpatient"
                              : "badge-outpatient"
                          }`}
                        >
                          {pg.patientType === "inpatient" ? "住院" : "門診"}
                        </span>
                      </td>
                      <td>
                        <button
                          className="btn-mini btn-mini-secondary"
                          onClick={() => openDetail(pg)}
                          style={{ fontWeight: "bold", backgroundColor: "#3b82f6", color: "white" }}
                        >
                          編輯 / 詳情
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 病人編輯與詳情 Modal */}
      {detailModalOpen && selectedPatientGroup && (
        <div className="wc-modal-backdrop" onClick={() => setDetailModalOpen(false)}>
          <div className="wc-modal" style={{ width: "680px", maxWidth: "90%" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 18, borderBottom: "1px solid #e2e8f0", paddingBottom: 8, marginBottom: 12, color: "#92400e" }}>
              編輯病人預約與治療排程
            </h3>

            {/* 病人姓名編輯區 */}
            <div style={{ display: "flex", gap: "10px", alignItems: "flex-end", marginBottom: "16px", background: "#f8fafc", padding: "10px", borderRadius: "6px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1 }}>
                <label style={{ fontSize: "12px", fontWeight: "bold", color: "#64748b" }}>病人姓名</label>
                <input 
                  type="text" 
                  value={editPatientName}
                  onChange={e => setEditPatientName(e.target.value)}
                  className="filter-input"
                  style={{ padding: "6px 10px", minWidth: "auto", fontSize: "14px" }}
                />
              </div>
              <button 
                type="button" 
                onClick={handleUpdatePatientName}
                style={{ height: "34px", padding: "0 12px", fontSize: "13px", backgroundColor: "#f59e0b" }}
              >
                修改姓名
              </button>
            </div>

            {/* 唯讀摘要 */}
            <div className="detail-grid" style={{ marginTop: 0, marginBottom: 16 }}>
              <div className="detail-label">負責治療師</div>
              <div className="detail-value">{selectedPatientGroup.therapistNamesStr}</div>

              <div className="detail-label">治療頻率</div>
              <div className="detail-value" style={{ fontWeight: "bold", color: "#b45309" }}>
                {selectedPatientGroup.frequencyStr}
              </div>
            </div>

            {/* 病人預約時段明細表格與編輯 */}
            <div>
              <div className="detail-label" style={{ marginBottom: 6 }}>排程時段明細與編輯</div>
              <div className="patient-table-wrapper" style={{ maxHeight: "250px", overflowY: "auto" }}>
                <table className="patient-table" style={{ fontSize: "12px" }}>
                  <thead>
                    <tr>
                      <th style={{ padding: "6px 10px", width: "15%" }}>星期</th>
                      <th style={{ padding: "6px 10px", width: "18%" }}>時間</th>
                      <th style={{ padding: "6px 10px", width: "15%" }}>時長</th>
                      <th style={{ padding: "6px 10px", width: "15%" }}>病患類型</th>
                      <th style={{ padding: "6px 10px", width: "20%" }}>負責治療師</th>
                      <th style={{ padding: "6px 10px", width: "17%" }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedPatientGroup.appointments.map((a) => {
                      const isEditing = editingApptId === a.id;
                      
                      return (
                        <tr key={a.id}>
                          {isEditing ? (
                            <>
                              {/* 星期編輯 */}
                              <td style={{ padding: "6px 8px" }}>
                                <select 
                                  value={editForm.day} 
                                  onChange={e => setEditForm({ ...editForm, day: Number(e.target.value) })}
                                  style={{ padding: "4px", fontSize: "12px", width: "100%" }}
                                >
                                  <option value="1">週一</option>
                                  <option value="2">週二</option>
                                  <option value="3">週三</option>
                                  <option value="4">週四</option>
                                  <option value="5">週五</option>
                                </select>
                              </td>
                              {/* 時間編輯 */}
                              <td style={{ padding: "6px 8px" }}>
                                <select 
                                  value={editForm.start} 
                                  onChange={e => setEditForm({ ...editForm, start: e.target.value })}
                                  style={{ padding: "4px", fontSize: "12px", width: "100%" }}
                                >
                                  {TIME_SLOTS.map(t => (
                                    <option key={t} value={t}>{t}</option>
                                  ))}
                                </select>
                              </td>
                              {/* 時長編輯 */}
                              <td style={{ padding: "6px 8px" }}>
                                <select 
                                  value={editForm.duration} 
                                  onChange={e => setEditForm({ ...editForm, duration: Number(e.target.value) })}
                                  style={{ padding: "4px", fontSize: "12px", width: "100%" }}
                                >
                                  <option value={30}>30分鐘</option>
                                  <option value={60}>60分鐘</option>
                                  <option value={90}>90分鐘</option>
                                </select>
                              </td>
                              {/* 病患類型編輯 */}
                              <td style={{ padding: "6px 8px" }}>
                                <select 
                                  value={editForm.patientType} 
                                  onChange={e => setEditForm({ ...editForm, patientType: e.target.value })}
                                  style={{ padding: "4px", fontSize: "12px", width: "100%" }}
                                >
                                  <option value="outpatient">門診</option>
                                  <option value="inpatient">住院</option>
                                </select>
                              </td>
                              {/* 負責治療師編輯 */}
                              <td style={{ padding: "6px 8px" }}>
                                <select 
                                  value={editForm.therapistId} 
                                  onChange={e => setEditForm({ ...editForm, therapistId: e.target.value })}
                                  style={{ padding: "4px", fontSize: "12px", width: "100%" }}
                                >
                                  {therapists.map(t => (
                                    <option key={t.id} value={t.id}>{t.name}</option>
                                  ))}
                                </select>
                              </td>
                              {/* 編輯中操作按鈕 */}
                              <td style={{ padding: "6px 8px", display: "flex", gap: "4px", justifyContent: "center" }}>
                                <button
                                  type="button"
                                  className="btn-mini btn-mini-success"
                                  onClick={() => handleSaveApptEdit(a)}
                                  style={{ padding: "2px 6px" }}
                                >
                                  儲存
                                </button>
                                <button
                                  type="button"
                                  className="btn-mini btn-mini-secondary"
                                  onClick={() => setEditingApptId(null)}
                                  style={{ padding: "2px 6px" }}
                                >
                                  取消
                                </button>
                              </td>
                            </>
                          ) : (
                            <>
                              {/* 唯讀顯示 */}
                              <td style={{ padding: "8px 10px", fontWeight: "bold" }}>{dayLabels[a.day]}</td>
                              <td style={{ padding: "8px 10px" }}>{a.start}</td>
                              <td style={{ padding: "8px 10px" }}>{a.duration}分鐘</td>
                              <td style={{ padding: "8px 10px" }}>
                                <span className={`badge-mini ${a.patientType === "inpatient" ? "badge-inpatient" : "badge-outpatient"}`} style={{ fontSize: "10px", padding: "1px 4px" }}>
                                  {a.patientType === "inpatient" ? "住院" : "門診"}
                                </span>
                              </td>
                              <td style={{ padding: "8px 10px" }}>{a.therapistName || a.therapistId}</td>
                              <td style={{ padding: "8px 10px", display: "flex", gap: "4px", justifyContent: "center" }}>
                                <button
                                  type="button"
                                  className="btn-mini btn-mini-secondary"
                                  onClick={() => startEditAppt(a)}
                                  style={{ padding: "2px 6px" }}
                                >
                                  編輯
                                </button>
                                <button
                                  type="button"
                                  className="btn-mini btn-mini-danger"
                                  onClick={() => handleDeleteAppt(a.id)}
                                  style={{ padding: "2px 6px", color: "white" }}
                                >
                                  刪除
                                </button>
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 病人交班備註 */}
            <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 12, marginTop: 12 }}>
              <div className="detail-label" style={{ marginBottom: 4 }}>病人交班備註</div>
              {selectedPatientGroup.appointments.some(a => a.handoverText) ? (
                <div className="detail-handover-box">
                  {selectedPatientGroup.appointments.find(a => a.handoverText)?.handoverText}
                </div>
              ) : (
                <div style={{ fontStyle: "italic", color: "#94a3b8", fontSize: 13, padding: "8px 0" }}>
                  尚無交班備註內容
                </div>
              )}
            </div>

            <div className="wc-form-actions" style={{ marginTop: 20 }}>
              <button
                type="button"
                className="wc-btn wc-btn-secondary"
                onClick={() => setDetailModalOpen(false)}
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
