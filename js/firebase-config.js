// Firebase settings for signing in and storing data in the cloud.
//
// Paste the web app config from Firebase console → Project settings → Your apps
// (these values are public by design; access is controlled by firestore.rules).
// While this is null the app runs as before: data stays in this browser only and
// there is no sign-in button.
export const firebaseConfig = {
  apiKey: "AIzaSyAkr3k1Jpc2-UjC3Wv2GsQGXYMQLDtR3zg",
  authDomain: "weigh-in-068257.firebaseapp.com",
  projectId: "weigh-in-068257",
  storageBucket: "weigh-in-068257.firebasestorage.app",
  messagingSenderId: "180133465276",
  appId: "1:180133465276:web:daacb6b6f902d3c0ded4b9",
};

// Tests set window.__WEIGHIN_EMULATOR before the page loads to use the local
// Firebase emulators instead. Only honoured on localhost.
export const useEmulator = typeof window !== "undefined"
  && window.__WEIGHIN_EMULATOR === true
  && ["127.0.0.1", "localhost"].includes(location.hostname);

export const cloudAvailable = useEmulator || firebaseConfig != null;
