import React from "react";
import WeekCalendar from "./components/WeekCalendar";

export default function App() {
  return (
    <div style={{ padding: 18 }}>
      <h1 style={{ color: "#1e40af", fontSize: 20 }}>病患排程器</h1>
      <WeekCalendar />
    </div>
  );
}
