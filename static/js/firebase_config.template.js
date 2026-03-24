// Firebase設定テンプレート
// このファイルをコピーして firebase_config.js を作成し、
// 実際のFirebaseプロジェクト設定を記入してください。
// firebase_config.js は .gitignore に含まれており、リポジトリには含まれません。
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// CDN読み込みされた後に初期化を実行
if (typeof firebase !== 'undefined') {
    firebase.initializeApp(firebaseConfig);
    window.db = firebase.database();
}
