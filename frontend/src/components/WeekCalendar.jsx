import React, { useMemo, useState, useEffect } from "react";
import "./WeekCalendar.css";
import sampleAppointments from "./sampleAppointments";

const DAYS = ["週一", "週二", "週三", "週四", "週五", "週六"]; // 只顯示週一~週六
const SLOT_MIN = 30;
const MORNING_START = 8;
const MORNING_END = 11; // 不含 11:00 之後
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
    for (let m = 0; m < 60; m += SLOT_MIN) {
      slots.push({ hour: h, minute: m });
    }
  }
  for (let h = AFTERNOON_START; h < AFTERNOON_END; h++) {
    for (let m = 0; m < 60; m += SLOT_MIN) {
      slots.push({ hour: h, minute: m });
    }
  }
  return slots;
}

export default function WeekCalendar() {
  const slots = useMemo(() => generateSlots(), []);
  const [appointments, setAppointments] = useState(() =>
    sampleAppointments.reduce((acc, a) => {
      acc[a.id] = a;
      return acc;
    }, {})
  );

  // Modal / form state for creating appointment
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDay, setModalDay] = useState(0);
  const [modalSlotIndex, setModalSlotIndex] = useState(0);
  const [formPatient, setFormPatient] = useState("");
  const [formDuration, setFormDuration] = useState(30);

  // Drag state
  const [draggingId, setDraggingId] = useState(null);

  useEffect(() => {
    // optional: persist to localStorage for quick demo persistence
    const saved = localStorage.getItem("ps_appointments_v1");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setAppointments(parsed);
      } catch {}
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("ps_appointments_v1", JSON.stringify(appointments));
  }, [appointments]);

  function onDragStart(e, id) {
    setDraggingId(id);
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function onDrop(e, dayIndex, slotIndex) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || draggingId;
    if (!id) return;
    setAppointments((prev) => {
      const ap = { ...prev[id] };
      ap.day = dayIndex;
      ap.slotIndex = slotIndex;
      // recompute start time string
      const slot = slots[slotIndex];
      ap.start = formatTime(slot.hour, slot.minute);
      return { ...prev, [id]: ap };
    });
    setDraggingId(null);
  }

  // create appointment via modal
  function openCreateModal(dayIndex, slotIndex) {
    setModalDay(dayIndex);
    setModalSlotIndex(slotIndex);
    setFormPatient("");
    setFormDuration(30);
    setModalOpen(true);
  }

  function submitCreate(e) {
    e.preventDefault();
    const id = `a${Date.now()}`;
    const slot = slots[modalSlotIndex];
    const newAp = {
      id,
      patient: formPatient || "未命名病患",
      day: modalDay,
      slotIndex: modalSlotIndex,
      start: formatTime(slot.hour, slot.minute),
      duration: Number(formDuration),
    };
    setAppointments((prev) => ({ ...prev, [id]: newAp }));
    setModalOpen(false);
  }

  // helper: compute how many slots an appointment spans
  function slotSpanForDuration(duration) {
    return Math.max(1, Math.round(duration / SLOT_MIN));
  }

  // build quick lookup: map startKey -> appointment
  const startMap = useMemo(() => {
    const map = {};
    Object.values(appointments).forEach((a) => {
      const key = `${a.day}-${a.slotIndex}`;
      map[key] = a;
    });
    return map;
  }, [appointments]);

  // render
  return (
    <div className="wc-container">
      <div className="wc-title">病患排程器 — 週圖</div>

      <div className="wc-header">
        <div className="wc-time-col">時間</div>
        {DAYS.map((d) => (
          <div key={d} className="wc-day-col-header">
            {d}
          </div>
        ))}
      </div>

      <div className="wc-grid">
        {slots.map((slot, slotIndex) => (
          <div key={slotIndex} className="wc-row">
            <div className="wc-time-col">
              <div className="wc-time-label">{formatTime(slot.hour, slot.minute)}</div>
            </div>

            {DAYS.map((_, dayIndex) => {
              const startKey = `${dayIndex}-${slotIndex}`;
              const ap = startMap[startKey];
              // if this slot is covered by a multi-slot appointment but not the start, skip rendering cell content
              // we detect coverage by checking any appointment that starts earlier and spans into this slot
              let covered = false;
              Object.values(appointments).forEach((a) => {
                if (a.day !== dayIndex) return;
                const span = slotSpanForDuration(a.duration);
                if (a.slotIndex < slotIndex && a.slotIndex + span > slotIndex) covered = true;
              });

              if (covered && !ap) {
                // render empty cell but visually indicate covered (no duplicate card)
                return (
                  <div key={startKey} className="wc-cell wc-cell-covered" onDragOver={onDragOver} onDrop={(e) => onDrop(e, dayIndex, slotIndex)} />
                );
              }

              return (
                <div
                  key={startKey}
                  className="wc-cell"
                  onDoubleClick={() => openCreateModal(dayIndex, slotIndex)}
                  onDragOver={onDragOver}
                  onDrop={(e) => onDrop(e, dayIndex, slotIndex)}
                >
                  {ap && (
                    <div
                      className="wc-appointment"
                      draggable
                      onDragStart={(e) => onDragStart(e, ap.id)}
                      title={`${ap.patient} • ${ap.start} • ${ap.duration} 分鐘`}
                      style={{
                        // height spans multiple slot rows visually
                        height: `calc(${slotSpanForDuration(ap.duration)} * 48px - 8px)`,
                      }}
                    >
                      <div className="wc-appt-title">{ap.patient}</div>
                      <div className="wc-appt-meta">{ap.start} • {ap.duration} 分鐘</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Modal for creating appointment */}
      {modalOpen && (
        <div className="wc-modal-backdrop" onClick={() => setModalOpen(false)}>
          <div className="wc-modal" onClick={(e) => e.stopPropagation()}>
            <h3>建立 / 預約治療</h3>
            <form onSubmit={submitCreate} className="wc-form">
              <div className="wc-form-row">
                <label>病患姓名</label>
                <input value={formPatient} onChange={(e) => setFormPatient(e.target.value)} placeholder="輸入病患姓名" />
              </div>
              <div className="wc-form-row">
                <label>時段</label>
                <div>{DAYS[modalDay]} • {formatTime(slots[modalSlotIndex].hour, slots[modalSlotIndex].minute)}</div>
              </div>
              <div className="wc-form-row">
                <label>時長（分鐘）</label>
                <select value={formDuration} onChange={(e) => setFormDuration(e.target.value)}>
                  <option value={30}>30</option>
                  <option value={60}>60</option>
                  <option value={90}>90</option>
                </select>
              </div>
              <div className="wc-form-actions">
                <button type="button" className="wc-btn wc-btn-secondary" onClick={() => setModalOpen(false)}>取消</button>
                <button type="submit" className="wc-btn wc-btn-primary">建立預約</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
