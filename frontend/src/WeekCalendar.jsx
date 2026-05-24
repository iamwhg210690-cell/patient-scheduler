// frontend/src/WeekCalendar.jsx
import React, { useEffect, useState } from 'react';
import api from './api';

export default function WeekCalendar({ therapistId }) {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(false);

  const [newAppt, setNewAppt] = useState({
    id: '',
    patient: '',
    day: 1,
    slotIndex: 0,
    start: '09:00',
    duration: 60,
    therapistId: therapistId || 1,
    patientType: 'outpatient'
  });

  useEffect(() => {
    if (therapistId == null) return;
    fetchAppointments(therapistId);
  }, [therapistId]);

  async function fetchAppointments(tid) {
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
  }

  async function handleCreate(e) {
    e.preventDefault();
    try {
      const payload = { ...newAppt, therapistId };
      await api.post('/api/appointments', payload);
      fetchAppointments(therapistId);
      setNewAppt(prev => ({ ...prev, id: '', patient: '' }));
    } catch (err) {
      console.error('create appt', err);
      alert('建立失敗');
    }
  }

  function onChangeField(k, v) {
    setNewAppt(prev => ({ ...prev, [k]: v }));
  }

  return (
    <div className="week-calendar">
      <h3>治療師排程 {therapistId ? `(ID ${therapistId})` : ''}</h3>

      <section className="appt-list">
        {loading ? <div>載入中…</div> : (
          appointments.length === 0 ? <div>目前無預約</div> : (
            appointments.map(a => (
              <div key={a.id} className={`appt-card ${a.patientType === 'inpatient' ? 'inpatient' : 'outpatient'}`}>
                <div className="appt-time">{a.start} ({a.duration}m)</div>
                <div className="appt-patient">{a.patient}</div>
                <div className="appt-meta">day:{a.day} slot:{a.slotIndex}</div>
              </div>
            ))
          )
        )}
      </section>

      <section className="create-appt">
        <h4>建立測試預約</h4>
        <form onSubmit={handleCreate}>
          <input placeholder="id" value={newAppt.id} onChange={e => onChangeField('id', e.target.value)} required />
          <input placeholder="病人姓名" value={newAppt.patient} onChange={e => onChangeField('patient', e.target.value)} required />
          <select value={newAppt.patientType} onChange={e => onChangeField('patientType', e.target.value)}>
            <option value="outpatient">門診</option>
            <option value="inpatient">住院</option>
          </select>
          <input type="time" value={newAppt.start} onChange={e => onChangeField('start', e.target.value)} />
          <input type="number" value={newAppt.duration} onChange={e => onChangeField('duration', Number(e.target.value))} />
          <button type="submit">建立</button>
        </form>
      </section>
    </div>
  );
}
