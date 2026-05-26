import { useMemo, useState } from "react";
import "./WeekCalendar.css";

const DAYS = ["週一", "週二", "週三", "週四", "週五"];
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

export default function WeekCalendar({ therapistId, therapistName, appointments, loading }) {
  const [tooltip, setTooltip] = useState({ show: false, x: 0, y: 0, patient: '', freq: '', type: '' });
  // 將 appointments（陣列/物件）統一處理為陣列
  const apptList = useMemo(() => {
    if (!appointments) return [];
    if (Array.isArray(appointments)) return appointments;
    return Object.values(appointments);
  }, [appointments]);

  // 轉換每個預約的 slotIndex 與佔用區間
  const apptRanges = useMemo(() => {
    return apptList.map((a) => {
      // 算出 a.start 對應的 slotIndex
      const startIdx = SLOTS.findIndex(
        (s) => formatTime(s.hour, s.minute) === a.start
      );
      return {
        ...a,
        startIdx: startIdx !== -1 ? startIdx : 0,
        span: 1, // 固定為 1，只顯示在開始時間那一格，取消跨格顯示
      };
    });
  }, [apptList]);

  const handleMouseEnter = (e, appt) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const patientName = appt.patient.trim();
    
    // 計算該病人在目前治療師名下的所有預約，以得到治療頻率
    const patientAppts = apptRanges.filter(a => a.patient.trim() === patientName);
    const uniqueDays = Array.from(new Set(patientAppts.map(a => a.day))).sort();
    const dayNames = { 1: "週一", 2: "週二", 3: "週三", 4: "週四", 5: "週五" };
    const freqStr = uniqueDays.map(d => dayNames[d]).join(", ");

    setTooltip({
      show: true,
      x: rect.left + window.scrollX + rect.width / 2,
      y: rect.top + window.scrollY,
      patient: appt.patient,
      freq: freqStr,
      type: appt.patientType === 'inpatient' ? '住院' : '門診'
    });
  };

  const handleMouseLeave = () => {
    setTooltip({ show: false, x: 0, y: 0, patient: '', freq: '', type: '' });
  };

  // 依 day 和 slotIndex 取得該時間格的所有預約 (單格限2人)
  function getApptsInCell(dayNum, slotIdx) {
    // dayNum 為 0-4（週一至週五的索引），後端 day 為 1-5。
    return apptRanges
      .filter((a) => a.day === dayNum + 1 && slotIdx === a.startIdx)
      .slice(0, 2); // 單格最多顯示 2 個
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
        <div className="wc-title">排程週表 — {therapistName || therapistId}</div>
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

            {/* cells: keep cells for grid lines, render vertical layouts directly inside cells */}
            {SLOTS.map((_, slotIndex) =>
              DAYS.map((_, dayIndex) => {
                const key = `cell-${dayIndex}-${slotIndex}`;
                const appts = getApptsInCell(dayIndex, slotIndex);
                
                return (
                  <div
                    key={key}
                    className="wc-cell"
                    style={{ gridColumn: dayIndex + 2, gridRow: slotIndex + 1 }}
                  >
                    <div className="wc-cell-inner vertical-layout">
                      {appts.map((appt) => (
                        <div
                          key={`${appt.id}-${slotIndex}`}
                          className={`wc-appt-card-mini ${appt.patientType || "outpatient"}`}
                          onMouseEnter={(e) => handleMouseEnter(e, appt)}
                          onMouseLeave={handleMouseLeave}
                        >
                          <span className="appt-card-name">{appt.patient}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
      
      {tooltip.show && (
        <div 
          className="wc-custom-tooltip"
          style={{
            position: 'absolute',
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
            transform: 'translate(-50%, -105%)',
            zIndex: 99999,
            pointerEvents: 'none'
          }}
        >
          <div className="tooltip-title">{tooltip.patient}</div>
          <div className="tooltip-row"><b>治療頻率：</b>{tooltip.freq}</div>
          <div className="tooltip-row"><b>病患類型：</b>{tooltip.type}</div>
        </div>
      )}
    </div>
  );
}
