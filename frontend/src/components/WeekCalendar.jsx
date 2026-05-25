import { useMemo } from "react";
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
      const span = Math.max(1, Math.round(a.duration / 30));
      return {
        ...a,
        startIdx: startIdx !== -1 ? startIdx : 0,
        span,
      };
    });
  }, [apptList]);

  // 依 day 和 slotIndex 取得該時間格的所有預約 (最多 4 位，垂直排列)
  function getApptsInCell(dayNum, slotIdx) {
    // dayNum 為 0-4（週一至週五的索引），後端 day 為 1-5。
    return apptRanges
      .filter((a) => a.day === dayNum + 1 && slotIdx >= a.startIdx && slotIdx < a.startIdx + a.span)
      .slice(0, 4); // 單格最多顯示 4 個
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
                          title={`${appt.patient} • ${appt.start} • ${appt.duration}分鐘 • ${
                            appt.patientType === "inpatient" ? "住院" : "門診"
                          }`}
                        >
                          <span className="appt-card-name">{appt.patient}</span>
                          <span className="appt-card-time">{appt.duration}分</span>
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
    </div>
  );
}
