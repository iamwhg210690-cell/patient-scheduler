import { useMemo, useState, useEffect, useCallback } from "react";
import api from "../api";
import "./WeekCalendar.css";

const DAYS = ["週一", "週二", "週三", "週四", "週五"];
const SLOT_MIN = 30;
const MORNING_START = 8;
const MORNING_END = 11;
const AFTERNOON_START = 13;
const AFTERNOON_END = 16;

// 最大可見欄位數（含 +N 指示器欄位）
const MAX_VISIBLE_COLS = 4;

function formatTime(hour, minute) {
  const h = String(hour).padStart(2, "0");
  const m = String(minute).padStart(2, "0");
  return `${h}:${m}`;
}

function generateSlots() {
  const slots = [];
  // morning: 08:00 ~ 10:30 (by 30min) up to MORNING_END
  for (let h = MORNING_START; h < MORNING_END; h++) {
    for (let m = 0; m < 60; m += SLOT_MIN) slots.push({ hour: h, minute: m });
  }
  // push MORNING_END (11:00)
  slots.push({ hour: MORNING_END, minute: 0 });

  // === 插入 12:00 的欄位 ===
  slots.push({ hour: 12, minute: 0 });

  // afternoon: 13:00 ~ 15:30 (by 30min) up to AFTERNOON_END
  for (let h = AFTERNOON_START; h < AFTERNOON_END; h++) {
    for (let m = 0; m < 60; m += SLOT_MIN) slots.push({ hour: h, minute: m });
  }
  // push AFTERNOON_END (16:00)
  slots.push({ hour: AFTERNOON_END, minute: 0 });

  return slots;
}

const SLOTS = generateSlots();

export default function WeekCalendar({ therapistId }) {
  const [appointments, setAppointments] = useState({});
  const [loading, setLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [modalDay, setModalDay] = useState(0);
  const [modalSlotIndex, setModalSlotIndex] = useState(0);
  const [formPatient, setFormPatient] = useState("");
  const [formDuration, setFormDuration] = useState(30);
  const [formPatientType, setFormPatientType] = useState("outpatient");
  const [errorMsg, setErrorMsg] = useState("");
  const [draggingId, setDraggingId] = useState(null);

  const fetchAppointments = useCallback(async () => {
    if (!therapistId) return;
    setLoading(true);
    try {
      const res = await api.get(`/api/appointments?therapistId=${therapistId}`);
      const dictionary = {};
      (res.data || []).forEach((appt) => {
        const dayIndex = appt.day - 1; // 後端 1-5 轉元件 0-4
        const slotIndex = SLOTS.findIndex(
          (s) => formatTime(s.hour, s.minute) === appt.start
        );
        dictionary[appt.id] = {
          id: appt.id,
          patient: appt.patient,
          day: dayIndex,
          slotIndex: slotIndex !== -1 ? slotIndex : 0,
          start: appt.start,
          duration: appt.duration,
          patientType: appt.patientType || "outpatient",
        };
      });
      setAppointments(dictionary);
    } catch (err) {
      console.error("fetchAppointments error", err);
      setAppointments({});
    } finally {
      setLoading(false);
    }
  }, [therapistId]);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  function slotSpanForDuration(duration) {
    return Math.max(1, Math.round(duration / SLOT_MIN));
  }

  function getSpanRange(slotIndex, duration) {
    const span = slotSpanForDuration(duration);
    const start = slotIndex;
    const end = slotIndex + span - 1;
    return { start, end };
  }

  // 計算某 day、slotIndex 被佔用的人數（包含跨格）
  function occupancyAt(day, slotIndex, ignoreId = null) {
    let count = 0;
    Object.values(appointments).forEach((a) => {
      if (a.id === ignoreId) return;
      if (a.day !== day) return;
      const { start, end } = getSpanRange(a.slotIndex, a.duration);
      if (slotIndex >= start && slotIndex <= end) count += 1;
    });
    return count;
  }

  // 檢查能否放置（檢查每一格 occupancy < 4）
  function canPlaceAppointment(day, slotIndex, duration, ignoreId = null) {
    const span = slotSpanForDuration(duration);
    for (let i = 0; i < span; i++) {
      const s = slotIndex + i;
      if (s >= SLOTS.length) {
        return { ok: false, reason: "超出可排程時間範圍" };
      }
      const occ = occupancyAt(day, s, ignoreId);
      if (occ >= 4) {
        return {
          ok: false,
          reason: `時間 ${formatTime(
            SLOTS[s].hour,
            SLOTS[s].minute
          )} 已達上限（${occ}/4）`,
        };
      }
    }
    return { ok: true, reason: null };
  }

  function openCreateModal(dayIndex, slotIndex) {
    setEditing(null);
    setModalDay(dayIndex);
    setModalSlotIndex(slotIndex);
    setFormPatient("");
    setFormDuration(30);
    setFormPatientType("outpatient");
    setErrorMsg("");
    setModalOpen(true);
  }

  function openEditModal(appt) {
    setEditing(appt.id);
    setModalDay(appt.day);
    setModalSlotIndex(appt.slotIndex);
    setFormPatient(appt.patient);
    setFormDuration(appt.duration);
    setFormPatientType(appt.patientType || "outpatient");
    setErrorMsg("");
    setModalOpen(true);
  }

  async function submitCreateOrEdit(e) {
    e.preventDefault();
    const day = modalDay;
    const slotIndex = Number(modalSlotIndex);
    const duration = Number(formDuration);
    if (!formPatient.trim()) {
      setErrorMsg("請輸入病患姓名");
      return;
    }
    const check = canPlaceAppointment(day, slotIndex, duration, editing);
    if (!check.ok) {
      setErrorMsg(check.reason || "無法排入此時段");
      return;
    }

    const startTimeStr = formatTime(SLOTS[slotIndex].hour, SLOTS[slotIndex].minute);

    try {
      if (editing) {
        // 編輯：呼叫 PUT API
        await api.put(`/api/appointments/${editing}`, {
          patient: formPatient.trim(),
          start: startTimeStr,
          duration,
          day: day + 1, // 後端 1-5
          patientType: formPatientType,
        });
      } else {
        // 新增：呼叫 POST API
        await api.post(`/api/appointments`, {
          therapistId,
          patient: formPatient.trim(),
          start: startTimeStr,
          duration,
          days: [day + 1], // 後端 1-5
          patientType: formPatientType,
        });
      }
      setModalOpen(false);
      fetchAppointments();
    } catch (err) {
      console.error("儲存失敗", err);
      setErrorMsg("儲存失敗：" + (err.response?.data?.error || err.message));
    }
  }

  async function deleteAppointment(id) {
    if (!confirm("確定要刪除此預約？")) return;
    try {
      await api.delete(`/api/appointments/${id}`);
      setModalOpen(false);
      fetchAppointments();
    } catch (err) {
      console.error("刪除失敗", err);
      alert("刪除失敗：" + (err.response?.data?.error || err.message));
    }
  }

  function onDragStart(e, id) {
    setDraggingId(id);
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  async function onDrop(e, dayIndex, slotIndex) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || draggingId;
    if (!id) return;
    const ap = appointments[id];
    if (!ap) return;
    const check = canPlaceAppointment(dayIndex, slotIndex, ap.duration, id);
    if (!check.ok) {
      alert(check.reason || "目標時段無法排入");
      setDraggingId(null);
      return;
    }

    const newStart = formatTime(SLOTS[slotIndex].hour, SLOTS[slotIndex].minute);

    // 樂觀更新前端 UI
    setAppointments((prev) => {
      const copy = { ...prev };
      copy[id] = {
        ...copy[id],
        day: dayIndex,
        slotIndex,
        start: newStart,
      };
      return copy;
    });

    try {
      await api.put(`/api/appointments/${id}`, {
        patient: ap.patient,
        start: newStart,
        duration: ap.duration,
        day: dayIndex + 1, // 後端 1-5
        patientType: ap.patientType || "outpatient",
      });
      fetchAppointments();
    } catch (err) {
      console.error("更新預約失敗", err);
      alert("更新預約失敗，將還原狀態");
      fetchAppointments();
    } finally {
      setDraggingId(null);
    }
  }

  // For overlay rendering: group appointments by day
  const dayGroups = useMemo(() => {
    const dg = {};
    Object.values(appointments).forEach((a) => {
      if (!dg[a.day]) dg[a.day] = [];
      dg[a.day].push(a);
    });
    // sort by slotIndex for stable layout
    Object.keys(dg).forEach((k) =>
      dg[k].sort((x, y) => x.slotIndex - y.slotIndex || x.id.localeCompare(y.id))
    );
    return dg;
  }, [appointments]);

  // compute column assignment per day using interval packing (greedy)
  const dayColumnsMap = useMemo(() => {
    const mapByDay = {};
    Object.keys(dayGroups).forEach((dayKey) => {
      const arr = dayGroups[dayKey];
      const sorted = [...arr].sort((a, b) => {
        if (a.slotIndex !== b.slotIndex) return a.slotIndex - b.slotIndex;
        return slotSpanForDuration(b.duration) - slotSpanForDuration(a.duration);
      });
      const columnsEnd = []; // columnsEnd[i] = last occupied slotIndex in column i
      const assign = {}; // ap.id -> colIndex
      sorted.forEach((ap) => {
        const span = slotSpanForDuration(ap.duration);
        const apStart = ap.slotIndex;
        const apEnd = apStart + span - 1;
        let placed = false;
        for (let i = 0; i < columnsEnd.length; i++) {
          if (apStart > columnsEnd[i]) {
            assign[ap.id] = i;
            columnsEnd[i] = apEnd;
            placed = true;
            break;
          }
        }
        if (!placed) {
          assign[ap.id] = columnsEnd.length;
          columnsEnd.push(apEnd);
        }
      });
      const final = {};
      Object.keys(assign).forEach((id) => {
        final[id] = { colIndex: assign[id] };
      });
      mapByDay[dayKey] = final;
    });
    return mapByDay;
  }, [dayGroups]);

  // compute +N indicators per day per start slot
  const plusIndicators = useMemo(() => {
    const indicatorsByDay = {};
    Object.keys(dayGroups).forEach((dayKey) => {
      const arr = dayGroups[dayKey];
      const colMap = dayColumnsMap[dayKey] || {};
      const byStart = {};
      arr.forEach((ap) => {
        const start = ap.slotIndex;
        if (!byStart[start]) byStart[start] = [];
        byStart[start].push(ap);
      });
      const indicators = {};
      Object.keys(byStart).forEach((startKey) => {
        const start = Number(startKey);
        const group = byStart[start];
        const globalTotalCols = (() => {
          const m = dayColumnsMap[dayKey] || {};
          const vals = Object.values(m).map((v) => v.colIndex);
          if (vals.length === 0) return 1;
          return Math.max(...vals) + 1;
        })();
        const visibleCols = Math.min(globalTotalCols, MAX_VISIBLE_COLS);
        let hiddenCount = 0;
        group.forEach((ap) => {
          const mapping = colMap[ap.id] || { colIndex: 0 };
          if (mapping.colIndex >= visibleCols) hiddenCount += 1;
        });
        if (hiddenCount > 0) {
          indicators[start] = { count: hiddenCount };
        }
      });
      indicatorsByDay[dayKey] = indicators;
    });
    return indicatorsByDay;
  }, [dayGroups, dayColumnsMap]);

  // occupancy summary for modal preview
  function occupancySummary(day, slotIndex, duration, ignoreId = null) {
    const span = slotSpanForDuration(duration);
    const arr = [];
    for (let i = 0; i < span; i++) {
      const s = slotIndex + i;
      if (s >= SLOTS.length) break;
      arr.push({
        time: formatTime(SLOTS[s].hour, SLOTS[s].minute),
        occ: occupancyAt(day, s, ignoreId),
      });
    }
    return arr;
  }

  if (!therapistId) {
    return (
      <div className="wc-outer">
        <div className="wc-container" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "400px" }}>
          <div style={{ textAlign: "center", color: "#6b4a2a" }}>
            <h2 style={{ fontSize: 20, marginBottom: 8 }}>請選擇一位治療師以開始查看與安排日程</h2>
            <p style={{ fontSize: 14 }}>您可以在左側選單中切換不同的治療師</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="wc-outer">
      <div className="wc-container">
        <div className="wc-title">病患排程器 — 週圖</div>
        <div className="wc-scroll-wrap">
          {loading && (
            <div style={{
              position: "absolute",
              inset: 0,
              backgroundColor: "rgba(251, 246, 238, 0.7)",
              zIndex: 2000,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              fontWeight: "bold",
              color: "#b45309"
            }}>
              載入中...
            </div>
          )}

          <div
            className="wc-header"
            role="row"
            style={{ gridTemplateColumns: `100px repeat(${DAYS.length}, 1fr)` }}
            aria-hidden
          >
            <div className="wc-time-col">時間</div>
            {DAYS.map((d) => (
              <div key={d} className="wc-day-col-header">{d}</div>
            ))}
          </div>

          <div
            className="wc-grid"
            role="grid"
            aria-label="週排程"
            style={{
              gridTemplateColumns: `100px repeat(${DAYS.length}, 1fr)`,
              gridTemplateRows: `repeat(${SLOTS.length}, var(--row-height))`,
            }}
          >
            {/* time labels */}
            {SLOTS.map((slot, slotIndex) => (
              <div
                key={`time-${slotIndex}`}
                className="wc-time-cell"
                style={{ gridColumn: 1, gridRow: slotIndex + 1 }}
              >
                <div className="wc-time-label">{formatTime(slot.hour, slot.minute)}</div>
              </div>
            ))}

            {/* cells: keep cells for grid lines and double-click area */}
            {SLOTS.map((_, slotIndex) =>
              DAYS.map((_, dayIndex) => {
                const key = `cell-${dayIndex}-${slotIndex}`;
                return (
                  <div
                    key={key}
                    className="wc-cell"
                    style={{ gridColumn: dayIndex + 2, gridRow: slotIndex + 1 }}
                    onDoubleClick={() => openCreateModal(dayIndex, slotIndex)}
                    onDragOver={onDragOver}
                    onDrop={(e) => onDrop(e, dayIndex, slotIndex)}
                  >
                    <div className="wc-cell-inner" />
                  </div>
                );
              })
            )}

            {/* OVERLAY */}
            {DAYS.map((_, dayIndex) => {
              const dayKey = `${dayIndex}`;
              const dayAppts = dayGroups[dayIndex] || [];
              const colMap = dayColumnsMap[dayKey] || {};
              const indicators = plusIndicators[dayKey] || {};
              const globalTotalCols = (() => {
                const m = colMap || {};
                const vals = Object.values(m).map((v) => v.colIndex);
                if (vals.length === 0) return 1;
                return Math.max(...vals) + 1;
              })();
              const visibleCols = Math.min(globalTotalCols, MAX_VISIBLE_COLS);
              return (
                <div
                  key={`overlay-day-${dayIndex}`}
                  className="wc-overlay-day"
                  style={{
                    gridColumn: dayIndex + 2,
                    gridRow: `1 / ${SLOTS.length + 1}`,
                  }}
                  aria-hidden
                >
                  {dayAppts.map((ap) => {
                    const span = slotSpanForDuration(ap.duration);
                    const apStart = ap.slotIndex;
                    const top = `calc(var(--row-height) * ${apStart} + 6px)`;
                    const height = `calc(var(--row-height) * ${span} - 8px)`;
                    const mapping = colMap[ap.id] || { colIndex: 0 };
                    const idx = mapping.colIndex;
                    if (mapping.colIndex >= visibleCols) {
                      return null;
                    }
                    const width = `calc((100% / ${visibleCols}) - 6px)`;
                    const left = `calc(${(idx / visibleCols) * 100}% + 6px)`;
                    return (
                      <div
                        key={ap.id}
                        className={`wc-appointment-overlay ${ap.patientType || "outpatient"}`}
                        draggable
                        onDragStart={(e) => onDragStart(e, ap.id)}
                        onClick={() => openEditModal(ap)}
                        title={`${ap.patient} • ${ap.start} • ${ap.duration} 分鐘 • ${
                          ap.patientType === "inpatient" ? "住院" : "門診"
                        }`}
                        data-appt-id={ap.id}
                        style={{
                          top,
                          height,
                          left,
                          width,
                        }}
                      >
                        <div className="wc-appt-title">{ap.patient}</div>
                      </div>
                    );
                  })}

                  {/* render +N indicators */}
                  {Object.keys(indicators).map((startKey) => {
                    const start = Number(startKey);
                    const info = indicators[start];
                    if (!info || info.count <= 0) return null;
                    const top = `calc(var(--row-height) * ${start} + 6px)`;
                    const height = `calc(var(--row-height) * ${slotSpanForDuration(
                      30
                    )} - 8px)`;
                    const left = `calc(${((visibleCols - 1) / visibleCols) * 100}% + 6px)`;
                    const width = `calc((100% / ${visibleCols}) - 6px)`;
                    return (
                      <div
                        key={`plus-${dayIndex}-${start}`}
                        className="wc-appointment-overlay plus-indicator"
                        style={{
                          top,
                          height,
                          left,
                          width,
                        }}
                        onClick={() => {
                          openCreateModal(dayIndex, start);
                        }}
                        title={`還有 ${info.count} 個預約未顯示（點擊可查看）`}
                      >
                        +{info.count}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {modalOpen && (
          <div className="wc-modal-backdrop" onClick={() => setModalOpen(false)}>
            <div className="wc-modal" onClick={(e) => e.stopPropagation()}>
              <h3>{editing ? "編輯預約" : "建立 / 預約治療"}</h3>
              <form onSubmit={submitCreateOrEdit} className="wc-form">
                <div className="wc-form-row">
                  <label>病患姓名</label>
                  <input
                    value={formPatient}
                    onChange={(e) => setFormPatient(e.target.value)}
                    placeholder="輸入病患姓名"
                  />
                </div>

                <div className="wc-form-row">
                  <label>日期與時段</label>
                  <div className="wc-inline">
                    <select
                      value={modalDay}
                      onChange={(e) => setModalDay(Number(e.target.value))}
                    >
                      {DAYS.map((d, i) => (
                        <option key={d} value={i}>{d}</option>
                      ))}
                    </select>
                    <select
                      value={modalSlotIndex}
                      onChange={(e) => setModalSlotIndex(Number(e.target.value))}
                    >
                      {SLOTS.map((s, idx) => (
                        <option key={idx} value={idx}>
                          {formatTime(s.hour, s.minute)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ marginTop: 6, fontSize: 13, color: "#6b4a2a" }}>
                    起始格人數：{occupancyAt(modalDay, modalSlotIndex, editing)} / 4
                  </div>

                  <div style={{ marginTop: 6, fontSize: 13, color: "#6b4a2a" }}>
                    跨格佔用預覽：
                    {occupancySummary(modalDay, modalSlotIndex, formDuration, editing).map(
                      (r) => (
                        <div key={r.time} style={{ fontSize: 12 }}>
                          {r.time}：{r.occ} / 4
                        </div>
                      )
                    )}
                  </div>
                </div>

                <div className="wc-form-row">
                  <label>時長（分鐘）</label>
                  <select
                    value={formDuration}
                    onChange={(e) => setFormDuration(Number(e.target.value))}
                  >
                    <option value={30}>30</option>
                    <option value={60}>60</option>
                    <option value={90}>90</option>
                  </select>
                </div>

                <div className="wc-form-row">
                  <label>病患類型</label>
                  <select
                    value={formPatientType}
                    onChange={(e) => setFormPatientType(e.target.value)}
                  >
                    <option value="outpatient">門診</option>
                    <option value="inpatient">住院</option>
                  </select>
                </div>

                {errorMsg && <div className="wc-error">{errorMsg}</div>}

                <div className="wc-form-actions">
                  {editing && (
                    <button
                      type="button"
                      className="wc-btn wc-btn-danger"
                      onClick={() => deleteAppointment(editing)}
                    >
                      刪除
                    </button>
                  )}
                  <div style={{ flex: 1 }} />
                  <button
                    type="button"
                    className="wc-btn wc-btn-secondary"
                    onClick={() => setModalOpen(false)}
                  >
                    取消
                  </button>
                  <button type="submit" className="wc-btn wc-btn-primary">
                    {editing ? "儲存變更" : "建立預約"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
