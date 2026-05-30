// frontend/src/firebase.js
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

// 請在此處填入您的 Firebase 專案配置資訊，或在專案根目錄建立 .env 檔案並設定以下環境變數。
// 您可以從 Firebase Console -> 專案設定 -> 您的應用程式 中取得此配置。
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBMTc-2HGF8jXa8ejM4lLSN-wAlemENupo",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "patient-scheduler-7ad1b.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "patient-scheduler-7ad1b",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "patient-scheduler-7ad1b.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "23615454204",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:23615454204:web:9ff743e3fd5aa191c81079",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-NZ6X8TWQZE"
};

// 初始化 Firebase 與匯出實例，加入 try-catch 避免在 file:// 協定或安全沙箱下因 top-level 錯誤而白屏
let app = null;
let db = null;
let auth = null;

try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
} catch (e) {
  console.warn("Firebase 初始化失敗，雲端同步功能將無法使用：", e);
}

export { db, auth };
export default app;
