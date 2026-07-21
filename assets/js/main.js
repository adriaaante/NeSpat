(() => {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Навигация ---------- */
  const nav = document.getElementById("nav");
  const burger = document.getElementById("navBurger");
  const navLinks = document.getElementById("navLinks");

  const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 24);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  burger.addEventListener("click", () => {
    const open = navLinks.classList.toggle("is-open");
    burger.setAttribute("aria-expanded", String(open));
    burger.setAttribute("aria-label", open ? "Закрыть меню" : "Открыть меню");
  });
  navLinks.addEventListener("click", (e) => {
    if (e.target.closest("a")) {
      navLinks.classList.remove("is-open");
      burger.setAttribute("aria-expanded", "false");
    }
  });

  /* ---------- Появление блоков при скролле ---------- */
  const revealObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    }
  }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
  document.querySelectorAll(".reveal").forEach((el) => revealObserver.observe(el));

  /* ---------- Параллакс героя ---------- */
  const heroBg = document.getElementById("heroBg");
  if (heroBg && !reducedMotion) {
    let ticking = false;
    window.addEventListener("scroll", () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = Math.min(window.scrollY, window.innerHeight);
        heroBg.style.transform = `translateY(${y * 0.25}px)`;
        ticking = false;
      });
    }, { passive: true });
  }

  /* ---------- Галерея: автоплей превью-видео в кадре ---------- */
  const videos = document.querySelectorAll(".gallery__item video");
  if (!reducedMotion) {
    const videoObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const v = entry.target;
        if (entry.isIntersecting) v.play().catch(() => {});
        else v.pause();
      }
    }, { threshold: 0.35 });
    videos.forEach((v) => videoObserver.observe(v));
  }

  /* ---------- Лайтбокс ---------- */
  const lightbox = document.getElementById("lightbox");
  const lightboxContent = document.getElementById("lightboxContent");
  const lightboxClose = document.getElementById("lightboxClose");

  const openLightbox = (node) => {
    lightboxContent.replaceChildren(node);
    lightbox.showModal();
  };
  const closeLightbox = () => {
    lightbox.close();
    lightboxContent.replaceChildren();
  };
  lightboxClose.addEventListener("click", closeLightbox);
  lightbox.addEventListener("click", (e) => { if (e.target === lightbox) closeLightbox(); });
  lightbox.addEventListener("close", () => lightboxContent.replaceChildren());

  document.querySelectorAll(".gallery__item").forEach((item) => {
    item.addEventListener("click", () => {
      const video = item.querySelector("video");
      if (video) {
        const full = document.createElement("video");
        full.src = video.dataset.full || video.src;
        full.poster = video.poster;
        full.controls = true;
        full.autoplay = true;
        full.playsInline = true;
        openLightbox(full);
      } else {
        const img = item.querySelector("img");
        const big = document.createElement("img");
        big.src = img.src;
        big.alt = img.alt;
        openLightbox(big);
      }
    });
  });

  /* ---------- Маска телефона ---------- */
  const phoneInput = document.getElementById("phone");
  const formatPhone = (digits) => {
    let d = digits.replace(/\D/g, "");
    if (d.startsWith("8")) d = "7" + d.slice(1);
    if (!d.startsWith("7")) d = "7" + d;
    d = d.slice(0, 11);
    let out = "+7";
    if (d.length > 1) out += " (" + d.slice(1, 4);
    if (d.length >= 4) out += ") " + d.slice(4, 7);
    if (d.length >= 7) out += "-" + d.slice(7, 9);
    if (d.length >= 9) out += "-" + d.slice(9, 11);
    return out;
  };
  phoneInput.addEventListener("input", () => {
    const v = phoneInput.value.replace(/\D/g, "");
    phoneInput.value = v ? formatPhone(v) : "";
  });

  /* ---------- Форма → Telegram ---------- */
  const form = document.getElementById("joinForm");
  const submitBtn = document.getElementById("formSubmit");
  const status = document.getElementById("formStatus");
  const cfg = window.NESPAT_CONFIG || {};

  const setStatus = (text, ok) => {
    status.textContent = text;
    status.classList.toggle("is-ok", !!ok);
    status.classList.toggle("is-err", ok === false);
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (form.company.value) return; // honeypot: боты заполняют скрытое поле

    const name = form.name.value.trim();
    const phoneDigits = phoneInput.value.replace(/\D/g, "");
    form.name.classList.toggle("is-invalid", !name);
    phoneInput.classList.toggle("is-invalid", phoneDigits.length !== 11);
    if (!name) { setStatus("Напиши, как тебя зовут.", false); return; }
    if (phoneDigits.length !== 11) { setStatus("Проверь номер телефона — нужно 11 цифр.", false); return; }

    if (!cfg.telegramBotToken || !cfg.telegramChatId) {
      const url = cfg.telegramFallbackUrl || "https://t.me/";
      setStatus("Приём заявок настраивается. Напиши нам в Telegram — ответим сразу!", false);
      window.open(url, "_blank", "noopener");
      return;
    }

    submitBtn.disabled = true;
    setStatus("Отправляем заявку…", true);
    const text = [
      "🔥 Новая заявка с сайта НЕ СПАТЬ МОСКВА",
      `Имя: ${name}`,
      `Телефон: ${phoneInput.value}`,
    ].join("\n");

    try {
      const res = await fetch(`https://api.telegram.org/bot${cfg.telegramBotToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: cfg.telegramChatId, text }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.description || "sendMessage failed");
      form.reset();
      setStatus("Заявка в клубе! Скоро позвоним и позовём на тренировку 💪", true);
    } catch {
      setStatus("Не получилось отправить. Попробуй ещё раз или напиши нам в Telegram.", false);
    } finally {
      submitBtn.disabled = false;
    }
  });

  /* ---------- Год в подвале ---------- */
  document.getElementById("year").textContent = String(new Date().getFullYear());
})();
