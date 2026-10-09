import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
async function loadLocalEnvironment() {
  try {
    const source = await fs.readFile(path.join(ROOT, ".env"), "utf8");
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  } catch (error) { if (error.code !== "ENOENT") throw error; }
}
await loadLocalEnvironment();
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "site-data.json");
const PORT = Number(process.env.PORT || 3000);
const ISRAEL_TZ = "Asia/Jerusalem";
const FIRST_ADMIN_CODE = process.env.ADMIN_CODE || (process.env.NODE_ENV === "production" ? "" : "KAV-start-7319!");
const sessions = new Map();
const loginAttempts = new Map();
const weekdayNames = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

const initialStore = {
  business: { name: "סטודיו קו", tagline: "אתרים מדויקים. תהליך אישי. תוצאה שנראית כמוך.", email: "", phone: "" },
  content: { heroLineOne: "העסק שלך", heroLineTwo: "ראוי לנוכחות אחרת.", heroDescription: "אתר אישי ומדויק שמספר את הסיפור שלך, מציג את מה שאת עושה ומקל על לקוחות ליצור קשר. מהרעיון ועד העלייה לאוויר — בתהליך ברור ובמחיר נגיש.", bookingLineOne: "יש לך רעיון.", bookingLineTwo: "בואי ניתן לו צורה.", bookingDescription: "בחרי יום ושעה לשיחת עיון. נלמד על העסק ונחשוב יחד מה האתר יכול לעשות בשבילך.", accentColor: "#655476" },
  schedule: { weekdays: [0, 1, 2, 3, 4], start: "10:00", end: "16:00", slotMinutes: 30, maxDaysAhead: 45, blockedDates: [] },
  packages: [
    { id: "landing", name: "עמוד נחיתה", price: "₪2,000", description: "עמוד חד וברור שמציג את העסק ומוביל את הלקוח לפעולה.", features: ["עיצוב אישי ומותאם לנייד", "שירותים וטופס פנייה", "כפתור WhatsApp והדרכה"], featured: false },
    { id: "business", name: "אתר תדמית", price: "₪2,250", description: "נוכחות מקצועית שמספרת את הסיפור שלך ומציגה את השירותים.", features: ["עד 3 עמודים מעוצבים", "גלריית עבודות ופרטי קשר", "מפה וקישורים לרשתות"], featured: true },
    { id: "plus", name: "אתר תדמית פלוס", price: "₪2,500", description: "עוד מקום לתוכן, תיק עבודות וכלים שימושיים ללקוחות.", features: ["עד 5 אזורי תוכן", "טופס מתקדם או בקשת פגישה", "תוכן מותאם למובייל והדרכה"], featured: false }
  ],
  bookings: [],
  adminCredential: null
};

let store;
let writeQueue = Promise.resolve();

function codeRecord(code) {
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: scryptSync(code, salt, 64).toString("hex") };
}

function codeMatches(code, record) {
  if (!record?.salt || !record?.hash) return false;
  const candidate = scryptSync(code, record.salt, 64);
  const known = Buffer.from(record.hash, "hex");
  return candidate.length === known.length && timingSafeEqual(candidate, known);
}

async function saveStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temporary = DATA_FILE + ".tmp";
  await fs.writeFile(temporary, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(temporary, DATA_FILE);
}

async function loadStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    store = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    store = structuredClone(initialStore);
  }
  store.business ||= structuredClone(initialStore.business);
  store.content ||= structuredClone(initialStore.content);
  store.schedule ||= structuredClone(initialStore.schedule);
  store.packages ||= structuredClone(initialStore.packages);
  store.bookings ||= [];
  if (!store.adminCredential) {
    if (!FIRST_ADMIN_CODE) throw new Error("Set a unique ADMIN_CODE before the first production launch.");
    store.adminCredential = codeRecord(FIRST_ADMIN_CODE);
  }
  await saveStore();
}

function json(res, status, data, extraHeaders = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders });
  res.end(JSON.stringify(data));
}

function minutes(value) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value || "")) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function israelDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: ISRAEL_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = Object.fromEntries(parts.map((entry) => [entry.type, entry.value]));
  return `${part.year}-${part.month}-${part.day}`;
}

function israelMinutes(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: ISRAEL_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const part = Object.fromEntries(parts.map((entry) => [entry.type, entry.value]));
  return Number(part.hour) * 60 + Number(part.minute);
}

function validDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date || "") && !Number.isNaN(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;
}

function getSlotInventory(date, currentStore = store) {
  const { schedule, bookings } = currentStore;
  if (!validDate(date) || schedule.blockedDates.includes(date)) return [];
  const today = israelDate();
  const offsetDays = (Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000;
  if (offsetDays < 0 || offsetDays > schedule.maxDaysAhead) return [];
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (!schedule.weekdays.includes(weekday)) return [];
  const start = minutes(schedule.start);
  const end = minutes(schedule.end);
  const duration = schedule.slotMinutes;
  if (start === null || end === null || end <= start || !Number.isFinite(duration) || duration < 15) return [];
  const booked = new Set(bookings.filter((booking) => booking.date === date && !["cancelled", "declined"].includes(booking.status)).map((booking) => booking.time));
  const now = date === today ? israelMinutes() : -1;
  const slots = [];
  for (let time = start; time + duration <= end; time += duration) {
    const label = `${String(Math.floor(time / 60)).padStart(2, "0")}:${String(time % 60).padStart(2, "0")}`;
    const status = time <= now ? "past" : booked.has(label) ? "booked" : "available";
    slots.push({ time: label, status });
  }
  return slots;
}

function getTimes(date, currentStore = store) {
  return getSlotInventory(date, currentStore).filter((slot) => slot.status === "available").map((slot) => slot.time);
}

function getMonthAvailability(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || "")) return null;
  const [year, monthNumber] = month.split("-").map(Number);
  if (year < 2000 || year > 2100) return null;
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const days = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const slots = getSlotInventory(date);
    const status = slots.some((slot) => slot.status === "available") ? "available" : slots.some((slot) => slot.status === "booked") ? "full" : "closed";
    days.push({ date, status, slots });
  }
  return days;
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 40000) throw Object.assign(new Error("הבקשה גדולה מדי."), { status: 413 });
  }
  try { return JSON.parse(raw || "{}"); }
  catch { throw Object.assign(new Error("המידע שנשלח אינו תקין."), { status: 400 }); }
}

async function mutate(action) {
  const previous = writeQueue;
  let release;
  writeQueue = new Promise((resolve) => { release = resolve; });
  await previous;
  try {
    const result = await action(store);
    await saveStore();
    return result;
  } finally {
    release();
  }
}

function sessionToken(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/(?:^|;\s*)studio_admin=([^;]+)/);
  return match ? match[1] : "";
}

function isAdmin(req) {
  const token = sessionToken(req);
  const expires = sessions.get(token);
  if (!expires || expires < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  json(res, 401, { error: "פג תוקף הכניסה. התחברי שוב כדי להמשיך." });
  return false;
}

function cleanString(value, maxLength, fallback = "") {
  return String(value ?? "").trim().slice(0, maxLength) || fallback;
}

function safeDashboard() {
  const bookings = [...store.bookings]
    .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
    .map(({ sms, ...booking }) => ({ ...booking, whatsappUrl: booking.status === "confirmed" ? whatsappUrlForBooking(booking) : "" }));
  return {
    business: store.business,
    content: store.content,
    schedule: store.schedule,
    packages: store.packages,
    bookings
  };
}

function displayDate(date) {
  return new Intl.DateTimeFormat("he-IL", { timeZone: ISRAEL_TZ, weekday: "long", day: "numeric", month: "long" }).format(new Date(`${date}T12:00:00+03:00`));
}

function normalizePhone(value) {
  const source = String(value || "").trim();
  const digits = source.replace(/\D/g, "");
  const international = source.startsWith("+") ? `+${digits}` : digits.startsWith("00") ? `+${digits.slice(2)}` : digits.startsWith("0") ? `+972${digits.slice(1)}` : digits.startsWith("972") ? `+${digits}` : `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(international) ? international : "";
}

function whatsappUrlForBooking(booking) {
  const phone = normalizePhone(booking.phone);
  if (!phone) return "";
  const message = `שלום ${booking.name}, שיחת העיון שלך אושרה ליום ${displayDate(booking.date)} בשעה ${booking.time}. נדבר איתך אז! נתראה.`;
  return `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(message)}`;
}

async function api(req, res, url) {
  const { pathname, searchParams } = url;
  if (req.method === "GET" && pathname === "/api/site") {
    return json(res, 200, { business: store.business, content: store.content, packages: store.packages, schedule: { slotMinutes: store.schedule.slotMinutes, maxDaysAhead: store.schedule.maxDaysAhead } });
  }
  if (req.method === "GET" && pathname === "/api/availability") {
    if (searchParams.has("month")) {
      const days = getMonthAvailability(searchParams.get("month"));
      if (!days) return json(res, 400, { error: "בחרי חודש תקין." });
      return json(res, 200, { month: searchParams.get("month"), days });
    }
    const date = searchParams.get("date");
    const slots = getSlotInventory(date);
    return json(res, 200, { slots, times: slots.filter((slot) => slot.status === "available").map((slot) => slot.time) });
  }
  if (req.method === "POST" && pathname === "/api/bookings") {
    const body = await readBody(req);
    const name = cleanString(body.name, 80);
    const phone = cleanString(body.phone, 30);
    const email = cleanString(body.email, 120).toLowerCase();
    const businessDescription = cleanString(body.business, 500);
    const date = cleanString(body.date, 10);
    const time = cleanString(body.time, 5);
    const packageId = cleanString(body.packageId, 80);

    if (name.length < 2 || !/[0-9]{7}/.test(phone.replace(/\D/g, "")) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(res, 400, { error: "בדקי את השם, מספר הטלפון וכתובת האימייל." });
    }
    const packageItem = store.packages.find((item) => item.id === packageId);
    if (!packageItem && packageId !== "general") return json(res, 400, { error: "בחרי אחת מהאפשרויות לפני קביעת השיחה." });
    if (!validDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return json(res, 400, { error: "בחרי יום ושעה תקינים." });
    const booking = await mutate((current) => {
      if (!getTimes(date, current).includes(time)) throw Object.assign(new Error("השעה הזו כבר נתפסה. בחרי שעה אחרת."), { status: 409 });
      const record = { id: randomBytes(10).toString("hex"), name, phone, email, business: businessDescription, date, time, packageId, packageName: packageItem?.name || "שיחת עיון כללית", status: "pending", createdAt: new Date().toISOString() };
      current.bookings.push(record);
      return record;
    });
    return json(res, 201, { id: booking.id, date: booking.date, displayDate: displayDate(booking.date), time: booking.time });
  }
  if (req.method === "POST" && pathname === "/api/admin/login") {
    const client = req.socket.remoteAddress || "unknown";
    const attempt = loginAttempts.get(client) || { count: 0, until: 0 };
    if (attempt.until > Date.now()) return json(res, 429, { error: "יותר מדי ניסיונות. נסי שוב בעוד כמה דקות." });
    const body = await readBody(req);
    if (!codeMatches(String(body.code || ""), store.adminCredential)) {
      attempt.count += 1;
      if (attempt.count >= 5) { attempt.count = 0; attempt.until = Date.now() + 15 * 60 * 1000; }
      loginAttempts.set(client, attempt);
      return json(res, 401, { error: "הקוד לא תואם. נסי שוב." });
    }
    loginAttempts.delete(client);
    const token = randomBytes(32).toString("hex");
    sessions.set(token, Date.now() + 8 * 60 * 60 * 1000);
    const secure = process.env.NODE_ENV === "production" || String(req.headers["x-forwarded-proto"] || "").split(",")[0] === "https";
    return json(res, 200, { ok: true }, { "Set-Cookie": `studio_admin=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure ? "; Secure" : ""}` });
  }
  if (req.method === "POST" && pathname === "/api/admin/logout") {
    const token = sessionToken(req);
    sessions.delete(token);
    return json(res, 200, { ok: true }, { "Set-Cookie": "studio_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
  }
  if (req.method === "GET" && pathname === "/api/admin/dashboard") {
    if (!requireAdmin(req, res)) return;
    return json(res, 200, safeDashboard());
  }
  if (req.method === "PUT" && pathname === "/api/admin/settings") {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const weekdays = [...new Set((Array.isArray(body.schedule?.weekdays) ? body.schedule.weekdays : []).map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))];
    const start = cleanString(body.schedule?.start, 5);
    const end = cleanString(body.schedule?.end, 5);
    const duration = Math.min(180, Math.max(15, Number(body.schedule?.slotMinutes) || 30));
    const maxDaysAhead = Math.min(180, Math.max(1, Number(body.schedule?.maxDaysAhead) || 45));
    if (!weekdays.length || minutes(start) === null || minutes(end) === null || minutes(end) <= minutes(start)) {
      return json(res, 400, { error: "בחרי לפחות יום פעילות אחד ובדקי ששעת הסיום מאוחרת משעת ההתחלה." });
    }
    const packages = (Array.isArray(body.packages) ? body.packages : []).slice(0, 12).map((item, index) => ({
      id: cleanString(item.id, 80).replace(/[^a-zA-Z0-9_-]/g, "") || `service-${index + 1}-${randomBytes(3).toString("hex")}`,
      name: cleanString(item.name, 70), price: cleanString(item.price, 60), description: cleanString(item.description, 220),
      features: (Array.isArray(item.features) ? item.features : []).map((feature) => cleanString(feature, 100)).filter(Boolean).slice(0, 8), featured: Boolean(item.featured)
    })).filter((item) => item.name && item.price);
    const blockedDates = [...new Set((Array.isArray(body.schedule?.blockedDates) ? body.schedule.blockedDates : []).filter(validDate))].slice(0, 120);
    await mutate((current) => {
      current.business = {
        name: cleanString(body.business?.name, 60, "סטודיו קו"),
        tagline: cleanString(body.business?.tagline, 140),
        email: cleanString(body.business?.email, 120),
        phone: cleanString(body.business?.phone, 30)
      };
      current.content = {
        heroLineOne: cleanString(body.content?.heroLineOne, 70, initialStore.content.heroLineOne),
        heroLineTwo: cleanString(body.content?.heroLineTwo, 90, initialStore.content.heroLineTwo),
        heroDescription: cleanString(body.content?.heroDescription, 260, initialStore.content.heroDescription),
        bookingLineOne: cleanString(body.content?.bookingLineOne, 70, initialStore.content.bookingLineOne),
        bookingLineTwo: cleanString(body.content?.bookingLineTwo, 90, initialStore.content.bookingLineTwo),
        bookingDescription: cleanString(body.content?.bookingDescription, 260, initialStore.content.bookingDescription),
        accentColor: /^#[0-9a-f]{6}$/i.test(body.content?.accentColor || "") ? body.content.accentColor : initialStore.content.accentColor
      };
      current.schedule = { weekdays, start, end, slotMinutes: duration, maxDaysAhead, blockedDates };
      current.packages = packages;
    });
    return json(res, 200, { ok: true });
  }
  if (req.method === "POST" && pathname === "/api/admin/code") {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const code = String(body.code || "");
    if (code.length < 8 || code.length > 100) return json(res, 400, { error: "הקוד צריך להכיל לפחות 8 תווים." });
    await mutate((current) => { current.adminCredential = codeRecord(code); });
    return json(res, 200, { ok: true });
  }
  const bookingMatch = pathname.match(/^\/api\/admin\/bookings\/([a-f0-9]+)\/(?:status|cancel)$/);
  if (req.method === "POST" && bookingMatch) {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const requestedStatus = pathname.endsWith("/cancel") ? "cancelled" : String(body.status || "");
    if (!["confirmed", "declined", "cancelled"].includes(requestedStatus)) return json(res, 400, { error: "בחרי פעולה תקינה לפגישה." });
    let target = store.bookings.find((item) => item.id === bookingMatch[1]);
    if (!target) return json(res, 404, { error: "הפגישה לא נמצאה." });
    if (requestedStatus === "confirmed" && target.status !== "confirmed" && store.bookings.some((entry) => entry.id !== target.id && entry.date === target.date && entry.time === target.time && !["cancelled", "declined"].includes(entry.status))) {
      return json(res, 409, { error: "השעה נתפסה בינתיים. בחרי זמן אחר לפני האישור." });
    }


    const booking = await mutate((current) => {
      const item = current.bookings.find((entry) => entry.id === bookingMatch[1]);
      if (!item) throw Object.assign(new Error("השיחה לא נמצאה."), { status: 404 });
      if (requestedStatus === "confirmed" && current.bookings.some((entry) => entry.id !== item.id && entry.date === item.date && entry.time === item.time && !["cancelled", "declined"].includes(entry.status))) {
        throw Object.assign(new Error("השעה נתפסה בינתיים. בחרי זמן אחר לפני האישור."), { status: 409 });
      }
      item.status = requestedStatus;

      return item;
    });
    const whatsappUrl = requestedStatus === "confirmed" ? whatsappUrlForBooking(booking) : "";
    return json(res, 200, { ok: true, id: booking.id, status: booking.status, whatsappUrl });
  }
  return json(res, 404, { error: "הנתיב לא נמצא." });
}

const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" };
const publicFiles = new Set(["index.html", "site.css", "site-overrides.css", "redesign.css", "site-refresh.css", "assets/webflow-logo.png", "assets/webflow-logo-light.png", "assets/webflow-logo-upload.png", "assets/cafe-site-example.png", "assets/showcase-law.png", "assets/showcase-garden.png", "assets/showcase-gym.png", "assets/showcase-cleaning.png", "assets/showcase-cafe.png", "app.js", "admin.html", "admin.css", "admin-overrides.css", "admin-redesign.css", "admin.js"]);

async function serve(req, res, url) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { return json(res, 400, { error: "כתובת לא תקינה." }); }

  if (pathname.startsWith("/api/")) return api(req, res, url);
  if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "שיטת הבקשה אינה נתמכת." });
  const relative = pathname === "/" ? "index.html" : pathname === "/admin" || pathname === "/admin/" ? "admin.html" : pathname.replace(/^\/+/, "");
  if (!publicFiles.has(relative)) return json(res, 404, { error: "העמוד לא נמצא." });
  const filename = path.resolve(ROOT, relative);
  if (!filename.startsWith(ROOT + path.sep) && filename !== path.join(ROOT, "index.html")) return json(res, 403, { error: "אין גישה לנתיב הזה." });
  try {
    const data = await fs.readFile(filename);
    res.writeHead(200, { "Content-Type": mime[path.extname(filename)] || "application/octet-stream", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "strict-origin-when-cross-origin", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'", "Cache-Control": path.extname(filename) === ".html" ? "no-cache" : "public, max-age=3600" });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    json(res, 404, { error: "העמוד לא נמצא." });
  }
}

await loadStore();

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  Promise.resolve(serve(req, res, url)).catch((error) => {
    if (res.headersSent) { res.destroy(); return; }
    json(res, error.status || 500, { error: error.message || "אירעה שגיאה. נסי שוב." });
  });
});
server.listen(PORT, "0.0.0.0", () => console.log(`Studio website listening on port ${PORT}`));
