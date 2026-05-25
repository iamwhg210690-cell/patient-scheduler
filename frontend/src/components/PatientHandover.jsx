import { useState, useEffect, useMemo } from "react";
import api from "../api";

export default function PatientHandover({ therapistId, therapistName, appointments, loading, onSave }) {
  // 元件內部的局部 appointments 狀態，用於即時的輸入框渲染，不需等待 API
  const [localAppts, setLocalAppts] = useState([]);
  
  // 搜尋過濾條件
  const [search, setSearch] = useState("");
  const [selectedDay, setSelectedDay] = useState("");

  // 儲存狀態標記 { [patientName]: 'idle' | 'saving' | 'saved' }
  const [saveStatus, setSaveStatus] = useState({});

  const dayLabels = { 1: "週一", 2: "週二", 3: "週三", 4: "週四", 5: "週五" };

  // 每當 props 傳入的 appointments 改變時，同步到 localAppts
  useEffect(() => {
    if (appointments) {
      const apptList = Array.isArray(appointments) ? appointments : Object.values(appointments);
      setLocalAppts(apptList);
    }
  }, [appointments]);

  // 將預約資料依「病患姓名」進行分群 (Group By)
  const handoverGroups = useMemo(() => {
    const groups = {};
    
    localAppts.forEach((appt) => {
      const key = appt.patient.trim();
      if (!groups[key]) {
        groups[key] = {
          patient: appt.patient,
          therapistId: appt.therapistId,
          therapistName: appt.therapistName,
          handoverText: appt.handoverText || "",
          appointments: [],
        };
      }
      
      groups[key].appointments.push(appt);
      // 若該預約包含備註，且群組目前的備註為空，則更新為有備註的值，以防落差
      if (appt.handoverText && !groups[key].handoverText) {
        groups[key].handoverText = appt.handoverText;
      }
    });

    return Object.values(groups).map((group) => {
      // 排序預約時間（星期升序，時間升序）
      const sortedAppts = [...group.appointments].sort((a, b) => {
        if (a.day !== b.day) return a.day - b.day;
        return a.start.localeCompare(b.start);
      });

      // 提取星期字串，例如 "週一, 週三"
      const uniqueDays = Array.from(new Set(sortedAppts.map((a) => a.day))).sort();
      const frequencyStr = uniqueDays.map((d) => dayLabels[d]).join(", ");

      // 提取時間明細，例如 "週一 09:00, 週三 10:00"
      const timeDetailsStr = sortedAppts
        .map((a) => `${dayLabels[a.day]} ${a.start}`)
        .join(", ");

      return {
        patient: group.patient,
        therapistId: group.therapistId,
        therapistName: group.therapistName,
        handoverText: group.handoverText,
        frequencyStr,
        timeDetailsStr,
        appointments: sortedAppts,
      };
    });
  }, [localAppts]);

  // 修改局部交班備註狀態 (以病人姓名為對象)
  const handleTextChange = (patientName, text) => {
    setLocalAppts((prev) =>
      prev.map((appt) =>
        appt.patient.trim() === patientName.trim() ? { ...appt, handoverText: text } : appt
      )
    );
  };

  // 儲存交班備註 (以 Promise.all 批次更新該病人底下的所有 appointments)
  const saveHandover = async (patientName, text, appointmentsInGroup) => {
    const truncatedText = (text || "").slice(0, 200);
    const apptIds = appointmentsInGroup.map((a) => a.id);
    
    if (!apptIds.length) return;

    setSaveStatus((prev) => ({ ...prev, [patientName]: "saving" }));
    try {
      // 批次 PATCH 同步更新
      await Promise.all(
        apptIds.map((id) =>
          api.patch(`/api/appointments/${id}/handover`, {
            handoverText: truncatedText,
          })
        )
      );
      
      setSaveStatus((prev) => ({ ...prev, [patientName]: "saved" }));
      
      // 觸發全域同步
      if (onSave) {
        onSave();
      }
      
      setTimeout(() => {
        setSaveStatus((prev) => ({ ...prev, [patientName]: "idle" }));
      }, 3000);
    } catch (err) {
      console.error("Failed to save handover notes", err);
      alert("儲存失敗，請重試");
      setSaveStatus((prev) => ({ ...prev, [patientName]: "idle" }));
    }
  };

  // 搜尋與篩選邏輯
  const filteredGroups = handoverGroups.filter((group) => {
    // 關鍵字篩選 (病人姓名)
    const matchesKeyword = group.patient.toLowerCase().includes(search.toLowerCase());
    
    // 星期篩選：只要病人的任何一筆預約落在該星期，即符合
    const matchesDay =
      selectedDay === "" || group.appointments.some((a) => String(a.day) === String(selectedDay));
      
    return matchesKeyword && matchesDay;
  });

  if (!therapistId) {
    return (
      <div className="wc-outer" style={{ padding: 0 }}>
        <div className="wc-container" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "350px" }}>
          <div style={{ textAlign: "center", color: "#6b4a2a" }}>
            <h2 style={{ fontSize: 20, marginBottom: 8 }}>請選擇一位治療師以開始進行病人交班</h2>
            <p style={{ fontSize: 14 }}>您可以在左側選單中切換不同的治療師</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="wc-outer" style={{ padding: 0 }}>
      <div className="wc-container">
        <div className="wc-title">病人交班 — {therapistName || therapistId}</div>

        {/* 篩選工具列 */}
        <div className="filter-bar">
          <div className="filter-group">
            <label>搜尋病人姓名</label>
            <input
              type="text"
              placeholder="搜尋病人..."
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
        </div>

        {/* 列表表格 */}
        {loading ? (
          <div style={{ textAlign: "center", padding: "40px", color: "#b45309", fontWeight: "bold" }}>
            載入中...
          </div>
        ) : (
          <div className="patient-table-wrapper">
            <table className="patient-table">
              <thead>
                <tr>
                  <th style={{ width: "15%" }}>病人姓名</th>
                  <th style={{ width: "15%" }}>治療頻率</th>
                  <th style={{ width: "25%" }}>排程時間</th>
                  <th style={{ width: "45%" }}>交班備註 (限200字元，更新會同步該病人所有預約)</th>
                </tr>
              </thead>
              <tbody>
                {filteredGroups.length === 0 ? (
                  <tr>
                    <td colSpan="4" style={{ textAlign: "center", padding: "30px", color: "#666" }}>
                      無符合條件的病人交班資料
                    </td>
                  </tr>
                ) : (
                  filteredGroups.map((group) => {
                    const status = saveStatus[group.patient] || "idle";
                    const charCount = (group.handoverText || "").length;
                    
                    return (
                      <tr key={group.patient}>
                        <td style={{ fontWeight: "bold" }}>{group.patient}</td>
                        <td style={{ color: "#b45309", fontWeight: "600" }}>{group.frequencyStr}</td>
                        <td style={{ fontSize: "13px" }}>{group.timeDetailsStr}</td>
                        <td>
                          <div className="handover-input-container">
                            <div className="handover-input-wrapper">
                              <textarea
                                className="handover-textarea"
                                value={group.handoverText || ""}
                                onChange={(e) => handleTextChange(group.patient, e.target.value)}
                                onBlur={() => saveHandover(group.patient, group.handoverText, group.appointments)}
                                maxLength={200}
                                placeholder="請輸入交班備註（例如：病患今日膝關節彎曲可達90度，下回可著重於阻力訓練）"
                              />
                              <button
                                className="btn-mini"
                                style={{
                                  backgroundColor: "#f59e0b",
                                  color: "white",
                                  alignSelf: "stretch",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  border: "none",
                                  borderRadius: "6px",
                                  padding: "0 12px",
                                  cursor: "pointer",
                                  fontWeight: "bold"
                                }}
                                onClick={() => saveHandover(group.patient, group.handoverText, group.appointments)}
                                disabled={status === "saving"}
                              >
                                {status === "saving" ? "儲存中" : "儲存"}
                              </button>
                            </div>
                            
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
                              <span className="char-counter">{charCount}/200 字</span>
                              {status === "saved" && (
                                <span className="status-indicator status-saved">✓ 已同步存檔</span>
                              )}
                              {status === "saving" && (
                                <span className="status-indicator" style={{ color: "#64748b" }}>● 正在存檔...</span>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
