// VibeClass — страница ученика
(function () {
  'use strict';

  var NAMES = { user: 'Вы', ai: 'ИИ-ассистент' };
  var TEAM_KEY = 'vibeclass.team';

  var TEAM = sessionStorage.getItem(TEAM_KEY);
  var lastAttempt = 0;
  var busy = false;

  var chatLog = VC.$('chatLog');

  // ---------- Выбор команды ----------

  function showTeamSelect() {
    VC.$('teamSelect').hidden = false;
    VC.$('work').hidden = true;
    VC.$('btnSwitchTeam').hidden = true;
  }

  function showWork() {
    VC.$('teamSelect').hidden = true;
    VC.$('work').hidden = false;
    VC.$('btnSwitchTeam').hidden = false;
    if (!chatLog.children.length) {
      VC.addMsg(chatLog, 'ai',
        'Привет! Я помощник для создания игры 🤖 Опиши словами, что нужно сделать или что изменить, — и я напишу код. У тебя 3 попытки, потом я точно пойму, что ты хочешь!',
        NAMES);
    }
  }

  document.querySelectorAll('.team-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      TEAM = btn.getAttribute('data-team');
      sessionStorage.setItem(TEAM_KEY, TEAM);
      lastAttempt = 0;
      VC.$('attempt').textContent = 'Попытка 0 из 3';
      showWork();
    });
  });

  VC.$('btnSwitchTeam').addEventListener('click', function (e) {
    e.preventDefault();
    sessionStorage.removeItem(TEAM_KEY);
    location.reload();
  });

  // ---------- Чат с ИИ ----------

  function updateAttempt(n) {
    lastAttempt = n;
    VC.$('attempt').textContent = 'Попытка ' + n + ' из 3';
  }

  function updatePreview() {
    var code = VC.$('editor').value;
    if (code.trim()) VC.$('preview').srcdoc = code;
  }

  VC.$('btnPreview').addEventListener('click', function () {
    VC.$('preview').srcdoc = VC.$('editor').value;
  });

  async function send() {
    if (busy) return;
    var input = VC.$('promptInput');
    var prompt = input.value.trim();
    if (!prompt) return;
    if (prompt.length > 1000) {
      alert('Слишком длинный запрос — до 1000 символов.');
      return;
    }

    input.value = '';
    VC.addMsg(chatLog, 'user', prompt, NAMES);
    busy = true;
    VC.$('btnSend').disabled = true;

    var thinking = VC.thinking(chatLog, 'ИИ думает…', NAMES);
    try {
      var r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team: TEAM, prompt: prompt })
      });
      thinking.remove();
      var j = await r.json();

      if (r.status === 429) {
        VC.addMsg(chatLog, 'sys', j.error || 'Подождите несколько секунд и попробуйте снова.');
        input.value = prompt;
        return;
      }
      if (!r.ok) {
        VC.addMsg(chatLog, 'sys', j.error || 'Что-то пошло не так. Попробуйте ещё раз.');
        input.value = prompt;
        return;
      }

      VC.addMsg(chatLog, 'ai', j.reply, NAMES);
      if (j.code) {
        VC.$('editor').value = j.code;
        VC.$('preview').srcdoc = j.code;
      }
      updateAttempt(j.attempt || lastAttempt);
    } catch (e) {
      thinking.remove();
      VC.addMsg(chatLog, 'sys', 'Ошибка сети. Попробуйте ещё раз.');
      input.value = prompt;
    } finally {
      busy = false;
      VC.$('btnSend').disabled = false;
      input.focus();
    }
  }

  VC.$('btnSend').addEventListener('click', send);
  VC.$('promptInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  // ---------- Отправка учителю + QR-церемония ----------

  VC.$('btnSubmit').addEventListener('click', async function () {
    var code = VC.$('editor').value;
    if (!code.trim()) {
      alert('Код пока пустой. Сначала попросите ИИ сделать игру!');
      return;
    }
    VC.$('btnSubmit').disabled = true;
    try {
      var r = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team: TEAM, code: code })
      });
      var j = await r.json();
      if (!r.ok) {
        alert(j.error || 'Не удалось отправить');
        VC.$('btnSubmit').disabled = false;
        return;
      }
      startQrCeremony(j.url);
    } catch (e) {
      alert('Ошибка сети');
      VC.$('btnSubmit').disabled = false;
    }
  });

  function startQrCeremony(url) {
    var overlay = VC.$('qrOverlay');
    var phase = VC.$('qrPhase');
    var done = VC.$('qrDone');
    var bar = VC.$('qrProgress');
    var statusEl = VC.$('qrStatus');

    overlay.hidden = false;
    phase.hidden = false;
    done.hidden = true;

    // Неоновый прогресс-бар: 9 секунд
    bar.style.transition = 'none';
    bar.style.width = '0%';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        bar.style.transition = 'width 9s linear';
        bar.style.width = '100%';
      });
    });

    var steps = [
      [0, 'Упаковываем код'],
      [2300, 'Проверяем игру'],
      [4600, 'Создаём ссылку'],
      [6900, 'Генерируем QR']
    ];
    steps.forEach(function (s) {
      setTimeout(function () { statusEl.textContent = s[1]; }, s[0]);
    });

    setTimeout(function () {
      phase.hidden = true;
      done.hidden = false;
      var box = VC.$('qrBox');
      box.innerHTML = '';
      new QRCode(box, {
        text: url,
        width: 190,
        height: 190,
        colorDark: '#0a0e1a',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
      VC.$('qrLink').href = url;
    }, 9200);
  }

  // ---------- Старт ----------

  if (TEAM) {
    showWork();
  } else {
    showTeamSelect();
  }
})();
