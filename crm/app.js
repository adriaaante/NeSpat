/* Штаб «НЕ СПАТЬ МОСКВА» — одностраничное приложение без сборки.
   Экраны по адресу после #: #/ (мероприятия), #/event/ID, #/people, #/person/ID,
   #/stats, #/team, #/me. Данные — через api.php; при 401 показываем вход по PIN,
   при must_change — обязательную смену временного PIN. При первом входе
   запускается обучение с подсветкой блоков; повторить — кнопка «?» в шапке. */
(function () {
  "use strict";

  var app = document.getElementById("app");
  var S = { me: null, can: {}, dict: null, scope: "upcoming", pq: "", pf: "all" };
  var LOGO = '<img src="../assets/img/monogram.png" alt="" width="28" height="31">';
  var MON = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  var MON_FULL = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  var WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
  var WD_FULL = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
  var STATE = { open: "Запись открыта", closed: "Запись закрыта", cancelled: "Отменено", past: "Прошло", full: "Мест нет" };

  // ---------- утилиты ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function api(action, body, query) {
    var url = "api.php?a=" + action + (query || "");
    var opt = body ? { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "crm" }, body: JSON.stringify(body) } : {};
    opt.credentials = "same-origin";
    return fetch(url, opt).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: "Сервер не ответил" }; }).then(function (d) {
        if (r.status === 401 && d.error === "auth") { S.me = null; showPin(); throw new Error("auth"); }
        if (d.error === "must_change") { if (S.me) S.me.must_change = true; showChangePin(true); throw new Error("must_change"); }
        if (!d.ok) throw new Error(d.error || "Ошибка");
        return d;
      });
    });
  }
  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg; t.classList.add("on");
    clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove("on"); }, 2600);
  }
  function fail(e) { if (e && e.message !== "auth" && e.message !== "must_change") toast(e.message); }
  function v(id) { var el = document.getElementById(id); return el ? el.value.trim() : ""; }
  function fmtPhone(p) {
    var d = String(p || "");
    return d.length === 11 ? "+7 (" + d.substr(1, 3) + ") " + d.substr(4, 3) + "-" + d.substr(7, 2) + "-" + d.substr(9, 2) : d;
  }
  function day(iso) { var m = String(iso).split("-"); return new Date(+m[0], +m[1] - 1, +m[2]); }
  function dateLong(iso) { var d = day(iso); return d.getDate() + " " + MON_FULL[d.getMonth()] + ", " + WD_FULL[d.getDay()]; }
  function dateShort(iso) { var d = day(iso); return d.getDate() + " " + MON[d.getMonth()] + (d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : ""); }
  function todayIso() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function times(e) { return e.time_start + (e.time_end ? "–" + e.time_end : ""); }
  function ago(ts) {
    var s = Math.floor(Date.now() / 1000) - ts;
    if (s < 60) return "только что";
    if (s < 3600) return Math.floor(s / 60) + " мин назад";
    if (s < 86400) return Math.floor(s / 3600) + " ч назад";
    var d = new Date(ts * 1000);
    return d.getDate() + " " + MON[d.getMonth()] + " " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }
  function initials(name) {
    return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0); }).join("").toUpperCase() || "?";
  }
  function plural(n, a, b, c) { var m = n % 10, h = n % 100; return n + " " + (m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c); }
  function rankName(r) { return r && S.dict.ranks[r] ? S.dict.ranks[r].name : "Без звания"; }
  function evState(e) {
    if (e.status === "cancelled") return "cancelled";
    if (e.past) return "past";
    if (e.status === "closed") return "closed";
    if (+e.capacity > 0 && +e.taken >= +e.capacity) return "full";
    return "open";
  }
  function chip(state) { return '<span class="chip ' + state + '">' + STATE[state] + "</span>"; }
  function copy(text) {
    function done() { toast("Скопировано"); }
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(done, fallback);
    fallback();
    function fallback() {
      var t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); done(); } catch (e) { toast("Не удалось скопировать"); }
      t.remove();
    }
  }
  function tgShare(url, text) { return "https://t.me/share/url?url=" + encodeURIComponent(url) + "&text=" + encodeURIComponent(text); }
  // маска телефона: +7 (999) 123-45-67
  function maskPhone(input) {
    input.addEventListener("input", function () {
      var d = input.value.replace(/\D/g, "");
      if (!d) { input.value = ""; return; }
      if (d[0] === "8") d = "7" + d.slice(1);
      if (d[0] !== "7") d = "7" + d;
      d = d.slice(0, 11);
      var out = "+7";
      if (d.length > 1) out += " (" + d.slice(1, 4);
      if (d.length >= 4) out += ") " + d.slice(4, 7);
      if (d.length >= 7) out += "-" + d.slice(7, 9);
      if (d.length >= 9) out += "-" + d.slice(9, 11);
      input.value = out;
    });
  }

  // ---------- вход по PIN ----------
  function pinPad(title, hint, onDone) {
    var val = "";
    app.innerHTML =
      '<div class="pin"><div class="box">' +
      '<img class="logo" src="../assets/img/monogram.png" alt="НЕ СПАТЬ МОСКВА">' +
      '<div class="ttl">НЕ СПАТЬ МОСКВА</div><div class="sub">Штаб клуба</div>' +
      "<div>" + esc(title) + "</div>" +
      '<div class="cells" id="cells"><i></i><i></i><i></i><i></i><i></i><i></i></div>' +
      '<div class="pinmsg" id="pinmsg">' + esc(hint || "") + "</div>" +
      '<div class="pad" id="pad">' +
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (n) { return '<button type="button" data-k="' + n + '">' + n + "</button>"; }).join("") +
      '<button type="button" class="ghost" data-k="c">Сброс</button><button type="button" data-k="0">0</button><button type="button" class="ghost" data-k="b" aria-label="Стереть">⌫</button>' +
      "</div></div></div>";
    var cells = document.getElementById("cells"), msg = document.getElementById("pinmsg"), busy = false;
    function draw() { [].forEach.call(cells.children, function (c, i) { c.classList.toggle("on", i < val.length); }); }
    function press(k) {
      if (busy) return;
      if (k === "b") val = val.slice(0, -1);
      else if (k === "c") val = "";
      else if (val.length < 6) val += k;
      draw();
      if (val.length === 6) {
        busy = true;
        // вход сам после шестой цифры
        onDone(val, function (err) {
          busy = false; val = ""; draw();
          if (err) { msg.textContent = err; cells.classList.remove("err"); void cells.offsetWidth; cells.classList.add("err"); }
        });
      }
    }
    document.getElementById("pad").onclick = function (e) { var b = e.target.closest("button"); if (b) press(b.getAttribute("data-k")); };
    document.onkeydown = function (e) {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("b");
      else if (e.key === "Escape") press("c");
    };
  }
  function showPin() {
    pinPad("Введите PIN", "", function (pin, done) {
      api("login", { pin: pin }).then(function (d) {
        document.onkeydown = null;
        S.me = d.user;
        if (S.me.must_change) showChangePin(true); else boot();
      }).catch(function (e) { done(e.message); });
    });
  }
  function showChangePin(forced) {
    var first = null;
    function ask() {
      pinPad(forced ? "Придумайте свой PIN — временный нужно сменить" : "Новый PIN", "6 цифр, не одинаковые и не подряд", function (pin, done) {
        first = pin; done();
        pinPad("Повторите новый PIN", "", function (pin2, done2) {
          if (pin2 !== first) { done2("PIN не совпали, начните заново"); setTimeout(ask, 1200); return; }
          api("my_pin", { pin: pin2 }).then(function () {
            document.onkeydown = null;
            if (S.me) S.me.must_change = false;
            toast("PIN сохранён");
            boot();
          }).catch(function (e) { done2(e.message); setTimeout(ask, 1600); });
        });
      });
    }
    ask();
  }

  // ---------- каркас ----------
  var ICON = {
    events: '<path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/>',
    people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c.6-3.3 3-5 6-5s5.4 1.7 6 5"/><path d="M15.5 5.2a3 3 0 0 1 0 5.6M17.5 14.3c1.8.6 3 2.2 3.5 4.7"/>',
    stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    certs: '<circle cx="12" cy="14" r="6"/><path d="M8.5 3h7l-2 5.5h-3L8.5 3ZM12 11.5v5M9.8 14h4.4"/>',
    team: '<path d="M12 3 4 6v6c0 4.4 3.3 7.8 8 9 4.7-1.2 8-4.6 8-9V6l-8-3Z"/>',
  };
  function shell(active, html) {
    var c = S.can;
    var items = [["events", "#/", "Мероприятия", "События"], ["people", "#/people", "Участники", "Участники"]];
    if (c.certs) items.push(["certs", "#/certs", "Сертификаты", "Звания"]);
    if (c.stats) items.push(["stats", "#/stats", "Сводка", "Сводка"]);
    if (c.team) items.push(["team", "#/team", "Команда", "Команда"]);
    app.innerHTML =
      '<header class="top"><div class="in"><a class="brand" href="#/">' + LOGO + "<span>Не спать Москва<small>Штаб клуба</small></span></a>" +
      '<nav class="nav">' + items.map(function (it) {
        return '<a href="' + it[1] + '" data-tour="nav-' + it[0] + '" class="' + (active === it[0] ? "on" : "") + '">' + it[2] + "</a>";
      }).join("") + "</nav>" +
      '<div class="tools"><button type="button" class="help" id="help" data-tour="help" title="Обучение" aria-label="Обучение">?</button>' +
      '<a href="#/me" data-tour="me" class="me' + (active === "me" ? " on" : "") + '" aria-label="Профиль"><span class="ini">' + esc(initials(S.me.name)) + "</span></a></div>" +
      '</div></header><main class="wrap">' + html + "</main>" +
      // на телефоне разделы — внизу, как в приложении
      '<nav class="tabbar">' + items.map(function (it) {
        return '<a href="' + it[1] + '" data-tour="nav-' + it[0] + '" class="' + (active === it[0] ? "on" : "") + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[it[0]] + "</svg><span>" + it[3] + "</span></a>";
      }).join("") + "</nav>";
    document.getElementById("help").onclick = helpCenter;
  }
  function boot() {
    api("me").then(function (d) {
      S.me = d.user; S.can = d.can; S.dict = d.dict;
      if (S.me.must_change) return showChangePin(true);
      route();
      // первый вход — сразу обучение
      if (!S.me.tour_done) setTimeout(function () { startTour(TOPICS.main.steps, false); }, 500);
    }).catch(fail);
  }
  var current = "";
  function route() {
    if (!S.me || !S.dict) return;
    closeMenu();
    var h = location.hash.replace(/^#\/?/, ""), m;
    current = h.split("/")[0] || "events";
    if ((m = h.match(/^event\/(\d+)/))) return viewEvent(+m[1]);
    if ((m = h.match(/^person\/(\d+)/))) return viewPerson(+m[1]);
    if (h === "people") return viewPeople();
    if (h === "certs" && S.can.certs) return viewCerts();
    if (h === "stats" && S.can.stats) return viewStats(30);
    if (h === "team" && S.can.team) return viewTeam();
    if (h === "me") return viewMe();
    current = "events";
    return viewEvents();
  }
  window.addEventListener("hashchange", route);

  // общий каркас окна: закрытие по фону, Esc и кнопке «Отмена»
  function modal(html, onReady, wide) {
    var m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = '<div class="dialog' + (wide ? " wide" : "") + '" role="dialog" aria-modal="true">' + html + "</div>";
    document.body.appendChild(m);
    function close() { document.removeEventListener("keydown", onKey); m.remove(); }
    function onKey(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", onKey);
    m.addEventListener("click", function (e) { if (e.target === m || e.target.closest("[data-close]")) close(); });
    var f = m.querySelector("input:not([type=radio]), textarea, button.btn");
    if (f && matchMedia("(hover: hover)").matches) f.focus();
    if (onReady) onReady(m, close);
    return close;
  }
  // всплывающее меню у кнопки «⋯»
  var menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function openMenu(btn, items) {
    closeMenu();
    menuEl = document.createElement("div");
    menuEl.className = "menu";
    menuEl.innerHTML = items.map(function (it, i) {
      return it.href ? '<a href="' + esc(it.href) + '"' + (/^https?:/.test(it.href) ? ' target="_blank" rel="noopener"' : "") + (it.cls ? ' class="' + it.cls + '"' : "") + ">" + esc(it.label) + "</a>"
        : '<button type="button" data-i="' + i + '"' + (it.cls ? ' class="' + it.cls + '"' : "") + ">" + esc(it.label) + "</button>";
    }).join("");
    document.body.appendChild(menuEl);
    var r = btn.getBoundingClientRect(), w = menuEl.offsetWidth, h = menuEl.offsetHeight;
    menuEl.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + "px";
    menuEl.style.top = (r.bottom + h + 8 > innerHeight ? r.top - h - 4 : r.bottom + 4) + "px";
    menuEl.onclick = function (e) {
      var b = e.target.closest("button[data-i]");
      if (b) { var it = items[+b.getAttribute("data-i")]; closeMenu(); it.fn(); }
      else if (e.target.closest("a")) closeMenu();
    };
  }
  document.addEventListener("click", function (e) { if (menuEl && !menuEl.contains(e.target) && !e.target.closest(".dots")) closeMenu(); });
  window.addEventListener("scroll", closeMenu, { passive: true });

  // ---------- мероприятия ----------
  function viewEvents() {
    shell("events", '<div class="empty">Загружаю…</div>');
    api("events", null, "&scope=" + S.scope).then(function (d) {
      var list = d.events;
      var html = '<div class="head"><h1>Мероприятия</h1>' +
        (S.can.events ? '<button type="button" class="btn" id="newEv" data-tour="new-event">+ Мероприятие</button>' : "") + "</div>" +
        '<div class="tabs" id="scope">' +
        [["upcoming", "Ближайшие"], ["past", "Прошедшие"], ["all", "Все"]].map(function (t) {
          return '<button type="button" data-s="' + t[0] + '" class="' + (S.scope === t[0] ? "on" : "") + '">' + t[1] + "</button>";
        }).join("") + "</div>" +
        '<div class="evs" data-tour="ev-list">' + (list.length ? list.map(evCard).join("") :
          '<div class="empty card"><b>' + (S.scope === "past" ? "Прошедших мероприятий пока нет" : "Пока ничего не запланировано") + "</b>" +
          (S.scope !== "past" ? "Создайте первое мероприятие — тренировку, забег или общий сбор — и отправьте ссылку на запись в Telegram-канал." : "") + "</div>") + "</div>" +
        (S.can.events ? '<button type="button" class="btn fab" id="newEv2">+ Мероприятие</button>' : "");
      shell("events", html);
      document.getElementById("scope").onclick = function (e) {
        var b = e.target.closest("button"); if (!b) return;
        S.scope = b.getAttribute("data-s"); viewEvents();
      };
      ["newEv", "newEv2"].forEach(function (id) { var b = document.getElementById(id); if (b) b.onclick = function () { eventModal(null); }; });
    }).catch(fail);
  }
  function evCard(e) {
    var d = day(e.date), st = evState(e), cap = +e.capacity, taken = +e.taken;
    var counter = e.past
      ? '<div class="cnt">' + e.came + " <small>пришли из " + taken + "</small></div>"
      : '<div class="cnt">' + taken + (cap ? " <small>из " + cap + "</small>" : " <small>записались</small>") + "</div>" +
        (cap ? '<div class="meter"><i style="width:' + Math.min(100, taken / cap * 100) + '%"></i></div>' : "");
    return '<a class="ev' + (st === "cancelled" || st === "past" ? " dim" : "") + '" href="#/event/' + e.id + '">' +
      '<div class="dt"><b>' + d.getDate() + "</b><span>" + MON[d.getMonth()] + "</span><small>" + WD[d.getDay()] + "</small></div>" +
      '<div><div class="tt">' + esc(e.title) + '</div><div class="mt"><span>' + esc(times(e)) + "</span><span>" + esc(e.place) + "</span><span>" + esc(S.dict.kinds[e.kind] || "") + "</span></div></div>" +
      '<div class="side">' + chip(st) + counter + "</div></a>";
  }
  function eventModal(e) {
    var k = S.dict.kinds, ed = e || { kind: "training", date: todayIso(), time_start: "19:00", time_end: "", capacity: 0 };
    modal("<h2>" + (e ? "Изменить мероприятие" : "Новое мероприятие") + "</h2>" +
      '<form id="ef" class="stack">' +
      '<fieldset class="opts" data-tour="f-kind"><legend>Что за мероприятие</legend><div class="kinds">' +
      Object.keys(k).map(function (key) {
        return '<label><input type="radio" name="kind" value="' + key + '"' + (ed.kind === key ? " checked" : "") + "><span>" + esc(k[key]) + "</span></label>";
      }).join("") + "</div></fieldset>" +
      '<label class="f">Название<input type="text" id="e_title" maxlength="120" required value="' + esc(ed.title || "") + '" placeholder="Например: Бокс в Парке Горького"></label>' +
      '<div class="grid3" data-tour="f-when"><label class="f">Дата<input type="date" id="e_date" required value="' + esc(ed.date) + '"></label>' +
      '<label class="f">Начало<input type="time" id="e_ts" required value="' + esc(ed.time_start) + '"></label>' +
      '<label class="f">Конец<input type="time" id="e_te" value="' + esc(ed.time_end || "") + '"></label></div>' +
      '<label class="f" data-tour="f-place">Место<input type="text" id="e_place" maxlength="120" required value="' + esc(ed.place || "") + '" placeholder="Парк Горького, площадка у Пионерского пруда"></label>' +
      '<div class="grid2"><label class="f">Адрес<input type="text" id="e_addr" maxlength="200" value="' + esc(ed.address || "") + '" placeholder="Улица, дом, ориентир"></label>' +
      '<label class="f">Ссылка на карту<input type="url" id="e_map" maxlength="500" value="' + esc(ed.map_url || "") + '" placeholder="https://yandex.ru/maps/…"></label></div>' +
      '<label class="f" data-tour="f-cap">Мест<input type="number" id="e_cap" min="0" max="10000" inputmode="numeric" value="' + (+ed.capacity || "") + '" placeholder="Пусто — без ограничений"></label>' +
      '<label class="f">Что взять, что будет<textarea id="e_desc" maxlength="2000" placeholder="Форма по погоде, вода. Работа в парах, лапы.">' + esc(ed.description || "") + "</textarea></label>" +
      '<p class="hint">Всё, кроме ссылки на карту и описания, увидят участники на странице записи.</p>' +
      '<div class="actions"><button type="button" class="btn ghost" data-close>Отмена</button><button class="btn">' + (e ? "Сохранить" : "Создать") + "</button></div></form>",
      function (m, close) {
        m.querySelector("#ef").onsubmit = function (ev) {
          ev.preventDefault();
          var kind = m.querySelector('input[name="kind"]:checked');
          api("event_save", {
            id: e ? e.id : 0, kind: kind ? kind.value : "", title: v("e_title"), date: v("e_date"), time_start: v("e_ts"), time_end: v("e_te"),
            place: v("e_place"), address: v("e_addr"), map_url: v("e_map"), capacity: +v("e_cap") || 0, description: v("e_desc"),
          }).then(function (r) {
            close(); toast(e ? "Сохранено" : "Мероприятие создано");
            if (e) viewEvent(e.id); else location.hash = "#/event/" + r.id;
          }).catch(fail);
        };
      }, true);
  }

  var REG_SRC = { site: "с сайта", crm: "вручную" };
  function viewEvent(id) {
    shell("events", '<div class="empty">Загружаю…</div>');
    api("event", null, "&id=" + id).then(function (d) { drawEvent(d); maybeTour("event"); }).catch(fail);
  }
  function drawEvent(d) {
    var e = d.event, regs = d.regs, act = regs.filter(function (r) { return r.status === "reg"; });
    e.taken = act.length;
    var came = regs.filter(function (r) { return +r.came; }).length, st = evState(e), cap = +e.capacity;
    var shareText = e.title + " — " + dateLong(e.date) + ", " + times(e) + ", " + e.place + ". Запись:";
    var acts = [];
    if (S.can.events) {
      acts.push('<button type="button" class="btn ghost small" id="evEdit">Изменить</button>');
      if (!e.past && e.status !== "cancelled") acts.push('<button type="button" class="btn ghost small" id="evClose">' + (e.status === "closed" ? "Открыть запись" : "Закрыть запись") + "</button>");
    }
    acts.push('<button type="button" class="dots" id="evMore" aria-label="Ещё">⋯</button>');

    var html = '<a href="#/" class="small muted" style="text-decoration:none">← Все мероприятия</a>' +
      '<div class="hero" style="margin-top:10px"><div class="row" style="justify-content:space-between;align-items:flex-start">' +
      '<div><div class="row">' + chip(st) + '<span class="chip">' + esc(S.dict.kinds[e.kind] || "") + "</span></div><h1>" + esc(e.title) + "</h1></div>" +
      '<div class="row" data-tour="ev-actions">' + acts.join("") + "</div></div>" +
      '<div class="facts"><span><b>' + esc(dateLong(e.date)) + "</b></span><span><b>" + esc(times(e)) + "</b></span>" +
      "<span>" + esc(e.place) + (e.address ? ", " + esc(e.address) : "") + "</span>" +
      (e.map_url ? '<a href="' + esc(e.map_url) + '" target="_blank" rel="noopener">На карте ↗</a>' : "") + "</div>" +
      (e.description ? '<p class="desc">' + esc(e.description) + "</p>" : "") + "</div>" +

      '<div class="stats3" style="margin-top:10px" data-tour="ev-stats">' +
      '<div class="st"><b>' + act.length + '</b><span>Записались</span></div>' +
      '<div class="st ok"><b>' + came + '</b><span>Пришли</span></div>' +
      '<div class="st"><b>' + (cap ? Math.max(0, cap - act.length) : "∞") + "</b><span>" + (cap ? "Свободно из " + cap : "Мест без ограничений") + "</span></div></div>" +

      (st === "open" || st === "full" || st === "closed" ? '<h2>Ссылка на запись</h2><div class="card share" data-tour="share"><div class="stack" style="gap:10px">' +
        '<div class="link"><code>' + esc(e.url) + '</code><button type="button" class="btn small" id="cpLink">Копировать</button></div>' +
        '<div class="row"><a class="btn ghost small" target="_blank" rel="noopener" href="' + esc(tgShare(e.url, shareText)) + '">Отправить в Telegram</a>' +
        '<a class="btn ghost small" target="_blank" rel="noopener" href="' + esc(e.url) + '">Открыть страницу записи</a>' +
        '<button type="button" class="btn ghost small" id="qrBig">QR-код</button></div>' +
        '<p class="hint">Участник открывает ссылку, вводит имя и телефон — и сразу появляется в списке ниже.' + (st === "closed" ? " Сейчас запись закрыта: страница покажет это." : "") + "</p></div>" +
        '<div class="qr" id="qrSmall" title="Увеличить">' + qrSvg(e.url) + "</div></div>" : "") +

      (S.can.regs && e.status !== "cancelled" ? '<h2>Добавить участника</h2><div class="card" data-tour="add"><form class="addp" id="addF" autocomplete="off">' +
        '<label class="f">Телефон<input type="tel" id="a_phone" placeholder="+7 (___) ___-__-__"></label>' +
        '<label class="f">Имя<input type="text" id="a_name" maxlength="80" placeholder="Если новый участник"></label>' +
        '<button class="btn ghost" type="submit" data-came="0">Записать</button><button class="btn ok" type="submit" data-came="1">Пришёл</button>' +
        '<div class="sugg" id="sugg" hidden></div></form>' +
        '<p class="hint" style="margin-top:8px">Начните вводить телефон или имя — подскажем, если человек уже есть в базе. «Пришёл» — сразу отметит посещение.</p></div>' : "") +

      '<div class="row" style="justify-content:space-between;margin:26px 0 10px"><h2 style="margin:0">Участники · ' + act.length + "</h2>" +
      (regs.length > 8 ? '<input type="search" id="rq" placeholder="Найти в списке" style="max-width:220px;min-height:34px">' : "") + "</div>" +
      '<div class="regs" id="regs" data-tour="regs">' + (regs.length ? regs.map(regRow).join("") :
        '<div class="empty"><b>Пока никто не записался</b>Отправьте ссылку на запись в Telegram-канал или добавьте участника вручную.</div>') + "</div>" +

      (d.log.length ? '<details class="more"><summary>Журнал действий</summary><div class="card log">' + d.log.map(logRow).join("") + "</div></details>" : "");
    shell("events", html);

    var cp = document.getElementById("cpLink"); if (cp) cp.onclick = function () { copy(e.url); };
    ["qrBig", "qrSmall"].forEach(function (x) { var b = document.getElementById(x); if (b) b.onclick = function () { qrModal(e); }; });
    var ed = document.getElementById("evEdit"); if (ed) ed.onclick = function () { eventModal(e); };
    var cl = document.getElementById("evClose"); if (cl) cl.onclick = function () { setStatus(e, e.status === "closed" ? "open" : "closed"); };
    document.getElementById("evMore").onclick = function () {
      var items = [];
      if (S.can.export) items.push({ label: "Выгрузить список (Excel)", href: "api.php?a=csv&what=event&id=" + e.id });
      if (S.can.events && !e.past) items.push(e.status === "cancelled"
        ? { label: "Вернуть мероприятие", fn: function () { setStatus(e, "open"); } }
        : { label: "Отменить мероприятие", cls: "danger", fn: function () { cancelModal(e, act.length); } });
      if (S.can.event_delete && !regs.length) items.push({ label: "Удалить", cls: "danger", fn: function () { deleteEvent(e); } });
      if (!items.length) items.push({ label: "Нет действий", fn: function () {} });
      openMenu(this, items);
    };
    var addF = document.getElementById("addF");
    if (addF) wireAdd(addF, e);
    var rq = document.getElementById("rq");
    if (rq) rq.oninput = function () {
      var q = rq.value.toLowerCase().replace(/\D/g, "") || rq.value.toLowerCase();
      [].forEach.call(document.querySelectorAll(".reg"), function (r) { r.hidden = q && r.getAttribute("data-s").indexOf(q) < 0; });
    };
    document.getElementById("regs").onclick = function (ev) {
      var b = ev.target.closest("button"); if (!b) return;
      var row = b.closest(".reg"), r = regs.filter(function (x) { return +x.id === +row.getAttribute("data-id"); })[0];
      if (b.classList.contains("came-btn")) return toggleCame(r, b, row, d);
      if (b.classList.contains("dots")) {
        openMenu(b, [
          { label: "Профиль участника", href: "#/person/" + r.person_id },
          { label: "Позвонить", href: "tel:+" + r.phone },
          r.status === "reg" ? { label: "Отменить запись", cls: "danger", fn: function () { regCancel(r, false, e); } }
            : { label: "Вернуть запись", fn: function () { regCancel(r, true, e); } },
        ]);
      }
    };
  }
  function regRow(r) {
    var came = +r.came, canc = r.status !== "reg";
    return '<div class="reg' + (came ? " came" : "") + (canc ? " cancel" : "") + '" data-id="' + r.id + '" data-s="' + esc((r.name + " " + r.phone).toLowerCase()) + '">' +
      '<span class="ava">' + (came ? "✓" : esc(initials(r.name))) + "</span>" +
      '<div><a class="nm" href="#/person/' + r.person_id + '">' + esc(r.name || "Без имени") + "</a>" +
      '<div class="sub"><a href="tel:+' + esc(r.phone) + '">' + esc(fmtPhone(r.phone)) + "</a>" +
      (+r.rank ? '<span class="chip rank">' + esc(rankName(+r.rank)) + "</span>" : "") +
      "<span>" + plural(+r.visits, "посещение", "посещения", "посещений") + "</span>" +
      (r.source === "site" ? '<span class="chip site">с сайта</span>' : "") +
      (canc ? '<span class="chip cancelled">отменил</span>' : "") + "</div></div>" +
      '<div class="ract">' + (S.can.regs && !canc ? '<button type="button" class="came-btn' + (came ? " on" : "") + '" aria-pressed="' + (came ? "true" : "false") + '">' + (came ? "✓ Пришёл" : "Отметить") + "</button>" : "") +
      (S.can.regs ? '<button type="button" class="dots" aria-label="Ещё">⋯</button>' : "") + "</div></div>";
  }
  function toggleCame(r, b, row, d) {
    var on = !+r.came;
    // отметка видна сразу; если сервер не принял — вернём как было
    r.came = on ? 1 : 0; r.visits = +r.visits + (on ? 1 : -1);
    row.outerHTML = regRow(r);
    api("reg_came", { id: r.id, came: on }).then(function () {
      var c = d.regs.filter(function (x) { return +x.came; }).length;
      var ok = document.querySelector(".st.ok b"); if (ok) ok.textContent = c;
    }).catch(function (er) {
      r.came = on ? 0 : 1; r.visits = +r.visits + (on ? -1 : 1);
      var cur = document.querySelector('.reg[data-id="' + r.id + '"]'); if (cur) cur.outerHTML = regRow(r);
      fail(er);
    });
  }
  function regCancel(r, restore, e) {
    api("reg_cancel", { id: r.id, restore: restore }).then(function () { toast(restore ? "Запись возвращена" : "Запись отменена"); viewEvent(e.id); }).catch(fail);
  }
  function wireAdd(form, e) {
    var ph = form.querySelector("#a_phone"), nm = form.querySelector("#a_name"), box = form.querySelector("#sugg"), t = null, which = 0;
    maskPhone(ph);
    form.querySelectorAll("button[type=submit]").forEach(function (b) { b.onclick = function () { which = +b.getAttribute("data-came"); }; });
    function find(q) {
      clearTimeout(t);
      if (q.replace(/\s/g, "").length < 2) { box.hidden = true; return; }
      t = setTimeout(function () {
        api("person_find", null, "&q=" + encodeURIComponent(q)).then(function (d) {
          if (!d.people.length) { box.hidden = true; return; }
          box.innerHTML = d.people.map(function (p) {
            return '<button type="button" data-ph="' + esc(p.phone) + '" data-nm="' + esc(p.name) + '"><span><b>' + esc(p.name) + '</b> <span class="muted small">' + esc(fmtPhone(p.phone)) + "</span></span>" +
              (+p.rank ? '<span class="chip rank">' + esc(rankName(+p.rank)) + "</span>" : "") + "</button>";
          }).join("");
          box.hidden = false;
        }).catch(function () {});
      }, 250);
    }
    ph.addEventListener("input", function () { find(ph.value.replace(/\D/g, "").replace(/^7/, "")); });
    nm.addEventListener("input", function () { find(nm.value); });
    box.onclick = function (ev) {
      var b = ev.target.closest("button"); if (!b) return;
      ph.value = fmtPhone(b.getAttribute("data-ph")); nm.value = b.getAttribute("data-nm"); box.hidden = true;
    };
    document.addEventListener("click", function (ev) { if (!form.contains(ev.target)) box.hidden = true; });
    form.onsubmit = function (ev) {
      ev.preventDefault();
      var phone = ph.value.replace(/\D/g, "");
      if (phone.length !== 11) { toast("Введите телефон полностью"); ph.focus(); return; }
      api("reg_add", { event_id: e.id, phone: phone, name: nm.value.trim(), came: which === 1 }).then(function (r) {
        toast(which ? "Отмечен как пришедший" : r.existing ? "Запись обновлена" : "Записан");
        viewEvent(e.id);
      }).catch(fail);
    };
  }
  function setStatus(e, s) {
    api("event_status", { id: e.id, status: s }).then(function () {
      toast({ open: "Запись открыта", closed: "Запись закрыта", cancelled: "Мероприятие отменено" }[s]); viewEvent(e.id);
    }).catch(fail);
  }
  function cancelModal(e, n) {
    modal("<h2>Отменить мероприятие?</h2><p style=\"margin:0\"><b>" + esc(e.title) + "</b> · " + esc(dateShort(e.date)) + "</p>" +
      '<p class="hint">' + (n ? "Записались " + plural(n, "человек", "человека", "человек") + ". Страница записи покажет, что мероприятие отменено, — предупредите участников в канале." : "Страница записи покажет, что мероприятие отменено.") + " Отмену можно вернуть.</p>" +
      '<div class="actions"><button type="button" class="btn ghost" data-close>Не отменять</button><button type="button" class="btn" id="cOk">Отменить</button></div>',
      function (m, close) { m.querySelector("#cOk").onclick = function () { close(); setStatus(e, "cancelled"); }; });
  }
  function deleteEvent(e) {
    modal("<h2>Удалить мероприятие?</h2><p style=\"margin:0\"><b>" + esc(e.title) + "</b> · " + esc(dateShort(e.date)) + '</p><p class="hint">На него никто не записан. Удаление нельзя отменить.</p>' +
      '<div class="actions"><button type="button" class="btn ghost" data-close>Оставить</button><button type="button" class="btn" id="dOk">Удалить</button></div>',
      function (m, close) {
        m.querySelector("#dOk").onclick = function () { api("event_delete", { id: e.id }).then(function () { close(); toast("Удалено"); location.hash = "#/"; }).catch(fail); };
      });
  }
  function qrSvg(url) { return window.NespatQR ? window.NespatQR.toSvg(url, { quiet: 1, label: "QR-код записи" }) || "" : ""; }
  function qrModal(e) {
    modal("<h2>QR-код записи</h2>" +
      '<div style="background:#fff;border-radius:12px;padding:16px;max-width:320px;margin:0 auto;width:100%">' + qrSvg(e.url) + "</div>" +
      '<p class="hint" style="text-align:center">' + esc(e.title) + " · " + esc(dateShort(e.date)) + ", " + esc(times(e)) + "<br>Наведите камеру телефона — откроется страница записи.</p>" +
      '<div class="actions"><button type="button" class="btn ghost" id="qPrint">Распечатать</button><button type="button" class="btn" data-close>Готово</button></div>',
      function (m) {
        m.querySelector("#qPrint").onclick = function () {
          var w = window.open("", "_blank");
          if (!w) return toast("Разрешите всплывающие окна");
          w.document.write('<html><head><title>QR — ' + esc(e.title) + '</title></head><body style="font-family:sans-serif;text-align:center;padding:40px">' +
            "<h1 style=\"margin:0 0 6px\">" + esc(e.title) + "</h1><p>" + esc(dateLong(e.date)) + ", " + esc(times(e)) + "<br>" + esc(e.place) + "</p>" +
            '<div style="width:360px;margin:20px auto">' + qrSvg(e.url) + "</div><p>Запишись: наведи камеру на код</p></body></html>");
          w.document.close(); w.focus(); w.print();
        };
      });
  }
  var LOG = {
    event_new: "создал(а) мероприятие", event_edit: "изменил(а) мероприятие", event_status: "сменил(а) статус",
    reg_add: "записал(а)", reg_walkin: "отметил(а) пришедшим без записи", reg_site: "записался(ась) на сайте",
    came: "отметил(а): пришёл", came_undo: "снял(а) отметку", reg_cancel: "отменил(а) запись", reg_restore: "вернул(а) запись",
  };
  function logRow(l) {
    var who = l.user_name || l.person_name || "участник", what = LOG[l.type] || l.type;
    if (l.type === "event_status" && l.meta) what += ": " + (STATE[l.meta.to] || { open: "запись открыта" }[l.meta.to] || l.meta.to);
    if (l.type === "event_status" && l.meta && l.meta.to === "open") what = "открыл(а) запись";
    var target = l.person_name && l.user_name ? " " + l.person_name : "";
    return "<div><span><b>" + esc(who) + "</b> " + esc(what) + esc(target) + "</span><time>" + esc(ago(+l.created_at)) + "</time></div>";
  }

  // ---------- участники ----------
  var PF = [["all", "Все"], ["ready", "Готовы к званию"], ["new", "Новые за 30 дней"], ["lost", "Давно не были"]];
  function viewPeople() {
    shell("people", '<div class="empty">Загружаю…</div>');
    loadPeople(true);
  }
  function loadPeople(full) {
    api("people", null, "&q=" + encodeURIComponent(S.pq) + "&f=" + S.pf).then(function (d) {
      var listHtml = d.people.length ? d.people.map(personRow).join("") : '<div class="empty"><b>' +
        (S.pq ? "Никого не нашли" : S.pf === "ready" ? "Пока никто не дорос до нового звания" : S.pf === "lost" ? "Все ходят — отлично" : "Участников пока нет") + "</b>" +
        (!S.pq && S.pf === "all" ? "Участники появятся сами, когда начнут записываться по ссылке, или когда вы отметите их на мероприятии." : "") + "</div>";
      if (!full && document.getElementById("plist")) { document.getElementById("plist").innerHTML = listHtml; return; }
      shell("people",
        '<div class="head"><h1>Участники</h1><div class="row">' + (S.can.export ? '<a class="btn ghost small" href="api.php?a=csv&what=people">Выгрузить (Excel)</a>' : "") +
        '<button type="button" class="btn small" id="pAdd" data-tour="person-new">+ Участник</button></div></div>' +
        '<input type="search" class="search" id="pq" data-tour="search" placeholder="Имя или телефон" value="' + esc(S.pq) + '">' +
        '<div class="tabs" id="pf" data-tour="ready">' + PF.map(function (f) { return '<button type="button" data-f="' + f[0] + '" class="' + (S.pf === f[0] ? "on" : "") + '">' + f[1] + "</button>"; }).join("") + "</div>" +
        '<div class="plist" id="plist" data-tour="plist">' + listHtml + "</div>" +
        '<p class="hint" style="margin-top:10px">«Готовы к званию» — набрали посещений на следующее звание: 10 для «Бойца», 30 для «Железного», 100 для «Стража». «Давно не были» — последнее посещение больше трёх недель назад.</p>');
      var q = document.getElementById("pq"), t = null;
      q.oninput = function () { clearTimeout(t); t = setTimeout(function () { S.pq = q.value.trim(); loadPeople(false); }, 250); };
      document.getElementById("pf").onclick = function (e) { var b = e.target.closest("button"); if (b) { S.pf = b.getAttribute("data-f"); loadPeople(true); } };
      document.getElementById("pAdd").onclick = personAddModal;
    }).catch(fail);
  }
  function personRow(p) {
    return '<a class="pr" href="#/person/' + p.id + '"><span class="ava">' + esc(initials(p.name)) + "</span>" +
      '<div><div class="nm">' + esc(p.name || "Без имени") + '</div><div class="sub"><span>' + esc(fmtPhone(p.phone)) + "</span>" +
      '<span class="chip' + (+p.rank ? " rank" : "") + '">' + esc(rankName(+p.rank)) + "</span>" +
      (p.ready ? '<span class="chip ready">готов: ' + esc(rankName(p.ready)) + "</span>" : "") +
      (p.last_visit ? "<span>был(а) " + esc(dateShort(p.last_visit)) + "</span>" : "") + "</div></div>" +
      '<div class="vis"><b>' + p.visits + "</b><span>" + plural(+p.visits, "посещение", "посещения", "посещений").replace(/^\d+ /, "") + "</span></div></a>";
  }
  function viewPerson(id) {
    shell("people", '<div class="empty">Загружаю…</div>');
    api("person", null, "&id=" + id).then(function (d) { var auto = S.openCert === +id; drawPerson(d); if (!auto) maybeTour("person"); }).catch(fail);
  }
  function drawPerson(d) {
    var p = d.person, R = S.dict.ranks, rank = +p.rank, visits = +p.visits;
    var next = null;
    for (var r = rank + 1; r <= 7; r++) if (R[r] && R[r].visits) { next = r; break; }
    var prog = next ? '<div class="card" style="margin-top:10px"><div class="row" style="justify-content:space-between"><span>До звания «<b>' + esc(R[next].name) + "</b>»</span><span class=\"muted\">" + Math.min(visits, R[next].visits) + " из " + R[next].visits + "</span></div>" +
      '<div class="bar"><i style="width:' + Math.min(100, visits / R[next].visits * 100) + '%"></i></div>' +
      (visits >= R[next].visits ? '<span class="chip ready">Готов к званию — можно выдавать сертификат</span>' : '<span class="small muted">Осталось ' + plural(R[next].visits - visits, "посещение", "посещения", "посещений") + "</span>") + "</div>" : "";
    var html = '<a href="#/people" class="small muted" style="text-decoration:none">← Все участники</a>' +
      '<div class="card prof" style="margin-top:10px"><span class="big">' + esc(initials(p.name)) + "</span>" +
      "<div><h1>" + esc(p.name || "Без имени") + '</h1><div class="row"><a class="muted" href="tel:+' + esc(p.phone) + '" style="text-decoration:none">' + esc(fmtPhone(p.phone)) + "</a>" +
      '<span class="chip' + (rank ? " rank" : "") + '">' + esc(rankName(rank)) + "</span><span class=\"muted small\">" + plural(visits, "посещение", "посещения", "посещений") + "</span></div>" +
      (p.note ? '<p class="desc" style="margin-top:6px">' + esc(p.note) + "</p>" : "") + "</div>" +
      '<div class="row acts">' + (S.can.people ? '<button type="button" class="btn ghost small" id="pEdit">Изменить</button>' : "") +
      (S.can.certs ? '<button type="button" class="btn small" id="pCert" data-tour="cert">Выдать сертификат</button>' : "") + "</div></div>" +
      '<h2>Путь бойца</h2><div class="path" data-tour="path">' + [1, 2, 3, 4, 5, 6, 7].map(function (i) {
        return '<div class="step' + (i <= rank ? " done" : i === p.ready ? " next" : "") + '"><span class="r">' + ["I", "II", "III", "IV", "V", "VI", "VII"][i - 1] + "</span><b>" + esc(R[i].name.replace(" «Не Спать»", "")) + "</b>" +
          (R[i].visits ? R[i].visits + " пос." : "по решению") + "</div>";
      }).join("") + "</div>" + prog +
      (d.certs.length ? "<h2>Сертификаты</h2><div class=\"certs\">" + d.certs.map(function (c) {
        return '<a class="cert" href="' + esc(c.url) + '" target="_blank" rel="noopener"><div class="r">' + esc(rankName(+c.rank)) + '</div><div class="n">' + esc(c.number) + " · " + esc(dateShort(c.date)) + "</div>" +
          '<div class="small muted" style="margin-top:6px">Выдал(а) ' + esc(c.user_name || "—") + " · открыть ↗</div></a>";
      }).join("") + "</div>" : "") +
      "<h2>Мероприятия · " + d.regs.length + "</h2>" +
      (d.regs.length ? '<div class="hist">' + d.regs.map(function (r) {
        var stt = +r.came ? '<span class="chip open">пришёл</span>' : r.status !== "reg" ? '<span class="chip cancelled">отменил</span>' : '<span class="chip">записан</span>';
        return '<a href="#/event/' + r.event_id + '"><span class="d">' + esc(dateShort(r.date)) + "</span><span>" + esc(r.title) + ' <span class="muted small">· ' + esc(S.dict.kinds[r.kind] || "") + "</span></span>" + stt + "</a>";
      }).join("") + "</div>" : '<div class="card empty">Ещё не записывался</div>') +
      '<p class="hint" style="margin-top:10px">В базе с ' + esc(new Date(p.created_at * 1000).toLocaleDateString("ru-RU")) + (p.source === "site" ? " · пришёл через запись на сайте" : "") + "</p>";
    shell("people", html);
    var pe = document.getElementById("pEdit"); if (pe) pe.onclick = function () { personModal(p); };
    var pc = document.getElementById("pCert"); if (pc) pc.onclick = function () { certModal(p); };
    if (S.openCert === +p.id && pc) { S.openCert = null; certModal(p); }
  }
  function personModal(p) {
    modal("<h2>Участник</h2><form id=\"pf2\" class=\"stack\">" +
      '<label class="f">Имя и фамилия<input type="text" id="p_name" maxlength="80" required value="' + esc(p.name) + '"></label>' +
      '<label class="f">Телефон<input type="tel" id="p_phone" required value="' + esc(fmtPhone(p.phone)) + '"></label>' +
      '<label class="f">Заметка<textarea id="p_note" maxlength="1000" placeholder="Видят только в штабе: травмы, уровень, договорённости">' + esc(p.note || "") + "</textarea></label>" +
      '<div class="actions"><button type="button" class="btn ghost" data-close>Отмена</button><button class="btn">Сохранить</button></div></form>',
      function (m, close) {
        maskPhone(m.querySelector("#p_phone"));
        m.querySelector("#pf2").onsubmit = function (e) {
          e.preventDefault();
          api("person_save", { id: p.id, name: v("p_name"), phone: v("p_phone"), note: v("p_note") }).then(function () { close(); toast("Сохранено"); viewPerson(p.id); }).catch(fail);
        };
      });
  }
  // поле «телефон + имя» с подсказкой из базы — в окне выдачи и при добавлении участника
  function whoFields(tour) {
    return '<div class="grid2 who"' + (tour ? ' data-tour="' + tour + '"' : "") + ' style="position:relative">' +
      '<label class="f">Телефон<input type="tel" id="w_phone" placeholder="+7 (___) ___-__-__" autocomplete="off"></label>' +
      '<label class="f">Имя и фамилия<input type="text" id="w_name" maxlength="80" placeholder="Как в сертификате" autocomplete="off"></label>' +
      '<div class="sugg" id="w_sugg" hidden></div></div>';
  }
  function wireWho(m, onPick) {
    var ph = m.querySelector("#w_phone"), nm = m.querySelector("#w_name"), box = m.querySelector("#w_sugg"), t = null;
    maskPhone(ph);
    function find(q) {
      clearTimeout(t);
      if (q.replace(/\s/g, "").length < 2) { box.hidden = true; return; }
      t = setTimeout(function () {
        api("person_find", null, "&q=" + encodeURIComponent(q)).then(function (d) {
          box.hidden = !d.people.length;
          box.innerHTML = d.people.map(function (p) {
            return '<button type="button" data-id="' + p.id + '" data-ph="' + esc(p.phone) + '" data-nm="' + esc(p.name) + '" data-rk="' + (+p.rank) + '"><span><b>' + esc(p.name) + '</b> <span class="muted small">' + esc(fmtPhone(p.phone)) + "</span></span>" +
              '<span class="chip' + (+p.rank ? " rank" : "") + '">' + esc(rankName(+p.rank)) + "</span></button>";
          }).join("");
        }).catch(function () {});
      }, 250);
    }
    ph.addEventListener("input", function () { onPick(null); find(ph.value.replace(/\D/g, "").replace(/^7/, "")); });
    nm.addEventListener("input", function () { find(nm.value); });
    box.onclick = function (e) {
      var b = e.target.closest("button"); if (!b) return;
      ph.value = fmtPhone(b.getAttribute("data-ph")); nm.value = b.getAttribute("data-nm"); box.hidden = true;
      onPick({ id: +b.getAttribute("data-id"), name: b.getAttribute("data-nm"), rank: +b.getAttribute("data-rk") });
    };
    m.addEventListener("click", function (e) { if (!e.target.closest(".who")) box.hidden = true; });
  }
  function personAddModal() {
    modal("<h2>Новый участник</h2><form id=\"paf\" class=\"stack\">" + whoFields() +
      '<p class="hint">Обычно участники появляются сами — когда записываются по ссылке или их отмечают на мероприятии. Здесь можно добавить человека вручную, например чтобы выдать сертификат.</p>' +
      '<div class="actions"><button type="button" class="btn ghost" data-close>Отмена</button><button class="btn">Добавить</button></div></form>',
      function (m, close) {
        wireWho(m, function () {});
        m.querySelector("#paf").onsubmit = function (e) {
          e.preventDefault();
          api("person_add", { phone: v("w_phone"), name: v("w_name") }).then(function (r) {
            close(); toast(r.existed ? "Такой участник уже есть — открываем" : "Участник добавлен"); location.hash = "#/person/" + r.person.id;
          }).catch(fail);
        };
      });
  }
  function rankOpts(rank, ready, suggest) {
    var C = window.NespatCert, R = S.dict.ranks;
    return [1, 2, 3, 4, 5, 6, 7].map(function (i) {
      var have = i <= rank;
      return '<label class="opt' + (have ? " cur" : "") + '"><input type="radio" name="rk" value="' + i + '"' + (i === suggest ? " checked" : "") + ">" +
        "<span><b>" + ["I", "II", "III", "IV", "V", "VI", "VII"][i - 1] + " · " + esc(R[i].name) + (have ? " — уже есть" : i === ready ? " — набрал посещения" : "") + "</b><small>" +
        esc((C && C.rankById(i) ? C.rankById(i).reason : "")) + "</small></span></label>";
    }).join("");
  }
  // выдача — всегда из карточки участника: там видно посещения и путь званий
  function certModal(p) {
    var C = window.NespatCert, suggest = p.ready || Math.min(7, (+p.rank || 0) + 1);
    modal("<h2>Сертификат · " + esc(p.name) + "</h2><form id=\"cf\" class=\"stack\">" +
      '<fieldset class="opts" data-tour="c-rank"><legend>Звание</legend><div class="stack" style="gap:6px">' + rankOpts(+p.rank, p.ready, suggest) + "</div></fieldset>" +
      '<div class="grid2"><label class="f">Дата вручения<input type="date" id="c_date" value="' + todayIso() + '"></label>' +
      '<label class="f">Комментарий<input type="text" id="c_note" maxlength="120" placeholder="Необязательно"></label></div>' +
      '<p class="hint">Сертификат с защитой от подделки — та же система, что на сайте. Ссылку можно отправить участнику в Telegram, бланк — распечатать на А4.</p>' +
      '<div class="actions"><button type="button" class="btn ghost" data-close>Отмена</button><button class="btn">Выдать</button></div></form>',
      function (m, close) {
        m.querySelector("#cf").onsubmit = function (e) {
          e.preventDefault();
          if (!C) return toast("Модуль сертификатов не загрузился — обновите страницу");
          var rk = +m.querySelector('input[name="rk"]:checked').value, date = v("c_date") || todayIso(), note = v("c_note");
          var cert = C.build(p.name, rk, date, note), url = S.dict.cert_view + "#" + C.encodePayload(cert);
          api("cert_save", { person_id: p.id, rank: rk, date: date, note: note, number: cert.k, url: url }).then(function () {
            close(); certDone(p, rk, cert.k, url); viewPerson(p.id);
          }).catch(fail);
        };
      }, true);
  }
  // «Выдать сертификат» в реестре: выбрать или добавить участника → его карточка с открытым окном выдачи
  function certWhoModal() {
    modal("<h2>Кому выдаём сертификат?</h2><form id=\"cwf\" class=\"stack\">" + whoFields("c-who") +
      '<p class="hint">Начните вводить телефон или имя и выберите человека из подсказки. Если его ещё нет в базе — заполните оба поля, он добавится. Откроется карточка участника с окном выдачи.</p>' +
      '<div class="actions"><button type="button" class="btn ghost" data-close>Отмена</button><button class="btn">Дальше</button></div></form>',
      function (m, close) {
        var picked = null;
        wireWho(m, function (who) { picked = who; });
        m.querySelector("#cwf").onsubmit = function (e) {
          e.preventDefault();
          (picked ? Promise.resolve(picked) : api("person_add", { phone: v("w_phone"), name: v("w_name") }).then(function (r) { return r.person; }))
            .then(function (person) { close(); S.openCert = person.id; location.hash = "#/person/" + person.id; }).catch(fail);
        };
      });
  }
  function certDone(p, rk, number, url) {
    var text = "Твой сертификат клуба «НЕ СПАТЬ МОСКВА»: звание «" + rankName(rk) + "». Поздравляем!";
    modal("<h2>Сертификат выдан</h2><p style=\"margin:0\"><b>" + esc(p.name) + "</b> · " + esc(rankName(rk)) + '</p><p class="hint">Номер ' + esc(number) + "</p>" +
      '<div class="link"><code>' + esc(url) + '</code><button type="button" class="btn small" id="cc">Копировать</button></div>' +
      '<div class="actions"><a class="btn ghost" target="_blank" rel="noopener" href="' + esc(url) + '">Открыть бланк</a>' +
      '<a class="btn" target="_blank" rel="noopener" href="' + esc(tgShare(url, text)) + '">Отправить в Telegram</a></div>',
      function (m) { m.querySelector("#cc").onclick = function () { copy(url); }; });
  }

  // ---------- реестр сертификатов ----------
  var CQ = "";
  function viewCerts() {
    shell("certs", '<div class="empty">Загружаю…</div>');
    loadCerts(true);
  }
  function loadCerts(full) {
    api("certs", null, "&q=" + encodeURIComponent(CQ)).then(function (d) {
      var rows = d.certs.length ? '<div class="plist">' + d.certs.map(function (c) {
        return '<div class="pr crow"><span class="ava" style="background:var(--accent-soft);color:#ff8a80;font-family:var(--fd)">' + ["I", "II", "III", "IV", "V", "VI", "VII"][c.rank - 1] + "</span>" +
          '<div><a class="nm" href="#/person/' + c.person_id + '" style="text-decoration:none">' + esc(c.name) + '</a><div class="sub"><span class="chip rank">' + esc(rankName(+c.rank)) + "</span><span>" + esc(c.number) + "</span><span>" + esc(dateShort(c.date)) + "</span>" +
          (c.user_name ? "<span>выдал(а) " + esc(c.user_name) + "</span>" : "") + "</div></div>" +
          '<button type="button" class="dots" data-id="' + c.id + '" aria-label="Действия">⋯</button></div>';
      }).join("") + "</div>" : '<div class="card empty"><b>' + (CQ ? "Ничего не нашли" : "Сертификатов пока нет") + "</b>" +
        (CQ ? "" : "Нажмите «Выдать сертификат» и выберите участника — откроется его карточка с окном выдачи. Выданные сертификаты собираются здесь.") + "</div>";
      if (!full && document.getElementById("clist")) { document.getElementById("clist").innerHTML = rows; bindCerts(d.certs); return; }
      shell("certs",
        '<div class="head"><h1>Сертификаты</h1><button type="button" class="btn" id="cNew" data-tour="cert-new">Выдать сертификат</button></div>' +
        '<input type="search" class="search" id="cq" placeholder="Имя, телефон или номер сертификата" value="' + esc(CQ) + '">' +
        '<div id="clist">' + rows + "</div>" +
        '<p class="hint" style="margin-top:10px">Сертификат выдаётся из карточки участника — там видно, сколько у него посещений и до какого звания он дорос. «Выдать сертификат» сам откроет нужную карточку.</p>');
      document.getElementById("cNew").onclick = certWhoModal;
      var q = document.getElementById("cq"), t = null;
      q.oninput = function () { clearTimeout(t); t = setTimeout(function () { CQ = q.value.trim(); loadCerts(false); }, 250); };
      bindCerts(d.certs);
    }).catch(fail);
  }
  function bindCerts(list) {
    var box = document.getElementById("clist"); if (!box) return;
    box.onclick = function (e) {
      var b = e.target.closest(".dots"); if (!b) return;
      var c = list.filter(function (x) { return +x.id === +b.getAttribute("data-id"); })[0];
      var text = "Твой сертификат клуба «НЕ СПАТЬ МОСКВА»: звание «" + rankName(+c.rank) + "». Поздравляем!";
      openMenu(b, [
        { label: "Открыть бланк", href: c.url },
        { label: "Скопировать ссылку", fn: function () { copy(c.url); } },
        { label: "Отправить в Telegram", href: tgShare(c.url, text) },
        { label: "Карточка участника", href: "#/person/" + c.person_id },
      ]);
    };
  }

  // ---------- сводка ----------
  function tile(label, value, sub, tone) {
    return '<div class="tile' + (tone ? " " + tone : "") + '"><span class="tl">' + label + "</span><b>" + value + "</b>" + (sub ? '<span class="ts">' + sub + "</span>" : "") + "</div>";
  }
  function bars(obj, labels) {
    var keys = Object.keys(obj || {}).filter(function (k) { return obj[k] > 0; });
    if (!keys.length) return '<p class="muted" style="margin:0">Пока нет данных</p>';
    var max = Math.max.apply(null, keys.map(function (k) { return obj[k]; }));
    return keys.map(function (k) {
      return '<div class="hb"><span>' + esc(labels ? labels[k] || k : k) + '</span><div class="t"><i style="width:' + (obj[k] / max * 100) + '%"></i></div><b>' + obj[k] + "</b></div>";
    }).join("");
  }
  function viewStats(days) {
    shell("stats", '<div class="empty">Считаю…</div>');
    api("stats", null, "&days=" + days).then(function (d) {
      var att = d.reg ? Math.round(d.came / d.reg * 100) + " %" : "—";
      var ranks = {}; Object.keys(d.ranks).forEach(function (k) { ranks[k] = d.ranks[k]; });
      var rl = { 0: "Без звания" }; Object.keys(S.dict.ranks).forEach(function (k) { rl[k] = S.dict.ranks[k].name; });
      var maxE = Math.max.apply(null, [1].concat(d.last.map(function (e) { return +e.taken; })));
      shell("stats",
        '<div class="head"><h1>Сводка</h1><div class="tabs" id="per" data-tour="period" style="margin:0">' +
        [[30, "30 дней"], [90, "90 дней"], [365, "Год"], [0, "Всё время"]].map(function (t) { return '<button type="button" data-d="' + t[0] + '" class="' + (t[0] === days ? "on" : "") + '">' + t[1] + "</button>"; }).join("") + "</div></div>" +
        '<div class="tiles" data-tour="stats-tiles">' +
        tile("Мероприятий", d.events, "прошло за период") +
        tile("Пришли", d.came, "отметок посещения", "acc") +
        tile("Явка", att, "пришли из записавшихся", "ok") +
        tile("Активных", d.active, "были хотя бы раз") + "</div>" +
        '<div class="tiles">' +
        tile("Записей", d.reg, "на прошедшие мероприятия") +
        tile("Новых", d.new_people, "участников в базе") +
        tile("Всего", d.people_total, "участников в базе") +
        tile("Готовы к званию", d.ready.length, "можно выдать сертификат", d.ready.length ? "ok" : "") + "</div>" +
        "<h2>Последние мероприятия: записались и пришли</h2><div class=\"card\">" + (d.last.length ? d.last.map(function (e) {
          return '<div class="hb"><span>' + esc(dateShort(e.date)) + " · " + esc(e.title) + '</span><div class="t"><i class="reg" style="width:' + (e.taken / maxE * 100) + '%"></i><i style="width:' + (e.came / maxE * 100) + '%"></i></div><b>' + e.came + " <small>/ " + e.taken + "</small></b></div>";
        }).join("") + '<div class="leg"><span><i style="background:var(--accent)"></i>пришли</span><span><i style="background:var(--line2)"></i>записались</span></div>' : '<p class="muted" style="margin:0">Прошедших мероприятий за период нет</p>') + "</div>" +
        '<div class="grid2"><div><h2>Посещения по видам</h2><div class="card">' + bars(d.by_kind, S.dict.kinds) + "</div></div>" +
        '<div><h2>Звания в клубе</h2><div class="card">' + bars(ranks, rl) + "</div></div></div>" +
        '<div class="grid2"><div><h2>Самые активные</h2><div class="card">' + (d.top.length ? d.top.map(function (p, i) {
          return '<div class="hb" style="grid-template-columns:22px 1fr auto"><span class="muted">' + (i + 1) + '</span><a href="#/person/' + p.id + '" style="text-decoration:none">' + esc(p.name) + '</a><b>' + p.visits + "</b></div>";
        }).join("") : '<p class="muted" style="margin:0">Пока нет посещений</p>') + "</div></div>" +
        '<div><h2>Готовы к званию</h2><div class="card">' + (d.ready.length ? d.ready.map(function (p) {
          return '<div class="hb" style="grid-template-columns:1fr auto"><a href="#/person/' + p.id + '" style="text-decoration:none">' + esc(p.name) + '</a><span class="chip ready">' + esc(rankName(p.ready)) + "</span></div>";
        }).join("") : '<p class="muted" style="margin:0">Пока никто</p>') + "</div></div></div>" +
        '<div><h2>Откуда записи</h2><div class="card">' + bars(d.by_source, { site: "По ссылке на сайте", crm: "Добавили в штабе" }) + "</div></div>");
      document.getElementById("per").onclick = function (e) { var b = e.target.closest("button"); if (b) viewStats(+b.getAttribute("data-d")); };
    }).catch(fail);
  }

  // ---------- команда ----------
  var ROLE_HINT = {
    manager: "Мероприятия, записи, отметки «пришёл» и участники",
    head: "Всё, что у сержанта, плюс сертификаты, сводка, выгрузки и команда",
    dev: "Разработчик штаба: полный доступ, учётка одна",
  };
  function viewTeam() {
    shell("team", '<div class="empty">Загружаю…</div>');
    api("users").then(function (d) {
      var roles = S.dict.roles;
      shell("team",
        '<div class="head"><h1>Команда</h1><button type="button" class="btn" id="addUser" data-tour="add-user">+ Добавить</button></div>' +
        '<div class="people" id="people" data-tour="team-list">' + d.users.map(function (u) {
          return '<div class="person"><span class="ava ava-' + u.role + '">' + esc(initials(u.name)) + '</span><div class="pinfo"><div class="nm">' + esc(u.name) +
            (+u.id === +S.me.id ? ' <span class="muted small">· вы</span>' : "") + '</div><div class="meta"><b style="color:var(--ink);font-weight:500">' + esc(roles[u.role]) + "</b> · " +
            (u.phone ? '<a href="#/person/' + u.person_id + '" style="color:inherit">' + esc(fmtPhone(u.phone)) + "</a> · " : "") +
            (u.last_login ? "входил " + ago(u.last_login) : "ещё не входил") + "</div></div>" +
            '<div class="pact">' + (u.can_phone ? '<button type="button" class="link2" data-ph="' + u.id + '" data-name="' + esc(u.name) + '" data-cur="' + esc(u.phone || "") + '">' + (u.phone ? "Телефон" : "Указать телефон") + "</button>" : "") +
            (u.can_manage ? '<button type="button" class="link2" data-pin="' + u.id + '" data-name="' + esc(u.name) + '">Сменить PIN</button>' +
              '<button type="button" class="link2" data-del="' + u.id + '" data-name="' + esc(u.name) + '">Удалить</button>' : "") + "</div></div>";
        }).join("") + "</div>" +
        '<p class="hint" style="margin-top:10px">' + Object.keys(ROLE_HINT).reverse().map(function (r) { return "<b>" + esc(roles[r]) + "</b> — " + esc(ROLE_HINT[r].toLowerCase()); }).join(". ") + ".</p>");
      document.getElementById("addUser").onclick = addUserModal;
      document.getElementById("people").onclick = function (e) {
        var b = e.target.closest("button"); if (!b) return;
        var id = +(b.getAttribute("data-del") || b.getAttribute("data-pin") || b.getAttribute("data-ph")), name = b.getAttribute("data-name");
        if (b.hasAttribute("data-ph")) userPhoneModal(id, name, b.getAttribute("data-cur"));
        else if (b.hasAttribute("data-del")) deleteUserModal(id, name); else resetPinModal(id, name);
      };
    }).catch(fail);
  }
  function addUserModal() {
    var roles = S.dict.roles;
    var allowed = ["manager", "head"]; // Инженер — только учётка разработчика, её не создают
    modal("<h2>Новый человек в команде</h2><form id=\"uf\" class=\"stack\">" +
      '<div class="grid2" data-tour="u-phone"><label class="f">Имя и фамилия<input type="text" id="u_name" autocomplete="off" required placeholder="Например: Артём Ковалёв"></label>' +
      '<label class="f">Телефон<input type="tel" id="u_phone" required placeholder="+7 (___) ___-__-__"></label></div>' +
      '<p class="hint" style="margin-top:-6px">Человек из команды — тоже участник клуба: по телефону у него будет карточка с посещениями и званием. Если он уже есть в базе — учётка привяжется к нему.</p>' +
      '<fieldset class="opts" data-tour="u-role"><legend>Роль</legend>' + allowed.map(function (r) {
        return '<label class="opt"><input type="radio" name="u_role" value="' + r + '"' + (r === "manager" ? " checked" : "") + "><span><b>" + esc(roles[r]) + "</b><small>" + esc(ROLE_HINT[r]) + "</small></span></label>";
      }).join("") + "</fieldset>" +
      '<label class="f" data-tour="u-pin">Начальный PIN<input type="text" id="u_pin" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="6 цифр или оставьте пустым"></label>' +
      '<p class="hint">Пустое поле — PIN придумаем сами. При первом входе человек заменит его на свой.</p>' +
      '<div class="actions"><button type="button" class="btn ghost" data-close>Отмена</button><button class="btn">Добавить</button></div></form>',
      function (m, close) {
        maskPhone(m.querySelector("#u_phone"));
        m.querySelector("#uf").onsubmit = function (e) {
          e.preventDefault();
          var name = v("u_name"), role = m.querySelector('input[name="u_role"]:checked').value;
          api("user_create", { name: name, role: role, phone: v("u_phone"), pin: v("u_pin") }).then(function (r) { close(); pinModal("PIN для входа: " + name, r.pin); }).catch(fail);
        };
      });
  }
  function userPhoneModal(id, name, cur) {
    modal("<h2>Телефон — " + esc(name) + "</h2><form id=\"upf\" class=\"stack\">" +
      '<label class="f">Телефон<input type="tel" id="up_phone" required value="' + esc(cur ? fmtPhone(cur) : "") + '" placeholder="+7 (___) ___-__-__"></label>' +
      '<p class="hint">По телефону у человека из команды будет карточка участника — с посещениями, званием и сертификатами. Если он уже есть в базе, учётка привяжется к нему.</p>' +
      '<div class="actions"><button type="button" class="btn ghost" data-close>Отмена</button><button class="btn">Сохранить</button></div></form>',
      function (m, close) {
        maskPhone(m.querySelector("#up_phone"));
        m.querySelector("#upf").onsubmit = function (e) {
          e.preventDefault();
          api("user_phone", { id: id, phone: v("up_phone") }).then(function () { close(); toast("Телефон сохранён"); viewTeam(); }).catch(fail);
        };
      });
  }
  function resetPinModal(id, name) {
    modal("<h2>Новый PIN — " + esc(name) + "</h2><form id=\"rf\" class=\"stack\">" +
      '<label class="f">Временный PIN<input type="text" id="r_pin" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="6 цифр или оставьте пустым"></label>' +
      '<p class="hint">Старый PIN перестанет работать сразу, вход на всех устройствах сбросится. При входе человек задаст свой.</p>' +
      '<div class="actions"><button type="button" class="btn ghost" data-close>Отмена</button><button class="btn">Сменить</button></div></form>',
      function (m, close) {
        m.querySelector("#rf").onsubmit = function (e) {
          e.preventDefault();
          api("user_pin_reset", { id: id, pin: v("r_pin") }).then(function (r) { close(); pinModal("Новый PIN — " + name, r.pin); }).catch(fail);
        };
      });
  }
  function deleteUserModal(id, name) {
    modal("<h2>Удалить из команды?</h2><p style=\"margin:0\"><b>" + esc(name) + "</b></p>" +
      '<p class="hint">Доступ пропадёт сразу. Отметки и действия этого человека в журнале сохранятся.</p>' +
      '<div class="actions"><button type="button" class="btn ghost" data-close>Отмена</button><button type="button" class="btn" id="dOk">Удалить</button></div>',
      function (m, close) {
        m.querySelector("#dOk").onclick = function () { api("user_delete", { id: id }).then(function () { close(); toast("Удалён из команды"); viewTeam(); }).catch(fail); };
      });
  }
  function pinModal(title, pin) {
    modal("<h2>" + esc(title) + '</h2><div class="bigpin">' + esc(pin.slice(0, 3) + " " + pin.slice(3)) + "</div>" +
      '<p class="hint">Передайте PIN лично — больше он нигде не показывается. Вход: ' + esc(location.origin + location.pathname) + "</p>" +
      '<div class="actions"><button type="button" class="btn" data-close>Готово</button></div>');
    viewTeam();
  }

  // ---------- профиль ----------
  function viewMe() {
    shell("me",
      '<div class="card prof"><span class="big">' + esc(initials(S.me.name)) + "</span><div><h1>" + esc(S.me.name) + '</h1><span class="muted">' + esc(S.dict.roles[S.me.role]) + "</span></div></div>" +
      '<div class="row" style="margin-top:14px"><button type="button" class="btn ghost" id="chpin">Сменить PIN</button>' +
      '<button type="button" class="btn ghost" id="tourAgain">Обучение и подсказки</button><button type="button" class="btn danger" id="out">Выйти</button></div>');
    document.getElementById("chpin").onclick = function () { showChangePin(false); };
    document.getElementById("tourAgain").onclick = helpCenter;
    document.getElementById("out").onclick = function () { api("logout", {}).then(function () { S.me = null; showPin(); }).catch(fail); };
  }

  // ---------- обучение: центр помощи и подсказки с подсветкой блоков ----------
  // Шаг: sel — какой блок подсветить ([data-tour=…]), go — какой экран открыть,
  // open — какое окно открыть на время шага (form/cert/user), need — право роли.
  var TI = {
    hi: '<path d="M12 2.5 14.6 8l6 .6-4.5 4 1.3 5.9L12 15.5l-5.4 3 1.3-5.9-4.5-4 6-.6L12 2.5Z"/>',
    cal: ICON.events, people: ICON.people, stats: ICON.stats, team: ICON.team,
    plus: '<path d="M12 5v14M5 12h14"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    medal: '<circle cx="12" cy="14" r="6"/><path d="M8.5 3h7l-2 5.5h-3L8.5 3ZM12 11.5v5M9.8 14h4.4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.9M12 16.8v.2"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  };
  var TOPICS = {
    main: { icon: "hi", title: "Обзор штаба", sub: "Что где находится — за минуту", steps: [
      { icon: "hi", title: "Добро пожаловать в штаб", text: "Здесь клуб ведёт мероприятия, записи и участников: кто записался, кто пришёл, кто дорос до нового звания. Пройдёмся по главному — это займёт минуту." },
      { sel: "nav-events", go: "#/", icon: "cal", title: "Мероприятия", text: "Тренировки, забеги, турниры и сборы. С этого экрана начинается работа: создаёте мероприятие и отправляете ссылку на запись." },
      { sel: "new-event", go: "#/", icon: "plus", title: "Новое мероприятие", text: "Кнопка создания. Вид, дата, время, место и число мест — и через минуту у вас готовая ссылка для Telegram-канала." },
      { sel: "ev-list", go: "#/", icon: "cal", title: "Карточки мероприятий", text: "На каждой — дата, время, место, статус записи и сколько человек уже записалось. Нажмите на карточку, чтобы открыть список и отмечать пришедших." },
      { sel: "nav-people", go: "#/people", icon: "people", title: "Участники", text: "Каждый человек — по номеру телефона. В его карточке все мероприятия, посещения, звание и выданные сертификаты." },
      { sel: "ready", go: "#/people", icon: "medal", title: "Готовы к званию", text: "Штаб сам считает посещения и подсказывает, кто набрал 10, 30 или 100 тренировок." },
      { sel: "plist", go: "#/people", need: "certs", icon: "medal", title: "Сертификат — из карточки", text: "Откройте участника и нажмите «Выдать сертификат»: в карточке видно его посещения и путь званий, штаб сам отметит следующее звание. Ссылку на сертификат — сразу в Telegram." },
      { sel: "nav-certs", go: "#/certs", need: "certs", icon: "medal", title: "Сертификаты", text: "Реестр всех выданных сертификатов: кому, какое звание, номер, кто выдал. Кнопка «Выдать сертификат» откроет карточку нужного участника." },
      { sel: "nav-stats", go: "#/stats", need: "stats", icon: "stats", title: "Сводка", text: "Явка, активные участники, звания, самые активные — за 30 дней, год или всё время." },
      { sel: "nav-team", go: "#/team", need: "team", icon: "team", title: "Команда", text: "Здесь добавляют Сержантов и Командиров. У каждого свой PIN, при первом входе его попросят сменить." },
      { sel: "help", icon: "help", title: "Помощь всегда рядом", text: "Кнопка «?» открывает центр помощи: короткие пошаговые подсказки по любой задаче — создать мероприятие, отметить пришедших, выдать сертификат." },
    ] },
    create: { icon: "plus", title: "Как создать мероприятие", sub: "Вид, дата, место и места", need: "events", steps: [
      { sel: "new-event", go: "#/", icon: "plus", title: "Кнопка создания", text: "Мероприятие создаётся отсюда. Сейчас откроем форму и пройдёмся по полям — ничего не сохранится, пока вы сами не нажмёте «Создать»." },
      { sel: "f-kind", open: "form", icon: "flag", title: "Вид мероприятия", text: "Выберите один вариант: тренировка, бокс, бег, турнир, сбор… Вид виден участнику и считается в сводке." },
      { sel: "f-when", open: "form", icon: "clock", title: "Дата и время", text: "Дата и время начала обязательны, время окончания — по желанию. Пока мероприятие не прошло, на него открыта запись." },
      { sel: "f-place", open: "form", icon: "pin", title: "Место", text: "Напишите так, чтобы новичок нашёл: «Парк Горького, площадка у Пионерского пруда». Ниже можно добавить адрес и ссылку на карту." },
      { sel: "f-cap", open: "form", icon: "people", title: "Сколько мест", text: "Если мест ограниченно — укажите число: когда места кончатся, запись закроется сама. Пусто — без ограничений." },
      { icon: "check", title: "Готово", text: "Нажмите «Создать» — откроется карточка мероприятия со ссылкой на запись, кнопкой отправки в Telegram и QR-кодом." },
    ] },
    share: { icon: "link", title: "Как пригласить на мероприятие", sub: "Ссылка, Telegram и QR-код", needs: "event", steps: [
      { sel: "share", icon: "link", title: "Ссылка на запись", text: "Скопируйте ссылку или нажмите «Отправить в Telegram» и выберите канал клуба. Участник откроет страницу, введёт имя и телефон — и сразу окажется в списке." },
      { sel: "share", icon: "link", title: "QR-код для площадки", text: "Кнопка «QR-код» открывает код крупно — его можно распечатать и повесить на месте тренировки: новички запишутся с телефона за 10 секунд." },
      { sel: "ev-stats", icon: "people", title: "Сколько записалось", text: "Счётчики обновляются сами: записались, пришли и сколько мест осталось." },
      { sel: "ev-actions", icon: "lock", title: "Закрыть или изменить", text: "«Закрыть запись» — когда набрали группу. «Изменить» — поменять время или место. В меню «⋯» — выгрузка списка в Excel и отмена мероприятия." },
    ] },
    attend: { icon: "check", title: "Как отметить пришедших", sub: "Отметки на тренировке", needs: "event", steps: [
      { sel: "regs", icon: "check", title: "Список записавшихся", text: "На тренировке нажимайте «Отметить» у каждого пришедшего — кнопка станет зелёной. Ошиблись — нажмите ещё раз, отметка снимется." },
      { sel: "add", icon: "plus", title: "Пришёл без записи", text: "Введите телефон — если человек уже есть в базе, штаб подскажет его. Кнопка «Пришёл» сразу добавит и отметит, «Записать» — только запишет." },
      { sel: "ev-stats", icon: "medal", title: "Из отметок — звания", text: "Каждая отметка — посещение в карточке участника. Набрал 10, 30 или 100 — штаб подскажет выдать новое звание." },
    ] },
    cert: { icon: "medal", title: "Как выдать сертификат", sub: "Из карточки участника", need: "certs", needs: "person", steps: [
      { sel: "path", icon: "medal", title: "Путь бойца", text: "Сертификат выдаётся в карточке участника. Красным подсвечены полученные звания, зелёной рамкой — то, до которого человек дорос по посещениям." },
      { sel: "cert", icon: "medal", title: "Кнопка выдачи", text: "Откроем окно — ничего не выдастся, пока вы сами не нажмёте «Выдать»." },
      { sel: "c-rank", open: "cert", icon: "flag", title: "Звание", text: "Штаб заранее отметит следующее звание. Защитника, Наставника и Легенду дают по решению команды." },
      { icon: "check", title: "Отправьте ссылку", text: "После «Выдать» появится ссылка на именной сертификат с защитой от подделки — отправьте её в Telegram. Все выданные сертификаты — в разделе «Сертификаты»." },
    ] },
    people: { icon: "people", title: "Как найти участника", sub: "Поиск и фильтры", steps: [
      { sel: "search", go: "#/people", icon: "search", title: "Поиск", text: "Ищите по имени или по любой части телефона — список обновляется на ходу." },
      { sel: "person-new", go: "#/people", icon: "plus", title: "Добавить вручную", text: "Обычно участники появляются сами — из записи по ссылке и отметок на мероприятиях. «+ Участник» — если нужно завести человека сразу, например чтобы выдать ему сертификат." },
      { sel: "ready", go: "#/people", icon: "medal", title: "Фильтры", text: "«Готовы к званию» — кому пора выдать сертификат. «Давно не были» — кого стоит позвать снова: последнее посещение больше трёх недель назад." },
      { sel: "plist", go: "#/people", icon: "people", title: "Карточка участника", text: "Нажмите на человека — откроются его мероприятия, посещения, звание и сертификаты. Там же можно поправить имя, телефон и добавить заметку." },
    ] },
    team: { icon: "team", title: "Как добавить человека в команду", sub: "Роли и PIN", need: "team", steps: [
      { sel: "add-user", go: "#/team", icon: "plus", title: "Добавить в команду", text: "Сержанты ведут мероприятия и отметки, Командиры — ещё и сертификаты, сводку и команду." },
      { sel: "u-phone", go: "#/team", open: "user", icon: "people", title: "Имя и телефон", text: "Телефон обязателен: человек из команды — тоже участник клуба. По номеру у него появится карточка с посещениями, званием и сертификатами; если он уже записывался — учётка привяжется к его карточке." },
      { sel: "u-role", go: "#/team", open: "user", icon: "team", title: "Роль", text: "Выберите роль — под каждой написано, что она может. Права можно поменять, только пересоздав человека, поэтому выбирайте по задачам." },
      { sel: "u-pin", go: "#/team", open: "user", icon: "lock", title: "Начальный PIN", text: "Оставьте пустым — штаб придумает сам. Передайте PIN лично: при первом входе человек сменит его на свой." },
      { sel: "team-list", go: "#/team", icon: "team", title: "Команда", text: "Здесь видно, кто когда входил. Забыл PIN — «Сменить PIN» выдаст новый временный; ушёл из клуба — «Удалить», доступ пропадёт сразу." },
    ] },
    stats: { icon: "stats", title: "Как читать сводку", sub: "Явка и активность", need: "stats", steps: [
      { sel: "period", go: "#/stats", icon: "clock", title: "Период", text: "Выберите, за какое время считать: 30 дней, 90 дней, год или всё время." },
      { sel: "stats-tiles", go: "#/stats", icon: "stats", title: "Главные цифры", text: "Явка — сколько пришло из записавшихся на прошедшие мероприятия. Активные — кто был хотя бы раз за период. Ниже — по видам, званиям и самые активные." },
    ] },
  };
  var PERSON_TIPS = [
    { sel: "path", icon: "medal", title: "Путь бойца", text: "Красным подсвечены полученные звания, зелёной рамкой — то, до которого человек уже дорос по посещениям." },
    { sel: "cert", need: "certs", icon: "medal", title: "Выдать сертификат", text: "Звание и именной сертификат — отсюда. Все выданные сертификаты собраны в разделе «Сертификаты»." },
  ];
  var SCREEN = { event: ["share", "attend"], person: ["cert"], people: ["people"], team: ["team"], stats: ["stats"], certs: ["cert"] };

  function svgI(name) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (TI[name] || TI.hi) + "</svg>"; }
  function allowed(t) { return !t.need || S.can[t.need]; }

  // Центр помощи: темы по задачам, сверху — подсказки к открытому экрану
  function helpCenter() {
    var here = (SCREEN[current] || []).filter(function (k) { return allowed(TOPICS[k]); });
    var keys = ["main", "create", "share", "attend", "cert", "people", "team", "stats"].filter(function (k) { return allowed(TOPICS[k]); });
    function card(k, hot) {
      var t = TOPICS[k];
      return '<button type="button" class="topic' + (hot ? " hot" : "") + '" data-k="' + k + '"><span class="ti">' + svgI(t.icon) + "</span>" +
        "<span><b>" + esc(t.title) + "</b><small>" + esc(t.sub) + " · " + plural(t.steps.length, "шаг", "шага", "шагов") + "</small></span><i>›</i></button>";
    }
    modal('<div class="hc-head"><span class="ti big">' + svgI("help") + "</span><div><h2>Центр помощи</h2>" +
      '<p class="hint">Выберите задачу — штаб сам откроет нужный экран и покажет, что нажимать.</p></div></div>' +
      (here.length ? '<div class="hc-sec">На этом экране</div><div class="topics">' + here.map(function (k) { return card(k, true); }).join("") + "</div>" : "") +
      '<div class="hc-sec">Все подсказки</div><div class="topics">' + keys.filter(function (k) { return here.indexOf(k) < 0; }).map(function (k) { return card(k); }).join("") + "</div>" +
      '<div class="actions"><button type="button" class="btn ghost" data-close>Закрыть</button></div>',
      function (m, close) {
        m.querySelector(".dialog").onclick = function (e) {
          var b = e.target.closest(".topic"); if (!b) return;
          close(); runTopic(b.getAttribute("data-k"));
        };
      }, true);
  }

  // Тема, которой нужен конкретный экран (мероприятие или участник), сама находит пример
  function runTopic(key) {
    var t = TOPICS[key];
    if (!t.needs || current === t.needs) return startTour(t.steps, true);
    var isEv = t.needs === "event";
    api(isEv ? "events" : "people", null, isEv ? "&scope=all" : "&f=all").then(function (d) {
      var list = isEv ? d.events : d.people, pick = null;
      if (isEv) list.forEach(function (e) { if (!pick && !e.past && e.status !== "cancelled") pick = e; });
      pick = pick || list[0];
      if (!pick) {
        return startTour([isEv
          ? { sel: "new-event", go: "#/", icon: "plus", title: "Сначала нужно мероприятие", text: "Эта подсказка показывается на карточке мероприятия. Создайте первое мероприятие кнопкой «+ Мероприятие» — и запустите её снова." }
          : { sel: "person-new", go: "#/people", icon: "people", title: "Сначала нужен участник", text: "Сертификат выдаётся из карточки участника. Участники появляются сами из записей и отметок — или добавьте человека кнопкой «+ Участник», откройте его карточку и нажмите «Выдать сертификат»." }], true);
      }
      S.topicRun = true;
      location.hash = (isEv ? "#/event/" : "#/person/") + pick.id;
      waitFor(t.steps[0].sel, function () { S.topicRun = false; startTour(t.steps, true); });
    }).catch(fail);
  }
  function waitFor(sel, cb) {
    var n = 0;
    (function tick() {
      if (!sel || document.querySelector('[data-tour="' + sel + '"]') || n++ > 40) return cb();
      setTimeout(tick, 100);
    })();
  }
  function maybeTour(kind) {
    var key = "nsm_tour_" + kind + "_" + S.me.id;
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, "1"); } catch (e) { return; }
    if (!S.me.tour_done || tourEl || S.topicRun || document.querySelector(".modal")) { try { localStorage.removeItem(key); } catch (e) {} return; } // сначала — общий обзор; идущую тему и открытое окно не перебиваем
    var steps = kind === "event" ? TOPICS.share.steps.slice(0, 1).concat(TOPICS.attend.steps.slice(0, 2)) : PERSON_TIPS.filter(function (x) { return !x.need || S.can[x.need]; });
    setTimeout(function () {
      // поверх открытого окна подсказку не показываем — покажем при следующем визите
      if (tourEl || S.topicRun) return;
      if (document.querySelector(".modal")) { try { localStorage.removeItem(key); } catch (e) {} return; }
      startTour(steps, true, "Подсказка для нового экрана");
    }, 400);
  }

  var tourEl = null;
  function startTour(steps, manual, kicker) {
    steps = steps.filter(function (s) { return !s.need || S.can[s.need]; });
    if (!steps.length) return;
    endTour();
    var i = 0, openedModal = null;
    tourEl = document.createElement("div");
    tourEl.className = "tour";
    tourEl.innerHTML = '<div class="hole"></div><div class="tip" role="dialog" aria-modal="true" aria-live="polite"><span class="arrow"></span><div class="tbody"></div></div>';
    document.body.appendChild(tourEl);
    var hole = tourEl.querySelector(".hole"), tip = tourEl.querySelector(".tip"), body = tourEl.querySelector(".tbody"), arrow = tourEl.querySelector(".arrow");
    function closeOpened() { if (openedModal && document.body.contains(openedModal)) openedModal.remove(); openedModal = null; }
    function finish() {
      closeOpened(); endTour();
      if (!manual || !S.me.tour_done) { S.me.tour_done = true; api("tour_done", {}).catch(function () {}); }
    }
    function target(s) {
      var el = null;
      if (s.sel) [].some.call(document.querySelectorAll('[data-tour="' + s.sel + '"]'), function (x) {
        if (x.offsetParent !== null || getComputedStyle(x).position === "fixed") { el = x; return true; }
      });
      return el;
    }
    function place() {
      var s = steps[i], el = target(s), tw = Math.min(360, innerWidth - 24), th = tip.offsetHeight || 220;
      tip.style.width = tw + "px";
      if (!el) {
        hole.className = "hole none"; hole.style.cssText = ""; arrow.className = "arrow";
        tip.style.left = (innerWidth - tw) / 2 + "px"; tip.style.top = Math.max(12, innerHeight / 2 - th / 2) + "px";
        return;
      }
      var r = el.getBoundingClientRect();
      if (r.top < 70 || r.bottom > innerHeight - 90) { el.scrollIntoView({ block: "center" }); r = el.getBoundingClientRect(); }
      var pad = 6, below = r.bottom + 16 + th < innerHeight - 8, above = r.top - th - 16 > 8;
      hole.className = "hole";
      hole.style.cssText = "left:" + (r.left - pad) + "px;top:" + (r.top - pad) + "px;width:" + (r.width + pad * 2) + "px;height:" + (r.height + pad * 2) + "px";
      var left = Math.max(12, Math.min(innerWidth - tw - 12, r.left + r.width / 2 - tw / 2));
      var top = below ? r.bottom + 16 : above ? r.top - th - 16 : Math.max(12, innerHeight - th - 12);
      tip.style.left = left + "px"; tip.style.top = top + "px";
      arrow.className = "arrow" + (below ? " up" : above ? " down" : "");
      arrow.style.left = Math.max(18, Math.min(tw - 30, r.left + r.width / 2 - left - 6)) + "px";
    }
    function show() {
      var s = steps[i], last = i === steps.length - 1;
      body.innerHTML =
        '<div class="th"><span class="ti">' + svgI(s.icon) + '</span><span class="k">' + esc(kicker || (steps.length > 1 ? "Шаг " + (i + 1) + " из " + steps.length : "Подсказка")) + "</span>" +
        '<button type="button" class="x" data-t="skip" aria-label="Закрыть подсказки">×</button></div>' +
        "<h3>" + esc(s.title) + "</h3><p>" + esc(s.text) + "</p>" +
        (steps.length > 1 ? '<div class="prog"><i style="width:' + ((i + 1) / steps.length * 100) + '%"></i></div>' : "") +
        '<div class="tf"><span class="keys">' + (matchMedia("(hover: hover)").matches ? "← → для перехода, Esc — закрыть" : "") + "</span>" +
        '<div class="row">' + (i ? '<button type="button" class="btn ghost small" data-t="back">Назад</button>' : "") +
        '<button type="button" class="btn small" data-t="next">' + (last ? "Понятно" : "Далее") + "</button></div></div>";
      // нужный экран и окно для шага
      if (!s.open && openedModal) closeOpened();
      var go = s.go && location.hash !== s.go && !(s.go === "#/" && (location.hash === "" || location.hash === "#")) ? s.go : null;
      if (go) { closeOpened(); location.hash = go; }
      waitFor(go ? (s.open ? null : s.sel) : null, function () {
        if (s.open && !document.querySelector(".modal")) {
          var before = document.querySelectorAll(".modal").length;
          if (s.open === "form") eventModal(null);
          else if (s.open === "user") addUserModal();
          else if (s.open === "cert") { var b = document.getElementById("pCert"); if (b) b.click(); }
          var ms = document.querySelectorAll(".modal");
          if (ms.length > before) openedModal = ms[ms.length - 1];
        }
        waitFor(s.sel, function () { setTimeout(place, 30); });
      });
      tip.classList.remove("in"); void tip.offsetWidth; tip.classList.add("in");
      var nb = body.querySelector('[data-t="next"]'); if (nb && matchMedia("(hover: hover)").matches) nb.focus();
    }
    tip.onclick = function (e) {
      var b = e.target.closest("[data-t]"); if (!b) return;
      var t = b.getAttribute("data-t");
      if (t === "next") { if (i >= steps.length - 1) return finish(); i++; show(); }
      else if (t === "back") { i = Math.max(0, i - 1); show(); }
      else finish();
    };
    tourEl._onKey = function (e) {
      if (e.key === "Escape") { e.stopPropagation(); finish(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); if (i >= steps.length - 1) finish(); else { i++; show(); } }
      else if (e.key === "ArrowLeft" && i) { i--; show(); }
    };
    tourEl._onResize = function () { place(); };
    document.addEventListener("keydown", tourEl._onKey, true);
    window.addEventListener("resize", tourEl._onResize);
    window.addEventListener("scroll", tourEl._onResize, { passive: true });
    show();
  }
  function endTour() {
    if (!tourEl) return;
    document.removeEventListener("keydown", tourEl._onKey, true);
    window.removeEventListener("resize", tourEl._onResize);
    window.removeEventListener("scroll", tourEl._onResize);
    tourEl.remove(); tourEl = null;
  }

  boot();
})();
