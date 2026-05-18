import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";

// ─── PASTE YOUR FIREBASE CONFIG HERE ───────────────────────────────────────
// 1. Go to https://console.firebase.google.com
// 2. Create a project → Add a web app → copy the firebaseConfig object below
// 3. In the Firebase console: Build → Firestore Database → Create database
const firebaseConfig = {
  apiKey:            "PASTE_YOUR_API_KEY",
  authDomain:        "PASTE_YOUR_AUTH_DOMAIN",
  projectId:         "PASTE_YOUR_PROJECT_ID",
  storageBucket:     "PASTE_YOUR_STORAGE_BUCKET",
  messagingSenderId: "PASTE_YOUR_MESSAGING_SENDER_ID",
  appId:             "PASTE_YOUR_APP_ID",
};
// ───────────────────────────────────────────────────────────────────────────

let db = null;

function getDb() {
  if (!db) {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
  }
  return db;
}

export function isFirebaseConfigured() {
  return !firebaseConfig.apiKey.startsWith("PASTE_");
}

/**
 * Save a completed arrest report to Firestore.
 * Returns the new document ID on success.
 */
export async function saveArrestReport(reportData) {
  const firestore = getDb();
  const ref = await addDoc(collection(firestore, "arrest_reports"), {
    ...reportData,
    savedAt: serverTimestamp(),
  });
  return ref.id;
}

/**
 * Load all saved arrest reports, newest first.
 */
export async function loadArrestReports() {
  const firestore = getDb();
  const q = query(
    collection(firestore, "arrest_reports"),
    orderBy("savedAt", "desc")
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}
