import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyABsZnmp3WcYUOgOb6sNF_swv_3gINWhlU",
  authDomain: "gen-lang-client-0899347402.firebaseapp.com",
  projectId: "gen-lang-client-0899347402",
  storageBucket: "gen-lang-client-0899347402.firebasestorage.app",
  messagingSenderId: "83983850235",
  appId: "1:83983850235:web:0815ac286cf8b856892e5e",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, "ai-studio-opti-636d3dcc-e309-404f-93e1-b6cd9c0f19d7");
export const auth = getAuth(app);

// Sign in anonymously for now to allow access
// signInAnonymously(auth).catch((error) => console.error("Auth error:", error));
