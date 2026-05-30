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
  for (let h = AFTERNOON_START; h < AFTERNOON_END; h++) {
    for (let m = 0; m < 60; m += SLOT_MIN) slots.push({ hour: h, minute: m });
  }
  slots.push({ hour: AFTERNOON_END, minute: 0 });
  return slots;
}

const SLOTS = generateSlots();

export default function WeekCalendar({ therapistId, therapistName, appointments, loading, therapists }) {
  const [tooltip, setTooltip] = useState({ show: false, x: 0, y: 0, patient: '', freq: '', type: '', otStText: '' });
  
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
    const patientAppts = apptRanges.filter(a => a.patient.trim() === patientName && a.therapistId === appt.therapistId);
    const uniqueDays = Array.from(new Set(patientAppts.map(a => a.day))).sort();
    const dayNames = { 1: "週一", 2: "週二", 3: "週三", 4: "週四", 5: "週五" };
    const freqStr = uniqueDays.map(d => dayNames[d]).join(", ");

    // 職能/語言時段格式化
    const otText = appt.otTime ? `職能${appt.otTime}` : '';
    const stText = appt.stTime ? `語言${appt.stTime}` : '';
    const otStText = [otText, stText].filter(Boolean).join('，');

    setTooltip({
      show: true,
      x: rect.left + rect.width / 2,
      y: rect.top,
      patient: appt.patient,
      freq: freqStr,
      type: appt.patientType === 'inpatient' ? '住院' : '門診',
      otStText: otStText
    });
  };

  const handleMouseLeave = () => {
    setTooltip({ show: false, x: 0, y: 0, patient: '', freq: '', type: '', otStText: '' });
  };

  // 依 day 和 slotIndex 取得該時間格的所有預約 (單格限2人)
  function getApptsInCell(tId, dayNum, slotIdx) {
    // dayNum 為 0-4（週一至週五的索引），後端 day 為 1-5。
    return apptRanges
      .filter((a) => a.therapistId === tId && a.day === dayNum + 1 && slotIdx === a.startIdx)
      .slice(0, 2); // 單格最多顯示 2 個
  }

  // 計算當前個別治療師的空檔時段
  const freeSlots = useMemo(() => {
    if (!therapistId || therapistId === 'all') return [];
    
    return SLOTS.map((slot) => {
      const timeStr = formatTime(slot.hour, slot.minute);
      const freeDays = [];
      for (let dayNum = 1; dayNum <= 5; dayNum++) {
        const count = apptRanges.filter(
          (a) => a.therapistId === therapistId && a.day === dayNum && a.start === timeStr
        ).length;
        if (count < 2) {
          freeDays.push(dayNum);
        }
      }
      return { timeStr, freeDays };
    }).filter(item => item.freeDays.length > 0);
  }, [apptRanges, therapistId]);

  // 治療師分組（每 3 人一組）
  const therapistGroups = useMemo(() => {
    if (therapistId !== 'all') return [];
    const groups = [];
    if (!therapists || therapists.length === 0) return [];
    for (let i = 0; i < therapists.length; i += 3) {
      groups.push(therapists.slice(i, i + 3));
    }
    return groups;
  }, [therapists, therapistId]);

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

  const dayNames = { 1: "週一", 2: "週二", 3: "週三", 4: "週四", 5: "週五" };

  // 1. 全部治療師合併排程模式
  if (therapistId === 'all') {
    return (
      <div className="wc-outer" style={{ position: 'relative' }}>
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
        
        {therapistGroups.map((group, gIdx) => {
          if (group.length === 3) {
            // 三位合併表格
            return (
              <div key={`group-${gIdx}`} className="wc-container wc-merged-section" style={{ marginBottom: "30px", width: "100%", overflowX: "auto" }}>
                <div className="wc-title">合併週排程表 — {group.map(t => t.name).join('、')}</div>
                <div className="wc-scroll-wrap">
                  <table className="wc-merged-table">
                    <thead>
                      <tr>
                        <th rowSpan="2" style={{ width: '100px', verticalAlign: 'middle' }}>時間</th>
                        {group.map(t => (
                          <th key={t.id} colSpan="5" style={{ fontSize: '15px', fontWeight: 'bold' }}>{t.name}</th>
                        ))}
                      </tr>
                      <tr>
                        {group.map(t => (
                          DAYS.map(day => (
                            <th key={`${t.id}-${day}`} className="wc-merged-sub-header">
                              {day}
                            </th>
                          ))
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {SLOTS.map((slot, slotIdx) => {
                        const timeStr = formatTime(slot.hour, slot.minute);
                        return (
                          <tr key={slotIdx}>
                            <td className="wc-time-cell-merged">{timeStr}</td>
                            {group.map(t => {
                              return [0, 1, 2, 3, 4].map(dayIdx => {
                                const appts = getApptsInCell(t.id, dayIdx, slotIdx);
                                return (
                                  <td key={`${t.id}-${dayIdx}`} className="wc-cell-merged">
                                    <div className="wc-cell-inner vertical-layout">
                                      {appts.map(appt => (
                                        <div
                                          key={appt.id}
                                          className={`wc-appt-card-mini ${appt.patientType || "outpatient"}`}
                                          onMouseEnter={(e) => handleMouseEnter(e, appt)}
                                          onMouseLeave={handleMouseLeave}
                                        >
                                          <span className="appt-card-name">{appt.patient}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </td>
                                );
                              });
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          } else {
            // 餘數治療師個別排程表
            return group.map(t => (
              <div key={t.id} className="wc-container wc-individual-section" style={{ marginBottom: "30px" }}>
                <div className="wc-title">排程週表 — {t.name}</div>
                <div className="wc-scroll-wrap">
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
                    {SLOTS.map((slot, slotIndex) => (
                      <div
                        key={`time-${slotIndex}`}
                        className="wc-time-cell"
                        style={{ gridColumn: 1, gridRow: slotIndex + 1 }}
                      >
                        <div className="wc-time-label">{formatTime(slot.hour, slot.minute)}</div>
                      </div>
                    ))}

                    {SLOTS.map((_, slotIndex) =>
                      DAYS.map((_, dayIndex) => {
                        const key = `cell-${dayIndex}-${slotIndex}`;
                        const appts = getApptsInCell(t.id, dayIndex, slotIndex);
                        
                        return (
                          <div
                            key={key}
                            className="wc-cell"
                            style={{ gridColumn: dayIndex + 2, gridRow: slotIndex + 1 }}
                          >
                            <div className="wc-cell-inner vertical-layout">
                              {appts.map((appt) => (
                                <div
                                  key={appt.id}
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
            ));
          }
        })}

        {tooltip.show && (
          <div 
            className="wc-custom-tooltip"
            style={{
              position: 'fixed',
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
            {tooltip.otStText && (
              <div className="tooltip-row"><b>職能/語言時段：</b>{tooltip.otStText}</div>
            )}
          </div>
        )}
      </div>
    );
  }

  // 2. 個別治療師排程模式 (併排空檔時段顯示)
  return (
    <div className="wc-outer" style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap', position: 'relative' }}>
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

      {/* 左側排程週表 */}
      <div className="wc-container" style={{ flex: '1 1 700px', minWidth: '0' }}>
        <div className="wc-title">排程週表 — {therapistName || therapistId}</div>
        <div className="wc-scroll-wrap">
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

            {/* cells */}
            {SLOTS.map((_, slotIndex) =>
              DAYS.map((_, dayIndex) => {
                const key = `cell-${dayIndex}-${slotIndex}`;
                const appts = getApptsInCell(therapistId, dayIndex, slotIndex);
                
                return (
                  <div
                    key={key}
                    className="wc-cell"
                    style={{ gridColumn: dayIndex + 2, gridRow: slotIndex + 1 }}
                  >
                    <div className="wc-cell-inner vertical-layout">
                      {appts.map((appt) => (
                        <div
                          key={appt.id}
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

      {/* 右側空檔時段顯示 */}
      <div className="wc-free-slots-panel" style={{ width: '280px', flexShrink: 0 }}>
        <div className="free-slots-title">💡 空檔時段顯示</div>
        <div className="free-slots-subtitle">未滿兩位病人的時段</div>
        <div className="free-slots-container">
          {freeSlots.length === 0 ? (
            <div className="free-slots-empty">目前該治療師無任何空檔</div>
          ) : (
            freeSlots.map((item, idx) => {
              const daysStr = item.freeDays.map(d => dayNames[d]).join('、');
              return (
                <div key={idx} className="free-slot-item">
                  <span className="free-slot-days">{daysStr}</span>
                  <span className="free-slot-at">的</span>
                  <span className="free-slot-time">{item.timeStr}</span>
                  <span className="free-slot-desc">為空檔時段</span>
                </div>
              );
            })
          )}
        </div>
      </div>
      
      {tooltip.show && (
        <div 
          className="wc-custom-tooltip"
          style={{
            position: 'fixed',
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
          {tooltip.otStText && (
            <div className="tooltip-row"><b>職能/語言時段：</b>{tooltip.otStText}</div>
          )}
        </div>
      )}
    </div>
  );
}
