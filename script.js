/* ============================================================
 * SCRIPT.JS — ДВИЖОК ТРЕНАЖЁРА ПО МАТЕМАТИКЕ (6 КЛАСС)
 * ============================================================
 * 1. Нормализация и проверка математических ответов
 * 2. Управление состоянием (State) и навигацией
 * 3. Рендеринг карточек заданий и полей ввода
 * 4. Подсчёт результатов, процентов и оценки
 * 5. Отправка результатов в Telegram Bot API
 * 6. Модальные окна (Теория / Настройки)
 * ============================================================ */

"use strict";

// Состояние приложения
const appState = {
  studentName: "",
  variantKey: "K-1",
  slides: [],
  currentSlide: 0,
  startTime: null,
  results: null,
};

// Вспомогательные функции селекторов
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ============================================================
 * ФОРМАТИРОВАНИЕ ДРОБЕЙ И ФОРМУЛ (KATEX + CSS FALLBACK)
 * ============================================================ */

function formatMath(text) {
  if (!text || typeof text !== "string") return text;

  // 1. Защита HTML тегов, URL-адресов и физических единиц
  const placeholders = [];
  const protect = (str) => {
    placeholders.push(str);
    return `___PL_${placeholders.length - 1}___`;
  };

  text = text.replace(/<[^>]+>/g, protect);
  text = text.replace(/https?:\/\/[^\s"'<>]+/g, protect);
  text = text.replace(
    /\b(км|м|см|мм|дм|кг|г|т|л|мл|руб|коп|об|сек|с|мин|ч)\s*\/\s*(км|м|см|мм|дм|кг|г|т|л|мл|руб|коп|об|сек|с|мин|ч|см³|м³|шт)\b/gi,
    protect
  );

  // Проверяем доступность KaTeX
  const hasKaTeX = typeof katex !== "undefined" && typeof katex.renderToString === "function";

  if (hasKaTeX) {
    // Явные формулы $...$
    text = text.replace(/\$([^\$]+)\$/g, (m, formula) => {
      try {
        return katex.renderToString(formula.trim(), { throwOnError: false, displayMode: false });
      } catch (e) {
        return m;
      }
    });

    // Смешанные числа с LaTeX: e.g. 1\frac{2}{3} или 3 \frac{5}{12}
    text = text.replace(/([-−]?\d+)\s*\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (m, whole, num, den) => {
      try {
        return katex.renderToString(`${whole}\\frac{${num}}{${den}}`, { throwOnError: false, displayMode: false });
      } catch (e) {
        return m;
      }
    });

    // Одиночные дроби LaTeX: \frac{a}{b} или -\frac{a}{b}
    text = text.replace(/([-−]?)\s*\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (m, sign, num, den) => {
      try {
        return katex.renderToString(`${sign}\\frac{${num}}{${den}}`, { throwOnError: false, displayMode: false });
      } catch (e) {
        return m;
      }
    });

    // Текстовые смешанные числа: "3 5/6", "-2 1/4"
    text = text.replace(/(?<![0-9a-zA-Zа-яА-Я_\\])([-−]?\d+)\s+(\d+)\s*\/\s*(\d+)(?![0-9a-zA-Zа-яА-Я_])/g, (m, whole, num, den) => {
      try {
        return katex.renderToString(`${whole}\\frac{${num}}{${den}}`, { throwOnError: false, displayMode: false });
      } catch (e) {
        return `<span class="mixed-num">${whole}<span class="frac"><span class="num">${num}</span><span class="den">${den}</span></span></span>`;
      }
    });

    // Обычные текстовые простые дроби: "3/4", "-5/8"
    text = text.replace(/(?<![0-9a-zA-Zа-яА-Я_\\])([-−]?)\s*(\d+)\s*\/\s*(\d+)(?![0-9a-zA-Zа-яА-Я_])/g, (m, sign, num, den) => {
      try {
        return katex.renderToString(`${sign}\\frac{${num}}{${den}}`, { throwOnError: false, displayMode: false });
      } catch (e) {
        return `<span class="frac"><span class="num">${num}</span><span class="den">${den}</span></span>`;
      }
    });
  } else {
    // Чистый CSS fallback при отсутствии KaTeX
    // 1. Дроби в скобках
    text = text.replace(
      /\(([^)]+)\)\s*\/\s*\(([^)]+)\)/g,
      `<span class="frac"><span class="num">$1</span><span class="den">$2</span></span>`
    );
    text = text.replace(
      /\(([^)]+)\)\s*\/\s*([a-zA-Zа-яА-Я0-9]+)/g,
      `<span class="frac"><span class="num">$1</span><span class="den">$2</span></span>`
    );
    text = text.replace(
      /(?<![<a-zA-Z0-9\/:\\])([a-zA-Zа-яА-Я0-9]+)\s*\/\s*\(([^)]+)\)/g,
      `<span class="frac"><span class="num">$1</span><span class="den">$2</span></span>`
    );

    // 2. Смешанные числа: "3 5/6" или 3\frac{5}{6}
    text = text.replace(
      /([-−]?\d+)\s*\\frac\{([^{}]+)\}\{([^{}]+)\}/g,
      `<span class="mixed-num">$1<span class="frac"><span class="num">$2</span><span class="den">$3</span></span></span>`
    );
    text = text.replace(
      /(?<![<a-zA-Z0-9\/:\\])([-−]?\d+)\s+(\d+)\s*\/\s*(\d+)(?![a-zA-Z0-9\/>])/g,
      `<span class="mixed-num">$1<span class="frac"><span class="num">$2</span><span class="den">$3</span></span></span>`
    );

    // 3. LaTeX \frac
    text = text.replace(
      /([-−]?)\s*\\frac\{([^{}]+)\}\{([^{}]+)\}/g,
      `<span class="frac"><span class="num">$2</span><span class="den">$3</span></span>`
    );

    // 4. Обычные простые дроби: "3/4"
    text = text.replace(
      /(?<![<a-zA-Z0-9\/:\\])([a-zA-Zа-яА-Я0-9]+)\s*\/\s*([a-zA-Zа-яА-Я0-9]+)(?![a-zA-Z0-9\/>])/g,
      `<span class="frac"><span class="num">$1</span><span class="den">$2</span></span>`
    );
  }

  // Восстановление защищённых фрагментов
  text = text.replace(/___PL_(\d+)___/g, (_, i) => placeholders[i]);

  return text;
}

/* ============================================================
 * 1. НОРМАЛИЗАЦИЯ И ПРОВЕРКА ОТВЕТОВ
 * ============================================================ */

// Очистка и канонизация строки ответа
function canon(val) {
  if (val == null) return "";
  let s = String(val).trim().toLowerCase();
  // Приведение LaTeX дробей \frac{a}{b} к обычному виду a/b
  s = s.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "$1/$2");
  s = s.replace(/\$/g, "");
  // Замена знаков умножения на точку
  s = s.replace(/[×*xх∙⋅]/g, "·");
  // Замена русских запятых в десятичных дробях для чисел
  s = s.replace(/°/g, "");
  // Удаление лишних пробелов вокруг знаков
  s = s.replace(/\s+/g, " ");
  return s;
}

// Нормализация координат вида "( 3 ; -2 )" -> "3;-2"
function canonCoords(val) {
  let s = canon(val);
  s = s.replace(/[()]/g, "").replace(/\s+/g, "").replace(/,/g, ";");
  return s;
}

// Парсинг списка чисел (порядок не важен)
function parseList(val) {
  if (!val) return [];
  // Извлекаем все целые и дробные числа или слова
  return String(val)
    .toLowerCase()
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();
}

// Проверка одного поля ввода
function checkAnswer(userVal, correctPattern, type) {
  if (!userVal || !userVal.trim()) return false;
  const userTrim = userVal.trim();

  // Если несколько вариантов ответа разделены пайпом |
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

  // Обычное сравнение с учетом математической гибкости
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
 * 2. ИНИЦИАЛИЗАЦИЯ И РЕНДЕРИНГ ТРЕНАЖЁРА
 * ============================================================ */

function initTrainer() {
  // Загружаем сохраненное имя
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

  // Определение варианта из URL (?variant=K-1)
  const urlParams = new URLSearchParams(window.location.search);
  const variantParam = urlParams.get("variant");
  if (variantParam && TASKS[variantParam]) {
    appState.variantKey = variantParam;
  }

  const variantSelect = $("#variantSelect");
  if (variantSelect) {
    variantSelect.value = appState.variantKey;
    variantSelect.addEventListener("change", (e) => {
      loadVariant(e.target.value);
    });
  }

  // Запуск выбранного варианта
  loadVariant(appState.variantKey);
  setupEvents();
}

function loadVariant(vKey) {
  const data = TASKS[vKey];
  if (!data) return;

  appState.variantKey = vKey;
  appState.currentSlide = 0;
  appState.startTime = new Date();
  appState.results = null;

  // Обновление заголовков
  const titleEl = $("#trainerTitle");
  if (titleEl) titleEl.textContent = data.title;
  const topicEl = $("#trainerTopic");
  if (topicEl) topicEl.textContent = data.topic;

  // Рендеринг слайдов
  const slidesContainer = $("#slidesDeck");
  if (!slidesContainer) return;

  slidesContainer.innerHTML = "";
  const slides = [];

  // Создаем слайды с вопросами
  data.questions.forEach((q, qIdx) => {
    const slide = document.createElement("div");
    slide.className = "slide" + (qIdx === 0 ? " active" : "");
    slide.dataset.slideIndex = qIdx;

    let html = `
      <div class="margin-line"></div>
      <div class="crumb">${formatMath(q.crumb || "Задание " + q.num)}</div>
      <h2 class="task-heading">
        <span class="task-num-badge">${q.num}</span>
        ${formatMath(q.title)}
      </h2>
      ${q.sub ? `<div class="task-sub">${formatMath(q.sub)}</div>` : ""}
      ${q.ref ? `<div class="task-ref">📖 ${formatMath(q.ref)}</div>` : ""}
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

    if (q.hints && q.hints.length) {
      html += `
        <div class="hint-box">
          <span>💡</span>
          <div>${q.hints.map(formatMath).join("<br>")}</div>
        </div>
      `;
    }

    html += `</div>`;
    slide.innerHTML = html;
    slidesContainer.appendChild(slide);
    slides.push(slide);
  });

  // Добавляем итоговый слайд результатов
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
    
    <h3 style="margin-bottom:12px; color:var(--chalk);">📋 Разбор выполненных заданий:</h3>
    <div id="reviewContainer"></div>

    <div class="send-box">
      <h3>📩 Отправить результат учителю</h3>
      <p style="font-size:14.5px; color:#52441a;">
        Результат будет мгновенно доставлен в Telegram-бот учителю.
      </p>
      <div class="send-inputs">
        <input type="text" class="student-name-input" id="reportStudentName" placeholder="Фамилия и Имя ученика" value="${appState.studentName}" />
        <button class="btn-send-tg" id="btnSendTelegram">Отправить в Telegram ✈️</button>
        <button class="btn-download-report" id="btnDownloadReport">Скачать отчёт (.txt) 💾</button>
      </div>
      <div class="send-status-msg" id="sendStatusMsg"></div>
    </div>

    <div style="display:flex; gap:12px; justify-content:center; margin-top:20px; flex-wrap:wrap;">
      <button class="btn-nav" id="btnRestart">🔄 Пройти заново</button>
      <a href="index.html" class="btn-nav" style="text-decoration:none;">📚 Ко всем урокам</a>
    </div>
  `;
  slidesContainer.appendChild(resultsSlide);
  slides.push(resultsSlide);

  appState.slides = slides;
  updateNav();
}

/* ============================================================
 * 3. НАВИГАЦИЯ И ПРОВЕРКА ПОЛЕЙ
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

  // Если перешли на слайд результатов — рассчитываем результат
  if (index === appState.slides.length - 1) {
    calculateResults();
  }

  updateNav();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Проверка всех полей ввода на текущем слайде
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
 * 4. ПОДСЧЁТ РЕЗУЛЬТАТОВ И ОЦЕНИВАНИЕ
 * ============================================================ */

function calculateResults() {
  const allInputs = $$("#slidesDeck .math-input");
  let totalScore = 0;
  let maxScore = 0;
  const reviewItems = [];

  // Группировка по группам оценивания (если заданы)
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

    if (grp) {
      if (!groups[grp]) {
        groups[grp] = { ok: true, w: w, qNum, qTitle, userVal: [], correctVal: [] };
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
      });
    }
  });

  // Добавляем групповые задания
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
    });
  });

  // Расчет процента и оценки
  const percent = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
  let grade = 2;
  let gradeText = "2 (Требуется повторение)";
  let gradeClass = "grade-2";

  if (percent >= CONFIG.gradeScale[5]) {
    grade = 5;
    gradeText = "5 (Отлично!) 🎉";
    gradeClass = "grade-5";
  } else if (percent >= CONFIG.gradeScale[4]) {
    grade = 4;
    gradeText = "4 (Хорошо) 👍";
    gradeClass = "grade-4";
  } else if (percent >= CONFIG.gradeScale[3]) {
    grade = 3;
    gradeText = "3 (Удовлетворительно) ✍️";
    gradeClass = "grade-3";
  }

  // Расчет времени решения
  const endTime = new Date();
  const timeDiffSec = Math.round((endTime - appState.startTime) / 1000);
  const minutes = Math.floor(timeDiffSec / 60);
  const seconds = timeDiffSec % 60;
  const timeString = `${minutes} мин ${seconds} сек`;

  appState.results = {
    totalScore,
    maxScore,
    percent,
    grade,
    gradeText,
    timeString,
    reviewItems,
    date: new Date().toLocaleString("ru-RU"),
  };

  // Вывод на экран
  const scoreDisp = $("#scoreDisplay");
  if (scoreDisp) scoreDisp.textContent = `${totalScore} / ${maxScore} баллов`;

  const percDisp = $("#percentDisplay");
  if (percDisp) percDisp.textContent = `${percent}% выполнено`;

  const gradeDisp = $("#gradeDisplay");
  if (gradeDisp) {
    gradeDisp.textContent = `Оценка: ${gradeText}`;
    gradeDisp.className = `grade-badge ${gradeClass}`;
  }

  // Рендеринг таблицы разбора
  const revCont = $("#reviewContainer");
  if (revCont) {
    let tHtml = `
      <table class="review-table">
        <thead>
          <tr>
            <th>№</th>
            <th>Тема задания</th>
            <th>Ваш ответ</th>
            <th>Верный ответ</th>
            <th>Итог</th>
          </tr>
        </thead>
        <tbody>
    `;

    reviewItems.forEach((item) => {
      tHtml += `
        <tr>
          <td><b>${item.qNum}</b></td>
          <td>${formatMath(item.qTitle)}</td>
          <td>${formatMath(item.userVal)}</td>
          <td>${item.isOk ? "—" : `<b>${formatMath(item.correctVal)}</b>`}</td>
          <td>
            <span class="status-tag ${item.isOk ? "status-ok" : "status-bad"}">
              ${item.isOk ? "✓ Верно" : "✗ Ошибка"}
            </span>
          </td>
        </tr>
      `;
    });

    tHtml += `</tbody></table>`;
    revCont.innerHTML = tHtml;
  }
}

/* ============================================================
 * 5. ОТПРАВКА В TELEGRAM BOT API И СКАЧИВАНИЕ ОТЧЁТА
 * ============================================================ */

// Формирование текстового отчёта
function buildTelegramMessage(results) {
  const vData = TASKS[appState.variantKey];
  const name = appState.studentName || "Ученик (без имени)";

  let msg = `📚 <b>Тренажёр по математике · 6 класс</b>\n\n`;
  msg += `👤 <b>Ученик:</b> ${name}\n`;
  msg += `📖 <b>Работа:</b> ${vData.title}\n`;
  msg += `📌 <b>Тема:</b> ${vData.topic}\n`;
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

// Отправка запроса в Telegram
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
  if (!botToken) {
    showStatusMsg("err", "⚠️ Токен Telegram-бота не найден! Введите токен или настройте GitHub Secrets.");
    openTelegramSettingsModal();
    return;
  }

  showStatusMsg("wait", "Отправляю отчёт учителю в Telegram... ⏳");

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
      showStatusMsg("ok", "✅ Результат успешно отправлен учителю в Telegram!");
    } else {
      throw new Error(data.description || `HTTP ${res.status}`);
    }
  } catch (err) {
    console.error("Telegram send error:", err);
    showStatusMsg(
      "err",
      `❌ Ошибка отправки: ${err.message}. Проверьте Chat ID и напишите боту @${CONFIG.telegram.botUsername} команду /start.`
    );
  }
}

// Показ статуса отправки
function showStatusMsg(type, text) {
  const el = $("#sendStatusMsg");
  if (!el) return;
  el.className = `send-status-msg ${type}`;
  el.textContent = text;
}

// Скачивание текстового отчёта файлом (.txt)
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
 * 6. СОБЫТИЯ И КЛАВИАТУРА
 * ============================================================ */

function setupEvents() {
  // Навигационные кнопки
  const prevBtn = $("#btnPrev");
  const nextBtn = $("#btnNext");
  const checkBtn = $("#btnCheck");
  const restartBtn = $("#btnRestart");

  if (prevBtn) prevBtn.addEventListener("click", () => goToSlide(appState.currentSlide - 1));
  if (nextBtn) nextBtn.addEventListener("click", () => goToSlide(appState.currentSlide + 1));
  if (checkBtn) checkBtn.addEventListener("click", checkCurrentSlide);
  if (restartBtn) restartBtn.addEventListener("click", () => loadVariant(appState.variantKey));

  // Кнопка отправки в Telegram
  const sendBtn = $("#btnSendTelegram");
  if (sendBtn) sendBtn.addEventListener("click", sendToTelegram);

  // Кнопка скачивания файла
  const dlBtn = $("#btnDownloadReport");
  if (dlBtn) dlBtn.addEventListener("click", downloadReport);

  // Клавиатурные сокращения
  document.addEventListener("keydown", (e) => {
    // Не перехватываем, если открыто модальное окно или фокус в текстовом поле
    if (e.target.tagName === "INPUT" && e.key === "Enter") {
      checkCurrentSlide();
      return;
    }
    if (e.target.tagName === "INPUT") return;

    if (e.key === "ArrowRight") {
      goToSlide(appState.currentSlide + 1);
    } else if (e.key === "ArrowLeft") {
      goToSlide(appState.currentSlide - 1);
    }
  });
}

/* ============================================================
 * 7. МОДАЛЬНЫЕ ОКНА: ТЕОРИЯ И НАСТРОЙКИ TELEGRAM
 * ============================================================ */

// Открытие теории к уроку
function openTheoryModal(lessonNum) {
  const modal = $("#theoryModal");
  const content = $("#theoryContent");
  if (!modal || !content) return;

  const data = THEORY_DATA[lessonNum];
  if (!data) return;

  let html = `
    <h3 class="modal-title">📖 Урок ${lessonNum}. ${data.title}</h3>
    <div style="font-size:13.5px; color:#8c7857; margin-bottom:12px;">
      УМК: <b>${data.umk}</b> · <span class="badge badge-adv">${data.badge}</span>
    </div>
    <div style="margin-bottom:14px;">
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
}

function closeTheoryModal() {
  const modal = $("#theoryModal");
  if (modal) modal.classList.remove("open");
}

// Открытие окна настроек Telegram
function openTelegramSettingsModal() {
  const modal = $("#settingsModal");
  if (!modal) return;

  const currentChatId = getTelegramChatId();
  const input = $("#settingChatId");
  if (input) input.value = currentChatId;

  modal.classList.add("open");
}

function closeTelegramSettingsModal() {
  const modal = $("#settingsModal");
  if (modal) modal.classList.remove("open");
}

// Сохранение Chat ID
function saveTelegramSettings() {
  const input = $("#settingChatId");
  const msgEl = $("#settingStatusMsg");
  if (!input) return;

  const chatId = input.value.trim();
  setTelegramChatId(chatId);

  if (msgEl) {
    msgEl.className = "send-status-msg ok";
    msgEl.textContent = "✅ Chat ID успешно сохранён в браузере!";
    setTimeout(() => {
      closeTelegramSettingsModal();
    }, 1200);
  }
}

// Тестовая отправка сообщения из настроек
async function testTelegramPing() {
  const input = $("#settingChatId");
  const msgEl = $("#settingStatusMsg");
  if (!input) return;

  const chatId = input.value.trim();
  if (!chatId) {
    if (msgEl) {
      msgEl.className = "send-status-msg err";
      msgEl.textContent = "⚠️ Сначала введите Chat ID!";
    }
    return;
  }

  if (msgEl) {
    msgEl.className = "send-status-msg wait";
    msgEl.textContent = "Отправляю тестовый сигнал боту... ⏳";
  }

  const botToken = getTelegramBotToken();
  if (!botToken) {
    if (msgEl) {
      msgEl.className = "send-status-msg err";
      msgEl.textContent = "⚠️ Токен Telegram-бота не найден!";
    }
    return;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: `🔔 <b>Тестовое подключение успешно!</b>\n\nТренажёр по математике (6 класс) подключён к Telegram-боту @${CONFIG.telegram.botUsername}. Отчёты учеников будут приходить в этот чат! 🎉`,
        parse_mode: "HTML",
      }),
    });

    const data = await res.json();
    if (res.ok && data.ok) {
      setTelegramChatId(chatId);
      if (msgEl) {
        msgEl.className = "send-status-msg ok";
        msgEl.textContent = "🎉 Сообщение доставлено в Telegram! Связь установлена.";
      }
    } else {
      throw new Error(data.description || `HTTP ${res.status}`);
    }
  } catch (err) {
    if (msgEl) {
      msgEl.className = "send-status-msg err";
      msgEl.textContent = `❌ Ошибка: ${err.message}. Убедитесь, что вы нажали /start боту @${CONFIG.telegram.botUsername}.`;
    }
  }
}

// Автозапуск при загрузке страницы
document.addEventListener("DOMContentLoaded", () => {
  if ($("#slidesDeck")) {
    initTrainer();
  }
});
