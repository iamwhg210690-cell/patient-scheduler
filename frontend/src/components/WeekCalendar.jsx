import React, { useMemo, useState } from "react";
import "./WeekCalendar.css";
import sampleAppointments from "./sampleAppointments";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const START_HOUR = 8;
const END_HOUR = 18;
const SLOT_MIN = 30;

function formatTime(hour, minute) {
  const h = String(hour).padStart(2, "0");
  const m = String(minute).padStart(2, "0");
  return `${h}:${m}`;
}

function generateSlots() {
  const slots = [];
  for (let h = START_HOUR; h < END_HOUR; h++) {
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

  const [draggingId, setDraggingId] = useState(null);

  function onDragStart(e, id) {
    setDraggingId(id);
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  }

  function onDrop(e, dayIndex, slotIndex) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || draggingId;
    if (!id) return;
    const slot = slots[slotIndex];
    setAppointments((prev) => {
      const ap = { ...prev[id] };
      ap.day = dayIndex;
      ap.slotIndex = slotIndex;
      ap.start = `${formatTime(slot.hour, slot.minute)}`;
      return { ...prev, [id]: ap };
    });
    setDraggingId(null);
  }

  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  const gridMap = useMemo(() => {
    const map = {};
    Object.values(appointments).forEach((a) => {
      const key = `${a.day}-${a.slotIndex}`;
      if (!map[key]) map[key] = [];
      map[key].push(a);
    });
    return map;
  }, [appointments, slots]);

  return (
    <div className="wc-container">
      <div className="wc-header">
        <div className="wc-time-col" />
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
              const key = `${dayIndex}-${slotIndex}`;
              const cellAppointments = gridMap[key] || [];
              return (
                <div
                  key={key}
                  className="wc-cell"
                  onDragOver={onDragOver}
                  onDrop={(e) => onDrop(e, dayIndex, slotIndex)}
                >
                  {cellAppointments.map((a) => (
                    <div
                      key={a.id}
                      className="wc-appointment"
                      draggable
                      onDragStart={(e) => onDragStart(e, a.id)}
                      title={`${a.patient} • ${a.start} • ${a.duration}min`}
                    >
                      <div className="wc-appt-title">{a.patient}</div>
                      <div className="wc-appt-meta">{a.start} • {a.duration}m</div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
