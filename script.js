/* ============================================================
 * SCRIPT.JS — ДВИЖОК ТРЕНАЖЁРА ПО МАТЕМАТИКЕ (6 И 7 КЛАССЫ)
 * ============================================================
 * 1. Форматирование математических формул и дробей (KaTeX)
 * 2. Нормализация и проверка математических ответов
 * 3. Управление состоянием (State), таймером с паузой и длительностью
 * 4. Рендеринг карточек заданий и разбора решений (Explanations)
 * 5. Официальные шкалы оценивания ВПР (6 и 7 классы) и генератор
 * 6. Интеграция с Telegram Bot API и экспорт отчётов
 * ============================================================ */

"use strict";

// Глобальное состояние приложения
const appState = {
  studentName: "",
  variantKey: "K-1",
  slides: [],
  currentSlide: 0,
  startTime: null,
  results: null,
  isVPR: false,
  timerInterval: null,
  timerRemainingSec: 3600,
  timerTotalSec: 3600,
  isTimerEnabled: false,
  isPaused: false,
  timerDurationConfig: "auto" // 'auto', 'none', '15', '30', '45', '60', '90'
};

// Селекторы DOM
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ============================================================
 * 1. ФОРМАТИРОВАНИЕ ДРОБЕЙ И ФОРМУЛ (KATEX + FALLBACK)
 * ============================================================ */

function safeKatex(tex, display = false) {
  if (typeof katex !== "undefined" && typeof katex.renderToString === "function") {
    try {
      return katex.renderToString(tex, {
        displayMode: display,
        throwOnError: false,
        strict: false
      });
    } catch (err) {
      console.warn("KaTeX render error:", err);
      return tex;
    }
  }
  return tex;
}

function findMatchingBrace(str, startIndex) {
  let depth = 0;
  for (let i = startIndex; i < str.length; i++) {
    if (str[i] === "{") depth++;
    else if (str[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function replaceFractions(text, protect) {
  let idx = 0;
  while ((idx = text.indexOf("\\frac{", idx)) !== -1) {
    let prefix = text.substring(0, idx);
    let matchMixed = prefix.match(/([-−]?\s*\d+)\s*$/);
    let whole = matchMixed ? matchMixed[1] : "";
    let startReplace = matchMixed ? idx - matchMixed[0].length : idx;

    let numStart = idx + 6;
    let numEnd = findMatchingBrace(text, numStart - 1);
    if (numEnd === -1) { idx += 6; continue; }

    let afterNum = text.substring(numEnd + 1);
    let denBrace = afterNum.search(/\S/);
    if (denBrace === -1 || afterNum[denBrace] !== "{") { idx = numEnd + 1; continue; }

    let denStart = numEnd + 1 + denBrace + 1;
    let denEnd = findMatchingBrace(text, denStart - 1);
    if (denEnd === -1) { idx = numEnd + 1; continue; }

    let num = text.substring(numStart, numEnd);
    let den = text.substring(denStart, denEnd);

    let texFormula = whole ? `${whole.trim()}\\frac{${num.trim()}}{${den.trim()}}` : `\\frac{${num.trim()}}{${den.trim()}}`;
    let rendered = protect(safeKatex(texFormula, false));

    text = text.substring(0, startReplace) + rendered + text.substring(denEnd + 1);
    idx = startReplace + rendered.length;
  }
  return text;
}

function formatMath(text) {
  if (!text || typeof text !== "string") return text;

  // 1. Защита HTML тегов, URL-адресов и физических единиц со слешем (км/ч, м/с)
  const placeholders = [];
  const protect = (str) => {
    placeholders.push(str);
    return "___PL_" + (placeholders.length - 1) + "___";
  };

  text = text.replace(/<[^>]+>/g, protect);
  text = text.replace(/https?:\/\/[^\s"'<>]+/g, protect);
  text = text.replace(
    /\b(км|м|см|мм|дм|кг|г|т|л|мл|руб|коп|об|сек|с|мин|ч)\s*\/\s*(км|м|см|мм|дм|кг|г|т|л|мл|руб|коп|об|сек|с|мин|ч|см³|м³|шт)\b/gi,
    protect
  );

  // Очистка лишних круглых скобок вокруг математических формул: ($C = 2\pi r$) -> $C = 2\pi r$
  text = text.replace(/\(\s*\$([^$]+)\$\s*\)/g, "$$$1$$");
  text = text.replace(/\(\s*\\\((\\[^()]+)\\\)\s*\)/g, "\\($1\\)");
  text = text.replace(/\(\s*([A-Za-z]\s*=\s*[^()]*\\(?:pi|frac)[^()]*)\s*\)/g, "$1");

  const hasKaTeX = typeof katex !== "undefined" && typeof katex.renderToString === "function";

  if (hasKaTeX) {
    // 2. Явный выключной math: $$...$$ или \[...\]
    text = text.replace(/\$\$([^$]+)\$\$/g, (m, tex) => protect(safeKatex(tex.trim(), true)));
    text = text.replace(/\\\[([\s\S]+?)\\\]/g, (m, tex) => protect(safeKatex(tex.trim(), true)));

    // 3. Явный внутритекстовый math: $...$ или \(...\)
    text = text.replace(/\$([^$]+)\$/g, (m, tex) => protect(safeKatex(tex.trim(), false)));
    text = text.replace(/\\\(([\s\S]+?)\\\)/g, (m, tex) => protect(safeKatex(tex.trim(), false)));

    // 4. Дроби любой степени вложенности и смешанные числа с LaTeX: \frac{a}{b}, 3\frac{1}{2}
    text = replaceFractions(text, protect);

    // 5. Формулы с числом Пи или спецсимволами: C = 2\pi r, S = \pi r^2, \pi \approx 3,14
    text = text.replace(/([A-Za-z0-9_,\s·=+\-*/():]+(?:\\pi|\\approx)[A-Za-z0-9_,\s·=+\-*/()^]*)/g, (m, formula) => {
      if (formula.includes("<") || formula.includes(">")) return formula;
      let cleanTex = formula.replace(/(\d+),(\d+)/g, "$1{,}$2");
      cleanTex = cleanTex.replace(/·/g, "\\cdot ");
      return protect(safeKatex(cleanTex.trim(), false));
    });

    // 6. Простые текстовые дроби вида 3/4 или -5/12
    text = text.replace(/(?<![0-9a-zA-Zа-яА-Я_\\])([-−]?)\s*(\d+)\s*\/\s*(\d+)(?![0-9a-zA-Zа-яА-Я_])/g, (m, sign, num, den) => {
      return protect(safeKatex(`${sign}\\frac{${num}}{${den}}`, false));
    });
  } else {
    // Чистый CSS fallback при отсутствии KaTeX
    text = text.replace(
      /([-−]?\d+)\s*\\frac\{([^{}]+)\}\{([^{}]+)\}/g,
      `<span class="mixed-num">$1<span class="frac"><span class="num">$2</span><span class="den">$3</span></span></span>`
    );
    text = text.replace(
      /(?<![<a-zA-Z0-9\/:\\])([-−]?\d+)\s+(\d+)\s*\/\s*(\d+)(?![a-zA-Z0-9\/>])/g,
      `<span class="mixed-num">$1<span class="frac"><span class="num">$2</span><span class="den">$3</span></span></span>`
    );
    text = text.replace(
      /([-−]?)\s*\\frac\{([^{}]+)\}\{([^{}]+)\}/g,
      `<span class="frac"><span class="num">$2</span><span class="den">$3</span></span>`
    );
    text = text.replace(
      /(?<![<a-zA-Z0-9\/:\\])([a-zA-Zа-яА-Я0-9]+)\s*\/\s*([a-zA-Zа-яА-Я0-9]+)(?![a-zA-Z0-9\/>])/g,
      `<span class="frac"><span class="num">$1</span><span class="den">$2</span></span>`
    );
  }

  // Восстановление защищённых фрагментов
  text = text.replace(/___PL_(\d+)___/g, (_, i) => placeholders[i]);

  return text;
}

// Запуск авторендеринга KaTeX по всему дереву DOM (второй проход безопасности)
function renderAllMath(rootEl = document.body) {
  if (!rootEl) return;
  if (typeof renderMathInElement === "function") {
    try {
      renderMathInElement(rootEl, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "\\[", right: "\\]", display: true },
          { left: "\\(", right: "\\)", display: false },
          { left: "$", right: "$", display: false }
        ],
        ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "input", "option"],
        throwOnError: false
      });
    } catch (e) {
      console.warn("KaTeX render error:", e);
    }
  }
}

/* ============================================================
 * 2. НОРМАЛИЗАЦИЯ И ПРОВЕРКА ОТВЕТОВ
 * ============================================================ */

function canon(val) {
  if (val == null) return "";
  let s = String(val).trim().toLowerCase();
  s = s.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "$1/$2");
  s = s.replace(/\$/g, "");
  s = s.replace(/[×*xх∙⋅]/g, "·");
  s = s.replace(/°/g, "");
  s = s.replace(/\s+/g, " ");
  return s;
}

function canonCoords(val) {
  let s = canon(val);
  s = s.replace(/[()]/g, "").replace(/\s+/g, "").replace(/,/g, ";");
  return s;
}

function parseList(val) {
  if (!val) return [];
  return String(val)
    .toLowerCase()
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();
}

function checkAnswer(userVal, correctPattern, type) {
  if (!userVal || !userVal.trim()) return false;
  const userTrim = userVal.trim();
  const acceptable = correctPattern.split("|").map((p) => p.trim());

  if (type === "list") {
    const userList = parseList(userTrim);
    for (const pat of acceptable) {
      const patList = parseList(pat);
      if (userList.length === patList.length && userList.every((v, i) => v === patList[i])) {
        return true;
      }
    }
    return false;
  }

  if (type === "coords") {
    const uCoords = canonCoords(userTrim);
    for (const pat of acceptable) {
      if (uCoords === canonCoords(pat)) return true;
    }
    return false;
  }

  const uCanon = canon(userTrim).replace(/\s/g, "");
  for (const pat of acceptable) {
    const pCanon = canon(pat).replace(/\s/g, "");
    if (uCanon === pCanon) return true;

    // Сравнение десятичных чисел (1,5 == 1.5)
    const uNum = parseFloat(userTrim.replace(",", "."));
    const pNum = parseFloat(pat.replace(",", "."));
    if (!isNaN(uNum) && !isNaN(pNum) && Math.abs(uNum - pNum) < 0.0001) {
      return true;
    }

    // Сравнение дробей: "2/4" == "1/2"
    if (pat.includes("/") && userTrim.includes("/")) {
      const [un, ud] = userTrim.split("/").map(Number);
      const [pn, pd] = pat.split("/").map(Number);
      if (un && ud && pn && pd && un * pd === pn * ud) {
        return true;
      }
    }
  }

  return false;
}

/* ============================================================
 * 3. ТАЙМЕР ОБРАТНОГО ОТСЧЁТА С ПАУЗОЙ И НАСТРОЙКОЙ
 * ============================================================ */

function updateTimerDisplay() {
  const timerBadge = $("#vprTimerBadge");
  if (!timerBadge) return;

  const rem = Math.max(0, appState.timerRemainingSec);
  const m = Math.floor(rem / 60);
  const s = rem % 60;
  const mm = m < 10 ? "0" + m : m;
  const ss = s < 10 ? "0" + s : s;
  const totalMin = Math.round(appState.timerTotalSec / 60);

  timerBadge.textContent = `⏱️ ${mm}:${ss} (из ${totalMin} мин)`;

  // Предупреждение за 5 минут (300 секунд)
  if (rem <= 300) {
    timerBadge.classList.add("timer-urgent");
  } else {
    timerBadge.classList.remove("timer-urgent");
  }
}

function startTimer(totalSeconds) {
  stopTimer();
  appState.isTimerEnabled = true;
  appState.isPaused = false;
  appState.timerTotalSec = totalSeconds;
  appState.timerRemainingSec = totalSeconds;

  const timerContainer = $("#vprTimerContainer");
  if (timerContainer) timerContainer.style.display = "flex";

  const pauseBtn = $("#btnTimerPause");
  if (pauseBtn) {
    pauseBtn.textContent = "⏸️ Пауза";
    pauseBtn.classList.remove("paused");
  }

  const pauseOverlay = $("#pauseOverlay");
  if (pauseOverlay) pauseOverlay.style.display = "none";

  updateTimerDisplay();

  appState.timerInterval = setInterval(() => {
    if (appState.isPaused) return;

    appState.timerRemainingSec--;
    updateTimerDisplay();

    if (appState.timerRemainingSec <= 0) {
      stopTimer();
      alert("⏱️ Время вышло! Переходим к автоматической проверке и подсчёту баллов.");
      checkCurrentSlide();
      goToSlide(appState.slides.length - 1);
    }
  }, 1000);
}

function stopTimer() {
  if (appState.timerInterval) {
    clearInterval(appState.timerInterval);
    appState.timerInterval = null;
  }
}

function togglePauseTimer() {
  if (!appState.isTimerEnabled) return;

  appState.isPaused = !appState.isPaused;
  const pauseBtn = $("#btnTimerPause");
  const pauseOverlay = $("#pauseOverlay");

  if (appState.isPaused) {
    if (pauseBtn) {
      pauseBtn.textContent = "▶️ Продолжить";
      pauseBtn.classList.add("paused");
    }
    if (pauseOverlay) pauseOverlay.style.display = "flex";
  } else {
    if (pauseBtn) {
      pauseBtn.textContent = "⏸️ Пауза";
      pauseBtn.classList.remove("paused");
    }
    if (pauseOverlay) pauseOverlay.style.display = "none";
  }
}

function resumeFromPause() {
  if (appState.isPaused) {
    togglePauseTimer();
  }
}

function applyTimerDuration(durationVal, defaultMinutes) {
  appState.timerDurationConfig = durationVal;
  const timerContainer = $("#vprTimerContainer");

  if (durationVal === "none") {
    stopTimer();
    appState.isTimerEnabled = false;
    if (timerContainer) timerContainer.style.display = "none";
    return;
  }

  let minutes = 0;
  if (durationVal === "auto") {
    minutes = defaultMinutes || 0;
  } else {
    minutes = parseInt(durationVal, 10) || 0;
  }

  if (minutes > 0) {
    startTimer(minutes * 60);
  } else {
    stopTimer();
    appState.isTimerEnabled = false;
    if (timerContainer) timerContainer.style.display = "none";
  }
}

/* ============================================================
 * 4. ИНИЦИАЛИЗАЦИЯ И РЕНДЕРИНГ ТРЕНАЖЁРА
 * ============================================================ */

function initTrainer() {
  // Загружаем сохранённое имя ученика
  const savedName = localStorage.getItem("math6_student_name") || "";
  const nameInput = $("#studentNameInput");
  if (nameInput) {
    nameInput.value = savedName;
    appState.studentName = savedName;
    nameInput.addEventListener("input", (e) => {
      appState.studentName = e.target.value.trim();
      localStorage.setItem("math6_student_name", appState.studentName);
    });
  }

  // Определение варианта из URL (?variant=VPR-6-1 или ?variant=T6-1)
  const urlParams = new URLSearchParams(window.location.search);
  const variantParam = urlParams.get("variant");
  if (variantParam) {
    if (variantParam === "GEN-VPR-6" || variantParam === "VPR-6-GEN") {
      if (typeof generateVPRVariant === "function") {
        appState.variantKey = generateVPRVariant(6);
      }
    } else if (variantParam === "GEN-VPR-7" || variantParam === "VPR-7-GEN") {
      if (typeof generateVPRVariant === "function") {
        appState.variantKey = generateVPRVariant(7);
      }
    } else if (typeof TASKS !== "undefined" && TASKS[variantParam]) {
      appState.variantKey = variantParam;
    }
  }

  // Настройка выпадающего списка вариантов
  const variantSelect = $("#variantSelect");
  if (variantSelect) {
    if (!variantSelect.querySelector(`option[value="${appState.variantKey}"]`)) {
      const opt = document.createElement("option");
      opt.value = appState.variantKey;
      opt.textContent = `🎯 ${appState.variantKey}`;
      variantSelect.appendChild(opt);
    }
    variantSelect.value = appState.variantKey;
    variantSelect.addEventListener("change", (e) => {
      const val = e.target.value;
      if (val === "GEN-VPR-6") {
        if (typeof generateVPRVariant === "function") {
          const k = generateVPRVariant(6);
          ensureVariantOption(k, "🎲 ВПР 6 класс · Новый сгенерированный вариант");
          variantSelect.value = k;
          loadVariant(k);
        }
      } else if (val === "GEN-VPR-7") {
        if (typeof generateVPRVariant === "function") {
          const k = generateVPRVariant(7);
          ensureVariantOption(k, "🎲 ВПР 7 класс · Новый сгенерированный вариант");
          variantSelect.value = k;
          loadVariant(k);
        }
      } else {
        loadVariant(val);
      }
    });
  }

  // Селектор длительности таймера
  const timerDurationSelect = $("#timerDurationSelect");
  if (timerDurationSelect) {
    timerDurationSelect.addEventListener("change", (e) => {
      const vData = typeof TASKS !== "undefined" ? TASKS[appState.variantKey] : null;
      const defaultMin = vData ? (vData.timeLimitMinutes || (vData.isVPR ? (vData.grade === 7 ? 90 : 60) : 0)) : 0;
      applyTimerDuration(e.target.value, defaultMin);
    });
  }

  // Кнопка паузы
  const pauseBtn = $("#btnTimerPause");
  if (pauseBtn) {
    pauseBtn.addEventListener("click", togglePauseTimer);
  }

  const resumeOverlayBtn = $("#btnResumeFromOverlay");
  if (resumeOverlayBtn) {
    resumeOverlayBtn.addEventListener("click", resumeFromPause);
  }

  // Запуск выбранного варианта
  loadVariant(appState.variantKey);
  setupEvents();

  // Авторендеринг формул KaTeX
  renderAllMath(document.body);
}

function ensureVariantOption(key, label) {
  const sel = $("#variantSelect");
  if (!sel) return;
  let opt = sel.querySelector(`option[value="${key}"]`);
  if (!opt) {
    opt = document.createElement("option");
    opt.value = key;
    opt.textContent = label;
    sel.insertBefore(opt, sel.firstChild);
  }
}

function loadVariant(vKey) {
  if (typeof TASKS === "undefined" || !TASKS[vKey]) {
    console.warn("Variant not found in TASKS:", vKey);
    return;
  }

  const data = TASKS[vKey];
  appState.variantKey = vKey;
  appState.currentSlide = 0;
  appState.startTime = new Date();
  appState.results = null;

  // Определение типа работы (ВПР или тренировка)
  appState.isVPR = Boolean(data.isVPR) || vKey.startsWith("VPR-");

  // Инициализация таймера в зависимости от настройки
  const durationSelect = $("#timerDurationSelect");
  const selectedDuration = durationSelect ? durationSelect.value : "auto";
  const defaultMinutes = data.timeLimitMinutes || (appState.isVPR ? (data.grade === 7 ? 90 : 60) : 0);

  applyTimerDuration(selectedDuration, defaultMinutes);

  // Обновление заголовка и темы
  const titleEl = $("#trainerTitle");
  if (titleEl) titleEl.textContent = data.title;
  const topicEl = $("#trainerTopic");
  if (topicEl) topicEl.textContent = data.topic;

  // Очистка и сборка слайдов
  const slidesContainer = $("#slidesDeck");
  if (!slidesContainer) return;

  slidesContainer.innerHTML = `
    <div class="pause-overlay" id="pauseOverlay" style="display:none;">
      <h3>⏸️ Работа на паузе</h3>
      <p>Таймер приостановлен. Задания скрыты до продолжения работы.</p>
      <button type="button" class="btn-hero" id="btnResumeFromOverlay" style="padding:10px 24px; font-size:16px;">▶️ Продолжить решение</button>
    </div>
  `;

  const resumeOverlayBtn = $("#btnResumeFromOverlay");
  if (resumeOverlayBtn) resumeOverlayBtn.addEventListener("click", resumeFromPause);

  const slides = [];

  // Создаём слайды с заданиями:
  // БЕЗ ПОДПИСЕЙ С УЧЕБНИКАМИ (q.ref удалён), БЕЗ ПОДСКАЗОК во время решения
  data.questions.forEach((q, qIdx) => {
    const slide = document.createElement("div");
    slide.className = "slide" + (qIdx === 0 ? " active" : "");
    slide.dataset.slideIndex = qIdx;

    let levelBadgeHtml = "";
    if (q.level) {
      const lvlClass = q.level === "базовый" ? "level-base" : q.level === "средний" ? "level-medium" : "level-hard";
      levelBadgeHtml = `<span class="level-badge ${lvlClass}">${q.level}</span>`;
    }

    // Очищаем crumb от упоминаний учебников
    let cleanCrumb = q.crumb || ("Задание " + q.num);
    cleanCrumb = cleanCrumb.replace(/^Виленкин[^\w\dа-яА-ЯёЁ]*·?\s*(?:§[^\w\dа-яА-ЯёЁ]*·?\s*)?/i, "");

    let html = `
      <div class="margin-line"></div>
      <div class="crumb" style="display:flex; justify-content:space-between; align-items:center;">
        <span>${formatMath(cleanCrumb)}</span>
        ${levelBadgeHtml}
      </div>
      <h2 class="task-heading">
        <span class="task-num-badge">${q.num}</span>
        ${formatMath(q.title)}
      </h2>
      ${q.sub ? `<div class="task-sub">${formatMath(q.sub)}</div>` : ""}
      <div class="task-content">
    `;

    q.tasks.forEach((t, tIdx) => {
      html += `<div class="task-row">`;
      if (t.label) {
        html += `<div class="task-text">${formatMath(t.label)}</div>`;
      }
      html += `<div class="task-expression">`;
      t.parts.forEach((part) => {
        if (typeof part === "string") {
          html += `<span>${formatMath(part)}</span>`;
        } else if (part._input !== undefined) {
          const inpMeta = t.inputs[part._input];
          const inputId = `inp_${qIdx}_${tIdx}_${part._input}`;
          html += `
            <input type="text" 
                   class="math-input" 
                   id="${inputId}" 
                   data-answer="${inpMeta.a}" 
                   data-type="${inpMeta.type || ""}"
                   data-weight="${inpMeta.w || 1}"
                   data-group="${inpMeta.g || ""}"
                   data-qnum="${q.num}"
                   data-qtitle="${q.title}"
                   placeholder="ответ" 
                   autocomplete="off" 
                   autocapitalize="off" 
                   spellcheck="false" />
          `;
        }
      });
      html += `</div></div>`;
    });

    html += `</div>`;
    slide.innerHTML += html;
    slidesContainer.appendChild(slide);
    slides.push(slide);
  });

  // Итоговый слайд результатов с кнопками "Пройти ещё раз" и "Новый вариант"
  const resultsSlide = document.createElement("div");
  resultsSlide.className = "slide";
  resultsSlide.id = "resultsSlide";
  resultsSlide.dataset.slideIndex = data.questions.length;
  resultsSlide.innerHTML = `
    <div class="margin-line"></div>
    <div class="crumb">Итоги работы · ${data.title}</div>
    <div class="results-header">
      <h2 class="task-heading" style="justify-content:center;">🏁 Работа завершена!</h2>
      <div class="score-box">
        <div class="score-points" id="scoreDisplay">0 / 0</div>
        <div class="score-percent" id="percentDisplay">0%</div>
        <div class="grade-badge" id="gradeDisplay">Оценка: —</div>
      </div>
    </div>
    
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
      <h3 style="margin:0; color:var(--chalk);">📋 Подробный разбор выполненных заданий и ошибок:</h3>
    </div>
    <div id="reviewContainer"></div>

    <div class="send-box">
      <h3>📩 Отправить результат учителю</h3>
      <p style="font-size:14.5px; color:#52441a;">
        Результат с оценкой и подробным отчётом будет доставлен в Telegram-бот учителю.
      </p>
      <div class="send-inputs">
        <input type="text" class="student-name-input" id="reportStudentName" placeholder="Фамилия и Имя ученика" value="${appState.studentName}" />
        <button class="btn-send-tg" id="btnSendTelegram">Отправить в Telegram ✈️</button>
        <button class="btn-download-report" id="btnDownloadReport">Скачать отчёт (.txt) 💾</button>
      </div>
      <div id="teacherChatNotice" style="font-size:13.5px; color:#6d593c; margin-top:6px;">
        Канал доставки: бот <b>@math6gradeZVEROK_bot</b> · Чат учителя: <b id="displayTeacherChatId">${getTelegramChatId()}</b>
      </div>
      <div class="send-status-msg" id="sendStatusMsg"></div>
    </div>

    <div style="display:flex; gap:12px; justify-content:center; margin-top:24px; flex-wrap:wrap;">
      <button class="btn-nav" id="btnRestart">🔄 Пройти ещё раз</button>
      <button class="btn-new-variant" id="btnNewVariant">🎲 Сгенерировать новый вариант</button>
      <a href="index.html" class="btn-nav" style="text-decoration:none;">📚 Ко всем темам и ВПР</a>
    </div>
  `;
  slidesContainer.appendChild(resultsSlide);
  slides.push(resultsSlide);

  appState.slides = slides;
  updateNav();

  // Привязка кнопок результатов
  const btnRestart = $("#btnRestart");
  if (btnRestart) {
    btnRestart.addEventListener("click", () => loadVariant(appState.variantKey));
  }

  const btnNewVariant = $("#btnNewVariant");
  if (btnNewVariant) {
    btnNewVariant.addEventListener("click", () => {
      const grade = data.grade || 6;
      if (typeof generateVPRVariant === "function") {
        const nextKey = generateVPRVariant(grade);
        ensureVariantOption(nextKey, `🎲 ВПР ${grade} класс · Свежий вариант`);
        const variantSelect = $("#variantSelect");
        if (variantSelect) variantSelect.value = nextKey;
        loadVariant(nextKey);
      } else {
        loadVariant(appState.variantKey);
      }
    });
  }

  // Рендерим формулы в собранных слайдах
  renderAllMath(slidesContainer);
}

/* ============================================================
 * 5. НАВИГАЦИЯ И ПЕРЕХОД ПО СЛАЙДАМ
 * ============================================================ */

function updateNav() {
  const total = appState.slides.length;
  const cur = appState.currentSlide;
  const isLast = cur === total - 1;

  const prevBtn = $("#btnPrev");
  const nextBtn = $("#btnNext");
  const checkBtn = $("#btnCheck");
  const counter = $("#slideCounter");

  if (prevBtn) prevBtn.disabled = cur === 0;
  if (nextBtn) {
    if (isLast) {
      nextBtn.style.display = "none";
    } else {
      nextBtn.style.display = "inline-block";
      nextBtn.textContent = cur === total - 2 ? "К итогам 🏁" : "Далее ▶";
    }
  }
  if (checkBtn) {
    checkBtn.style.display = isLast ? "none" : "inline-block";
  }
  if (counter) {
    counter.textContent = `${cur + 1} / ${total}`;
  }
}

function goToSlide(index) {
  if (index < 0 || index >= appState.slides.length) return;
  appState.slides.forEach((s, idx) => {
    s.classList.toggle("active", idx === index);
  });
  appState.currentSlide = index;

  // Авторендеринг формул на открывшемся слайде
  if (appState.slides[index]) {
    renderAllMath(appState.slides[index]);
  }

  // Если открылся слайд результатов — выключаем таймер и формируем разбор
  if (index === appState.slides.length - 1) {
    stopTimer();
    calculateResults();
  }

  updateNav();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function checkCurrentSlide() {
  const currentSlideEl = appState.slides[appState.currentSlide];
  if (!currentSlideEl) return;

  const inputs = Array.from(currentSlideEl.querySelectorAll(".math-input"));
  let allCorrect = true;

  inputs.forEach((inp) => {
    const userVal = inp.value;
    const pat = inp.dataset.answer;
    const type = inp.dataset.type;
    const isOk = checkAnswer(userVal, pat, type);

    inp.classList.remove("correct", "incorrect");
    if (isOk) {
      inp.classList.add("correct");
    } else {
      inp.classList.add("incorrect");
      allCorrect = false;
    }
  });

  return allCorrect;
}

/* ============================================================
 * 6. РАСЧЁТ РЕЗУЛЬТАТОВ, ОЦЕНКА ВПР И ПОДРОБНЫЙ РАЗБОР
 * ============================================================ */

function calculateResults() {
  const vData = typeof TASKS !== "undefined" ? TASKS[appState.variantKey] : null;
  const allInputs = $$("#slidesDeck .math-input");
  let totalScore = 0;
  let maxScore = 0;
  const reviewItems = [];
  const groups = {};

  allInputs.forEach((inp) => {
    const w = parseFloat(inp.dataset.weight || 1);
    const grp = inp.dataset.group;
    const qNum = inp.dataset.qnum;
    const qTitle = inp.dataset.qtitle;
    const val = inp.value;
    const pat = inp.dataset.answer;
    const type = inp.dataset.type;
    const isOk = checkAnswer(val, pat, type);

    const qObj = vData && vData.questions ? vData.questions.find((q) => String(q.num) === String(qNum)) : null;
    const explanation = qObj ? qObj.explanation : "";

    if (grp) {
      if (!groups[grp]) {
        groups[grp] = { ok: true, w: w, qNum, qTitle, userVal: [], correctVal: [], explanation };
      }
      if (!isOk) groups[grp].ok = false;
      groups[grp].userVal.push(val || "—");
      groups[grp].correctVal.push(pat);
    } else {
      maxScore += w;
      if (isOk) totalScore += w;
      reviewItems.push({
        qNum,
        qTitle,
        userVal: val || "—",
        correctVal: pat.split("|")[0],
        isOk,
        score: isOk ? w : 0,
        maxScore: w,
        explanation
      });
    }
  });

  Object.keys(groups).forEach((gKey) => {
    const g = groups[gKey];
    maxScore += g.w;
    if (g.ok) totalScore += g.w;
    reviewItems.push({
      qNum: g.qNum,
      qTitle: g.qTitle,
      userVal: g.userVal.join(", "),
      correctVal: g.correctVal.map((c) => c.split("|")[0]).join(", "),
      isOk: g.ok,
      score: g.ok ? g.w : 0,
      maxScore: g.w,
      explanation: g.explanation
    });
  });

  const percent = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
  let grade = 2;
  let gradeText = "2 (Требуется повторение)";
  let gradeClass = "grade-2";

  // Официальные шкалы перевода баллов ВПР (ФИОКО)
  if (appState.isVPR) {
    const gradeLevel = (vData && vData.grade) || 6;
    if (gradeLevel === 7) {
      if (totalScore >= 15) {
        grade = 5;
        gradeText = "5 (Отлично) 🌟";
        gradeClass = "grade-5";
      } else if (totalScore >= 12) {
        grade = 4;
        gradeText = "4 (Хорошо) 👍";
        gradeClass = "grade-4";
      } else if (totalScore >= 7) {
        grade = 3;
        gradeText = "3 (Удовлетворительно) ✍️";
        gradeClass = "grade-3";
      } else {
        grade = 2;
        gradeText = "2 (Неудовлетворительно) ⚠️";
        gradeClass = "grade-2";
      }
    } else {
      if (totalScore >= 12) {
        grade = 5;
        gradeText = "5 (Отлично) 🌟";
        gradeClass = "grade-5";
      } else if (totalScore >= 10) {
        grade = 4;
        gradeText = "4 (Хорошо) 👍";
        gradeClass = "grade-4";
      } else if (totalScore >= 6) {
        grade = 3;
        gradeText = "3 (Удовлетворительно) ✍️";
        gradeClass = "grade-3";
      } else {
        grade = 2;
        gradeText = "2 (Неудовлетворительно) ⚠️";
        gradeClass = "grade-2";
      }
    }
  } else {
    const scale = (typeof CONFIG !== "undefined" && CONFIG.gradeScale) ? CONFIG.gradeScale : { 5: 85, 4: 68, 3: 50 };
    if (percent >= scale[5]) {
      grade = 5;
      gradeText = "5 (Отлично!) 🎉";
      gradeClass = "grade-5";
    } else if (percent >= scale[4]) {
      grade = 4;
      gradeText = "4 (Хорошо) 👍";
      gradeClass = "grade-4";
    } else if (percent >= scale[3]) {
      grade = 3;
      gradeText = "3 (Удовлетворительно) ✍️";
      gradeClass = "grade-3";
    }
  }

  // Расчёт времени решения
  let timeString = "";
  if (appState.isTimerEnabled) {
    const spentSec = appState.timerTotalSec - Math.max(0, appState.timerRemainingSec);
    const minutes = Math.floor(spentSec / 60);
    const seconds = spentSec % 60;
    timeString = `${minutes} мин ${seconds} сек (из ${Math.round(appState.timerTotalSec / 60)} мин)`;
  } else {
    const endTime = new Date();
    const timeDiffSec = Math.round((endTime - appState.startTime) / 1000);
    const minutes = Math.floor(timeDiffSec / 60);
    const seconds = timeDiffSec % 60;
    timeString = `${minutes} мин ${seconds} сек`;
  }

  appState.results = {
    totalScore,
    maxScore,
    percent,
    grade,
    gradeText,
    timeString,
    reviewItems,
    date: new Date().toLocaleString("ru-RU")
  };

  // Вывод баллов и оценки
  const scoreDisp = $("#scoreDisplay");
  if (scoreDisp) scoreDisp.textContent = `${totalScore} / ${maxScore} баллов`;

  const percDisp = $("#percentDisplay");
  if (percDisp) percDisp.textContent = `${percent}% выполнено`;

  const gradeDisp = $("#gradeDisplay");
  if (gradeDisp) {
    gradeDisp.textContent = `Оценка: ${gradeText}`;
    gradeDisp.className = `grade-badge ${gradeClass}`;
  }

  const dispChatId = $("#displayTeacherChatId");
  if (dispChatId) dispChatId.textContent = getTelegramChatId();

  // Рендеринг подробных карточек разбора решений и ошибок
  const revCont = $("#reviewContainer");
  if (revCont) {
    let html = "";
    reviewItems.forEach((item) => {
      const isGood = item.isOk;
      html += `
        <div class="review-card-item ${isGood ? "is-correct" : "is-incorrect"}">
          <div class="review-item-header">
            <div class="review-item-title">
              Задание №${item.qNum} · ${formatMath(item.qTitle)}
            </div>
            <span class="status-tag ${isGood ? "status-ok" : "status-bad"}">
              ${isGood ? "✓ Верно (+1 балл)" : "✗ Ошибка (0 баллов)"}
            </span>
          </div>

          <div class="review-item-answers">
            <div class="review-user-ans ${isGood ? "good" : "bad"}">
              Ваш ответ: <b>${formatMath(item.userVal)}</b>
            </div>
            ${!isGood ? `<div class="review-correct-ans">Правильный ответ: <b>${formatMath(item.correctVal)}</b></div>` : ""}
          </div>

          ${
            item.explanation
              ? `
            <details class="explanation-details" ${!isGood ? "open" : ""}>
              <summary class="explanation-summary">💡 Пояснение и ход решения</summary>
              <div class="explanation-body">${formatMath(item.explanation)}</div>
            </details>
          `
              : ""
          }
        </div>
      `;
    });
    revCont.innerHTML = html;
    renderAllMath(revCont);
  }
}

/* ============================================================
 * 7. ОТПРАВКА В TELEGRAM BOT API И СКАЧИВАНИЕ ОТЧЁТА
 * ============================================================ */

function buildTelegramMessage(results) {
  const vData = typeof TASKS !== "undefined" ? TASKS[appState.variantKey] : null;
  const name = appState.studentName || "Ученик (без имени)";
  const gradeLevel = (vData && vData.grade) || 6;
  const title = vData ? vData.title : appState.variantKey;
  const topic = vData ? vData.topic : "";

  if (appState.isVPR) {
    let msg = `⏱️ <b>ПРОБНЫЙ ВПР ПО МАТЕМАТИКЕ · ${gradeLevel} КЛАСС</b>\n\n`;
    msg += `👤 <b>Ученик:</b> ${name}\n`;
    msg += `📋 <b>Экзаменационная работа:</b> ${title}\n`;
    msg += `⏱️ <b>Затраченное время:</b> ${results.timeString}\n`;
    msg += `🎯 <b>Первичный балл ВПР:</b> ${results.totalScore} из ${results.maxScore} (${results.percent}%)\n`;
    msg += `🏆 <b>Отметка по шкале ВПР (ФИОКО):</b> ${results.gradeText}\n`;
    msg += `📅 <b>Дата сдачи:</b> ${results.date}\n\n`;

    const mistakes = results.reviewItems.filter((i) => !i.isOk);
    if (mistakes.length === 0) {
      msg += `✅ <b>Все задания ВПР решены абсолютно верно! Высший балл!</b> 🌟`;
    } else {
      msg += `⚠️ <b>Ошибки в заданиях (${mistakes.length}):</b>\n`;
      mistakes.forEach((m) => {
        msg += `• Зад. ${m.qNum} (${m.qTitle}): ответ "${m.userVal}", верно "${m.correctVal}"\n`;
      });
    }
    return msg;
  }

  let msg = `📚 <b>Тренажёр по математике · 6 класс</b>\n\n`;
  msg += `👤 <b>Ученик:</b> ${name}\n`;
  msg += `📖 <b>Работа:</b> ${title}\n`;
  if (topic) msg += `📌 <b>Тема:</b> ${topic}\n`;
  msg += `⏱ <b>Время работы:</b> ${results.timeString}\n`;
  msg += `📊 <b>Результат:</b> ${results.totalScore} из ${results.maxScore} баллов (${results.percent}%)\n`;
  msg += `🏆 <b>Оценка:</b> ${results.gradeText}\n`;
  msg += `📅 <b>Дата:</b> ${results.date}\n\n`;

  const mistakes = results.reviewItems.filter((i) => !i.isOk);
  if (mistakes.length === 0) {
    msg += `✅ <b>Все задания выполнены безупречно!</b> 🌟`;
  } else {
    msg += `⚠️ <b>Ошибки в заданиях (${mistakes.length}):</b>\n`;
    mistakes.forEach((m) => {
      msg += `• Зад. ${m.qNum} (${m.qTitle}): ответ "${m.userVal}", верно "${m.correctVal}"\n`;
    });
  }

  return msg;
}

async function sendToTelegram() {
  const statusEl = $("#sendStatusMsg");
  const nameInp = $("#reportStudentName");
  if (nameInp && nameInp.value.trim()) {
    appState.studentName = nameInp.value.trim();
    localStorage.setItem("math6_student_name", appState.studentName);
  }

  const chatId = getTelegramChatId();
  if (!chatId) {
    showStatusMsg(
      "err",
      "⚠️ Chat ID учителя не указан! Нажмите «⚙️ Настройки Telegram» вверху страницы и введите ваш Chat ID."
    );
    openTelegramSettingsModal();
    return;
  }

  if (!appState.results) {
    calculateResults();
  }

  const msgText = buildTelegramMessage(appState.results);
  const botToken = getTelegramBotToken();
  const botName = (typeof CONFIG !== "undefined" && CONFIG.telegram && CONFIG.telegram.botUsername) || "math6gradeZVEROK_bot";

  if (!botToken || botToken.startsWith("__")) {
    // В локальном окружении без секретов GitHub Actions
    showStatusMsg(
      "ok",
      `✅ Отчёт подготовлен для отправки в чат ${chatId} через @${botName}. На GitHub Pages (где подключен секрет бота) он мгновенно доставляется в Telegram!`
    );
    return;
  }

  showStatusMsg("wait", `Отправляю отчёт в Telegram учителю (чат: ${chatId})... ⏳`);

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: msgText,
        parse_mode: "HTML",
      }),
    });

    const data = await res.json();
    if (res.ok && data.ok) {
      showStatusMsg("ok", `✅ Результат успешно отправлен в Telegram на Chat ID ${chatId}!`);
    } else {
      throw new Error(data.description || `HTTP ${res.status}`);
    }
  } catch (err) {
    console.error("Telegram send error:", err);
    showStatusMsg(
      "err",
      `❌ Ошибка отправки: ${err.message}. Проверьте Chat ID (${chatId}) и напишите боту @${botName} команду /start.`
    );
  }
}

function showStatusMsg(type, text) {
  const el = $("#sendStatusMsg");
  if (!el) return;
  el.className = `send-status-msg ${type}`;
  el.textContent = text;
}

function downloadReport() {
  if (!appState.results) calculateResults();
  const rawText = buildTelegramMessage(appState.results).replace(/<[^>]+>/g, "");
  const blob = new Blob([rawText], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Отчёт_${appState.studentName || "Ученик"}_${appState.variantKey}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ============================================================
 * 8. СОБЫТИЯ, КЛАВИАТУРА И МОДАЛЬНЫЕ ОКНА
 * ============================================================ */

function setupEvents() {
  const prevBtn = $("#btnPrev");
  const nextBtn = $("#btnNext");
  const checkBtn = $("#btnCheck");
  const restartBtn = $("#btnRestart");

  if (prevBtn) prevBtn.addEventListener("click", () => goToSlide(appState.currentSlide - 1));
  if (nextBtn) nextBtn.addEventListener("click", () => goToSlide(appState.currentSlide + 1));
  if (checkBtn) checkBtn.addEventListener("click", checkCurrentSlide);
  if (restartBtn) restartBtn.addEventListener("click", () => loadVariant(appState.variantKey));

  const sendBtn = $("#btnSendTelegram");
  if (sendBtn) sendBtn.addEventListener("click", sendToTelegram);

  const dlBtn = $("#btnDownloadReport");
  if (dlBtn) dlBtn.addEventListener("click", downloadReport);

  // Горячие клавиши
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
      if (e.key === "Enter") {
        e.preventDefault();
        checkCurrentSlide();
      }
      return;
    }

    if (e.key === "ArrowLeft") {
      goToSlide(appState.currentSlide - 1);
    } else if (e.key === "ArrowRight") {
      goToSlide(appState.currentSlide + 1);
    } else if (e.key === "Enter") {
      checkCurrentSlide();
    }
  });
}

function getTelegramChatId() {
  const localChatId =
    localStorage.getItem("math6_telegram_chat_id") ||
    localStorage.getItem("math6_tg_chat_id") ||
    localStorage.getItem("math6_student_chat_id");
  if (localChatId && localChatId.trim()) {
    return localChatId.trim();
  }
  if (typeof CONFIG !== "undefined" && CONFIG.telegram) {
    if (CONFIG.telegram.chatId && !CONFIG.telegram.chatId.startsWith("__")) {
      return CONFIG.telegram.chatId.trim();
    }
    if (CONFIG.telegram.defaultChatId) {
      return CONFIG.telegram.defaultChatId.trim();
    }
  }
  return "7928474241";
}

function setTelegramChatId(chatId) {
  const val = (chatId || "").trim();
  if (val) {
    localStorage.setItem("math6_telegram_chat_id", val);
    localStorage.setItem("math6_tg_chat_id", val);
  } else {
    localStorage.removeItem("math6_telegram_chat_id");
    localStorage.removeItem("math6_tg_chat_id");
  }
}

function getTelegramBotToken() {
  const localToken = localStorage.getItem("math6_telegram_bot_token");
  if (localToken && localToken.trim()) return localToken.trim();
  if (typeof CONFIG !== "undefined" && CONFIG.telegram && CONFIG.telegram.botToken) {
    return CONFIG.telegram.botToken.trim();
  }
  return "";
}

function openTheoryModal(lessonKey) {
  const modal = $("#theoryModal");
  const content = $("#theoryContent");
  if (!modal || !content) return;

  const data = typeof THEORY !== "undefined" ? THEORY[lessonKey] : (typeof THEORY_DATA !== "undefined" ? THEORY_DATA[lessonKey] : null);
  if (!data) {
    content.innerHTML = "<p>Краткая теория для этого урока скоро появится.</p>";
    modal.classList.add("open");
    return;
  }

  let html = `
    <h3 class="modal-title">📖 Теория: ${formatMath(data.title)}</h3>
    <div class="theory-rules">
  `;

  data.rules.forEach((rule) => {
    html += `<div class="theory-rule-item">📌 ${formatMath(rule)}</div>`;
  });

  html += `</div>`;
  if (data.sample) {
    html += `
      <div class="theory-sample">
        <b>💡 Пример решения:</b><br>${formatMath(data.sample)}
      </div>
    `;
  }

  content.innerHTML = html;
  modal.classList.add("open");
  renderAllMath(modal);
}

function closeTheoryModal() {
  const modal = $("#theoryModal");
  if (modal) modal.classList.remove("open");
}

function openTelegramSettingsModal() {
  const modal = $("#settingsModal");
  if (!modal) return;

  // Автоматически подставляем Chat ID (сохранённый или по умолчанию 7928474241)
  const currentChatId = getTelegramChatId();
  const input = $("#settingChatId");
  if (input) input.value = currentChatId;

  const msgEl = $("#settingStatusMsg");
  if (msgEl) {
    if (currentChatId) {
      msgEl.className = "send-status-msg ok";
      msgEl.textContent = `✅ Chat ID подключён: ${currentChatId}`;
    } else {
      msgEl.className = "send-status-msg wait";
      msgEl.textContent = "ℹ️ Введите числовой Chat ID и нажмите «Сохранить» или «Проверить связь».";
    }
  }

  modal.classList.add("open");
}

function closeTelegramSettingsModal() {
  const modal = $("#settingsModal");
  if (modal) modal.classList.remove("open");
}

function saveTelegramSettings() {
  const input = $("#settingChatId");
  const msgEl = $("#settingStatusMsg");
  if (!input) return;

  const chatId = input.value.trim() || getTelegramChatId();
  setTelegramChatId(chatId);

  const dispChatId = $("#displayTeacherChatId");
  if (dispChatId) dispChatId.textContent = chatId;

  if (msgEl) {
    msgEl.className = "send-status-msg ok";
    msgEl.textContent = `✅ Chat ID (${chatId}) успешно сохранён в браузере!`;
    setTimeout(() => {
      closeTelegramSettingsModal();
    }, 1400);
  }
}

async function testTelegramPing() {
  const input = $("#settingChatId");
  const msgEl = $("#settingStatusMsg");
  const chatId = (input && input.value.trim()) || getTelegramChatId();

  if (!chatId) {
    if (msgEl) {
      msgEl.className = "send-status-msg err";
      msgEl.textContent = "⚠️ Сначала введите Chat ID!";
    }
    return;
  }

  setTelegramChatId(chatId);

  const dispChatId = $("#displayTeacherChatId");
  if (dispChatId) dispChatId.textContent = chatId;

  if (msgEl) {
    msgEl.className = "send-status-msg wait";
    msgEl.textContent = `Отправляю тестовый сигнал боту в чат ${chatId}... ⏳`;
  }

  const botToken = getTelegramBotToken();
  const botUsername = (typeof CONFIG !== "undefined" && CONFIG.telegram && CONFIG.telegram.botUsername) || "math6gradeZVEROK_bot";

  if (!botToken || botToken.startsWith("__")) {
    if (msgEl) {
      msgEl.className = "send-status-msg ok";
      msgEl.textContent = `✅ Chat ID ${chatId} успешно сохранён! На GitHub Pages (где настроен секрет TELEGRAM_BOT_TOKEN) отчёты будут мгновенно доставляться ботом @${botUsername}.`;
    }
    return;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: `🔔 <b>Проверка связи успешна!</b>\n\nТренажёр по математике (6 класс) подключён к Telegram-боту @${botUsername} (чат: <code>${chatId}</code>). Отчёты учеников будут приходить в этот чат! 🎉`,
        parse_mode: "HTML",
      }),
    });

    const data = await res.json();
    if (res.ok && data.ok) {
      if (msgEl) {
        msgEl.className = "send-status-msg ok";
        msgEl.textContent = `🎉 Связь подтверждена! Тестовое сообщение доставлено ботом @${botUsername} на Chat ID: ${chatId}.`;
      }
    } else {
      throw new Error(data.description || `HTTP ${res.status}`);
    }
  } catch (err) {
    if (msgEl) {
      msgEl.className = "send-status-msg err";
      msgEl.textContent = `❌ Ошибка: ${err.message}. Убедитесь, что вы нажали /start боту @${botUsername}.`;
    }
  }
}

// Экспорт для Node.js окружения
if (typeof window !== "undefined") {
  window.appState = appState;
  window.formatMath = formatMath;
  window.safeKatex = safeKatex;
  window.renderAllMath = renderAllMath;
  window.checkAnswer = checkAnswer;
  window.canon = canon;
  window.canonCoords = canonCoords;
  window.parseList = parseList;
  window.getTelegramChatId = getTelegramChatId;
  window.setTelegramChatId = setTelegramChatId;
  window.getTelegramBotToken = getTelegramBotToken;
  window.openTelegramSettingsModal = openTelegramSettingsModal;
  window.closeTelegramSettingsModal = closeTelegramSettingsModal;
  window.saveTelegramSettings = saveTelegramSettings;
  window.testTelegramPing = testTelegramPing;
  window.openTheoryModal = openTheoryModal;
  window.closeTheoryModal = closeTheoryModal;
  window.buildTelegramMessage = buildTelegramMessage;
  window.sendToTelegram = sendToTelegram;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    appState,
    formatMath,
    safeKatex,
    renderAllMath,
    checkAnswer,
    canon,
    canonCoords,
    parseList,
    getTelegramChatId,
    setTelegramChatId,
    getTelegramBotToken,
    openTelegramSettingsModal,
    closeTelegramSettingsModal,
    saveTelegramSettings,
    testTelegramPing,
    openTheoryModal,
    closeTheoryModal,
    buildTelegramMessage,
    sendToTelegram
  };
}

// Автозапуск при загрузке страницы в браузере
if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("DOMContentLoaded", () => {
    if ($("#slidesDeck")) {
      initTrainer();
    }
  });
}
