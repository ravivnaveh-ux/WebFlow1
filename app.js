const API = "/api";
const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

async function request(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "לא הצלחנו להשלים את הבקשה.");
  return result;
}

function todayInIsrael() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const date = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${date.year}-${date.month}-${date.day}`;
}

let revealObserver = null;
function initializeEntrance() {
  const loader = $("#siteLoader");
  if (!loader) return;
  const revealSite = () => window.setTimeout(() => loader.classList.add("is-hidden"), window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 300);
  if (document.readyState === "complete") revealSite();
  else window.addEventListener("load", revealSite, { once: true });
  window.setTimeout(() => loader.classList.add("is-hidden"), 2400);
}

function addReveal(elements) {
  const nodes = [...elements];
  if (!("IntersectionObserver" in window)) {
    nodes.forEach((node) => node.classList.add("is-visible"));
    return;
  }
  revealObserver ||= new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      revealObserver.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -24px 0px" });
  nodes.forEach((node) => {
    if (node.dataset.revealReady) return;
    node.dataset.revealReady = "true";
    node.classList.add("reveal");
    revealObserver.observe(node);
  });
}

function initializeMotion() {
  addReveal(document.querySelectorAll(".intro,.category-card,.tools-title,.tools-list article,.deliverables-grid article,.process-grid article,.booking-copy,.booking-card,.closing"));
  const counter = $("#growthCounter");
  const stage = $(".hero-stage");
  if (!counter || !stage) return;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let started = false;
  const countUp = () => {
    if (started) return;
    started = true;
    if (reducedMotion) {
      counter.textContent = "100";
      return;
    }
    const startAt = performance.now();
    const duration = 1350;
    const tick = (now) => {
      const progress = Math.min((now - startAt) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 4);
      counter.textContent = String(Math.round(eased * 100));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  if (reducedMotion || !("IntersectionObserver" in window)) countUp();
  else {
    const counterObserver = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      countUp();
      counterObserver.disconnect();
    }, { threshold: 0.35 });
    counterObserver.observe(stage);
  }
}

function renderPackages(packages) {
  const grid = $("#packageGrid");
  const select = $("#bookingPackage");
  if (!packages?.length) {
    grid.innerHTML = '<p class="loading-card">החבילות מתעדכנות. אפשר לקבוע שיחה ונמצא יחד את הכיוון הנכון.</p>';
    select.innerHTML = '<option value="general">שיחת עיון כללית</option>';
    return;
  }
  grid.innerHTML = packages.map((item, index) => {
    const features = (item.features || []).map((feature) => `<li>${esc(feature)}</li>`).join("");
    return `<article class="package-card ${item.featured ? "featured" : ""}">
      ${item.featured ? '<span class="package-badge">הבחירה הפופולרית</span>' : ""}
      <span class="package-label">מסלול ${String(index + 1).padStart(2, "0")}</span>
      <h3>${esc(item.name)}</h3><p class="package-price">${esc(item.price)}</p>
      <p class="package-desc">${esc(item.description)}</p>
      <ul class="package-features">${features}</ul>
      <a class="package-cta" href="#booking" data-package="${esc(item.id)}">לבדוק התאמה <span>←</span></a>
    </article>`;
  }).join("");
  addReveal(grid.querySelectorAll(".package-card"));
  select.innerHTML = '<option value="">בחרי אפשרות</option>' + packages.map((item) => `<option value="${esc(item.id)}">${esc(item.name)} · ${esc(item.price)}</option>`).join("");
}

let calendarMonth = "";
let calendarDays = new Map();
let calendarRequest = 0;
let bookingMaxDaysAhead = 45;

function shiftMonth(month, amount) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", month: "long", year: "numeric" }).format(new Date(Date.UTC(year, monthNumber - 1, 1, 12)));
}

function updateCalendarNavigation() {
  const todayMonth = todayInIsrael().slice(0, 7);
  const maxDate = new Date(`${todayInIsrael()}T12:00:00Z`);
  maxDate.setUTCDate(maxDate.getUTCDate() + bookingMaxDaysAhead);
  const maxMonth = `${maxDate.getUTCFullYear()}-${String(maxDate.getUTCMonth() + 1).padStart(2, "0")}`;
  $("#calendarPrev").disabled = calendarMonth <= todayMonth;
  $("#calendarNext").disabled = calendarMonth >= maxMonth;
}

function renderCalendar(days) {
  const [year, monthNumber] = calendarMonth.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const today = todayInIsrael();
  const daysByDate = new Map(days.map((day) => [day.date, day]));
  const previousSelection = $("#bookingDate").value;
  if (previousSelection.startsWith(calendarMonth) && daysByDate.get(previousSelection)?.status !== "available") {
    clearSelectedSlot("היום שבחרת כבר אינו פנוי. בחרי יום ושעה אחרים.");
  }
  const grid = $("#calendarGrid");
  const cells = Array.from({ length: firstWeekday }, () => '<span class="calendar-day-empty" aria-hidden="true"></span>');
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${calendarMonth}-${String(day).padStart(2, "0")}`;
    const record = daysByDate.get(date) || { status: "closed", slots: [] };
    const available = record.status === "available";
    const selected = $("#bookingDate").value === date;
    const statusLabel = available ? "יש שעות פנויות" : record.status === "full" ? "כל השעות תפוסות" : "אין פעילות ביום זה";
    const dateLabel = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${date}T12:00:00+03:00`));
    cells.push(`<button type="button" class="calendar-day ${available ? "is-available" : "is-unavailable"} ${selected ? "is-selected" : ""} ${date === today ? "is-today" : ""}" data-calendar-date="${date}" data-day-status="${record.status}" aria-label="${esc(dateLabel)}: ${statusLabel}" aria-pressed="${selected}" ${available ? "" : "disabled"} style="--day-delay:${(day % 14) * 13}ms"><span class="calendar-date-number">${day}</span><span class="calendar-day-mark"><i></i><small>${available ? "פנוי" : record.status === "full" ? "מלא" : "—"}</small></span></button>`);
  }
  grid.innerHTML = cells.join("");
  $("#calendarMonthLabel").textContent = monthLabel(calendarMonth);
  updateCalendarNavigation();
  calendarDays = daysByDate;
  const selectedDate = $("#bookingDate").value;
  if (selectedDate && selectedDate.startsWith(calendarMonth)) {
    const record = calendarDays.get(selectedDate);
    if (record?.status === "available") renderDaySlots(record);
    else clearSelectedSlot("השעה שבחרת כבר אינה פנויה. בחרי יום ושעה אחרים.");
  }
}

async function loadCalendarMonth(month = calendarMonth, { quiet = false } = {}) {
  calendarMonth = month;
  updateCalendarNavigation();
  const grid = $("#calendarGrid");
  if (!quiet) {
    grid.innerHTML = Array.from({ length: 35 }, () => '<span class="calendar-day-skeleton" aria-hidden="true"></span>').join("");
    $("#calendarMonthLabel").textContent = "טוענת זמינות…";
  }
  const requestNumber = ++calendarRequest;
  try {
    const result = await request(`${API}/availability?month=${encodeURIComponent(month)}`);
    if (requestNumber !== calendarRequest) return;
    renderCalendar(result.days || []);
  } catch (error) {
    if (requestNumber !== calendarRequest) return;
    grid.innerHTML = `<p class="calendar-error" role="status">${esc(error.message)} נסי לרענן את העמוד.</p>`;
    $("#calendarMonthLabel").textContent = monthLabel(month);
  }
}

function renderDaySlots(day) {
  const slots = $("#timeSlots");
  const available = (day.slots || []).some((slot) => slot.status === "available");
  if (!available) {
    slots.innerHTML = '<span class="slot-hint">אין שעות פנויות ביום הזה. בחרי יום אחר בלוח.</span>';
    return;
  }
  const chosenTime = $("#bookingTime").value;
  const chosenStillAvailable = day.slots.some((slot) => slot.time === chosenTime && slot.status === "available");
  if (chosenTime && !chosenStillAvailable) {
    $("#bookingTime").value = "";
    $("#bookingNext").disabled = true;
    const message = $("#bookingMessage");
    if (message) { message.className = "booking-message error"; message.textContent = "המועד שבחרת נתפס בינתיים. בחרי שעה פנויה אחרת."; }
  } else if (chosenStillAvailable) $("#bookingNext").disabled = false;
  slots.innerHTML = day.slots.map((slot) => {
    if (slot.status === "available") {
      const selected = chosenStillAvailable && slot.time === chosenTime;
      return `<button type="button" class="time-slot ${selected ? "selected" : ""}" data-time="${esc(slot.time)}" aria-pressed="${selected}"><span>${esc(slot.time)}</span><small>פנוי</small></button>`;
    }
    const status = slot.status === "booked" ? "תפוס" : "עבר";
    return `<span class="time-slot is-unavailable" aria-label="${esc(slot.time)} ${status}"><span>${esc(slot.time)}</span><small>${status}</small></span>`;
  }).join("");
}

function clearSelectedSlot(message = "בחרי יום בלוח השנה כדי לראות שעות") {
  $("#bookingDate").value = "";
  $("#bookingTime").value = "";
  $("#bookingNext").disabled = true;
  $("#timeSlots").innerHTML = `<span class="slot-hint">${esc(message)}</span>`;
}

function showBookingStep(step) {
  const activeStep = step === 2 ? "2" : "1";
  document.querySelectorAll("[data-booking-step]").forEach((panel) => {
    const active = panel.dataset.bookingStep === activeStep;
    panel.hidden = !active;
    panel.classList.toggle("is-current", active);
  });
  const stepper = $(".booking-stepper");
  if (stepper) stepper.dataset.activeStep = activeStep;
  document.querySelectorAll("[data-step-indicator]").forEach((indicator) => {
    const number = indicator.dataset.stepIndicator;
    indicator.classList.toggle("is-active", number === activeStep);
    indicator.classList.toggle("is-complete", Number(number) < Number(activeStep));
    if (number === activeStep) indicator.setAttribute("aria-current", "step");
    else indicator.removeAttribute("aria-current");
  });
  const progress = $("#stepProgress");
  if (progress) progress.style.width = activeStep === "2" ? "100%" : "0%";
}

async function initBooking() {
  const dateInput = $("#bookingDate");
  const timeInput = $("#bookingTime");
  const form = $("#bookingForm");
  const message = $("#bookingMessage");
  const bookingSuccess = $("#bookingSuccess");
  calendarMonth = todayInIsrael().slice(0, 7);
  await loadCalendarMonth(calendarMonth);
  const changeCalendarMonth = (nextMonth) => {
    if (nextMonth === calendarMonth) return;
    clearSelectedSlot();
    loadCalendarMonth(nextMonth);
  };
  $("#calendarPrev").addEventListener("click", () => changeCalendarMonth(shiftMonth(calendarMonth, -1)));
  $("#calendarNext").addEventListener("click", () => changeCalendarMonth(shiftMonth(calendarMonth, 1)));
  $("#calendarGrid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-calendar-date]");
    if (!button || button.disabled) return;
    document.querySelectorAll(".calendar-day.is-selected").forEach((day) => { day.classList.remove("is-selected"); day.setAttribute("aria-pressed", "false"); });
    button.classList.add("is-selected");
    button.setAttribute("aria-pressed", "true");
    dateInput.value = button.dataset.calendarDate;
    timeInput.value = "";
    $("#bookingNext").disabled = true;
    renderDaySlots(calendarDays.get(dateInput.value));
    showBookingStep(1);
    message.textContent = "";
    $("#timeSlots").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  $("#bookingNext").addEventListener("click", () => {
    if (!dateInput.value) {
      message.className = "booking-message error";
      message.textContent = "בחרי יום לשיחה כדי להמשיך.";
      dateInput.focus();
      return;
    }
    if (!timeInput.value) {
      message.className = "booking-message error";
      message.textContent = "בחרי שעה פנויה כדי להמשיך לפרטים.";
      $("#timeSlots").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const displayDate = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${dateInput.value}T12:00:00+03:00`));
    $("#selectedSlotSummary").textContent = `${displayDate} · ${timeInput.value}`;
    message.textContent = "";
    showBookingStep(2);
    $("#bookingPhone").focus({ preventScroll: true });
  });
  const backToDate = () => {
    showBookingStep(1);
    $("[data-calendar-date].is-selected")?.focus({ preventScroll: true });
  };
  $("#bookingBack").addEventListener("click", backToDate);
  $("#bookingChangeSlot").addEventListener("click", backToDate);
  $("#timeSlots").addEventListener("click", (event) => {
    const button = event.target.closest("[data-time]");
    if (!button) return;
    $("#timeSlots").querySelectorAll(".time-slot").forEach((slot) => { slot.classList.remove("selected"); slot.setAttribute("aria-pressed", "false"); });
    button.classList.add("selected");
    button.setAttribute("aria-pressed", "true");
    timeInput.value = button.dataset.time;
    $("#bookingNext").disabled = false;
    message.textContent = "";
  });
  window.addEventListener("focus", () => loadCalendarMonth(calendarMonth, { quiet: true }));
  window.setInterval(() => { if (!document.hidden) loadCalendarMonth(calendarMonth, { quiet: true }); }, 45000);
  $("#bookAnother").addEventListener("click", () => {
    bookingSuccess.hidden = true;
    bookingSuccess.classList.remove("is-shown");
    form.hidden = false;
    $(".booking-stepper").hidden = false;
    form.reset();
    showBookingStep(1);
    clearSelectedSlot();
    message.textContent = "";
    $("#calendarGrid").scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.className = "booking-message";
    message.textContent = "";
    if (!dateInput.value || !timeInput.value) {
      message.classList.add("error");
      message.textContent = "בחרי יום ושעה פנויים לפני שליחת הבקשה.";
      return;
    }
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    button.textContent = "שומרת את המועד…";
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      const result = await request(`${API}/bookings`, { method: "POST", body: JSON.stringify(data) });
      form.reset();
      showBookingStep(1);
      clearSelectedSlot("הבקשה התקבלה. בחרי יום אחר בלוח או סיימי כאן.");
      $("#bookingNext").disabled = true;
      await loadCalendarMonth(calendarMonth);
      $("#bookingSuccessSummary").textContent = `${result.displayDate} · ${result.time}`;
      form.hidden = true;
      $(".booking-stepper").hidden = true;
      bookingSuccess.hidden = false;
      bookingSuccess.classList.remove("is-shown");
      requestAnimationFrame(() => bookingSuccess.classList.add("is-shown"));
      bookingSuccess.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    } catch (error) {
      message.classList.add("error");
      message.textContent = error.message;
      if (error.message.includes("כבר נתפסה")) {
        showBookingStep(1);
        const selectedDate = dateInput.value;
        timeInput.value = "";
        $("#bookingNext").disabled = true;
        await loadCalendarMonth(calendarMonth);
        const latest = calendarDays.get(selectedDate);
        if (latest?.status === "available") {
          dateInput.value = selectedDate;
          renderDaySlots(latest);
        } else clearSelectedSlot("השעה כבר נתפסה. בחרי מועד אחר.");
      }
    } finally {
      button.disabled = false;
      button.innerHTML = 'שליחת בקשה <span>↙</span>';
    }
  });
  $("#packageGrid").addEventListener("click", (event) => {
    const link = event.target.closest("[data-package]");
    if (link) $("#bookingPackage").value = link.dataset.package;
  });
}

async function init() {
  initializeEntrance();
  initializeMotion();
  $("#year").textContent = String(new Date().getFullYear());
  try {
    const site = await request(`${API}/site`);
    $("#heroLineOne").textContent = site.content.heroLineOne;
    $("#heroLineTwo").textContent = site.content.heroLineTwo;
    $("#heroDescription").textContent = site.content.heroDescription;
    $("#bookingLineOne").textContent = site.content.bookingLineOne;
    $("#bookingLineTwo").textContent = site.content.bookingLineTwo;
    $("#bookingDescription").textContent = site.content.bookingDescription;
    if (/^#[0-9a-f]{6}$/i.test(site.content.accentColor || "")) document.documentElement.style.setProperty("--accent", site.content.accentColor);
    $("#copyrightName").textContent = site.business.name;
    $("#footerTagline").textContent = site.business.tagline || "אתרים מדויקים. תהליך אישי. תוצאה שנראית כמוך.";
    $("#callDuration").textContent = `כ־${site.schedule.slotMinutes} דקות`;
    const phone = String(site.business.phone || "");
    const email = String(site.business.email || "");
    const waNumber = phone.replace(/\D/g, "").replace(/^0/, "972");
    const waUrl = waNumber ? `https://wa.me/${waNumber}?text=${encodeURIComponent("היי, אשמח לשמוע פרטים על בניית אתר לעסק שלי.")}` : "";
    [$("#headerWhatsApp"), $("#footerWhatsApp")].forEach((link) => {
      if (!link) return;
      if (waUrl) { link.href = waUrl; link.setAttribute("aria-label", `פתיחת WhatsApp למספר ${phone}`); link.hidden = false; }
      else link.hidden = true;
    });
    $("#headerWhatsAppNumber").textContent = phone;
    const contactLinks = [];
    if (phone) contactLinks.push(`<a href="tel:${esc(phone.replace(/[^+0-9]/g, ""))}">${esc(phone)}</a>`);
    if (email) contactLinks.push(`<a href="mailto:${encodeURIComponent(email)}">${esc(email)}</a>`);
    $("#footerContact").innerHTML = contactLinks.join("　·　");
    document.title = `${site.business.name} | אתרים לעסקים`;
    renderPackages(site.packages);
    bookingMaxDaysAhead = Number(site.schedule.maxDaysAhead) || 45;
  } catch {
    $("#packageGrid").innerHTML = '<p class="loading-card">החבילות יופיעו כאן אחרי חיבור השרת.</p>';
    $("#bookingPackage").innerHTML = '<option value="general">שיחת עיון כללית</option>';
  }
  initBooking();
}

init();
