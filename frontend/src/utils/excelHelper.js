import * as XLSX from 'xlsx';

/**
 * 格式化 Excel 時間。如果是小數（Excel 時間格式），轉換為 HH:MM；如果是字串，則保持原樣。
 * @param {any} val 
 * @returns {string}
 */
export function formatExcelTime(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') {
    let timeFraction = val;
    if (timeFraction >= 1) {
      timeFraction = timeFraction - Math.floor(timeFraction);
    }
    const totalSeconds = Math.round(timeFraction * 24 * 3600);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const pad = (num) => String(num).padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}`;
  }
  return String(val).trim();
}

// 星期對照表
const DAY_MAP_CN_TO_NUM = {
  '週一': 1, '星期一': 1, '一': 1, '1': 1,
  '週二': 2, '星期二': 2, '二': 2, '2': 2,
  '週三': 3, '星期三': 3, '三': 3, '3': 3,
  '週四': 4, '星期四': 4, '四': 4, '4': 4,
  '週五': 5, '星期五': 5, '五': 5, '5': 5
};

const DAY_MAP_NUM_TO_CN = {
  1: '週一', 2: '週二', 3: '週三', 4: '週四', 5: '週五'
};

// 病患類型對照表
const TYPE_MAP_CN_TO_EN = {
  '門診': 'outpatient', 'outpatient': 'outpatient',
  '住院': 'inpatient', 'inpatient': 'inpatient'
};

const TYPE_MAP_EN_TO_CN = {
  'outpatient': '門診', 'inpatient': '住院'
};

/**
 * 核心解析與驗證資料列邏輯 (抽離為公用函式)
 * @param {Array} rawRows 
 * @returns {{successData: Array, errorRows: Array}}
 */
export function parseRawRows(rawRows) {
  if (rawRows.length < 2) {
    return { successData: [], errorRows: [{ rowNum: 1, error: '資料內容為空或缺少標題列' }] };
  }

  const headers = rawRows[0].map(h => String(h || '').trim());
  const dataRows = rawRows.slice(1);

  // 寬鬆比對欄位索引的輔助函式
  const findHeaderIndex = (aliases) => {
    return headers.findIndex(h => 
      aliases.some(alias => h.toLowerCase().includes(alias.toLowerCase()))
    );
  };

  const idxTherapist = findHeaderIndex(['治療師', 'therapist']);
  const idxPatient = findHeaderIndex(['病人姓名', '病人', '病患', 'patient']);
  const idxDay = findHeaderIndex(['預約星期', '星期', '星期幾', 'day']);
  const idxStart = findHeaderIndex(['開始時間', '時間', '開始', 'start']);
  const idxDuration = findHeaderIndex(['時長', '時間長度', 'duration']);
  const idxType = findHeaderIndex(['病患類型', '類型', 'patientType']);
  const idxHandover = findHeaderIndex(['交班備註', '備註', '交班', 'handoverText']);

  // 如果找不到最關鍵的「病人姓名」欄位，直接報錯
  if (idxPatient === -1) {
    return { 
      successData: [], 
      errorRows: [{ rowNum: 1, error: `找不到必要的「病人姓名」欄位。現有欄位為：${headers.join(', ')}` }] 
    };
  }

  const successData = [];
  const errorRows = [];

  dataRows.forEach((row, index) => {
    const rowNum = index + 2; // 1-based index, 扣除標題列所以 +2
    
    // 跳過空白列
    if (!row || row.filter(cell => cell !== null && cell !== undefined && String(cell).trim() !== '').length === 0) {
      return;
    }

    const therapistVal = idxTherapist !== -1 ? String(row[idxTherapist] || '').trim() : '';
    const patientVal = idxPatient !== -1 ? String(row[idxPatient] || '').trim() : '';
    const dayVal = idxDay !== -1 ? String(row[idxDay] || '').trim() : '';
    const startVal = idxStart !== -1 ? formatExcelTime(row[idxStart]) : '';
    const durationVal = idxDuration !== -1 ? String(row[idxDuration] || '').trim() : '';
    const typeVal = idxType !== -1 ? String(row[idxType] || '').trim() : '';
    const handoverVal = idxHandover !== -1 ? String(row[idxHandover] || '') : '';

    const errors = [];

    // 1. 驗證病人姓名
    if (!patientVal) {
      errors.push('病人姓名不能為空白');
    }

    // 2. 驗證預約星期 (支援以分號、逗號、頓號、斜線分隔的多個星期)
    const parsedDays = [];
    if (!dayVal) {
      errors.push('未指定預約星期');
    } else {
      const dayParts = dayVal.split(/[\s;；,，、/]+/);
      const invalidParts = [];

      dayParts.forEach(part => {
        const cleanPart = part.trim();
        if (!cleanPart) return;

        let dayNum = DAY_MAP_CN_TO_NUM[cleanPart];
        if (!dayNum) {
          const num = parseInt(cleanPart, 10);
          if (num >= 1 && num <= 5) {
            dayNum = num;
          }
        }

        if (dayNum) {
          parsedDays.push(dayNum);
        } else {
          invalidParts.push(cleanPart);
        }
      });

      if (parsedDays.length === 0) {
        errors.push(`未指定有效的預約星期 ("${dayVal}")`);
      } else if (invalidParts.length > 0) {
        errors.push(`部分預約星期格式錯誤：包含無效值 "${invalidParts.join(', ')}"`);
      }
    }

    // 3. 驗證開始時間 (例如 "08:00")
    let startTime = startVal;
    if (!startTime) {
      errors.push('未指定開始時間');
    } else {
      // 嘗試將 "8:00" 轉換成 "08:00" 等標準格式
      if (/^\d{1}:\d{2}$/.test(startTime)) {
        startTime = '0' + startTime;
      }
      if (!/^\d{2}:\d{2}$/.test(startTime)) {
        errors.push(`開始時間格式錯誤 ("${startVal}")，應為 HH:MM`);
      }
    }

    // 4. 驗證時長 (預設 30 分鐘，僅支援 30, 60, 90)
    let duration = 30;
    if (durationVal) {
      const parsedDur = parseInt(durationVal, 10);
      if ([30, 60, 90].includes(parsedDur)) {
        duration = parsedDur;
      } else {
        errors.push(`預約時長必須為 30、60 或 90 分鐘 ("${durationVal}")`);
      }
    }

    // 5. 驗證病患類型 (預設門診)
    let patientType = 'outpatient';
    if (typeVal) {
      const mappedType = TYPE_MAP_CN_TO_EN[typeVal];
      if (mappedType) {
        patientType = mappedType;
      } else {
        errors.push(`病患類型格式錯誤 ("${typeVal}")，應為「門診」或「住院」`);
      }
    }

    if (errors.length > 0) {
      errorRows.push({
        rowNum,
        patient: patientVal || '未填寫',
        error: errors.join('；')
      });
    } else {
      parsedDays.forEach(dayNum => {
        successData.push({
          rowNum,
          therapistName: therapistVal || null, // 若空白，則在匯入流程中對應至當前選擇的治療師
          patient: patientVal,
          day: dayNum,
          start: startTime,
          duration,
          patientType,
          handoverText: handoverVal.trim()
        });
      });
    }
  });

  return { successData, errorRows };
}

/**
 * 解析匯入的 Excel 或 CSV 檔案 (讀取 ArrayBuffer 格式)
 * @param {File|Blob} file 
 * @returns {Promise<{successData: Array, errorRows: Array}>}
 */
export function parseImportFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // 讀取為二維陣列
        const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        resolve(parseRawRows(rawRows));
      } catch (err) {
        reject(new Error(`解析檔案失敗：${err.message}`));
      }
    };
    reader.onerror = () => reject(new Error('讀取檔案時發生錯誤'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * 解析匯入的貼上純文字 (TSV/CSV 格式)
 * @param {string} text 
 * @returns {Promise<{successData: Array, errorRows: Array}>}
 */
export function parseImportText(text) {
  return new Promise((resolve) => {
    try {
      const workbook = XLSX.read(text, { type: 'string' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      // 讀取為二維陣列
      const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      resolve(parseRawRows(rawRows));
    } catch (err) {
      resolve({
        successData: [],
        errorRows: [{ rowNum: 1, error: `解析貼上內容失敗：${err.message}` }]
      });
    }
  });
}

/**
 * 匯出預約排程為 Excel 檔案 (.xlsx)
 * @param {Array} appointments 
 * @param {Array} therapists 
 * @param {string} fileName 
 */
export function exportToExcel(appointments, therapists, fileName = '治療排程表') {
  const data = appointments.map(appt => {
    const therapist = therapists.find(t => t.id === appt.therapistId);
    return {
      '治療師姓名': therapist ? (therapist.name || therapist.username) : '未分配',
      '病人姓名': appt.patient,
      '預約星期': DAY_MAP_NUM_TO_CN[appt.day] || `週${appt.day}`,
      '開始時間': appt.start,
      '時長(分鐘)': appt.duration,
      '病患類型': TYPE_MAP_EN_TO_CN[appt.patientType] || '門診',
      '交班備註': appt.handoverText || ''
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '排程資料');
  
  // 欄位寬度微調
  worksheet['!cols'] = [
    { wch: 15 }, // 治療師姓名
    { wch: 15 }, // 病人姓名
    { wch: 10 }, // 預約星期
    { wch: 10 }, // 開始時間
    { wch: 12 }, // 時長(分鐘)
    { wch: 10 }, // 病患類型
    { wch: 35 }  // 交班備註
  ];

  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], { type: 'application/octet-stream' });
  triggerDownload(blob, `${fileName}.xlsx`);
}

/**
 * 匯出預約排程為 CSV 檔案
 * @param {Array} appointments 
 * @param {Array} therapists 
 * @param {string} fileName 
 */
export function exportToCSV(appointments, therapists, fileName = '治療排程表') {
  const data = appointments.map(appt => {
    const therapist = therapists.find(t => t.id === appt.therapistId);
    return {
      '治療師姓名': therapist ? (therapist.name || therapist.username) : '未分配',
      '病人姓名': appt.patient,
      '預約星期': DAY_MAP_NUM_TO_CN[appt.day] || `週${appt.day}`,
      '開始時間': appt.start,
      '時長(分鐘)': appt.duration,
      '病患類型': TYPE_MAP_EN_TO_CN[appt.patientType] || '門診',
      '交班備註': appt.handoverText || ''
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(data);
  const csvContent = XLSX.utils.sheet_to_csv(worksheet);
  
  // 加上 UTF-8 BOM (\uFEFF) 防止 Microsoft Excel 直接開啟 CSV 時中文字亂碼
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, `${fileName}.csv`);
}

/**
 * 觸發瀏覽器下載檔案
 * @param {Blob} blob 
 * @param {string} filename 
 */
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 解析週六住院病人排程資料 (二維陣列)
 * @param {Array} rawRows
 * @returns {{successData: Array, errorRows: Array}}
 */
export function parseSaturdayRawRows(rawRows) {
  if (rawRows.length < 2) {
    return { successData: [], errorRows: [{ rowNum: 1, error: '資料內容為空或缺少標題列' }] };
  }

  const headers = rawRows[0].map(h => String(h || '').trim());
  const dataRows = rawRows.slice(1);

  const findHeaderIndex = (aliases) => {
    return headers.findIndex(h => 
      aliases.some(alias => h.toLowerCase().includes(alias.toLowerCase()))
    );
  };

  const idxPatient = findHeaderIndex(['病人姓名', '姓名', '病人', '病患', 'patient']);
  const idxBed = findHeaderIndex(['房號', '床號', '病房', 'bed', 'room']);
  const idxTherapist = findHeaderIndex(['治療師', '負責治療師', 'therapist']);
  const idxPt = findHeaderIndex(['物理治療', '物理', 'pt']);
  const idxOt = findHeaderIndex(['職能治療', '職能', 'ot']);
  const idxSt = findHeaderIndex(['語言治療', '語言', 'st']);
  const idxSatTime = findHeaderIndex(['時間', '週六時間', '排程時間', 'saturdayTime', 'time']);
  const idxWeekdayTime = findHeaderIndex(['週一-週五時間', '平日時間', '平日', 'weekdayTime', 'weekday']);
  const idxNote = findHeaderIndex(['備註', '說明', 'note', 'handoverText']);

  if (idxPatient === -1) {
    return { 
      successData: [], 
      errorRows: [{ rowNum: 1, error: `找不到必要的「病人姓名」欄位。現有欄位為：${headers.join(', ')}` }] 
    };
  }

  const successData = [];
  const errorRows = [];

  dataRows.forEach((row, index) => {
    const rowNum = index + 2;
    if (!row || row.filter(cell => cell !== null && cell !== undefined && String(cell).trim() !== '').length === 0) {
      return;
    }

    const patient = idxPatient !== -1 ? String(row[idxPatient] || '').trim() : '';
    const bed = idxBed !== -1 ? String(row[idxBed] || '').trim() : '';
    const therapist = idxTherapist !== -1 ? String(row[idxTherapist] || '').trim() : '';
    const ptTime = idxPt !== -1 ? formatExcelTime(row[idxPt]) : '';
    const otTime = idxOt !== -1 ? formatExcelTime(row[idxOt]) : '';
    const stTime = idxSt !== -1 ? formatExcelTime(row[idxSt]) : '';
    const saturdayTime = idxSatTime !== -1 ? formatExcelTime(row[idxSatTime]) : '';
    const weekdayTime = idxWeekdayTime !== -1 ? formatExcelTime(row[idxWeekdayTime]) : '';
    const note = idxNote !== -1 ? String(row[idxNote] || '').trim() : '';

    if (!patient) {
      errorRows.push({ rowNum, error: '病人姓名不能為空白' });
    } else {
      successData.push({
        rowNum,
        patient,
        bed,
        therapist,
        ptTime,
        otTime,
        stTime,
        saturdayTime,
        weekdayTime,
        note
      });
    }
  });

  return { successData, errorRows };
}

/**
 * 讀取並解析週六排程 Excel 檔案 (.xlsx, .xls, .csv)
 * @param {File|Blob} file
 * @returns {Promise<{successData: Array, errorRows: Array}>}
 */
export function parseSaturdayImportFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        resolve(parseSaturdayRawRows(rawRows));
      } catch (err) {
        reject(new Error(`解析檔案失敗：${err.message}`));
      }
    };
    reader.onerror = () => reject(new Error('讀取檔案時發生錯誤'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * 解析週六排程貼上純文字
 * @param {string} text
 * @returns {Promise<{successData: Array, errorRows: Array}>}
 */
export function parseSaturdayImportText(text) {
  return new Promise((resolve) => {
    try {
      const workbook = XLSX.read(text, { type: 'string' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      resolve(parseSaturdayRawRows(rawRows));
    } catch (err) {
      resolve({
        successData: [],
        errorRows: [{ rowNum: 1, error: `解析貼上內容失敗：${err.message}` }]
      });
    }
  });
}

/**
 * 讀取並解析簡易平日排程 Excel 檔案 (只比對姓名與時間)
 * @param {File|Blob} file
 * @returns {Promise<{successData: Array, errorRows: Array}>}
 */
export function parseSimpleWeekdayFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        resolve(parseSimpleWeekdayRawRows(rawRows));
      } catch (err) {
        reject(new Error(`解析平日對照檔案失敗：${err.message}`));
      }
    };
    reader.onerror = () => reject(new Error('讀取檔案時發生錯誤'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * 解析簡易平日排程資料 (二維陣列)
 * @param {Array} rawRows
 * @returns {{successData: Array, errorRows: Array}}
 */
export function parseSimpleWeekdayRawRows(rawRows) {
  if (rawRows.length < 2) {
    return { successData: [], errorRows: [{ rowNum: 1, error: '資料內容為空或缺少標題列' }] };
  }

  const headers = rawRows[0].map(h => String(h || '').trim());
  const dataRows = rawRows.slice(1);

  const findHeaderIndex = (aliases) => {
    return headers.findIndex(h => 
      aliases.some(alias => h.toLowerCase().includes(alias.toLowerCase()))
    );
  };

  const idxPatient = findHeaderIndex(['病人姓名', '姓名', '病人', '病患', 'patient']);
  const idxTime = findHeaderIndex(['時間', '開始時間', '預約時間', '時段', '平日時間', 'start', 'time']);
  const idxDay = findHeaderIndex(['預約星期', '星期', '星期幾', 'day', 'weekday']);

  if (idxPatient === -1) {
    return { 
      successData: [], 
      errorRows: [{ rowNum: 1, error: `找不到必要的「病人姓名」欄位。現有欄位為：${headers.join(', ')}` }] 
    };
  }

  if (idxTime === -1) {
    return {
      successData: [],
      errorRows: [{ rowNum: 1, error: `找不到必要的「時間」欄位。現有欄位為：${headers.join(', ')}` }]
    };
  }

  const successData = [];
  const errorRows = [];

  dataRows.forEach((row, index) => {
    const rowNum = index + 2;
    if (!row || row.filter(cell => cell !== null && cell !== undefined && String(cell).trim() !== '').length === 0) {
      return;
    }

    const patient = String(row[idxPatient] || '').trim();
    const timeVal = formatExcelTime(row[idxTime]);
    const dayVal = idxDay !== -1 ? String(row[idxDay] || '').trim() : '';

    if (!patient) {
      errorRows.push({ rowNum, error: '病人姓名不能為空白' });
      return;
    }
    if (!timeVal) {
      errorRows.push({ rowNum, error: '時間不能為空白' });
      return;
    }

    // 嘗試解析星期。如果 timeVal 本身包含 "週一", "週二" 等，或 dayVal 有值
    let dayNum = 0;
    const cleanDayVal = dayVal.trim();
    if (cleanDayVal) {
      dayNum = DAY_MAP_CN_TO_NUM[cleanDayVal] || parseInt(cleanDayVal, 10) || 0;
    }
    
    // 如果從 day 欄位沒抓到，嘗試從時間字串中抓取
    if (dayNum === 0) {
      const match = timeVal.match(/(週|星期)(一|二|三|四|五|六|日|1|2|3|4|5|6|7)/);
      if (match) {
        dayNum = DAY_MAP_CN_TO_NUM[match[0]] || DAY_MAP_CN_TO_NUM[`週${match[2]}`] || 0;
      }
    }

    successData.push({
      rowNum,
      patient,
      start: timeVal,
      day: dayNum,
      duration: 30,
      patientType: 'outpatient'
    });
  });

  return { successData, errorRows };
}
