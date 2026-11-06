// Тест API VibeClass: лимит, счётчик попыток, «подмена» на 4-й попытке, submit, play, reset.
// Запуск: node scripts/chat-test.js
'use strict';

const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test123';
const TEAM = process.env.TEST_TEAM || '1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;

function check(name, cond, extra) {
  const mark = cond ? 'OK  ' : 'FAIL';
  console.log(`[${mark}] ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failed += 1;
}

async function post(url, body) {
  const r = await fetch(BASE + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  let j = null;
  try { j = await r.json(); } catch (e) { /* не json */ }
  return { status: r.status, j };
}

async function main() {
  const fallbackCode = fs.readFileSync(
    path.join(__dirname, '..', 'fallback', 'team' + TEAM + '.html'),
    'utf8'
  );

  // 0. Сброс к чистому состоянию
  let r = await post('/api/reset', { password: 'wrong-password' });
  check('reset с неверным паролем -> 401', r.status === 401);
  r = await post('/api/reset', { password: ADMIN_PASSWORD });
  check('reset с паролем -> 200', r.status === 200 && r.j.ok === true);

  // 1. Попытка 1 (без ключей YandexGPT — сервер обязан ответить fallback-ом без ошибок)
  r = await post('/api/chat', { team: TEAM, prompt: 'Сделай мою игру' });
  check('attempt 1 -> 200', r.status === 200);
  check('attempt 1: поля ровно reply/code/attempt',
    r.j && Object.keys(r.j).sort().join(',') === 'attempt,code,reply',
    r.j ? Object.keys(r.j).sort().join(',') : '');
  check('attempt 1: attempt=1', r.j.attempt === 1);
  check('attempt 1: code = fallback', r.j.code === fallbackCode);
  check('attempt 1: reply — строка без слов fallback/source',
    typeof r.j.reply === 'string' && r.j.reply.length > 0 &&
    !/fallback|source|source|error|ошибк/i.test(JSON.stringify(r.j.reply)));

  // 2. Лимит: второй запрос сразу -> 429
  r = await post('/api/chat', { team: TEAM, prompt: 'ещё раз' });
  check('сразу второй запрос -> 429', r.status === 429);

  // 3. Попытка 2 после паузы 5.3с
  await sleep(5300);
  r = await post('/api/chat', { team: TEAM, prompt: 'добавь очки' });
  check('attempt 2 -> 200, attempt=2', r.status === 200 && r.j.attempt === 2);

  // 4. Попытка 3
  await sleep(5300);
  r = await post('/api/chat', { team: TEAM, prompt: 'сделай красиво' });
  check('attempt 3 -> 200, attempt=3', r.status === 200 && r.j.attempt === 3);

  // 5. Попытка 4 — «подмена»: задержка 6–9 с, точный текст, код из fallback
  await sleep(5300);
  const t4start = Date.now();
  r = await post('/api/chat', { team: TEAM, prompt: 'а теперь так, как я хотел' });
  const t4ms = Date.now() - t4start;
  check('attempt 4 -> 200, attempt=4', r.status === 200 && r.j.attempt === 4);
  check('attempt 4: задержка 6–9 с', t4ms >= 6000 && t4ms <= 9200, (t4ms / 1000).toFixed(1) + 'с');
  check('attempt 4: точный reply',
    r.j.reply === 'Ребята, я вас наконец понял! Вот то, что вы хотели.');
  check('attempt 4: code = fallback', r.j.code === fallbackCode);
  check('attempt 4: поля ровно reply/code/attempt',
    Object.keys(r.j).sort().join(',') === 'attempt,code,reply');

  // 6. Валидация
  r = await post('/api/chat', { team: 99, prompt: 'x' });
  check('team=99 -> 400', r.status === 400);
  r = await post('/api/chat', { team: TEAM, prompt: '' });
  check('пустой prompt -> 400', r.status === 400);

  // 7. Отправка работы
  const gameCode = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>Моя игра</body></html>';
  r = await post('/api/submit', { team: TEAM, code: gameCode });
  check('submit -> 200, ok=true', r.status === 200 && r.j.ok === true);
  check('submit: url', typeof r.j.url === 'string' && r.j.url.endsWith('/play/' + TEAM), r.j.url);

  let g = await fetch(BASE + '/api/submissions');
  let data = await g.json();
  check('submissions: team submitted=true', data.teams[TEAM].submitted === true);

  g = await fetch(BASE + '/play/' + TEAM);
  check('GET /play -> 200', g.status === 200);
  const played = await g.text();
  check('/play отдаёт отправленный код', played === gameCode);

  r = await post('/api/submit', { team: TEAM, code: 'x'.repeat(200 * 1024 + 1) });
  check('submit > 200 КБ -> 400', r.status === 400);

  // 8. Сброс
  r = await post('/api/reset', { password: ADMIN_PASSWORD });
  check('reset -> 200', r.status === 200);
  g = await fetch(BASE + '/api/submissions');
  data = await g.json();
  check('после reset: submitted=false', data.teams[TEAM].submitted === false);
  g = await fetch(BASE + '/play/' + TEAM);
  check('после reset: /play -> 404', g.status === 404);

  console.log(failed === 0 ? '\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : '\nПРОВАЛЕНО ПРОВЕРОК: ' + failed);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Сбой теста:', e.message);
  process.exit(1);
});
