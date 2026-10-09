const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "לא הצלחנו להשלים את הבקשה.");
  return result;
}

let dashboardData = null;
let currentPage = "overview";
let bookingFilter = "pending";
const loginPanel = $("#loginPanel");
const dashboard = $("#dashboard");

function todayIsrael() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const date = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${date.year}-${date.month}-${date.day}`;
}

function showDashboard() {
  loginPanel.classList.add("hidden");
  dashboard.classList.remove("hidden");
}

function showLogin() {
  dashboard.classList.add("hidden");
  loginPanel.classList.remove("hidden");
}

function fillForm(data) {
  dashboardData = data;
  document.querySelectorAll(".admin-brand-name").forEach((node) => { node.textContent = data.business.name; });
  $("#businessName").value = data.business.name || "";
  $("#businessTagline").value = data.business.tagline || "";
  $("#businessEmail").value = data.business.email || "";
  $("#businessPhone").value = data.business.phone || "";
  $("#heroLineOne").value = data.content.heroLineOne || "";
  $("#heroLineTwo").value = data.content.heroLineTwo || "";
  $("#heroDescription").value = data.content.heroDescription || "";
  $("#bookingLineOne").value = data.content.bookingLineOne || "";
  $("#bookingLineTwo").value = data.content.bookingLineTwo || "";
  $("#bookingDescription").value = data.content.bookingDescription || "";
  $("#accentColor").value = data.content.accentColor || "#ef7654";
  $("#startTime").value = data.schedule.start;
  $("#endTime").value = data.schedule.end;
  $("#slotMinutes").value = String(data.schedule.slotMinutes);
  $("#maxDaysAhead").value = data.schedule.maxDaysAhead;
  $("#blockedDates").value = (data.schedule.blockedDates || []).join("\n");
  document.querySelectorAll("[data-weekday]").forEach((input) => { input.checked = data.schedule.weekdays.includes(Number(input.dataset.weekday)); });
  renderPackageEditor(data.packages || []);
  renderBookings(data.bookings || []);
  const today = todayIsrael();
  const activeBookings = (data.bookings || []).filter((booking) => ["pending", "confirmed"].includes(booking.status));
  const pending = (data.bookings || []).filter((booking) => booking.status === "pending");
  const upcoming = activeBookings.filter((booking) => booking.date >= today).length;
  $("#pendingCount").textContent = String(pending.length);
  $("#statsRow").innerHTML = `<div class="stat-card"><span>בקשות חדשות</span><strong>${pending.length}</strong></div><div class="stat-card"><span>פגישות קרובות</span><strong>${upcoming}</strong></div><div class="stat-card"><span>חבילות פעילות</span><strong>${(data.packages || []).length}</strong></div>`;
  renderOverview(pending);
}

function renderOverview(pending) {
  const container = $("#overviewNext");
  if (!pending.length) {
    container.innerHTML = '<div class="empty-bookings">אין בקשות שממתינות לאישור. כשהלקוחה תקבע שיחה, היא תופיע כאן.</div>';
    return;
  }
  container.innerHTML = pending.slice(0, 4).map((booking) => `<article class="overview-booking"><div><b>${esc(booking.name)}</b><small>${esc(displayBookingDate(booking.date))} · ${esc(booking.time)} · ${esc(booking.packageName)}</small></div><button type="button" data-booking-action="confirmed" data-booking-id="${esc(booking.id)}">אישור ופתיחת WhatsApp</button><button type="button" class="decline-action" data-booking-action="declined" data-booking-id="${esc(booking.id)}">דחייה</button></article>`).join("");
}

function renderPackageEditor(packages) {
  const container = $("#packageEditor");
  if (!packages.length) {
    container.innerHTML = '<p class="empty-bookings">עדיין אין חבילות. אפשר להוסיף חבילה חדשה בכפתור למעלה.</p>';
    return;
  }
  container.innerHTML = packages.map((item) => `<article class="editor-item" data-package-id="${esc(item.id)}">
    <button type="button" class="remove-package" data-remove-package>הסרה ✕</button><h3>${esc(item.name || "חבילה חדשה")}</h3>
    <div class="admin-fields">
      <div><label>שם החבילה</label><input data-field="name" maxlength="70" value="${esc(item.name)}" required></div>
      <div><label>מחיר או טווח מחיר</label><input data-field="price" maxlength="60" value="${esc(item.price)}" required></div>
      <div class="full-field"><label>תיאור קצר</label><input data-field="description" maxlength="220" value="${esc(item.description)}"></div>
      <div class="full-field"><label>מה כלול? (שורה לכל פריט)</label><textarea data-field="features" rows="3" maxlength="800">${esc((item.features || []).join("\n"))}</textarea></div>
    </div><label class="feature-toggle"><input data-field="featured" type="checkbox" ${item.featured ? "checked" : ""}> לסמן כחבילה מומלצת</label>
  </article>`).join("");
}

function displayBookingDate(date) {
  return new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00+03:00`));
}

function renderBookings(bookings) {
  const list = $("#bookingsList");
  const filtered = bookingFilter === "all" ? bookings : bookings.filter((booking) => booking.status === bookingFilter);
  if (!filtered.length) {
    const emptyText = bookingFilter === "pending" ? "אין בקשות שממתינות לאישור כרגע." : bookingFilter === "confirmed" ? "אין פגישות מאושרות להצגה." : bookingFilter === "declined" ? "אין בקשות שנדחו להצגה." : "עדיין לא התקבלו בקשות לפגישה.";
    list.innerHTML = `<div class="empty-bookings">${emptyText}</div>`;
    return;
  }
  list.innerHTML = filtered.map((booking) => {
    const statusLabels = { pending: "ממתינה לאישור", confirmed: "אושרה", declined: "נדחתה", cancelled: "בוטלה" };
    const statusClass = booking.status === "pending" ? "pending" : booking.status === "confirmed" ? "confirmed" : "cancelled";
    let actions = "";
    if (booking.status === "pending") actions = `<button class="booking-approve" type="button" data-booking-action="confirmed" data-booking-id="${esc(booking.id)}">אישור ופתיחת WhatsApp</button><button class="booking-cancel" type="button" data-booking-action="declined" data-booking-id="${esc(booking.id)}">דחייה</button>`;
    else if (booking.status === "confirmed") actions = `<button class="booking-cancel" type="button" data-booking-action="cancelled" data-booking-id="${esc(booking.id)}">ביטול פגישה</button>`;
    const whatsappAction = booking.status === "confirmed" && booking.whatsappUrl ? `<a class="whatsapp-ready-link" href="${esc(booking.whatsappUrl)}" target="_blank" rel="noopener noreferrer">פתיחת הודעת WhatsApp מוכנה ↗</a>` : booking.status === "confirmed" ? "לא ניתן להכין הודעה — בדקי את מספר הטלפון" : "";
    return `<article class="booking-row">
      <div class="booking-client"><strong>${esc(booking.name)}</strong><small><a href="mailto:${encodeURIComponent(booking.email)}">${esc(booking.email)}</a></small><small><a href="tel:${esc(booking.phone.replace(/[^+0-9]/g, ""))}">${esc(booking.phone)}</a></small></div>
      <div class="booking-detail"><strong>${esc(displayBookingDate(booking.date))} · ${esc(booking.time)}</strong><small>${esc(booking.packageName)}</small></div>
      <span class="booking-status ${statusClass}">${statusLabels[booking.status] || "ממתינה"}</span>
      <div class="booking-actions">${actions}</div>
      ${whatsappAction ? `<div class="booking-whatsapp">${whatsappAction}</div>` : ""}
      ${booking.business ? `<div class="booking-detail booking-note"><small>על העסק: ${esc(booking.business)}</small></div>` : ""}
    </article>`;
  }).join("");
}

function readPackagesFromEditor() {
  return [...$("#packageEditor").querySelectorAll(".editor-item")].map((card) => ({
    id: card.dataset.packageId,
    name: $("[data-field=name]", card).value,
    price: $("[data-field=price]", card).value,
    description: $("[data-field=description]", card).value,
    features: $("[data-field=features]", card).value.split("\n").map((feature) => feature.trim()).filter(Boolean),
    featured: $("[data-field=featured]", card).checked
  }));
}

function navigateTo(page) {
  const titles = { overview: "סקירה כללית", bookings: "ניהול פגישות", availability: "שעות וזמינות", packages: "חבילות ומחירים", site: "תוכן ועיצוב", security: "אבטחת החשבון" };
  currentPage = titles[page] ? page : "overview";
  document.querySelectorAll("[data-admin-page]").forEach((panel) => panel.classList.toggle("hidden", panel.dataset.adminPage !== currentPage));
  document.querySelectorAll("[data-page-target]").forEach((button) => button.classList.toggle("active", button.dataset.pageTarget === currentPage));
  $("#currentPageTitle").textContent = titles[currentPage];
  $(".save-bar").classList.toggle("hidden", !["site", "availability", "packages"].includes(currentPage));
}

async function refreshDashboard() {
  const data = await api("/api/admin/dashboard");
  fillForm(data);
  showDashboard();
  navigateTo(currentPage);
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = $("#loginMessage");
  const button = event.currentTarget.querySelector("button[type=submit]");
  message.textContent = "";
  button.disabled = true;
  try {
    await api("/api/admin/login", { method: "POST", body: JSON.stringify({ code: $("#adminCode").value }) });
    $("#adminCode").value = "";
    await refreshDashboard();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("#settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#saveButton");
  const message = $("#saveMessage");
  message.textContent = "";
  button.disabled = true;
  const packages = readPackagesFromEditor();
  const payload = {
    business: { name: $("#businessName").value, tagline: $("#businessTagline").value, email: $("#businessEmail").value, phone: $("#businessPhone").value },
    content: { heroLineOne: $("#heroLineOne").value, heroLineTwo: $("#heroLineTwo").value, heroDescription: $("#heroDescription").value, bookingLineOne: $("#bookingLineOne").value, bookingLineTwo: $("#bookingLineTwo").value, bookingDescription: $("#bookingDescription").value, accentColor: $("#accentColor").value },
    schedule: {
      weekdays: [...document.querySelectorAll("[data-weekday]:checked")].map((input) => Number(input.dataset.weekday)),
      start: $("#startTime").value,
      end: $("#endTime").value,
      slotMinutes: Number($("#slotMinutes").value),
      maxDaysAhead: Number($("#maxDaysAhead").value),
      blockedDates: $("#blockedDates").value.split("\n").map((date) => date.trim()).filter(Boolean)
    }, packages
  };
  try {
    await api("/api/admin/settings", { method: "PUT", body: JSON.stringify(payload) });
    await refreshDashboard();
    $("#saveMessage").textContent = "השינויים נשמרו ומופיעים באתר.";
  } catch (error) {
    if (error.message.includes("פג תוקף")) showLogin();
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("#addPackage").addEventListener("click", () => {
  const packages = readPackagesFromEditor();
  const id = `service-${Date.now()}`;
  packages.push({ id, name: "חבילה חדשה", price: "לפי הצעה", description: "", features: [], featured: false });
  renderPackageEditor(packages);
  const added = $(".editor-item:last-child", $("#packageEditor"));
  added?.scrollIntoView({ behavior: "smooth", block: "center" });
});

$("#packageEditor").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-package]");
  if (!button) return;
  button.closest(".editor-item").remove();
});

document.querySelectorAll("[data-page-target]").forEach((button) => button.addEventListener("click", () => navigateTo(button.dataset.pageTarget)));
document.querySelectorAll("[data-booking-filter]").forEach((button) => button.addEventListener("click", () => {
  bookingFilter = button.dataset.bookingFilter;
  document.querySelectorAll("[data-booking-filter]").forEach((filter) => filter.classList.toggle("active", filter === button));
  renderBookings(dashboardData?.bookings || []);
}));

$("#dashboard").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-booking-action]");
  if (!button) return;
  const requestedAction = button.dataset.bookingAction;
  let whatsappWindow = null;
  if (requestedAction === "confirmed") whatsappWindow = window.open("about:blank", "_blank");
  button.disabled = true;
  try {
    const result = await api(`/api/admin/bookings/${encodeURIComponent(button.dataset.bookingId)}/status`, { method: "POST", body: JSON.stringify({ status: requestedAction }) });
    if (requestedAction === "confirmed") {
      if (result.whatsappUrl && whatsappWindow && !whatsappWindow.closed) {
        whatsappWindow.opener = null;
        whatsappWindow.location.href = result.whatsappUrl;
      } else if (result.whatsappUrl) {
        alert("התור אושר. הודעת WhatsApp מוכנה זמינה בכרטיס התור.");
      } else {
        whatsappWindow?.close();
        alert("התור אושר, אבל לא הצלחנו להכין הודעת WhatsApp. בדקי את מספר הטלפון בכרטיס התור.");
      }
    }
    await refreshDashboard();
  } catch (error) {
    whatsappWindow?.close();
    button.disabled = false;
    alert(error.message);
  }
});

$("#codeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = $("#codeMessage");
  message.textContent = "";
  try {
    await api("/api/admin/code", { method: "POST", body: JSON.stringify({ code: $("#newCode").value }) });
    $("#newCode").value = "";
    message.textContent = "הקוד עודכן. הכניסה הנוכחית נשארת פעילה.";
  } catch (error) {
    message.textContent = error.message;
  }
});

$("#logoutButton").addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST", body: "{}" }).catch(() => {});
  showLogin();
});

$("#dashboard").addEventListener("click", (event) => {
  const link = event.target.closest("[data-go-page]");
  if (link) navigateTo(link.dataset.goPage);
});

api("/api/admin/dashboard").then((data) => {
  fillForm(data);
  showDashboard();
  navigateTo(currentPage);
}).catch(() => showLogin());
