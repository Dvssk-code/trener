'use strict';

// VibeClass — сервер урока вайб-кодинга.
// Секреты читаются ТОЛЬКО из process.env (.env при локальном запуске).

require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const YANDEX_API_KEY = process.env.YANDEX_API_KEY || '';
const YANDEX_FOLDER_ID = process.env.YANDEX_FOLDER_ID || '';
const BASE_URL = (process.env.BASE_URL || '').replace(/\/+$/, '') || `http://localhost:${PORT}`;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data.json');
const FALLBACK_DIR = path.join(ROOT, 'fallback');
const SCENARIO_FILE = path.join(ROOT, 'data', 'scenario.json');
const PROMPTS_FILE = path.join(ROOT, 'data', 'prompts.json');
const DEMO_FILE = path.join(ROOT, 'demo', 'demo-game.html');

const TEAMS = ['1', '2', '3'];
const MAX_PROMPT = 1000;
const MAX_CODE = 200 * 1024;
const RATE_LIMIT_MS = 5000;
const YANDEX_TIMEOUT_MS = 25000;
const YANDEX_URL = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';

// ---------------- Состояние ----------------
// Для каждой команды: { attempts, history, code, submitted }.
// Счётчик попыток ведётся ТОЛЬКО здесь, на сервере.

function defaultTeam() {
  return { attempts: 0, history: [], code: null, submitted: false };
}

function freshState() {
  return { teams: { '1': defaultTeam(), '2': defaultTeam(), '3': defaultTeam() } };
}

let state = freshState();
const lastChatAt = { '1': 0, '2': 0, '3': 0 };
const prompts = { '1': '', '2': '', '3': '' };

function loadPrompts() {
  try {
    const raw = JSON.parse(fs.readFileSync(PROMPTS_FILE, 'utf8'));
    for (const t of TEAMS) {
      if (typeof raw[t] === 'string' && raw[t].trim()) prompts[t] = raw[t];
    }
  } catch (e) {
    console.error('prompts.json не найден или не читается: ' + e.message);
  }
}

function loadState() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      saveState();
      return;
    }
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const st = freshState();
    for (const t of TEAMS) {
      const team = raw && raw.teams && raw.teams[t];
      if (team) {
        st.teams[t] = {
          attempts: Number(team.attempts) || 0,
          history: Array.isArray(team.history) ? team.history : [],
          code: typeof team.code === 'string' ? team.code : null,
          submitted: Boolean(team.submitted)
        };
      }
    }
    state = st;
  } catch (e) {
    console.error('data.json повреждён, начинаем с чистого состояния: ' + e.message);
    state = freshState();
  }
}

function saveState() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.error('Не удалось сохранить data.json: ' + e.message);
  }
}

function readFallback(team) {
  return fs.readFileSync(path.join(FALLBACK_DIR, 'team' + team + '.html'), 'utf8');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTeam(v) {
  const s = String(v === null || v === undefined ? '' : v).trim();
  return TEAMS.includes(s) ? s : null;
}

// ---------------- YandexGPT ----------------

// Достаём HTML из ответа модели: блок ```html ... ``` либо весь текст.
function extractHtml(text) {
  let m = text.match(/```html\r?\n([\s\S]*?)```/i);
  if (m) return m[1].trim();
  m = text.match(/```\r?\n?([\s\S]*?)```/);
  if (m) return m[1].trim();
  return text.trim();
}

async function callYandexGPT(team, teamState) {
  const messages = [{ role: 'system', text: prompts[team] || '' }];
  for (const h of teamState.history) {
    if (h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string') {
      messages.push({ role: h.role, text: h.content });
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), YANDEX_TIMEOUT_MS);

  let resp;
  try {
    resp = await fetch(YANDEX_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Api-Key ' + YANDEX_API_KEY,
        'x-folder-id': YANDEX_FOLDER_ID
      },
      body: JSON.stringify({
        modelUri: 'gpt://' + YANDEX_FOLDER_ID + '/yandexgpt/latest',
        completionOptions: { stream: false, temperature: 0.3, maxTokens: 6000 },
        messages
      }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) throw new Error('YandexGPT HTTP ' + resp.status);

  const body = await resp.json();
  const alt = body && body.result && body.result.alternatives && body.result.alternatives[0];
  const text = alt && alt.message && typeof alt.message.text === 'string' ? alt.message.text : '';
  if (!text.trim()) throw new Error('Пустой ответ YandexGPT');

  const code = extractHtml(text);
  if (!code) throw new Error('В ответе YandexGPT нет кода');

  // Короткое сообщение для чата — текст вне блока кода (если модель что-то написала).
  let reply = text
    .replace(/```html\r?\n?[\s\S]*?```/i, '')
    .replace(/```\r?\n?[\s\S]*?```/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!reply) reply = 'Обновил код, загляни в новую версию игры!';

  return { reply, code };
}

// ---------------- Приложение ----------------

const app = express();
app.use(express.json({ limit: '350kb' }));
app.use(express.static(path.join(ROOT, 'public')));

// Явные страницы (без расширения)
app.get('/teacher', (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'teacher.html'));
});

app.get('/student', (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'student.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/scenario', (req, res) => {
  res.sendFile(SCENARIO_FILE, (err) => {
    if (err && !res.headersSent) res.status(500).json({ error: 'Сценарий недоступен' });
  });
});

app.get('/api/demo', (req, res) => {
  res.type('html').sendFile(DEMO_FILE, (err) => {
    if (err && !res.headersSent) res.status(500).json({ error: 'Демо недоступно' });
  });
});

app.get('/api/submissions', (req, res) => {
  const teams = {};
  for (const t of TEAMS) {
    const team = state.teams[t];
    teams[t] = {
      submitted: team.submitted,
      url: BASE_URL + '/play/' + t
    };
  }
  res.json({ teams });
});

// ---------------- Чат с «ИИ» (имитация + подмена) ----------------
// Ответы попыток 1–3 и попытки 4+ приходят в ОДИНАКОВОМ формате:
// { reply, code, attempt }. Никаких полей-указателей на источник.

app.post('/api/chat', async (req, res) => {
  try {
    const body = req.body || {};
    const team = normalizeTeam(body.team);
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';

    if (!team) return res.status(400).json({ error: 'Некорректная команда (1, 2 или 3)' });
    if (!prompt) return res.status(400).json({ error: 'Напишите запрос ИИ' });
    if (prompt.length > MAX_PROMPT) {
      return res.status(400).json({ error: 'Запрос слишком длинный (до ' + MAX_PROMPT + ' символов)' });
    }

    const now = Date.now();
    if (now - (lastChatAt[team] || 0) < RATE_LIMIT_MS) {
      return res.status(429).json({ error: 'Подождите несколько секунд и попробуйте снова' });
    }
    lastChatAt[team] = now;

    const t = state.teams[team];
    t.attempts += 1;
    t.history.push({ role: 'user', content: prompt });

    let reply;
    let code;

    if (t.attempts >= 4) {
      // «ИИ наконец понял»: готовое решение + пауза как у настоящей генерации
      await sleep(6000 + Math.random() * 3000);
      code = readFallback(team);
      reply = 'Ребята, я вас наконец понял! Вот то, что вы хотели.';
    } else {
      let ai = null;
      if (YANDEX_API_KEY && YANDEX_FOLDER_ID) {
        try {
          ai = await callYandexGPT(team, t);
        } catch (e) {
          ai = null; // ошибка/таймаут — ответим в том же формате, без следов
        }
      }
      if (ai) {
        reply = ai.reply;
        code = ai.code;
      } else {
        code = readFallback(team);
        reply = 'Понял! Делаю новую версию игры для вас.';
      }
    }

    t.code = code;
    t.history.push({ role: 'assistant', content: code });
    saveState();

    res.json({ reply, code, attempt: t.attempts });
  } catch (e) {
    console.error('Ошибка в /api/chat: ' + e.message);
    res.status(500).json({ error: 'Внутренняя ошибка, попробуйте ещё раз' });
  }
});

// ---------------- Отправка работы ----------------

app.post('/api/submit', (req, res) => {
  const body = req.body || {};
  const team = normalizeTeam(body.team);
  const code = typeof body.code === 'string' ? body.code : '';

  if (!team) return res.status(400).json({ error: 'Некорректная команда (1, 2 или 3)' });
  if (!code.trim()) return res.status(400).json({ error: 'Нет кода игры для отправки' });
  if (code.length > MAX_CODE) {
    return res.status(400).json({ error: 'Код игры слишком большой (максимум 200 КБ)' });
  }

  const t = state.teams[team];
  t.code = code;
  t.submitted = true;
  saveState();

  res.json({ ok: true, url: BASE_URL + '/play/' + team });
});

// ---------------- Сброс урока ----------------

app.post('/api/reset', (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Сброс не включён: задайте ADMIN_PASSWORD' });
  }
  const body = req.body || {};
  if (body.password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Неверный пароль' });
  }

  state = freshState();
  for (const t of TEAMS) lastChatAt[t] = 0;
  saveState();

  res.json({ ok: true });
});

// Отдаёт сохранённый код игры команды как обычную HTML-страницу.
app.get('/play/:team', (req, res) => {
  const team = normalizeTeam(req.params.team);
  if (!team) {
    return res.status(404).type('html').send('<meta charset="utf-8"><h3>Команда не найдена</h3>');
  }
  const t = state.teams[team];
  if (!t.code) {
    return res
      .status(404)
      .type('html')
      .send('<meta charset="utf-8"><body style="background:#0a0e1a;color:#8b96b5;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif"><h3>Игра ещё не появилась. Загляни позже!</h3></body>');
  }
  res.type('html').send(t.code);
});

loadPrompts();
loadState();

app.listen(PORT, () => {
  console.log('VibeClass запущен: http://localhost:' + PORT);
});
