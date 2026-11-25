import { icon } from "./icons.js";
import { messages } from "./i18n.js";
import { formatMoney, formatRegionalDate } from "./format.js";
import { regionUrl } from "./region-url.js";
import { safeStorage } from "./storage.js";

const sessionStore = safeStorage("sessionStorage");
const preferencesStore = safeStorage("localStorage");

const root = document.querySelector("#app");
const dialog = document.querySelector("#dialog");
const s = {
  region: null,
  regions: [],
  user: null,
  page: "explore",
  spaces: [],
  managed: [],
  bookings: [],
  events: [],
  status: null,
  vehicle: "car",
  destination: "",
  destinationQuery: "",
  destinations: [],
  destinationLabel: "",
  filter: "all",
  sort: "distance",
  query: "",
  loading: true,
  error: "",
  authRole: "driver",
  registering: false,
  bookingFilter: "all",
  syncing: false,
  syncError: "",
};
let token = sessionStore.getItem("te.token") || "";
let requestSequence = 0;
let toastTimer;
let checkout = null;
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ])
  );
const t = (key) =>
  (messages[s.region?.language] || messages.es)[key] || messages.es[key] || key;
const environmentLabel = () =>
  t(s.region?.demo === false ? "productionLabel" : "demo");
const paymentNotice = () =>
  t(s.region?.payments?.live ? "liveCharges" : "noCharges");
const money = (amount) => formatMoney(amount, s.region);
const date = (value, full = true) => formatRegionalDate(value, s.region, full);
const countMoney = (key) =>
  money(
    s.bookings
      .filter((b) => b.status === "completed")
      .reduce((sum, b) => sum + b[key], 0)
  );
const statusBadge = (status) =>
  `<span class="badge ${esc(status)}"><span class="status-dot"></span>${esc(
    t(status)
  )}</span>`;
const button = (label, action, id = "", cls = "button") => {
  const visibleText = label.replace(/<[^>]*>/g, "").trim();
  const accessible = visibleText
    ? ""
    : ` aria-label="${esc(
        t(
          {
            details: "details",
            receipt: "receipt",
            close: "close",
            theme: "dark",
            notifications: "notifications",
          }[action] || action
        )
      )}"`;
  return `<button${accessible} class="${cls}" data-action="${action}" data-id="${esc(
    id
  )}">${label}</button>`;
};
const sectionHeading = (title, sub = "", action = "") =>
  `<div class="section-heading"><div><h2>${esc(title)}</h2>${
    sub ? `<p>${esc(sub)}</p>` : ""
  }</div>${action}</div>`;

async function api(path, { method = "GET", body, timeout = 12000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch("/api" + path, {
      method,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json();
    if (!response.ok) {
      const err = Object.assign(
        new Error(
          messages[s.region?.language]?.errors?.[payload.error?.code] ||
            payload.error?.message ||
            t("error")
        ),
        { code: payload.error?.code, status: response.status }
      );
      if (response.status === 401 && !path.startsWith("/auth")) {
        token = "";
        s.user = null;
        sessionStore.removeItem("te.token");
        render();
      }
      throw err;
    }
    return payload.data;
  } catch (err) {
    if (err.name === "AbortError") throw new Error(t("pendingNote"));
    if (err instanceof TypeError)
      throw new Error(t("error") + ". " + t("retry"));
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function toast(message) {
  clearTimeout(toastTimer);
  const target = document.querySelector("#toast");
  target.textContent = message;
  target.classList.add("visible");
  toastTimer = setTimeout(() => target.classList.remove("visible"), 4000);
}

function logo() {
  return `<span class="brand-mark" aria-hidden="true">P</span><span class="brand-name">tu<span>espacio</span><small>Parking, with a plan.</small></span>`;
}
function navItems() {
  const shared = [["settings", "settings", "settings"]];
  const roles = {
    driver: [
      ["explore", "search", "explore"],
      ["bookings", "ticket", "bookings"],
    ],
    owner: [
      ["overview", "grid", "overview"],
      ["bookings", "ticket", "bookings"],
      ["spaces", "home", "spaces"],
    ],
    host: [
      ["overview", "grid", "overview"],
      ["spaces", "home", "spaces"],
      ["bookings", "ticket", "bookings"],
      ["earnings", "wallet", "earnings"],
    ],
    admin: [
      ["operations", "grid", "operations"],
      ["bookings", "ticket", "bookings"],
      ["spaces", "home", "spaces"],
      ["transactions", "server", "transactions"],
      ["regions", "globe", "regions"],
    ],
  };
  return [...(roles[s.user?.role] || roles.driver), ...shared];
}
const homePage = () =>
  ({
    driver: "explore",
    owner: "overview",
    host: "overview",
    admin: "operations",
  }[s.user?.role] || "explore");

function authView() {
  return `<div class="auth-shell"><section class="auth-story"><a class="brand" href="#">${logo()}</a><div class="story-copy"><h1>${esc(
    t("welcome")
  )}</h1><p>${esc(t("welcomeNote"))}</p></div>
    <div class="parking-scene" aria-hidden="true"><div class="lane-label">PARKING</div><div class="parking-lane"><span class="parked-car"></span><span class="spot">P</span><span class="parked-car second"></span></div><div class="scene-caption">${icon(
      "pin"
    )} ${esc(s.region.city)} <span>${icon("check")} ${esc(
    t("confirmed")
  )}</span></div></div>
    <p class="story-foot">${esc(environmentLabel())}</p></section>
    <main id="main" class="auth-main"><div class="auth-top">${regionSelect()}${button(
    icon(document.documentElement.dataset.theme === "dark" ? "sun" : "moon"),
    "theme",
    "",
    "icon-button"
  )}</div>
    <div class="auth-form"><h2>${esc(
      t(s.registering ? "register" : "login")
    )}</h2><p class="muted">${esc(t("security"))}</p>
    <div class="role-selector" role="group" aria-label="${esc(t("role"))}">${[
    "driver",
    ...(s.registering ? ["host"] : ["owner", "host", "admin"]),
  ]
    .map(
      (role) =>
        `<button class="role-option ${
          s.authRole === role ? "selected" : ""
        }" data-action="role" data-id="${role}" aria-pressed="${
          s.authRole === role
        }">${icon(
          { driver: "car", owner: "home", host: "key", admin: "shield" }[role]
        )}${esc(t(role))}</button>`
    )
    .join("")}</div>
    <form data-form="auth">${
      s.registering
        ? `<label>${esc(
            t("name")
          )}<input name="name" autocomplete="name" required minlength="3" maxlength="100"></label>`
        : ""
    }
    <label>${esc(
      t("email")
    )}<input name="email" type="email" autocomplete="email" required placeholder="tu@correo.com"></label>
    <label>${esc(
      t("password")
    )}<input name="password" type="password" autocomplete="${
    s.registering ? "new-password" : "current-password"
  }" required minlength="${
    s.registering
      ? s.region.passwordMinLength || (s.region.demo === false ? 12 : 6)
      : 1
  }" maxlength="128"></label>
    <div class="form-error" role="alert"></div><button class="button full" type="submit">${esc(
      t(s.registering ? "register" : "login")
    )}${icon("arrow")}</button></form>
    ${
      !s.registering
        ? s.region.demo === false
          ? ""
          : button(t("demoAccount"), "demo-login", "", "button secondary full")
        : ""
    }
    ${button(
      t(s.registering ? "login" : "register"),
      "auth-mode",
      "",
      "text-button full"
    )}
    <div class="auth-note">${icon("info")}<p>${esc(
    paymentNotice()
  )}<br><span>${esc(environmentLabel())}</span></p></div></div>
    <footer>Tu Espacio${
      s.region.demo === false ? "" : " · Sistemas Distribuidos"
    } · 2026</footer></main></div>`;
}

function regionSelect() {
  return `<label class="region-control">${icon(
    "globe"
  )}<span class="sr-only">${esc(
    t("region")
  )}</span><select id="region-select">${s.regions
    .map(
      (r) =>
        `<option value="${r.id}" ${
          r.id === s.region.id ? "selected" : ""
        }>${esc(r.city)} · ${r.currency}</option>`
    )
    .join("")}</select></label>`;
}

function render() {
  if (!s.region) return;
  document.documentElement.lang = s.region.language;
  document.title = "Tu Espacio · " + t(s.user ? s.page : "login");
  if (!s.user) {
    root.innerHTML = authView();
    return;
  }
  const items = navItems();
  root.innerHTML = `<div class="app-shell"><aside class="sidebar"><a class="brand" href="#${homePage()}">${logo()}</a><div class="workspace"><span class="workspace-icon">${icon(
    s.user.role === "driver" ? "car" : "home"
  )}</span><div><strong>${esc(t(s.user.role))}</strong><small>${esc(
    s.region.city
  )}</small></div><span class="badge mini">${esc(
    s.region.id.toUpperCase()
  )}</span></div>
    <nav aria-label="Navegación principal">${items
      .map(
        ([id, ic, label]) =>
          `<a class="nav-link ${
            s.page === id ? "selected" : ""
          }" href="#${id}" ${s.page === id ? 'aria-current="page"' : ""}>${icon(
            ic
          )}<span>${esc(t(label))}</span>${
            id === "bookings" &&
            s.bookings.some((b) => b.status === "confirmed")
              ? `<span class="nav-count">${
                  s.bookings.filter((b) => b.status === "confirmed").length
                }</span>`
              : ""
          }</a>`
      )
      .join("")}</nav>
    <div class="sidebar-bottom"><div class="demo-label">${icon(
      "info"
    )}<span>${esc(environmentLabel())}</span></div>${button(
    icon("exit") + t("logout"),
    "logout",
    "",
    "nav-link logout"
  )}</div></aside>
    <div class="main-shell"><header class="topbar"><a class="mobile-brand" href="#${homePage()}">${logo()}</a><div class="breadcrumb">${esc(
    t(s.page)
  )}<span>/</span><span>${esc(
    s.region.city
  )}</span></div><div class="topbar-actions">${regionSelect()}${button(
    icon(document.documentElement.dataset.theme === "dark" ? "sun" : "moon"),
    "theme",
    "",
    "icon-button"
  )}${button(
    icon("bell"),
    "notifications",
    "",
    "icon-button"
  )}<button class="avatar" data-action="account" aria-label="${esc(
    t("account")
  )}">${esc(s.user.name.slice(0, 1).toUpperCase())}</button></div></header>
    <main id="main" tabindex="-1"><div class="page-top"><div><h1>${esc(
      t(
        {
          explore: "greeting",
          overview: s.user.role === "host" ? "hostTitle" : "operatorTitle",
          operations: "adminTitle",
        }[s.page] || s.page
      )
    )}</h1><p>${esc(
    s.page === "explore"
      ? t("subtitle")
      : s.region.city + " · " + date(new Date())
  )}</p></div>${
    s.page !== "explore"
      ? button(
          icon("refresh") + t("refresh"),
          "reload",
          "",
          "button secondary compact"
        )
      : `<span class="local-date">${icon("clock")} ${esc(
          date(new Date())
        )}</span>`
  }</div>
    ${
      checkout?.body
        ? `<div class="pending-banner" role="status">${icon(
            "clock"
          )}<span>${esc(t("pendingNote"))}</span>${button(
            t("retry"),
            "retry-checkout",
            "",
            "button secondary small"
          )}</div>`
        : ""
    }
    ${
      s.syncError
        ? `<div class="pending-banner" role="status">${icon("info")}<span>${esc(
            s.syncError
          )}</span>${button(
            t("retry"),
            "reload",
            "",
            "button secondary small"
          )}</div>`
        : ""
    }
    ${s.loading ? skeleton() : s.error ? errorState() : pageContent()}
    <footer class="page-footer"><span>© 2026 Tu Espacio</span><span>${esc(
      environmentLabel()
    )}</span></footer></main></div></div>`;
  root
    .querySelectorAll('.icon-button[data-action="theme"]')
    .forEach((el) =>
      el.setAttribute(
        "aria-label",
        el.dataset.action === "theme"
          ? t(
              document.documentElement.dataset.theme === "dark"
                ? "light"
                : "dark"
            )
          : t("notifications")
      )
    );
}

function skeleton() {
  return `<div class="skeleton" role="status" aria-label="${esc(
    t("loading")
  )}"><span></span><span></span><span></span></div>`;
}
function errorState() {
  return `<div class="empty error-state">${icon("info")}<h2>${esc(
    t("error")
  )}</h2><p>${esc(s.error)}</p>${button(t("retry"), "reload")}</div>`;
}

function pageContent() {
  if (s.page === "explore") return explore();
  if (s.page === "bookings") return bookingsView();
  if (s.page === "settings") return settings();
  if (s.page === "spaces") return spacesView();
  if (s.page === "overview") return overview();
  if (s.page === "operations") return operations();
  if (s.page === "transactions") return transactionView();
  if (s.page === "regions") return regionView();
  if (s.page === "earnings") return earnings();
  return "";
}

function explore() {
  return `<section class="search-panel"><form class="destination-form" data-form="search"><label class="destination-label">${icon(
    "pin"
  )}<span><span class="field-label">${esc(
    t("destination")
  )}</span><input id="destination" name="destination" type="search" maxlength="180" value="${esc(
    s.destinationQuery
  )}" placeholder="${esc(
    t("addressPlaceholder")
  )}" autocomplete="off"></span></label>
    <div class="vehicle-switch" role="group" aria-label="${esc(
      t("vehicle")
    )}">${["car", "moto"]
    .map(
      (v) =>
        `<button type="button" class="${
          s.vehicle === v ? "selected" : ""
        }" data-action="vehicle" data-id="${v}" aria-pressed="${
          v === s.vehicle
        }">${icon(v)}${esc(t(v))}</button>`
    )
    .join("")}</div><button class="button" type="submit">${icon(
    "search"
  )}<span>${esc(
    t("search")
  )}</span></button></form><div class="form-error" role="alert"></div>${
    s.destinations.length
      ? `<div class="destination-results" aria-label="${esc(
          t("chooseDestination")
        )}"><p>${esc(t("chooseDestination"))}</p>${s.destinations
          .map((d) =>
            button(
              `<strong>${esc(d.name)}</strong><small>${esc(d.hint)}</small>`,
              "destination",
              d.id,
              "destination-result"
            )
          )
          .join("")}<small>© OpenStreetMap contributors · Photon</small></div>`
      : ""
  }</section>
    <div class="filter-row"><div class="filters" aria-label="${esc(
      t("filters")
    )}">${["all", "covered", "noKeys", "private", "formal"]
    .map(
      (f) =>
        `<button class="filter ${
          s.filter === f ? "selected" : ""
        }" data-action="filter" data-id="${f}" aria-pressed="${
          s.filter === f
        }">${
          f === "covered" ? icon("roof") : f === "noKeys" ? icon("key") : ""
        }${esc(t(f))}</button>`
    )
    .join("")}</div><label class="sort-label"><span class="sr-only">${esc(
    t("price")
  )}</span><select id="sort"><option value="distance" ${
    s.sort === "distance" ? "selected" : ""
  }>${esc(t("distance"))}</option><option value="price" ${
    s.sort === "price" ? "selected" : ""
  }>${esc(t("price"))}</option></select></label></div>
    <div class="explore-grid"><section class="results"><div class="results-header"><h2><strong>${
      s.spaces.length
    }</strong> ${esc(t("results"))}</h2><span>${esc(
    s.destinationLabel || s.region.city
  )}</span></div><div class="space-list">${
    s.spaces.length
      ? s.spaces.map(spaceCard).join("")
      : `<div class="empty">${icon("search")}<h3>${esc(t("emptySpaces"))}</h3>${
          s.destination ? `<p>${esc(t("noCoverage"))}</p>` : ""
        }${button(t("reset"), "reset-filters", "", "button secondary")}</div>`
  }</div></section>
    <aside class="map-panel"><div class="map-title">${icon("pin")}<strong>${esc(
    t("map")
  )}</strong><span>${esc(
    s.region.city
  )}</span></div>${mapView()}<div class="map-legend"><span><i class="dot available"></i>${esc(
    t("available")
  )}</span><span><i class="dot full"></i>${esc(
    t("full")
  )}</span></div><p class="map-disclaimer">${icon("info")}${esc(
    t("mapNote")
  )}</p></aside></div>`;
}

function spaceCard(space, i = 0) {
  const a = space.availability[s.vehicle];
  const rate = space.rates[s.vehicle];
  return `<article class="space-card"><div class="space-card-top"><div class="parking-thumb thumb-${
    i % 3
  }" aria-hidden="true">${icon(
    space.kind === "particular" ? "home" : "car"
  )}<span>P</span></div><div class="space-card-heading"><div class="space-type">${esc(
    t(space.kind === "formal" ? "formal" : "private")
  )}${
    space.plan === "Destacado" ? `<span class="featured">Plus</span>` : ""
  }</div><h3>${esc(space.name)}</h3><p>${icon("pin")}${esc(
    space.address
  )}</p></div>${button(
    icon("chevron"),
    "details",
    space.id,
    "icon-button detail-arrow"
  )}</div>
    <div class="space-conditions"><span>${icon("clock")}${
    space.distanceM
  } m · ${Math.ceil(space.distanceM / 75)} min</span><span>${icon(
    space.conditions.covered ? "roof" : "sun"
  )}${esc(t(space.conditions.covered ? "covered" : "uncovered"))}</span>${
    !space.conditions.keys
      ? `<span>${icon("key")}${esc(t("noKeys"))}</span>`
      : ""
  }</div>
    <div class="space-card-bottom"><div>${statusBadge(a.status)}<small>${
    a.free
  } ${esc(t("free"))}</small></div><div class="space-price"><strong>${esc(
    money(rate.price)
  )}</strong><span>${esc(t(rate.unit))}</span></div>${button(
    t("reserve") + icon("arrow"),
    "reserve",
    space.id,
    "button small"
  ).replace(
    "<button ",
    `<button ${!a.free ? "disabled" : ""} `
  )}</div></article>`;
}

function mapView() {
  const blocks = [
    [15, 15, 145, 92],
    [185, 15, 95, 92],
    [312, 15, 115, 92],
    [460, 15, 140, 92],
    [15, 143, 90, 110],
    [137, 143, 145, 110],
    [316, 143, 110, 110],
    [462, 143, 140, 110],
    [15, 290, 145, 110],
    [195, 290, 88, 110],
    [317, 290, 110, 110],
    [462, 290, 140, 110],
    [15, 437, 180, 140],
    [230, 437, 196, 140],
    [462, 437, 140, 140],
  ];
  return `<div class="map-canvas"><svg viewBox="0 0 620 570" role="group" aria-label="${esc(
    t("map")
  )}"><rect width="620" height="570" fill="var(--map-bg)"/>
    ${blocks
      .map(
        ([x, y, w, h], i) =>
          `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${
            [3, 5, 10].includes(i) ? "var(--map-park)" : "var(--map-block)"
          }" stroke="var(--map-line)" stroke-width="2"/>`
      )
      .join("")}
    <path d="M0 270h620M300 0v570" stroke="var(--map-road)" stroke-width="18"/>
    <path d="M0 270h620M300 0v570" stroke="var(--map-line)" stroke-width="1" stroke-dasharray="6 9"/>
    <g class="map-streets" fill="var(--map-label)"><text x="350" y="130">${esc(
      s.region.districts[0]
    )}</text><text x="40" y="425">${esc(
    s.region.city
  )}</text><text x="42" y="285">${esc(t("zone"))}</text></g>
    <g transform="translate(270 246)"><circle cx="30" cy="24" r="35" fill="var(--accent)" opacity=".13"/><circle cx="30" cy="24" r="12" fill="var(--accent)" stroke="var(--card)" stroke-width="4"/></g>
    ${s.spaces
      .slice(0, 10)
      .map((p, i) => {
        const x = 270 + p.pos.x * 285,
          y = 245 + p.pos.y * 265;
        return `<g class="map-pin ${
          !p.availability[s.vehicle].free ? "is-full" : ""
        }" transform="translate(${x} ${y})" tabindex="0" role="button" data-action="details" data-id="${esc(
          p.id
        )}" aria-label="${esc(
          p.name + " · " + money(p.rates[s.vehicle].price)
        )}"><rect x="-50" y="-22" width="100" height="37" rx="10"/><path d="m-6 14 6 7 6-7"/><text text-anchor="middle" y="1">${esc(
          money(p.rates[s.vehicle].price)
        )}</text></g>`;
      })
      .join("")}</svg></div>`;
}

function bookingRows(bookings, compact = false) {
  if (!bookings.length)
    return `<div class="empty">${icon("ticket")}<h3>${esc(
      t("empty")
    )}</h3><p>${esc(t("emptyNote"))}</p>${
      s.user.role === "driver"
        ? `<a class="button" href="#explore">${esc(t("search"))}${icon(
            "arrow"
          )}</a>`
        : ""
    }</div>`;
  return `<div class="booking-list">${bookings
    .map(
      (b) =>
        `<article class="booking-row"><div class="booking-symbol">${icon(
          b.vehicle
        )}</div><div class="booking-main"><h3>${esc(
          b.space.name
        )}</h3><p>${icon("clock")}${esc(date(b.startAt))} · ${
          b.durationMin / 60
        } h</p>${
          !compact && s.user.role !== "driver"
            ? `<small>${esc(b.driverName)}</small>`
            : ""
        }</div><div class="booking-code">${esc(b.code)}<small>${esc(
          money(b.amount)
        )}</small></div><div class="booking-status">${statusBadge(
          b.status
        )}</div>${button(
          icon("chevron"),
          "receipt",
          b.id,
          "icon-button"
        )}</article>`
    )
    .join("")}</div>`;
}

function bookingsView() {
  const filtered = s.bookings.filter(
    (b) =>
      (s.bookingFilter === "all" || b.status === s.bookingFilter) &&
      (b.code + b.driverName + b.space.name)
        .toLowerCase()
        .includes(s.query.toLowerCase())
  );
  return `<div class="panel"><div class="panel-toolbar"><div class="tabs"><button class="tab ${
    s.bookingFilter === "all" ? "selected" : ""
  }" data-action="booking-filter" data-id="all" aria-pressed="${
    s.bookingFilter === "all"
  }">${esc(t("all"))}<span>${
    s.bookings.length
  }</span></button><button class="tab ${
    s.bookingFilter === "confirmed" ? "selected" : ""
  }" data-action="booking-filter" data-id="confirmed" aria-pressed="${
    s.bookingFilter === "confirmed"
  }">${esc(t("confirmed"))}</button><button class="tab ${
    s.bookingFilter === "completed" ? "selected" : ""
  }" data-action="booking-filter" data-id="completed" aria-pressed="${
    s.bookingFilter === "completed"
  }">${esc(t("completed"))}</button></div><label class="table-search">${icon(
    "search"
  )}<input id="booking-search" type="search" placeholder="${esc(
    t("searchBookings")
  )}" aria-label="${esc(t("searchBookings"))}" value="${esc(
    s.query
  )}"></label></div><div id="booking-results">${
    filtered.length || !s.query
      ? bookingRows(filtered)
      : `<div class="empty">${esc(t("emptySearch"))}</div>`
  }</div></div>`;
}

function metrics(items) {
  return `<div class="metrics">${items
    .map(
      ([label, value, ic]) =>
        `<div class="metric"><span class="metric-label">${esc(t(label))}${icon(
          ic
        )}</span><strong>${esc(value)}</strong></div>`
    )
    .join("")}</div>`;
}

function overview() {
  const spaces = s.managed;
  const totals = spaces.reduce(
    (a, p) => {
      for (const v of ["car", "moto"]) {
        a.capacity += p.capacity[v];
        a.free += p.availability[v].free;
        a.reserved += p.availability[v].reserved;
      }
      return a;
    },
    { capacity: 0, free: 0, reserved: 0 }
  );
  return (
    metrics([
      ["capacity", totals.capacity, "home"],
      ["free", totals.free, "car"],
      ["reserved", totals.reserved, "ticket"],
      [
        "count",
        s.bookings.filter((b) => b.status === "completed").length,
        "check",
      ],
    ]) +
    `<div class="operator-grid"><section class="panel">${sectionHeading(
      t("occupancy"),
      "",
      `<a class="text-button" href="#spaces">${esc(t("spaces"))}${icon(
        "arrow"
      )}</a>`
    )}${
      spaces
        .map(
          (p) =>
            `<div class="occupancy-space"><div class="row-between"><h3>${esc(
              p.name
            )}</h3>${statusBadge(
              p.status === "published" ? "available" : "paused"
            )}</div>${["car", "moto"]
              .filter((v) => p.capacity[v])
              .map((v) => {
                const a = p.availability[v];
                return `<div class="occupancy-item"><div class="row-between"><span>${icon(
                  v
                )}${esc(t(v))}</span><strong>${
                  a.capacity - a.free
                }<span class="muted"> / ${
                  a.capacity
                }</span></strong></div><meter min="0" max="${
                  a.capacity
                }" value="${a.capacity - a.free}" aria-label="${esc(
                  t("occupancy")
                )}"></meter><div class="occupancy-controls"><small>${
                  a.free
                } ${esc(t("free"))}</small><div>${button(
                  icon("minus") + t("exit"),
                  "occupancy",
                  p.id + ":m:" + v,
                  "button secondary small"
                )}${button(
                  icon("plus") + t("entry"),
                  "occupancy",
                  p.id + ":p:" + v,
                  "button secondary small"
                )}</div></div></div>`;
              })
              .join("")}</div>`
        )
        .join("") || `<div class="empty">${esc(t("noData"))}</div>`
    }</section><section class="panel">${sectionHeading(t("next"))}${bookingRows(
      s.bookings.filter((b) => b.status === "confirmed").slice(0, 5),
      true
    )}</section></div>`
  );
}

function spacesView() {
  return `<div class="panel">${sectionHeading(
    t("spaces"),
    t("localeNote"),
    s.user.role === "host"
      ? button(icon("plus") + t("newSpace"), "new-space")
      : ""
  )}<div class="managed-list">${
    s.managed
      .map(
        (p) =>
          `<article class="managed-space"><div class="space-title-icon">${icon(
            p.kind === "formal" ? "home" : "key"
          )}</div><div><h3>${esc(p.name)}</h3><p>${esc(
            p.address
          )}</p><span class="muted">${p.capacity.car} ${esc(t("car"))} · ${
            p.capacity.moto
          } ${esc(t("moto"))} · ${p.schedule.open}–${
            p.schedule.close
          }</span></div>${statusBadge(
            p.status === "published" ? "available" : "paused"
          )}${button(
            t("edit") + icon("chevron"),
            "edit-space",
            p.id,
            "button secondary small"
          )}</article>`
      )
      .join("") || `<div class="empty">${esc(t("noData"))}</div>`
  }</div></div>`;
}

function earnings() {
  return (
    metrics([
      ["gross", countMoney("amount"), "wallet"],
      ["commission", countMoney("commission"), "ticket"],
      [
        "net",
        money(
          s.bookings
            .filter((b) => b.status === "completed")
            .reduce((n, b) => n + b.amount - b.commission, 0)
        ),
        "check",
      ],
      [
        "count",
        s.bookings.filter((b) => b.status === "completed").length,
        "grid",
      ],
    ]) +
    `<section class="panel">${sectionHeading(
      t("earnings"),
      t("localeNote")
    )}${bookingRows(
      s.bookings.filter((b) => b.status === "completed")
    )}</section>`
  );
}

function operations() {
  const services = s.status?.services || [];
  return (
    metrics([
      [
        "services",
        services.filter((x) => x.status === "online").length + " / 5",
        "server",
      ],
      ["bookings", s.bookings.length, "ticket"],
      ["spaces", s.managed.length, "home"],
      ["events", s.events.length, "bell"],
    ]) +
    `<div class="operator-grid"><section class="panel">${sectionHeading(
      t("services"),
      s.region.city + " · HTTP / JSON"
    )}<div class="service-list">${services
      .map(
        (srv, i) =>
          `<div class="service-row"><span class="service-symbol">${icon(
            ["shield", "home", "wallet", "ticket", "server"][i]
          )}</span><div><strong>${esc(srv.service)}</strong><small>${esc(
            srv.region
          )} · ${
            srv.status === "online" ? srv.latencyMs + " ms" : "503"
          }</small></div>${statusBadge(srv.status)}</div>`
      )
      .join("")}</div><div class="panel-note">${icon(
      "info"
    )}<p>Identidad → Inventario → Reservas → Pagos<br>Outbox → Broker → ${esc(
      t("notifications")
    )}</p></div></section><section class="panel">${sectionHeading(
      t("activity")
    )}${eventList()}</section></div><section class="panel spaced">${sectionHeading(
      t("next")
    )}${bookingRows(
      s.bookings.filter((b) => b.status === "confirmed").slice(0, 5)
    )}</section>`
  );
}

function eventList() {
  return s.events.length
    ? `<div class="event-list">${s.events
        .slice(0, 10)
        .map(
          (e) =>
            `<div class="event"><span class="event-dot"></span><div><strong>${esc(
              t(e.type.replace("reservation.", ""))
            )}</strong><p>${esc(e.code)} · ${esc(e.space)}</p><small>${esc(
              date(e.at)
            )}</small></div></div>`
        )
        .join("")}</div>`
    : `<div class="empty">${icon("bell")}<h3>${esc(
        t("noNotifications")
      )}</h3><p>${esc(t("noData"))}</p></div>`;
}
function transactionView() {
  return `<section class="panel">${sectionHeading(t("audit"))}${
    s.bookings.length
      ? s.bookings
          .map(
            (b) =>
              `<details class="transaction"><summary><span><code>${esc(
                b.code
              )}</code><strong>${esc(
                b.space.name
              )}</strong></span>${statusBadge(
                b.status
              )}</summary><ol class="trace">${b.steps
                .map(
                  (step) =>
                    `<li class="${step.status}"><code>${esc(
                      step.step
                    )}</code><span>${esc(step.detail)}</span><time>${esc(
                      date(step.at, false)
                    )}</time></li>`
                )
                .join("")}</ol></details>`
          )
          .join("")
      : `<div class="empty">${esc(t("noData"))}</div>`
  }</section>`;
}
function regionView() {
  return `<section class="panel">${sectionHeading(
    t("profile"),
    t("localeNote")
  )}<div class="table-scroll"><table><thead><tr>${[
    "region",
    "city",
    "languages",
    "currency",
    "timezone",
    "payment",
  ]
    .map((k) => `<th>${esc(t(k))}</th>`)
    .join("")}</tr></thead><tbody>${s.regions
    .map(
      (r) =>
        `<tr><td><strong>${esc(r.name)}</strong></td><td>${esc(
          r.city
        )}</td><td>${esc(r.locale)}</td><td><code>${
          r.currency
        }</code></td><td>${esc(r.timeZone)}</td><td>${esc(
          r.paymentMethods.join(" · ")
        )}</td></tr>`
    )
    .join("")}</tbody></table></div></section>`;
}
function settings() {
  return `<div class="settings-grid"><section class="panel">${sectionHeading(
    t("account")
  )}<form class="settings-form" data-form="profile"><label>${esc(
    t("name")
  )}<input name="name" value="${esc(
    s.user.name
  )}" required minlength="3" maxlength="100"></label><label>${esc(
    t("email")
  )}<input value="${esc(s.user.email)}" disabled></label><label>${esc(
    t("role")
  )}<input value="${esc(
    t(s.user.role)
  )}" disabled></label><div class="form-error" role="alert"></div><button class="button" type="submit">${esc(
    t("save")
  )}</button></form></section><section class="panel">${sectionHeading(
    t("profile")
  )}<dl class="settings-details"><div><dt>${esc(t("region"))}</dt><dd>${esc(
    s.region.name
  )}</dd></div><div><dt>${esc(t("currency"))}</dt><dd>${
    s.region.currency
  }</dd></div><div><dt>${esc(t("timezone"))}</dt><dd>${esc(
    s.region.timeZone
  )}</dd></div></dl><p class="panel-note">${esc(t("privacy"))}</p>${button(
    icon("exit") + t("logout"),
    "logout",
    "",
    "button secondary full"
  )}</section></div>`;
}

async function loadPage({ silent = false } = {}) {
  if (!s.user) return render();
  const sequence = ++requestSequence;
  s.syncing = true;
  s.loading = !silent;
  s.error = "";
  s.syncError = "";
  if (!silent) render();
  try {
    if (s.user.role === "driver") {
      const params = new URLSearchParams({
        destinationId: s.destination,
        vehicle: s.vehicle,
        sort: s.sort,
        ...(s.filter === "covered"
          ? { covered: "true" }
          : s.filter === "noKeys"
          ? { noKeys: "true" }
          : ["private", "formal"].includes(s.filter)
          ? { kind: s.filter === "private" ? "particular" : "formal" }
          : {}),
      });
      const [spaces, bookings] = await Promise.all([
        api("/spaces?" + params),
        api("/me/reservations"),
      ]);
      if (sequence !== requestSequence) return;
      s.spaces = spaces;
      s.bookings = bookings;
    } else {
      const role = s.user.role;
      const [managed, bookings] = await Promise.all([
        api(
          role === "admin"
            ? "/ops/spaces"
            : role === "owner"
            ? "/owner/space"
            : "/host/spaces"
        ),
        api(role === "admin" ? "/ops/reservations" : "/host/reservations"),
      ]);
      if (sequence !== requestSequence) return;
      s.managed = Array.isArray(managed)
        ? managed
        : managed
        ? [managed.space || managed]
        : [];
      s.bookings = bookings;
      if (role === "admin") {
        const [status, events] = await Promise.all([
          api("/ops/status"),
          api("/notifications"),
        ]);
        if (sequence !== requestSequence) return;
        s.status = status;
        s.events = events;
      }
    }
  } catch (err) {
    if (sequence === requestSequence) {
      if (silent) s.syncError = err.message;
      else s.error = err.message;
    }
  }
  if (sequence === requestSequence) {
    s.loading = false;
    s.syncing = false;
    render();
  }
}

function openDialog(content, cls = "") {
  dialog.className = cls;
  dialog.innerHTML = `<div class="dialog-top"><span class="dialog-brand">Tu Espacio</span>${button(
    icon("close"),
    "close",
    "",
    "icon-button"
  )}</div>${content}`;
  dialog
    .querySelector('[data-action="close"]')
    .setAttribute("aria-label", t("close"));
  if (!dialog.open) dialog.showModal();
}

function spaceDetails(space) {
  const a = space.availability[s.vehicle];
  openDialog(
    `<div class="dialog-body"><div class="detail-intro"><div class="space-title-icon">${icon(
      space.kind === "formal" ? "home" : "key"
    )}</div>${statusBadge(a.status)}</div><h2 id="dialog-title">${esc(
      space.name
    )}</h2><p class="muted">${icon("pin")}${esc(
      space.address
    )}</p><div class="detail-facts"><div><strong>${a.free}</strong><span>${esc(
      t("free")
    )}</span></div><div><strong>${esc(
      money(space.rates[s.vehicle].price)
    )}</strong><span>${esc(
      t(space.rates[s.vehicle].unit)
    )}</span></div><div><strong>${space.distanceM} m</strong><span>${esc(
      t("walking")
    )}</span></div></div><h3>${esc(
      t("conditions")
    )}</h3><ul class="condition-list"><li>${icon(
      space.conditions.covered ? "roof" : "sun"
    )}${esc(
      t(space.conditions.covered ? "covered" : "uncovered")
    )}</li><li>${icon("key")}${esc(
      t(space.conditions.keys ? "keys" : "withoutKeys")
    )}</li>${
      space.conditions.maxHeight
        ? `<li>${icon("car")}${esc(t("height"))}: ${
            space.conditions.maxHeight
          } m</li>`
        : ""
    }<li>${icon("clock")}${esc(t("schedule"))}: ${space.schedule.open}–${
      space.schedule.close
    }</li></ul><p class="note">${esc(t("mapNote"))}</p>${button(
      t("reserve") + icon("arrow"),
      "reserve",
      space.id,
      "button full"
    ).replace("<button ", `<button ${!a.free ? "disabled" : ""} `)}</div>`
  );
}

function reserveDialog(space) {
  const hosted = s.region.payments?.provider === "mercadopago";
  if (hosted && !s.region.payments.available)
    return toast(t("paymentUnavailable"));
  if (checkout?.body) return pendingDialog();
  checkout = { space, key: crypto.randomUUID(), body: null, userId: s.user.id };
  const rate = space.rates[s.vehicle];
  openDialog(
    `<div class="dialog-body"><h2 id="dialog-title">${esc(
      t("summary")
    )}</h2><p class="muted">${esc(space.name)} · ${esc(
      t(s.vehicle)
    )}</p><form data-form="reserve"><div class="form-grid"><label>${esc(
      t("arrival")
    )}<select name="arrival">${[15, 30, 60, 120]
      .map((n) => `<option value="${n}">${n} min</option>`)
      .join("")}</select></label><label>${esc(
      t("duration")
    )}<select id="duration" name="duration">${[60, 120, 240, 480]
      .map((n) => `<option value="${n}">${n / 60} h</option>`)
      .join("")}</select></label></div>${
      hosted
        ? `<p class="note">Mercado Pago · ${esc(
            t(s.region.payments.live ? "hostedPayment" : "hostedTestPayment")
          )}</p>`
        : `<label>${esc(
            t("payment")
          )}<select name="paymentMethod">${s.region.paymentMethods
            .map((p) => `<option>${esc(p)}</option>`)
            .join("")}</select></label><details class="scenario"><summary>${esc(
            t("scenario")
          )}</summary><label class="sr-only" for="scenario">${esc(
            t("scenario")
          )}</label><select id="scenario" name="scenario"><option value="none">${esc(
            t("normal")
          )}</option><option value="declined">${esc(
            t("declined")
          )}</option></select></details>`
    }<div class="checkout-total"><span>${esc(
      t("total")
    )}</span><strong id="estimate">${esc(
      money(rate.price * (rate.unit === "minute" ? 60 : 1))
    )}</strong></div><p class="note">${icon("shield")}${esc(
      t(hosted ? "hostedPrivacy" : "testPayment")
    )}</p><div class="form-error" role="alert"></div><button class="button full" type="submit">${esc(
      t("confirm")
    )}${icon("arrow")}</button></form></div>`
  );
}

function pendingDialog() {
  openDialog(
    `<div class="dialog-body"><h2 id="dialog-title">${esc(
      t("pending")
    )}</h2><p>${esc(
      t("pendingNote")
    )}</p><div class="form-error" role="alert"></div>${button(
      t("retry"),
      "retry-checkout",
      "",
      "button full"
    )}</div>`
  );
}

function saveCheckout() {
  if (checkout?.body)
    sessionStore.setItem(
      "te.checkout",
      JSON.stringify({ userId: s.user.id, body: checkout.body })
    );
  else sessionStore.removeItem("te.checkout");
}

function restoreCheckout() {
  try {
    const saved = JSON.parse(sessionStore.getItem("te.checkout") || "null");
    checkout =
      saved?.userId === s.user?.id && saved?.body
        ? { ...saved, key: saved.body.idempotencyKey }
        : null;
    if (!checkout) sessionStore.removeItem("te.checkout");
  } catch {
    checkout = null;
    sessionStore.removeItem("te.checkout");
  }
}

async function finishCheckout() {
  saveCheckout();
  try {
    const b = await api("/reservations", {
      method: "POST",
      body: checkout.body,
    });
    checkout = null;
    saveCheckout();
    receiptView(b);
    toast(t(b.status === "confirmed" ? "createSuccess" : b.status));
    await loadPage();
  } catch (err) {
    if (err.status && err.status < 500) {
      checkout.body = null;
      checkout.key = crypto.randomUUID();
      saveCheckout();
      if (!checkout.space) {
        checkout = null;
        dialog.querySelector('[data-action="retry-checkout"]')?.remove();
      }
      render();
    }
    throw err;
  }
}

function paymentPendingView(b) {
  const url = new URL(b.payment.checkoutUrl);
  if (url.protocol !== "https:" || url.hostname !== "www.mercadopago.com.co")
    throw new Error(t("error"));
  openDialog(
    `<div class="dialog-body"><h2 id="dialog-title">${esc(
      t("awaiting_payment")
    )}</h2><p>${esc(t("paymentPendingNote"))}</p><p><strong>${esc(
      money(b.amount)
    )}</strong> · ${esc(b.code)}</p><a class="button full" href="${esc(
      url.href
    )}" rel="noreferrer">${esc(t("goToPayment"))}${icon("arrow")}</a>${button(
      t("refreshPayment"),
      "refresh-payment",
      b.id,
      "button secondary full"
    )}${button(
      t("cancel"),
      "cancel-confirm",
      b.id,
      "text-button danger full"
    )}<div class="form-error" role="alert"></div></div>`
  );
}

function receiptView(b) {
  if (b.status === "awaiting_payment") return paymentPendingView(b);
  const action =
    b.status === "confirmed"
      ? button(icon("check") + t("checkIn"), "check-in", b.id, "button full") +
        button(t("cancel"), "cancel-confirm", b.id, "text-button danger full")
      : b.status === "active"
      ? button(t("checkOut") + icon("arrow"), "check-out", b.id, "button full")
      : "";
  openDialog(
    `<div class="dialog-body receipt"><div class="receipt-status">${icon(
      b.status === "confirmed" ? "check" : "ticket"
    )}${statusBadge(b.status)}</div><h2 id="dialog-title">${esc(
      t(b.status === "confirmed" ? "createSuccess" : "receipt")
    )}</h2><p class="muted">${esc(
      b.space.name
    )}</p><div class="ticket-code"><span>${esc(t("code"))}</span><strong>${esc(
      b.code
    )}</strong><small>${esc(
      b.space.address
    )}</small></div><dl class="receipt-lines"><div><dt>${esc(
      t("arrival")
    )}</dt><dd>${esc(date(b.startAt))}</dd></div><div><dt>${esc(
      t("duration")
    )}</dt><dd>${b.durationMin / 60} h · ${esc(
      t(b.vehicle)
    )}</dd></div><div><dt>${esc(t("payment"))}</dt><dd>${esc(
      b.payment.method
    )}</dd></div><div><dt>${esc(t("subtotal"))}</dt><dd>${esc(
      money(b.subtotal ?? b.amount)
    )}</dd></div><div><dt>${esc(t("tax"))}</dt><dd>${esc(
      money(b.tax || 0)
    )}</dd></div><div class="receipt-total"><dt>${esc(
      t("total")
    )}</dt><dd>${esc(money(b.amount))}</dd></div></dl><p class="note">${esc(
      t(
        b.payment.provider === "demo" || !b.payment.provider
          ? "testPayment"
          : "receiptNote"
      )
    )}</p><div class="form-error" role="alert"></div>${action}${
      b.receiptId
        ? button(
            icon("download") + t("export"),
            "download",
            b.id,
            "button secondary full"
          )
        : ""
    }</div>`,
    "receipt-dialog"
  );
}

function editSpace(p) {
  const fresh = !p;
  p ||= {
    name: "",
    address: "",
    destinationId: "d-emp",
    capacity: { car: 1, moto: 0 },
    rates: {
      car: { price: s.region.minutePrice * 60, unit: "hour" },
      moto: null,
    },
    conditions: { covered: true, keys: false, maxHeight: 2.1 },
    schedule: { open: "06:00", close: "22:00", days: "Todos los días" },
    status: "published",
  };
  openDialog(`<div class="dialog-body"><h2 id="dialog-title">${esc(
    t(fresh ? "newSpace" : "edit")
  )}</h2><form data-form="space" data-id="${esc(p.id || "")}"><label>${esc(
    t("name")
  )}<input name="name" value="${esc(
    p.name
  )}" required minlength="3" maxlength="100"></label><label>${esc(
    t("address")
  )}<input name="address" value="${esc(
    p.address
  )}" required minlength="3" maxlength="160"></label><div class="form-grid"><label>${esc(
    t("latitude")
  )}<input name="latitude" type="number" min="-90" max="90" step="any" required value="${esc(
    p.location?.lat ?? ""
  )}"></label><label>${esc(
    t("longitude")
  )}<input name="longitude" type="number" min="-180" max="180" step="any" required value="${esc(
    p.location?.lon ?? ""
  )}"></label></div><div class="form-grid"><label>${esc(
    t("status")
  )}<select name="status"><option value="published">${esc(
    t("publish")
  )}</option><option value="paused" ${
    p.status === "paused" ? "selected" : ""
  }>${esc(t("paused"))}</option></select></label></div>
    ${["car", "moto"]
      .map(
        (v) =>
          `<fieldset><legend>${esc(
            t(v)
          )}</legend><div class="form-grid"><label>${esc(
            t("capacity")
          )}<input name="${v}Capacity" type="number" min="0" max="10000" step="1" required value="${
            p.capacity[v]
          }"></label><label>${esc(t("price"))} (${s.region.currency} ${esc(
            t("hour")
          )})<input name="${v}Price" type="number" min="0" step="${
            1 / 10 ** s.region.digits
          }" value="${
            p.rates[v]
              ? (p.rates[v].price * (p.rates[v].unit === "minute" ? 60 : 1)) /
                10 ** s.region.digits
              : 0
          }"></label></div></fieldset>`
      )
      .join("")}
    <div class="form-grid"><label>${esc(
      t("open")
    )}<input type="time" name="open" value="${
    p.schedule.open
  }" required></label><label>${esc(
    t("closing")
  )}<input type="time" name="close" value="${
    p.schedule.close
  }" required></label></div>${
    fresh
      ? `<label class="consent"><input type="checkbox" name="identityConsent" required>${esc(
          t("identityConsent")
        )}</label><p class="note">${esc(t("identityNote"))}</p>`
      : ""
  }<div class="checkboxes"><label><input type="checkbox" name="covered" ${
    p.conditions.covered ? "checked" : ""
  }>${esc(t("covered"))}</label><label><input type="checkbox" name="keys" ${
    p.conditions.keys ? "checked" : ""
  }>${esc(t("keys"))}</label></div><label>${esc(
    t("height")
  )} (m)<input name="maxHeight" type="number" step=".05" min=".5" max="10" value="${
    p.conditions.maxHeight || ""
  }"></label><div class="form-error" role="alert"></div><button class="button full" type="submit">${esc(
    t("save")
  )}</button></form></div>`);
}

async function busy(el, fn) {
  const previous = el?.innerHTML;
  if (el) {
    el.disabled = true;
    el.setAttribute("aria-busy", "true");
  }
  try {
    await fn();
  } catch (err) {
    const error = dialog.open
      ? dialog.querySelector(".form-error")
      : root.querySelector(".form-error");
    if (error) error.textContent = err.message;
    else toast(err.message);
  } finally {
    if (el?.isConnected) {
      el.disabled = false;
      el.removeAttribute("aria-busy");
      if (previous) el.innerHTML = previous;
    }
  }
}

async function handleAction(el) {
  const { action, id } = el.dataset;
  if (action === "destination") {
    const destination = s.destinations.find((d) => d.id === id);
    if (!destination) return;
    s.destination = destination.id;
    s.destinationQuery = destination.name;
    s.destinationLabel = destination.name;
    s.destinations = [];
    return loadPage();
  }
  if (action === "refresh-payment")
    return busy(el, async () => {
      receiptView(await api("/reservations/" + id));
      await loadPage();
    });
  if (action === "close") {
    dialog.close();
    return;
  }
  if (action === "theme") {
    const theme =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    preferencesStore.setItem("te.theme", theme);
    render();
    return;
  }
  if (action === "role") {
    s.authRole = id;
    render();
    return;
  }
  if (action === "auth-mode") {
    s.registering = !s.registering;
    s.authRole = "driver";
    render();
    return;
  }
  if (action === "demo-login")
    return busy(el, async () => {
      const email =
        {
          driver: "conductor",
          owner: "parqueadero",
          host: "anfitrion",
          admin: "admin",
        }[s.authRole] + "@demo.test";
      await signIn({ email, password: "demo123", role: s.authRole });
    });
  if (action === "logout") {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      /* La sesión local se cierra incluso sin red. */
    }
    token = "";
    sessionStore.removeItem("te.token");
    sessionStore.removeItem("te.checkout");
    checkout = null;
    s.user = null;
    s.bookings = [];
    s.managed = [];
    ++requestSequence;
    dialog.close();
    render();
    return;
  }
  if (action === "account") {
    location.hash = "settings";
    return;
  }
  if (action === "reload") return loadPage();
  if (action === "filter") {
    s.filter = id;
    return loadPage();
  }
  if (action === "vehicle") {
    s.vehicle = id;
    return loadPage();
  }
  if (action === "reset-filters") {
    s.filter = "all";
    return loadPage();
  }
  if (action === "details")
    return busy(el, async () =>
      spaceDetails(await api("/spaces/" + id + "?track=true"))
    );
  if (action === "reserve")
    return busy(el, async () => reserveDialog(await api("/spaces/" + id)));
  if (action === "retry-checkout") {
    if (!dialog.open) pendingDialog();
    return busy(
      dialog.querySelector('[data-action="retry-checkout"]'),
      finishCheckout
    );
  }
  if (action === "receipt")
    return busy(el, async () => receiptView(await api("/reservations/" + id)));
  if (action === "cancel-confirm") {
    openDialog(
      `<div class="dialog-body"><h2 id="dialog-title">${esc(
        t("confirmCancel")
      )}</h2><p>${esc(
        t("cancelNote")
      )}</p><div class="form-error" role="alert"></div><div class="dialog-actions">${button(
        t("keep"),
        "receipt",
        id,
        "button secondary"
      )}${button(t("cancel"), "cancel", id, "button destructive")}</div></div>`
    );
    return;
  }
  if (["cancel", "check-in", "check-out"].includes(action))
    return busy(el, async () => {
      const b = await api("/reservations/" + id + "/" + action, {
        method: "POST",
      });
      receiptView(b);
      toast(t(action === "cancel" ? "cancelSuccess" : "updateSuccess"));
      await loadPage();
    });
  if (action === "notifications")
    return busy(el, async () => {
      s.events = await api("/notifications");
      openDialog(
        `<div class="dialog-body"><h2 id="dialog-title">${esc(
          t("notifications")
        )}</h2>${eventList()}</div>`
      );
    });
  if (action === "download") {
    return busy(el, async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(
          "/api/reservations/" +
            encodeURIComponent(id) +
            "/receipt?format=html",
          {
            headers: { Authorization: "Bearer " + token },
            signal: controller.signal,
          }
        );
        if (!response.ok) throw new Error(t("receiptUnavailable"));
        const url = URL.createObjectURL(await response.blob());
        const a = document.createElement("a");
        a.href = url;
        a.download = "recibo-" + id + ".html";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } finally {
        clearTimeout(timeout);
      }
    });
  }
  if (action === "new-space") {
    editSpace();
    return;
  }
  if (action === "edit-space") {
    editSpace(s.managed.find((p) => p.id === id));
    return;
  }
  if (action === "occupancy")
    return busy(el, async () => {
      const [space, dir, vehicle] = id.split(":");
      await api("/spaces/" + space + "/occupancy", {
        method: "POST",
        body: { vehicle, delta: dir === "p" ? 1 : -1 },
      });
      await loadPage();
    });
  if (action === "booking-filter") {
    s.bookingFilter = id;
    root.querySelectorAll(".tab").forEach((b) => {
      b.classList.toggle("selected", b === el);
      b.setAttribute("aria-pressed", String(b === el));
    });
    root.querySelector("#booking-results").innerHTML = bookingRows(
      s.bookings.filter(
        (b) =>
          (id === "all" || b.status === id) &&
          (b.code + b.driverName + b.space.name)
            .toLowerCase()
            .includes(s.query.toLowerCase())
      )
    );
  }
}

async function signIn(body, register = false) {
  const result = await api("/auth/" + (register ? "register" : "login"), {
    method: "POST",
    body,
  });
  token = result.token;
  sessionStore.setItem("te.token", token);
  s.user = result.user;
  restoreCheckout();
  s.page = homePage();
  location.hash = s.page;
  await loadPage();
}

document.addEventListener("click", (event) => {
  const el = event.target.closest("[data-action]");
  if (el && !el.disabled) {
    event.preventDefault();
    void handleAction(el).catch((err) => toast(err.message));
  }
});
document.addEventListener("keydown", (event) => {
  if (
    event.target.matches("g[data-action]") &&
    ["Enter", " "].includes(event.key)
  ) {
    event.preventDefault();
    void handleAction(event.target).catch((err) => toast(err.message));
  }
});
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      dialog.close();
  }
});
document.addEventListener("change", async (event) => {
  if (event.target.id === "region-select") {
    const region = s.regions.find((r) => r.id === event.target.value);
    if (region && region.id !== s.region.id) {
      location.assign(regionUrl(location.href, region.port));
    }
  }
  if (event.target.id === "sort") {
    s.sort = event.target.value;
    await loadPage();
  }
  if (event.target.id === "duration" && checkout) {
    const rate = checkout.space.rates[s.vehicle];
    document.querySelector("#estimate").textContent = money(
      rate.price *
        (rate.unit === "minute"
          ? +event.target.value
          : Math.ceil(+event.target.value / 60))
    );
  }
});
document.addEventListener("input", (event) => {
  if (event.target.id === "booking-search") {
    s.query = event.target.value;
    const active = root.querySelector(".tab.selected")?.dataset.id;
    root.querySelector("#booking-results").innerHTML = bookingRows(
      s.bookings.filter(
        (b) =>
          (!active || active === "all" || b.status === active) &&
          (b.code + b.driverName + b.space.name)
            .toLowerCase()
            .includes(s.query.toLowerCase())
      )
    );
  }
});
document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!form.dataset.form) return;
  event.preventDefault();
  const fields = Object.fromEntries(new FormData(form));
  const submit = form.querySelector('[type="submit"]');
  form.querySelector(".form-error")?.replaceChildren();
  void busy(submit, async () => {
    if (form.dataset.form === "auth")
      await signIn(
        { ...fields, role: s.authRole, vehicle: "car" },
        s.registering
      );
    if (form.dataset.form === "search") {
      s.destinationQuery = fields.destination.trim();
      if (!s.destinationQuery) {
        s.destination = "";
        s.destinationLabel = "";
        s.destinations = [];
        await loadPage();
      } else {
        s.destinations = await api(
          "/destinations?q=" + encodeURIComponent(s.destinationQuery)
        );
        render();
        if (!s.destinations.length) toast(t("addressNotFound"));
      }
    }
    if (form.dataset.form === "profile") {
      s.user = await api("/me", { method: "PATCH", body: fields });
      toast(t("saved"));
      render();
    }
    if (form.dataset.form === "reserve") {
      if (!checkout.body)
        checkout.body = {
          spaceId: checkout.space.id,
          vehicle: s.vehicle,
          durationMin: +fields.duration,
          expectedAmount:
            checkout.space.rates[s.vehicle].price *
            (checkout.space.rates[s.vehicle].unit === "minute"
              ? +fields.duration
              : Math.ceil(+fields.duration / 60)),
          startAt: new Date(
            Date.now() + Number(fields.arrival) * 60000
          ).toISOString(),
          paymentMethod: fields.paymentMethod,
          scenario: fields.scenario || "none",
          idempotencyKey: checkout.key,
        };
      // Una respuesta incierta conserva exactamente el cuerpo y la llave originales.
      form.querySelectorAll("select").forEach((x) => (x.disabled = true));
      try {
        await finishCheckout();
      } catch (err) {
        if (err.status && err.status < 500) {
          form.querySelectorAll("select").forEach((x) => (x.disabled = false));
        } else {
          if (submit) submit.textContent = t("retry");
        }
        throw err;
      }
    }
    if (form.dataset.form === "space") {
      const body = {
        name: fields.name,
        address: fields.address,
        destinationId: "custom",
        location: {
          lat: Number(fields.latitude),
          lon: Number(fields.longitude),
        },
        status: fields.status,
        capacity: { car: +fields.carCapacity, moto: +fields.motoCapacity },
        rates: {},
        schedule: {
          open: fields.open,
          close: fields.close,
          days: "Todos los días",
        },
        conditions: {
          covered: !!fields.covered,
          keys: !!fields.keys,
          maxHeight: fields.maxHeight ? +fields.maxHeight : null,
        },
      };
      body.identityConsent = form.elements.identityConsent?.checked || false;
      for (const v of ["car", "moto"])
        body.rates[v] = body.capacity[v]
          ? {
              unit: "hour",
              price: Math.round(
                Number(fields[v + "Price"]) * 10 ** s.region.digits
              ),
            }
          : null;
      await api(
        form.dataset.id ? "/spaces/" + form.dataset.id : "/host/spaces",
        { method: form.dataset.id ? "PATCH" : "POST", body }
      );
      dialog.close();
      toast(t("saved"));
      await loadPage();
    }
  });
});
window.addEventListener("hashchange", () => {
  if (!s.user) return;
  s.page = navItems().some(([id]) => id === location.hash.slice(1))
    ? location.hash.slice(1)
    : homePage();
  void loadPage();
});

async function boot() {
  try {
    document.documentElement.dataset.theme =
      preferencesStore.getItem("te.theme") || "light";
    const [region, regions] = await Promise.all([
      api("/region"),
      api("/regions"),
    ]);
    s.region = region;
    s.regions = regions;
    if (token) {
      try {
        s.user = await api("/me");
      } catch (err) {
        if (err.status !== 401) throw err;
      }
    }
    restoreCheckout();
    s.page = navItems().some(([id]) => id === location.hash.slice(1))
      ? location.hash.slice(1)
      : homePage();
    s.loading = false;
    if (s.user) {
      await loadPage();
      const booking = new URLSearchParams(location.search).get("booking");
      if (booking)
        receiptView(await api("/reservations/" + encodeURIComponent(booking)));
    } else render();
  } catch (err) {
    root.innerHTML = `<main id="main" class="boot"><h1>Tu Espacio</h1><p>${esc(
      err.message
    )}</p><p>Ejecuta <code>python3 -m server.run --regions all</code> desde <code>tuespacio/</code>.</p><button class="button" data-action="boot">Reintentar conexión</button></main>`;
    root.querySelector("button").addEventListener("click", boot);
  }
}
setInterval(() => {
  if (
    s.user &&
    !s.syncing &&
    !dialog.open &&
    document.visibilityState === "visible" &&
    !document.activeElement?.closest("input,select,textarea,button,a")
  ) {
    void loadPage({ silent: true });
  }
}, 15000);
void boot();
