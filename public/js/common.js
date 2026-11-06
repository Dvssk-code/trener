// VibeClass — общие клиентские утилиты
window.VC = {
  $(id) {
    return document.getElementById(id);
  },

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  // Добавляет сообщение в чат. from: 'user' | 'ai' | 'sys'
  addMsg(log, from, text, names) {
    var div = document.createElement('div');
    div.className = 'msg ' + from;
    var name = document.createElement('div');
    name.className = 'msg-name';
    name.textContent = names && names[from] ? names[from] : (from === 'user' ? 'Вы' : from === 'ai' ? 'ИИ-ассистент' : '');
    if (name.textContent) div.appendChild(name);
    var body = document.createElement('div');
    body.className = 'msg-text';
    body.textContent = text;
    div.appendChild(body);
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  },

  // Пузырь «печатает… / думает…» с анимированными точками.
  thinking(log, label, names) {
    var div = document.createElement('div');
    div.className = 'msg ai';
    div.dataset.thinking = '1';
    var name = document.createElement('div');
    name.className = 'msg-name';
    name.textContent = names && names.ai ? names.ai : 'ИИ-ассистент';
    var body = document.createElement('div');
    body.className = 'msg-text';
    body.innerHTML = '<span class="typing"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span> ' + label;
    div.appendChild(name);
    div.appendChild(body);
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }
};
