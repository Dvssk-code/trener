// VibeClass — страница учителя
(function () {
  'use strict';

  var NAMES = { teacher: 'Учитель', ai: 'ИИ-ассистент' };
  var THEMES = { '1': 'Лови звёзды', '2': 'Найди пару', '3': 'Тап-раннер' };

  var chatLog = VC.$('chatLog');
  var editor = VC.$('editor');
  var btnNext = VC.$('btnNext');
  var btnRestart = VC.$('btnRestart');
  var btnRun = VC.$('btnRun');
  var autoPlay = VC.$('autoPlay');

  var scenario = [];
  var idx = 0;
  var timer = null;
  var demoDone = false;
  var demoCode = null;

  // ---------- Сценарий ----------

  function showLine() {
    if (idx >= scenario.length) return;
    var item = scenario[idx];
    idx += 1;

    if (item.from === 'ai') {
      var bubble = VC.thinking(chatLog, 'печатает…', NAMES);
      VC.sleep(1100).then(function () {
        bubble.remove();
        VC.addMsg(chatLog, 'ai', item.text, NAMES);
      });
    } else {
      VC.addMsg(chatLog, 'teacher', item.text, NAMES);
    }
    scheduleNext();
  }

  function scheduleNext() {
    clearTimeout(timer);
    timer = null;
    if (!autoPlay.checked) return;
    if (idx >= scenario.length) {
      finishScenario();
      return;
    }
    var prev = idx > 0 ? scenario[idx - 1] : null;
    var delay = Math.max(700, (prev && prev.delay) || 700);
    timer = setTimeout(showLine, delay);
  }

  async function finishScenario() {
    if (demoDone) return;
    demoDone = true;
    btnNext.disabled = true;
    if (!demoCode) {
      try {
        var r = await fetch('/api/demo');
        demoCode = r.ok ? await r.text() : '';
      } catch (e) {
        demoCode = '';
      }
    }
    VC.addMsg(chatLog, 'sys', 'Сценарий завершён — печатаю код демо-игры в редактор…');
    typeCode(editor, demoCode);
  }

  function typeCode(el, text) {
    el.value = '';
    var i = 0;
    var skip = { v: false };
    var onSkip = function () { skip.v = true; };
    el.addEventListener('click', onSkip);
    (function tick() {
      if (skip.v) {
        el.value = text;
        el.removeEventListener('click', onSkip);
        return;
      }
      i += 12 + Math.floor(Math.random() * 22);
      el.value = text.slice(0, i);
      el.scrollTop = el.scrollHeight;
      if (i < text.length) setTimeout(tick, 24);
    })();
  }

  async function restart() {
    clearTimeout(timer);
    idx = 0;
    demoDone = false;
    chatLog.innerHTML = '';
    editor.value = '';
    btnNext.disabled = false;
    VC.addMsg(chatLog, 'sys', 'Перезапускаю сценарий…');
    await VC.sleep(600);
    showLine();
  }

  // ---------- Запуск игры ----------

  btnRun.addEventListener('click', function () {
    var code = editor.value;
    if (!code.trim()) {
      alert('В редакторе пока пусто. Дождитесь конца сценария или вставьте код сами.');
      return;
    }
    VC.$('iframe').srcdoc = code;
    VC.$('gameFrame').hidden = false;
    VC.$('gameFrame').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  VC.$('btnCloseFrame').addEventListener('click', function () {
    VC.$('gameFrame').hidden = true;
    VC.$('iframe').srcdoc = '';
  });

  // ---------- Карточки команд + QR ----------

  var cards = {};

  function buildCards() {
    var wrap = VC.$('teamCards');
    wrap.innerHTML = '';
    cards = {};
    ['1', '2', '3'].forEach(function (t) {
      var card = document.createElement('div');
      card.className = 'team-card';
      card.innerHTML =
        '<div class="tc-head">Команда ' + t + ' <span class="tc-theme">' + THEMES[t] + '</span></div>' +
        '<div class="tc-body waiting">Ждём, пока команда отправит игру…</div>';
      wrap.appendChild(card);
      cards[t] = card;
    });
  }

  function pollSubmissions() {
    fetch('/api/submissions')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        ['1', '2', '3'].forEach(function (t) {
          var info = data.teams[t];
          var body = cards[t].querySelector('.tc-body');
          if (!body) return;
          if (info.submitted && !body.classList.contains('qr')) {
            body.classList.remove('waiting');
            body.classList.add('qr');
            body.innerHTML =
              '<div class="qr-box"></div>' +
              '<a class="tc-link" target="_blank" rel="noopener">Открыть игру ↗</a>';
            body.querySelector('.tc-link').href = info.url;
            var box = body.querySelector('.qr-box');
            new QRCode(box, {
              text: info.url,
              width: 120,
              height: 120,
              colorDark: '#0a0e1a',
              colorLight: '#ffffff',
              correctLevel: QRCode.CorrectLevel.M
            });
          } else if (!info.submitted && body.classList.contains('qr')) {
            body.classList.remove('qr');
            body.classList.add('waiting');
            body.innerHTML = 'Ждём, пока команда отправит игру…';
          }
        });
      })
      .catch(function () { /* сервер временно недоступен — просто ждём */ });
  }

  // ---------- Сброс урока ----------

  VC.$('btnReset').addEventListener('click', async function () {
    var p = prompt('Пароль для сброса урока:');
    if (p === null) return;
    try {
      var r = await fetch('/api/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: p })
      });
      var j = await r.json();
      if (r.ok) {
        alert('Урок сброшен: счётчики и работы команд очищены.');
        location.reload();
      } else {
        alert(j.error || 'Не удалось сбросить');
      }
    } catch (e) {
      alert('Ошибка сети');
    }
  });

  // ---------- Старт ----------

  buildCards();
  pollSubmissions();
  setInterval(pollSubmissions, 3000);

  btnNext.addEventListener('click', function () {
    if (idx >= scenario.length) return;
    clearTimeout(timer);
    showLine();
  });

  btnRestart.addEventListener('click', restart);

  fetch('/api/scenario')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      scenario = Array.isArray(data) ? data : [];
      if (!scenario.length) {
        VC.addMsg(chatLog, 'sys', 'Сценарий не найден на сервере.');
        return;
      }
      VC.addMsg(chatLog, 'sys', 'Демонстрация урока. Реплики появляются автоматически — или жмите «Следующая реплика».');
      scheduleNext();
    })
    .catch(function () {
      VC.addMsg(chatLog, 'sys', 'Не удалось загрузить сценарий.');
    });
})();
