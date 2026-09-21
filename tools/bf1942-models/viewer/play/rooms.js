// The P2 lobby: a small DOM panel over the Instant Battle screen that lists
// the room server's rooms and joins or creates one. It is deliberately NOT
// the engine's own menu (the canvas is the game's and stays that way — the
// engine's join screen wires were never in the extracted layout); the panel
// is the page's addition, in the page's own type. What it talks to is the
// room server's JSON lobby (`GET /netcode/rooms`, the same port and path
// prefix as the WebSocket), and what it launches is the game.
//
// `levels` supplies the level names for CREATE ROOM (the screen's already
// loaded list); `onJoin(room, name, level)` gets fired and index.html builds
// `../map.html?room=...&name=...&map=...`.

const ROOMS_URL = '/netcode/rooms';
const POLL_MS = 3000;

export function createRoomsPanel({ levels, onJoin }) {
  const host = document.createElement('div');
  host.className = 'rooms-panel';
  host.innerHTML = `
    <div class="rooms-head">PLAY ONLINE</div>
    <div class="rooms-list" role="listbox" aria-label="Rooms"></div>
    <div class="rooms-empty">no rooms running</div>
    <label class="rooms-field">ROOM <input class="rooms-code" maxlength="24" spellcheck="false"></label>
    <label class="rooms-field">NAME <input class="rooms-name" maxlength="24" value="Player"></label>
    <div class="rooms-actions">
      <button class="rooms-join">JOIN</button>
      <button class="rooms-create">CREATE</button>
    </div>
    <div class="rooms-status"></div>
    <div class="rooms-issue" hidden>
      <div class="rooms-issue-panel" role="alertdialog" aria-label="Room problem">
        <div class="rooms-issue-title">ROOM</div>
        <p class="rooms-issue-message"></p>
        <div class="rooms-actions">
          <button class="rooms-issue-ok">OK</button>
        </div>
      </div>
    </div>`;

  const list = host.querySelector('.rooms-list');
  const empty = host.querySelector('.rooms-empty');
  const code = host.querySelector('.rooms-code');
  const name = host.querySelector('.rooms-name');
  const status = host.querySelector('.rooms-status');
  const issue = host.querySelector('.rooms-issue');
  const issueMessage = host.querySelector('.rooms-issue-message');
  const issueOk = host.querySelector('.rooms-issue-ok');
  const just = ['JOIN', 'CREATE'].map(id => host.querySelector(`.rooms-${id.toLowerCase()}`));
  const [joinBtn, createBtn] = just;

  let rooms = [];
  let timer = null;
  let lastError = null;

  function showIssue(message) {
    issueMessage.textContent = message;
    issue.hidden = false;
    issueOk.focus();
  }
  issueOk.addEventListener('click', () => { issue.hidden = true; });
  issue.addEventListener('click', event => {
    if (event.target === issue) issue.hidden = true;
  });

  async function poll() {
    try {
      const res = await fetch(ROOMS_URL);
      if (!res.ok) throw new Error(String(res.status));
      rooms = await res.json();
      lastError = null;
      if (Array.isArray(rooms)) paint();
    } catch (error) {
      lastError = error;
      paint();
    }
  }

  function paint() {
    const rows = Array.isArray(rooms) ? rooms : [];
    list.textContent = '';
    empty.hidden = rows.length > 0;
    for (const room of rows) {
      const row = document.createElement('div');
      row.className = 'rooms-row';
      row.setAttribute('role', 'option');
      row.textContent = `${room.code} · ${room.level} · ${room.players}/${room.max}`;
      row.addEventListener('click', () => {
        code.value = room.code;
        code.focus();
      });
      list.appendChild(row);
    }
    status.textContent = lastError
      ? `room server unreachable (${lastError.message})`
      : rows.length ? `${rows.length} room${rows.length === 1 ? '' : 's'}` : '';
  }

  function join(level) {
    // A room server that isn't answering must say so here, before the
    // navigation into map.html (whose own modal would say the same thing a
    // level-load later) — the player gets the reason now, not after the
    // page has already reset.
    if (lastError) {
      showIssue('THE ROOM SERVER ISN\'T ANSWERING\n'
        + 'Nothing can be joined until it runs.\n'
        + 'Start it, then try again.');
      return;
    }
    const room = code.value.trim();
    if (!room) {
      status.textContent = 'type a room code';
      return;
    }
    onJoin(room, name.value.trim() || 'Player', level);
  }

  joinBtn.addEventListener('click', () => join(null));
  createBtn.addEventListener('click', () => {
    const level = levels()?.[0]?.name ?? null;
    if (!level) {
      status.textContent = 'no level loaded to create a room on';
      return;
    }
    join(level);
  });
  code.addEventListener('keydown', event => {
    if (event.key === 'Enter') joinBtn.click();
  });

  host.hidden = true;
  document.body.appendChild(host);

  return {
    show() {
      host.hidden = false;
      poll();
      timer = setInterval(poll, POLL_MS);
      code.focus();
    },
    hide() {
      host.hidden = true;
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
    get visible() { return !host.hidden; },
    refresh: poll,
  };
}