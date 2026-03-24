const chatLog = document.getElementById('chat-log');
const chatForm = document.getElementById('chat-form');
const messageInput = document.getElementById('message');

const memoryForm = document.getElementById('memory-form');
const taskInput = document.getElementById('task');
const solutionInput = document.getElementById('solution');
const tagsInput = document.getElementById('tags');

const memoryList = document.getElementById('memories');
const refreshBtn = document.getElementById('refresh');

function addMessage(role, text) {
  const wrap = document.createElement('div');
  wrap.className = 'msg';
  wrap.innerHTML = `<div class="role">${role}</div><div class="text"></div>`;
  wrap.querySelector('.text').textContent = text;
  chatLog.appendChild(wrap);
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function sendChat(message) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Chat request failed');
  return data.reply;
}

async function saveMemory(task, solution, tags) {
  const res = await fetch('/api/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, solution, tags }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Memory save failed');
  return data;
}

async function loadMemories() {
  const res = await fetch('/api/memories');
  const data = await res.json();
  memoryList.innerHTML = '';
  (data.items || []).forEach((item) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <strong>${item.task}</strong><br>
      <small>${(item.tags || []).join(', ') || '-'}</small>
      <p>${item.solution}</p>
    `;
    memoryList.appendChild(li);
  });
}

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = messageInput.value.trim();
  if (!message) return;

  addMessage('you', message);
  messageInput.value = '';

  try {
    const reply = await sendChat(message);
    addMessage('assistant', reply);
  } catch (err) {
    addMessage('error', err.message);
  }
});

memoryForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const task = taskInput.value.trim();
  const solution = solutionInput.value.trim();
  const tags = tagsInput.value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  try {
    await saveMemory(task, solution, tags);
    taskInput.value = '';
    solutionInput.value = '';
    tagsInput.value = '';
    await loadMemories();
    addMessage('system', 'Memory saved from UI.');
  } catch (err) {
    addMessage('error', err.message);
  }
});

refreshBtn.addEventListener('click', loadMemories);

addMessage('system', 'IND-AI UI is ready.');
loadMemories();
