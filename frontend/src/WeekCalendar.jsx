import { useEffect, useState, useCallback } from 'react';
import api from './api';
import './WeekCalendar.css';

export default function WeekCalendar({ therapistId }) {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newAppt, setNewAppt] = useState({
    patient: '',
    selectedDays: [1, 2, 3, 4, 5],
    startTime: '08:00',
    duration: 30,
    patientType: 'outpatient'
  });

  const timeSlots = ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00'];
  const days = [1, 2, 3, 4, 5];
  const dayLabels = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五' };

  const fetchAppointments = useCallback(async (tid) => {
    setLoading(true);
    try {
      const res = await api.get(`/api/appointments?therapistId=${tid}`);
      setAppointments(res.data || []);
    } catch (err) {
      console.error('fetchAppointments', err);
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (therapistId == null) return;
    fetchAppointments(therapistId);
  }, [therapistId, fetchAppointments]);

  async function handleCreate(e) {
    e.preventDefault();
    if (newAppt.selectedDays.length === 0) {
      alert('請至少選擇一天');
      return;
    }

    try {
      const payload = {
        therapistId,
        patient: newAppt.patient,
        start: newAppt.startTime,
        duration: newAppt.duration,
        days: newAppt.selectedDays,
        patientType: newAppt.patientType
      };
      const res = await api.post('/api/appointments', payload);
      fetchAppointments(therapistId);
      setNewAppt(prev => ({ ...prev, patient: '', selectedDays: [1, 2, 3, 4, 5] }));
      alert('成功建立 ' + res.data.success.length + ' 筆預約');
    } catch (err) {
      console.error('create appt', err);
      alert('建立失敗');
    }
  }

  function toggleDay(day) {
    setNewAppt(prev => ({
      ...prev,
      selectedDays: prev.selectedDays.includes(day)
        ? prev.selectedDays.filter(d => d !== day)
        : [...prev.selectedDays, day].sort()
    }));
  }

  function getAppointmentsInSlot(dayNum, time) {
    return appointments.filter(a => a.day === dayNum && a.start === time).slice(0, 4);
  }

  if (!therapistId) {
    return <div className="week-calendar"><p>請先選擇治療師</p></div>;
  }

  return (
    <div className="week-calendar">
      <h3>週排程表 - 治療師 {therapistId}</h3>
      {loading ? (
        <div className="loading">載入中…</div>
      ) : (
        <>
          <div className="schedule-table-wrapper">
            <table className="schedule-table">
              <thead>
                <tr>
                  <th className="time-header">時間</th>
                  {days.map(day => (
                    <th key={day} className="day-header">週{dayLabels[day]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {timeSlots.map(time => (
                  <tr key={time} className="time-row">
                    <td className="time-cell">{time}</td>
                    {days.map(day => {
                      const appts = getAppointmentsInSlot(day, time);
                      return (
                        <td key={day + time} className="schedule-slot">
                          <div className="slot-content">
                            {appts.map((appt) => {
                              const h = (appt.duration / 30) * 80;
                              return (
                                <div key={appt.id} className={'appt-badge ' + (appt.patientType === 'inpatient' ? 'inpatient' : 'outpatient')} style={{ height: h + 'px' }}>
                                  <div>{appt.patient}</div>
                                  <div>{appt.duration}分</div>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <section className="create-appt">
            <h4>新增預約</h4>
            <form onSubmit={handleCreate}>
              <input type="text" placeholder="病人姓名" value={newAppt.patient} onChange={e => setNewAppt(Object.assign({}, newAppt, { patient: e.target.value }))} required />
              <div className="day-selector">
                {days.map(d => (
                  <label key={d}>
                    <input type="checkbox" checked={newAppt.selectedDays.includes(d)} onChange={() => toggleDay(d)} />
                    週{dayLabels[d]}
                  </label>
                ))}
              </div>
              <select value={newAppt.startTime} onChange={e => setNewAppt(Object.assign({}, newAppt, { startTime: e.target.value }))}>
                {timeSlots.map(t => (<option key={t} value={t}>{t}</option>))}
              </select>
              <select value={newAppt.duration} onChange={e => setNewAppt(Object.assign({}, newAppt, { duration: Number(e.target.value) }))}>
                <option value={30}>30分鐘</option>
                <option value={60}>60分鐘</option>
                <option value={90}>90分鐘</option>
              </select>
              <select value={newAppt.patientType} onChange={e => setNewAppt(Object.assign({}, newAppt, { patientType: e.target.value }))}>
                <option value="outpatient">門診</option>
                <option value="inpatient">住院</option>
              </select>
              <button type="submit">新增預約</button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
