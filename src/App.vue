<!-- src/App.vue  (polish UI + i18n; functionality preserved) -->
<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watchEffect } from "vue";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import {
  doc,
  updateDoc,
  serverTimestamp,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
} from "firebase/firestore";
import { ref as rref, set as rset } from "firebase/database";
import { auth, db, rtdb } from "./firebase";
import { plateKeyOf, driverEmailFromPlateKey } from "./lib/plateKey";
import { useI18n } from "./i18n";

type DriverStatus = "available" | "busy" | "offline";
type Booking = any;

const { lang, setLang, t } = useI18n();

watchEffect(() => {
  document.documentElement.lang = lang.value;
});

const user = ref<User | null>(null);
const plate = ref("");
const password = ref("");
const err = ref("");

const driverKey = ref(""); // plateKey derived from auth

// server-truth status (from vehicles/{plateKey})
const serverStatus = ref<DriverStatus>("offline");
const lastStatusAt = ref<number | null>(null);

// UI selection + explicit apply button
const selectedStatus = ref<DriverStatus>("offline");
const statusSaving = ref(false);
const statusMsg = ref("");

const plateKeyInput = computed(() => plateKeyOf(plate.value.trim()));

const gpsOn = ref(false);
const lastPos = ref<{ lat: number; lng: number; ts: number } | null>(null);

const bookings = ref<Booking[]>([]);
let unsubBookings: (() => void) | null = null;
let unsubVehicle: (() => void) | null = null;

let watchId: number | null = null;
let lastSent = 0;

// App.vue

function keyFromUser(u: User) {
  const e = (u.email || "").trim();
  const raw = (e.split("@")[0] || "").trim();

  // IMPORTANT: Firebase Auth may normalize emails to lowercase.
  // Your Firestore doc IDs + vehiclePrivate IDs are uppercase plateKeys (e.g. 38ABC123),
  // so we must normalize here to match those IDs.
  return plateKeyOf(raw) || raw.toUpperCase();
}


function detachBookings() {
  unsubBookings?.();
  unsubBookings = null;
  bookings.value = [];
}

function detachVehicle() {
  unsubVehicle?.();
  unsubVehicle = null;
}

function attachBookings() {
  if (!driverKey.value) return;

  const qx = query(
    collection(db, "bookings"),
    where("vehicleId", "==", driverKey.value),
    orderBy("createdAt", "desc"),
    limit(20)
  );

  unsubBookings = onSnapshot(
    qx,
    (snap) => {
      bookings.value = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    },
    (e) => {
      err.value = e?.message || "Bookings listen failed";
    }
  );
}

function attachVehicle() {
  if (!driverKey.value) return;

  const vref = doc(db, "vehicles", driverKey.value);
  unsubVehicle = onSnapshot(
    vref,
    (snap) => {
      if (!snap.exists()) return;
      const d: any = snap.data();

      const s = (d.driverStatus as DriverStatus) || "offline";
      serverStatus.value = s;

      if (!statusSaving.value && !statusMsg.value) selectedStatus.value = s;

      const ts = d.updatedAt?.toDate?.();
      lastStatusAt.value = ts ? ts.getTime() : null;
    },
    (e) => {
      err.value = e?.message || "Vehicle listen failed";
    }
  );
}

function stopGps() {
  gpsOn.value = false;
  if (watchId != null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

async function login() {
  err.value = "";
  statusMsg.value = "";

  const key = plateKeyInput.value;
  if (!key) {
    err.value = t("login.err.plate");
    return;
  }
  if (!password.value) {
    err.value = t("login.err.pass");
    return;
  }

  const email = driverEmailFromPlateKey(key);
  try {
    await signInWithEmailAndPassword(auth, email, password.value);
    driverKey.value = key;
  } catch (e: any) {
    err.value = `${e?.code || ""} ${e?.message || "Login failed"}`.trim();
  }
}

async function logout() {
  stopGps();
  detachBookings();
  detachVehicle();
  driverKey.value = "";
  statusMsg.value = "";
  await signOut(auth);
}

function pickStatus(s: DriverStatus) {
  selectedStatus.value = s;
  statusMsg.value = "";
}

async function applyDriverStatus() {
  statusMsg.value = "";
  err.value = "";
  if (!driverKey.value) return;

  statusSaving.value = true;
  try {
    await updateDoc(doc(db, "vehicles", driverKey.value), {
      driverStatus: selectedStatus.value,
      updatedAt: serverTimestamp(),
    });
    statusMsg.value = t("status.updated");
  } catch (e: any) {
    err.value = e?.message || "Status update failed";
  } finally {
    statusSaving.value = false;
  }
}

async function pushLocation(lat: number, lng: number) {
  if (!user.value || !driverKey.value) return;

  const now = Date.now();
  if (now - lastSent < 2000) return;
  lastSent = now;

  await rset(rref(rtdb, `liveLocations/${driverKey.value}`), {
    lat,
    lng,
    ts: now,
    status: serverStatus.value,
    uid: user.value.uid,
  });
}

function startGps() {
  if (!navigator.geolocation) {
    err.value = t("gps.noSupport");
    return;
  }
  if (watchId != null) return;

  gpsOn.value = true;
  watchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const ts = Date.now();
      lastPos.value = { lat, lng, ts };
      try {
        await pushLocation(lat, lng);
      } catch (e: any) {
        err.value = e?.message || t("gps.sendFail");
      }
    },
    (e) => {
      err.value = e.message || "GPS error";
      gpsOn.value = false;
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
  );
}

async function acceptBooking(b: any) {
  await updateDoc(doc(db, "bookings", b.id), {
    status: "accepted",
    driverUid: user.value?.uid || null,
    acceptedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  pickStatus("busy");
  await applyDriverStatus();
}

async function rejectBooking(b: any) {
  await updateDoc(doc(db, "bookings", b.id), {
    status: "rejected",
    driverUid: user.value?.uid || null,
    rejectedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

onMounted(() => {
  onAuthStateChanged(auth, async (u) => {
    err.value = "";
    statusMsg.value = "";
    stopGps();
    detachBookings();
    detachVehicle();

    if (!u) {
      user.value = null;
      driverKey.value = "";
      serverStatus.value = "offline";
      selectedStatus.value = "offline";
      lastStatusAt.value = null;
      return;
    }

    // Driver app must only allow @drivers.local accounts
    const email = (u.email || "").toLowerCase();
    if (!email.endsWith("@drivers.local")) {
      await signOut(auth);
      user.value = null;
      driverKey.value = "";
      return;
    }

    user.value = u;
    driverKey.value = keyFromUser(u);

    attachVehicle();
    attachBookings();
  });
});

onUnmounted(() => {
  stopGps();
  detachBookings();
  detachVehicle();
});

function btnStyle(s: DriverStatus) {
  const isActive = selectedStatus.value === s;
  const isServer = serverStatus.value === s;

  return {
    border: "1px solid var(--border)",
    borderRadius: "12px",
    padding: "10px 12px",
    background: isActive ? "var(--ink)" : "#fff",
    color: isActive ? "#fff" : "var(--ink)",
    outline: isServer ? "2px solid var(--ok)" : "none",
    outlineOffset: "1px",
    fontWeight: 900,
  } as any;
}

function fmtTs(ms: number | null) {
  if (!ms) return "-";
  const locale = lang.value === "tr" ? "tr-TR" : "en-US";
  return new Date(ms).toLocaleString(locale);
}

function statusPillClass(s: string) {
  if (s === "accepted") return "pill pillOk";
  if (s === "rejected") return "pill pillBad";
  return "pill pillWarn";
}
</script>

<template>
  <div class="page">
    <header class="topbar">
      <div class="shell">
        <div class="brandRow">
          <div class="brand">
            <span class="brandMark" aria-hidden="true" />
            <span>{{ t("brand.name") }}</span>
            <span class="badge">{{ t("brand.driver") }}</span>
          </div>

          <!-- App.vue — replace ONLY this langSwitch block -->
<div class="langSwitch" aria-label="Language" style="display:flex; align-items:center; gap:10px;">
  <!-- EN on the left -->
  <button :class="{ active: lang === 'en' }" @click="setLang('en')">
    {{ t("lang.en") }}
  </button>

  <!-- flags in the middle: EN left, TR right -->
  <span aria-hidden="true" style="display:flex; align-items:center; gap:6px; line-height:1;">
    <span style="font-size:18px;">🇬🇧</span>
    <span style="font-size:18px;">🇹🇷</span>
  </span>

  <!-- TR on the right -->
  <button :class="{ active: lang === 'tr' }" @click="setLang('tr')">
    {{ t("lang.tr") }}
  </button>
</div>
        </div>
      </div>
    </header>

    <main class="main">
      <div class="shell">
        <div class="grid" style="gap:12px;">
          <div class="card">
            <div class="cardPad grid" style="gap:6px;">
              <div style="font-weight: 1000; font-size: 18px;">{{ t("brand.driver") }}</div>
              <!-- <div class="small">{{ t("login.hint") }}</div> -->
            </div>
          </div>

        <div v-if="!user" class="card loginCard">
          <div class="cardPad grid" style="gap:10px;">
            <input class="input" v-model="plate" :placeholder="t('login.plate')" />
            <input class="input" v-model="password" type="password" :placeholder="t('login.pass')" />
            <button class="btn btnBrand" @click="login">{{ t("login.btn") }}</button>
            <div v-if="err" style="color: var(--bad); font-weight: 900;">{{ err }}</div>
          </div>
        </div>      

          <template v-else>
            <div class="grid2">
              <div class="card">
                <div class="cardPad grid" style="gap:10px;">
                  <div class="row" style="justify-content: space-between;">
                    <div class="grid" style="gap:4px;">
                      <div style="font-weight: 1000; font-size: 18px;">
                        {{ driverKey || "(" + t("session.plateKey") + ")" }}
                      </div>
                      <div class="small">{{ t("session.uid") }}: <span class="mono" style="font-weight: 900;">{{ user.uid }}</span></div>
                    </div>
                    <button class="btn" @click="logout">{{ t("session.logout") }}</button>
                  </div>

                  <hr class="hr" />

                  <div class="grid" style="gap:8px;">
                    <div class="row" style="justify-content: space-between;">
                      <div style="font-weight: 950;">{{ t("status.title") }}</div>
                      <span class="pill" :class="serverStatus === 'available' ? 'pillOk' : (serverStatus === 'busy' ? 'pillWarn' : '')">
                        {{ serverStatus === 'available' ? t("status.available") : (serverStatus === 'busy' ? t("status.busy") : t("status.offline")) }}
                      </span>
                    </div>

                    <div class="row" style="gap:8px; flex-wrap: wrap;">
                      <button :style="btnStyle('available')" @click="pickStatus('available')" :disabled="!driverKey">
                        {{ t("status.available") }}
                      </button>
                      <button :style="btnStyle('busy')" @click="pickStatus('busy')" :disabled="!driverKey">
                        {{ t("status.busy") }}
                      </button>
                      <button :style="btnStyle('offline')" @click="pickStatus('offline')" :disabled="!driverKey">
                        {{ t("status.offline") }}
                      </button>

                      <button class="btn btnBrand" @click="applyDriverStatus" :disabled="!driverKey || statusSaving">
                        {{ statusSaving ? t("status.updating") : t("status.update") }}
                      </button>
                    </div>

                    <div class="small">
                      {{ t("status.server") }}: <b>{{ serverStatus }}</b> •
                      {{ t("status.selected") }}: <b>{{ selectedStatus }}</b> •
                      {{ t("status.last") }}: {{ fmtTs(lastStatusAt) }}
                      <span v-if="statusMsg"> • {{ statusMsg }}</span>
                    </div>
                  </div>

                  <hr class="hr" />

                  <div class="grid" style="gap:8px;">
                    <div class="row" style="justify-content: space-between;">
                      <div style="font-weight: 950;">{{ t("gps.title") }}</div>
                      <span class="kpi">{{ gpsOn ? "ON" : "OFF" }}</span>
                    </div>

                    <div class="row" style="flex-wrap: wrap;">
                      <button v-if="!gpsOn" class="btn btnBrand" @click="startGps" :disabled="!driverKey">
                        {{ t("gps.start") }}
                      </button>
                      <button v-else class="btn" @click="stopGps">
                        {{ t("gps.stop") }}
                      </button>

                      <span class="small" v-if="lastPos">
                        {{ t("gps.last") }}: <b>{{ lastPos.lat.toFixed(5) }}, {{ lastPos.lng.toFixed(5) }}</b>
                      </span>
                    </div>
                  </div>

                  <div v-if="err" style="color: var(--bad); font-weight: 900;">{{ err }}</div>
                </div>
              </div>

              <div class="card">
                <div class="cardPad grid" style="gap:10px;">
                  <div style="font-weight: 1000;">{{ t("bookings.title") }}</div>

                  <div v-if="bookings.length === 0" class="small">{{ t("bookings.none") }}</div>

                  <div v-for="b in bookings" :key="b.id" class="booking">
                    <div class="row" style="justify-content: space-between;">
                      <span :class="statusPillClass(b.status)">{{ b.status }}</span>
                      <span class="small mono">{{ b.id }}</span>
                    </div>

                    <div class="small" v-if="b.from?.label && b.to?.label">
                      <b>{{ b.from.label }}</b> → <b>{{ b.to.label }}</b>
                    </div>

                    <div class="kpiRow" v-if="b.distanceKm != null && b.priceTry != null">
                      <div class="kpi">{{ Number(b.distanceKm).toFixed(1) }} {{ t("common.km") }}</div>
                      <div class="kpi">{{ b.priceTry }} {{ t("common.try") }}</div>
                    </div>

                    <div class="row" style="flex-wrap: wrap;">
                      <button class="btn btnBrand" @click="acceptBooking(b)" :disabled="b.status !== 'pending'">
                        {{ t("bookings.accept") }}
                      </button>
                      <button class="btn" @click="rejectBooking(b)" :disabled="b.status !== 'pending'">
                        {{ t("bookings.reject") }}
                      </button>
                    </div>
                  </div>

                  <div v-if="err" style="color: var(--bad); font-weight: 900;">{{ err }}</div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </main>
  </div>
</template>
