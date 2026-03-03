// src/main.ts  (UNCHANGED logic + ensures styles are loaded)
import "./style.css";

import { createApp } from "vue";
import "./style.css";
import App from "./App.vue";

import { setPersistence, browserSessionPersistence } from "firebase/auth";
import { auth } from "./firebase";

// Reduce cross-app auth leakage on the same browser: session-only.
setPersistence(auth, browserSessionPersistence).catch(() => {});

createApp(App).mount("#app");
