import React from "react";
import WeekCalendar from "./components/WeekCalendar";

export default function App() {
  return (
    <div style={{ padding: 16 }}>
      <h2>Patient Scheduler — Week View</h2>
      <WeekCalendar />
    </div>
  );
}
