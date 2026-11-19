/* ============================================================
 * CONFIG.JS — НАСТРОЙКИ ТРЕНАЖЁРА 6 КЛАССА
 * ============================================================
 * Токен бота и Chat ID НЕ хранятся в открытом виде в публичном репозитории!
 * При развёртывании через GitHub Actions они безопасно внедряются
 * из GitHub Secrets:
 *   - TELEGRAM_BOT_TOKEN
 *   - TELEGRAM_CHAT_ID
 *
 * Также поддерживается переопределение через меню настроек на сайте
 * (сохраняется в локальном браузере через localStorage).
 * ============================================================ */

const CONFIG = {
  // Telegram Bot API
  telegram: {
    // Плейсхолдеры для безопасного внедрения через GitHub Actions Secrets
    botToken: "__TELEGRAM_BOT_TOKEN__",
    chatId: "__TELEGRAM_CHAT_ID__",
    defaultChatId: "7928474241",
    botUsername: "math6gradeZVEROK_bot",
  },

  // Имя учителя или учебного заведения по умолчанию
  teacherName: "Учитель математики",
  schoolName: "6 класс · Математика (ФГОС / ФОП)",

  // Шкала оценивания по ФГОС (в процентах от максимума)
  gradeScale: {
    5: 85, // от 85% — оценка «5» (Отлично)
    4: 68, // от 68% — оценка «4» (Хорошо)
    3: 50, // от 50% — оценка «3» (Удовлетворительно)
    2: 0,  // менее 50% — оценка «2»
  },

  // Вспомогательные каналы (при необходимости)
  emailjs: {
    serviceId: "",
    templateId: "",
    publicKey: "",
  },
  formspree: {
    endpoint: "",
  }
};

// Функция получения актуального токена бота
function getTelegramBotToken() {
  const localToken = localStorage.getItem("math6_telegram_bot_token");
  if (localToken && localToken.trim()) {
    return localToken.trim();
  }
  if (CONFIG.telegram.botToken && !CONFIG.telegram.botToken.startsWith("__")) {
    return CONFIG.telegram.botToken.trim();
  }
  return "";
}

// Функция получения актуального chatId (из config или из localStorage)
function getTelegramChatId() {
  const localChatId =
    localStorage.getItem("math6_telegram_chat_id") ||
    localStorage.getItem("math6_tg_chat_id") ||
    localStorage.getItem("math6_student_chat_id");
  if (localChatId && localChatId.trim()) {
    return localChatId.trim();
  }
  if (CONFIG.telegram.chatId && !CONFIG.telegram.chatId.startsWith("__")) {
    return CONFIG.telegram.chatId.trim();
  }
  return CONFIG.telegram.defaultChatId || "7928474241";
}

// Функция сохранения chatId в localStorage
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

// Функция сохранения токена в localStorage (для локального тестирования)
function setTelegramBotToken(token) {
  if (token) {
    localStorage.setItem("math6_telegram_bot_token", token.trim());
  } else {
    localStorage.removeItem("math6_telegram_bot_token");
  }
}

if (typeof window !== "undefined") {
  window.CONFIG = CONFIG;
  window.getTelegramBotToken = getTelegramBotToken;
  window.getTelegramChatId = getTelegramChatId;
  window.setTelegramChatId = setTelegramChatId;
  window.setTelegramBotToken = setTelegramBotToken;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { CONFIG, getTelegramBotToken, getTelegramChatId, setTelegramChatId, setTelegramBotToken };
}
