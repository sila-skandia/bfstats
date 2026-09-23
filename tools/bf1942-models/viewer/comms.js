/* The radio menu and the message log on the page: the overlay they draw on,
 * the F1..F8 keys, the voice lines, and the game events that write lines.
 *
 * The rules are in `radio.js` (what a key sends, what a message prints and
 * plays) and `chat-log.js` (the three sections, their timers and colours);
 * this is the page half -- fetching the extracted layouts, fonts, icons and
 * voices, and painting in the 800x600 virtual screen the HUD uses, stretched
 * on each axis the way `hud.js` does (VHUD-11).
 *
 * Built once by the page. `page` hands in, as getters: `AUDIO_OFF`,
 * `audioBufferCache`, `audioListener`, `audioLoader`, `bust`,
 * `ensureAudioContext`, `extras`, `flags`, `gridRef`, `hudPaths`,
 * `localAlive`, `localName`, `localPosition`, `localTeam`, `MAPS_BASE`,
 * `masterVolume`, `radioIconType`, `roomSendRadio`, `sprite`, `teamNation`.
 */

import {
  RADIO_MESSAGES, CLOSEST_CONTROL_POINT, LOCAL_RANGE, ICON_ON_FOOT,
  pressRadioKey, isTeamMessage, remapLocal, closestControlPoint, radioChatText,
  radioPatch, RadioSpamLimit, radioGameMode, radioVars, visibleLeaves, leafText,
} from './radio.js';
import {
  ChatLog, SECTION_CHAT, SECTION_INFO, SECTION_KILL, killWord, killLine,
  teamKillLine, deathLine, captureLine, allPointsLine, rowGeometry,
  dividerGeometry, lineColor,
} from './chat-log.js';

const VIRTUAL_W = 800;
const VIRTUAL_H = 600;
const FKEYS = { F1: 1, F2: 2, F3: 3, F4: 4, F5: 5, F6: 6, F7: 7, F8: 8 };

/** The eight 1-px copies the chat outline draws in black under each line
 *  (`chatOutline`, list data +0x1E, on at 0x0045F190). */
const OUTLINE = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

function xyz(p) {
  if (!p) return null;
  if (Array.isArray(p)) return { x: p[0], y: p[1], z: p[2] };
  return { x: p.x, y: p.y, z: p.z };
}

export function createComms(page) {
  const comms = {};
  const canvas = document.getElementById('comms-canvas');
  let radioLayout = null;
  let chatLayout = null;
  let sounds = null;
  let font = null;
  const icons = new Map();
  const tinted = new Map();
  let chat = new ChatLog();
  const spam = new RadioSpamLimit();
  const radio = { category: 0, back: true, idle: 0 };
  /** `game.setRadioToolTip`: the heading under each button (`Radio/
   *  ShowRadioToolTip`). The shipped default profile turns it on; the owner's
   *  own profile turns it off, and his game shows the icons alone, so off is
   *  the page's default. The console word turns it back on. */
  let showToolTip = false;
  let centre = null;           // { text, until }
  let dirty = true;
  let lastSig = '';
  const lastAttack = new Map(); // victim id -> { killer, at }

  // --- loading ---------------------------------------------------------------

  const hudUrl = rel => `${page.hudPaths.url(rel)}${page.bust()}`;
  const sharedDir = () => (page.MAPS_BASE === 'maps' ? 'maps/_shared' : `${page.MAPS_BASE}/_shared`);

  function loadImage(src) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  async function load() {
    try {
      [radioLayout, chatLayout] = await Promise.all([
        fetch(hudUrl('radio-layout.json')).then(r => r.json()),
        fetch(hudUrl('chat-layout.json')).then(r => r.json()),
      ]);
    } catch (error) {
      console.warn('radio / chat layout unavailable', error);
      return;
    }
    chat = new ChatLog({ ...chatLayout.sections,
      timeUntilMessageRemoved: chatLayout.timeUntilMessageRemoved });
    const faceEntry = radioLayout.fontFiles?.standard6;
    const [meta, img] = await Promise.all([
      fetch(hudUrl(faceEntry?.glyphs ?? 'fonts/standard6.json')).then(r => r.json()).catch(() => null),
      loadImage(hudUrl(faceEntry?.file ?? 'fonts/standard6.png')),
    ]);
    if (meta && img) font = { meta, img };
    await Promise.all(Object.entries(radioLayout.icons || {}).map(async ([key, entry]) => {
      const icon = await loadImage(hudUrl(entry.file));
      if (icon) icons.set(key, icon);
    }));
    try {
      sounds = await fetch(`${sharedDir()}/voices/radio-sounds.json${page.bust()}`).then(r => r.json());
    } catch {
      sounds = null;
    }
    dirty = true;
  }
  comms.ready = load();

  // --- the radio state the menu reads -----------------------------------------

  /** The points the F4 page offers, in level order: every control point that
   *  can change hands (0x006D45A0 skips `unableToChangeTeam`), at most six. */
  function radioPoints() {
    return (page.flags || []).filter(f => f && !f.uncapturable && f.controlPointName != null);
  }

  /** A point's name as the engine prints it: `Locale(controlPointName)`,
   *  the key through the lexicon (`SMALL_BRIDGE` -> "Stone Bridge"). */
  function pointLabel(flag) {
    const key = flag?.name ?? '';
    return chatLayout?.names?.[key] ?? key;
  }

  function gameMode() {
    return radioGameMode(page.extras?.gameplayMode);
  }

  function vars() {
    return radioVars(radioLayout, {
      category: radio.category,
      gameMode: gameMode(),
      iconType: page.radioIconType?.() ?? ICON_ON_FOOT,
      controlPointNames: radioPoints().slice(0, 6).map(f => pointLabel(f).toUpperCase()),
      showToolTip,
    });
  }

  comms.radioToolTip = () => showToolTip;
  comms.setRadioToolTip = on => {
    showToolTip = !!on;
    dirty = true;
    return showToolTip;
  };

  /** F1..F8. True when the key was the radio's (and was eaten). */
  comms.keydown = event => {
    const key = FKEYS[event.code];
    if (!key || event.ctrlKey || event.metaKey || event.altKey) return false;
    event.preventDefault();
    if (event.repeat || !radioLayout) return true;
    const points = radioPoints();
    const next = pressRadioKey(radio, key, {
      gameMode: gameMode(),
      controlPoints: Math.min(6, points.length),
    });
    radio.category = next.category;
    radio.back = next.back;
    radio.idle = 0;
    dirty = true;
    if (next.message) send(next.message);
    return true;
  };

  /** The local player sends `id`: resolve CLOSEST, apply the vehicle remap,
   *  run the client's spam limit, then deliver it here the way the sender's
   *  own client does (its receive handler runs at once) and hand it to the
   *  room, whose server relays it to everyone else who should get it. */
  function send(id) {
    if (!page.localAlive?.()) return;
    const at = xyz(page.localPosition?.());
    let message = id;
    if (message === CLOSEST_CONTROL_POINT) {
      const pts = radioPoints().slice(0, 6).map(f => xyz(f.position)).filter(Boolean);
      message = at ? closestControlPoint(pts, at) : null;
      if (message == null) return;
    }
    if (!isTeamMessage(message)) message = remapLocal(message, page.radioIconType?.() ?? ICON_ON_FOOT);
    if (!spam.trySend()) return;
    const speaker = {
      name: page.localName?.() ?? 'Player',
      team: page.localTeam?.() ?? 0,
      position: at,
      local: true,
    };
    receive(message, speaker);
    page.roomSendRadio?.(message, isTeamMessage(message));
  }
  comms.send = send;

  /**
   * A radio message arriving (0x006D3400 team, 0x006D2790 shouted).
   * `speaker`: `{ name, team, position, local }`. Team radio is only ever
   * delivered to the speaker's team; a shout reaches anyone in 70 m but only
   * the speaker's team gets the line.
   */
  function receive(id, speaker) {
    const msg = RADIO_MESSAGES[id];
    if (!msg) return;
    const listenerTeam = page.localTeam?.() ?? 0;
    const team = msg.kind === 'team';
    let defend = false;
    let pointName = null;
    let gridAt = speaker.position;
    if (msg.cp != null) {
      const point = radioPoints()[msg.cp];
      if (!point) return;
      pointName = pointLabel(point);
      defend = point.team === speaker.team;
      gridAt = xyz(point.position) ?? gridAt;
    }
    if (team || speaker.team === listenerTeam) {
      const text = radioChatText(id, {
        name: speaker.name,
        grid: gridAt ? page.gridRef?.(gridAt.x, gridAt.z) : '',
        strings: radioLayout?.strings,
        pointName,
        defend,
      });
      if (text) chat.add(SECTION_CHAT, { text, team: speaker.team, buddy: isBuddy(speaker) });
    }
    const patch = radioPatch(id, defend);
    if (!patch) return;
    if (patch.script === 'radio') {
      playVoice('radio', patch.patch, page.teamNation?.(listenerTeam), null);
    } else {
      const here = xyz(page.localPosition?.());
      if (!speaker.local && here && speaker.position) {
        const d = Math.hypot(here.x - speaker.position.x, here.y - speaker.position.y,
          here.z - speaker.position.z);
        if (d > LOCAL_RANGE) return;
      }
      playVoice('local', patch.patch, page.teamNation?.(speaker.team),
        speaker.local ? null : speaker.position);
    }
    dirty = true;
  }
  comms.receive = receive;

  // --- voices ------------------------------------------------------------------

  const missingVoices = new Set();

  function voiceDirs(nation) {
    const shared = sharedDir();
    const dirs = [];
    if (nation && nation !== 'unknown') {
      dirs.push(`${shared}/voices/${nation}`);
      if (shared !== 'maps/_shared') dirs.push(`maps/_shared/voices/${nation}`);
    }
    dirs.push(`${shared}/voices/us`);
    return dirs;
  }

  async function voiceBuffer(url) {
    if (missingVoices.has(url) || !page.audioLoader) return null;
    const key = `radio:${url}`;
    let pending = page.audioBufferCache.get(key);
    if (!pending) {
      pending = page.audioLoader.loadAsync(`${url}${page.bust()}`).catch(() => {
        missingVoices.add(url);
        page.audioBufferCache.delete(key);
        return null;
      });
      page.audioBufferCache.set(key, pending);
    }
    return pending;
  }

  /**
   * One voice line. Team radio is a flat 2D line in the listener's own
   * language (`MenuRadioSound.ssc`, played by 0x006A5580). A shout is the
   * speaker's `SoldierVoice.ssc` patch in the speaker's language, in 3D on
   * his soldier: `minDistance 3` and a Distance -> Volume ramp, full to 10 m
   * and gone at 55 m -- a linear panner between those two distances. The
   * speaker's own shout is his own voice at his own ear.
   */
  async function playVoice(script, index, nation, position) {
    if (page.AUDIO_OFF || !sounds || page.masterVolume() <= 0) return;
    const patch = sounds[script]?.[index];
    if (!patch?.stems?.length) return;
    page.ensureAudioContext();
    const listener = page.audioListener;
    if (!listener || listener.context.state === 'suspended') return;
    // `randomPlay 1` picks one sample; otherwise every sample is a layer.
    const stems = patch.random
      ? [patch.stems[Math.floor(Math.random() * patch.stems.length)]]
      : patch.stems;
    for (const stem of stems) {
      let buffer = null;
      for (const dir of voiceDirs(nation)) {
        buffer = await voiceBuffer(`${dir}/${stem}.mp3`);
        if (buffer) break;
      }
      if (buffer) playBuffer(listener, buffer, patch, position);
    }
  }

  function playBuffer(listener, buffer, patch, position) {
    const ctx = listener.context;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = page.masterVolume();
    source.connect(gain);
    let panner = null;
    if (position && patch.ramp) {
      panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'linear';
      panner.refDistance = patch.ramp[0];
      panner.maxDistance = patch.ramp[1];
      panner.rolloffFactor = 1;
      panner.positionX.value = position.x;
      panner.positionY.value = position.y + 1.6;
      panner.positionZ.value = position.z;
      gain.connect(panner);
    }
    (panner ?? gain).connect(listener.getInput());
    source.onended = () => {
      try { source.disconnect(); gain.disconnect(); panner?.disconnect(); } catch (_) {}
    };
    try { source.start(); } catch (_) {}
  }

  // --- the game's lines --------------------------------------------------------

  const strings = () => chatLayout?.strings;

  /** A line is green only when its player is on the reader's buddy list
   *  (`BfMap+0x13C`, 0x00468680); the engine has no special case for the
   *  reader himself, so his own lines take his team's colour. The viewer has
   *  no buddy list yet, so this is the hook one would answer through. */
  const isBuddy = player => !!(player && page.isBuddy?.(player));

  /**
   * A soldier died. `victim` and `killer` are `{ id, name, team, local,
   * vehicle }` (`vehicle` the template the killer sat in, if any); `killer`
   * null for a death nobody caused.
   *
   * An ordinary kill prints the killer's line in his colour under his flag
   * (score event 3); the victim's own death is the no-message kind (5). A team
   * kill prints `killer killed a teammate` and the victim's `is no more` (6
   * then 4), both team 0. A death with no killer, or by one's own hand, is
   * `is no more` (4). The victim also gets the line in the centre of his
   * screen (0x006A88E0) when he is the local player.
   */
  comms.onKill = (victim, killer) => {
    let centreText = null;
    if (killer && killer.id !== victim.id) {
      if (killer.team && killer.team === victim.team) {
        chat.add(SECTION_KILL, { text: teamKillLine(killer.name, strings()), team: 0, buddy: isBuddy(killer) });
        const death = deathLine(victim.name, strings());
        chat.add(SECTION_KILL, { text: death, team: 0, buddy: isBuddy(victim) });
        centreText = teamKillLine(killer.name, strings());
      } else {
        const word = killWord(killer.vehicle, strings(), chatLayout?.names);
        const text = killLine(killer.name, victim.name, word);
        chat.add(SECTION_KILL, { text, team: killer.team, buddy: isBuddy(killer) });
        centreText = text;
      }
    } else {
      const text = deathLine(victim.name, strings());
      chat.add(SECTION_KILL, { text, team: 0, buddy: isBuddy(victim) });
      centreText = text;
    }
    if (victim.local && centreText) {
      centre = { text: centreText, until: performance.now() + (chatLayout?.killMessage?.seconds ?? 10) * 1000 };
    }
    dirty = true;
  };

  /** Remember who last hit a player, so a death the page only notices later
   *  (the local soldier's Armor running out) still names its killer. */
  comms.noteAttack = (victimId, killer) => {
    lastAttack.set(victimId, { killer, at: performance.now() });
  };
  comms.lastAttacker = (victimId, withinMs = 5000) => {
    const hit = lastAttack.get(victimId);
    return hit && performance.now() - hit.at <= withinMs ? hit.killer : null;
  };

  /** A control point changed hands: the game-information line, to everyone,
   *  and the all-points line when one side now holds every point. */
  comms.onCapture = (point, team) => {
    if (team !== 1 && team !== 2) return;
    chat.add(SECTION_INFO, { text: captureLine(pointLabel(point), team, strings()), team });
    const points = (page.flags || []).filter(f => f && f.controlPointName != null);
    if (points.length && points.every(f => (f === point ? team : f.team) === team)) {
      chat.add(SECTION_INFO, { text: allPointsLine(team, strings()), team: 0 });
    }
    dirty = true;
  };

  /** A plain line (a room message, a join): game information, no team. */
  comms.info = (text, team = 0) => {
    chat.add(SECTION_INFO, { text, team });
    dirty = true;
  };

  comms.clear = () => {
    chat.clear();
    centre = null;
    radio.category = 0;
    radio.back = true;
    dirty = true;
  };

  // --- per frame -------------------------------------------------------------

  comms.tick = dt => {
    chat.tick(dt);
    spam.tick(dt);
    // The open page's own timeout node: it runs while a page is open and
    // closes it after `Radio/RadioTimeOut` (TimeOutCommandInterface
    // 0x006D2480 returns to the strip, or to off).
    if (radio.category !== 0 && radio.category !== 8 && radioLayout) {
      radio.idle += dt;
      const limit = radioLayout.defaults?.['Radio/RadioTimeOut'] ?? 60;
      if (radio.idle > limit) {
        radio.category = radio.back ? 0 : 8;
        radio.idle = 0;
        dirty = true;
      }
    }
    if (centre && performance.now() > centre.until) {
      centre = null;
      dirty = true;
    }
  };

  // --- painting --------------------------------------------------------------

  function atlas(rgb) {
    const key = rgb.map(v => Math.round(v * 255)).join(',');
    let c = tinted.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = font.img.width;
    c.height = font.img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(font.img, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = `rgb(${key})`;
    ctx.fillRect(0, 0, c.width, c.height);
    tinted.set(key, c);
    return c;
  }

  function measure(text) {
    let w = 0;
    for (const ch of text) {
      const g = font.meta.glyphs[ch.charCodeAt(0)];
      if (g) w += g[0] + g[1] + g[2];
    }
    return w;
  }

  /** Glyphs on a baseline, in one colour. */
  function glyphs(ctx, text, x, baseline, rgb) {
    const sheet = atlas(rgb);
    let pen = x;
    for (const ch of text) {
      const g = font.meta.glyphs[ch.charCodeAt(0)];
      if (!g) continue;
      const [left, width, right, ascent, x0, y0, x1, y1] = g;
      if (ch !== ' ' && width > 0 && y1 > y0) {
        ctx.drawImage(sheet, x0, y0, x1 - x0, y1 - y0, pen + left, baseline - ascent, x1 - x0, y1 - y0);
      }
      pen += left + width + right;
    }
  }

  function text(ctx, str, x, baseline, rgb, outline) {
    if (outline) for (const [dx, dy] of OUTLINE) glyphs(ctx, str, x + dx, baseline + dy, [0, 0, 0]);
    glyphs(ctx, str, x, baseline, rgb);
  }

  function paintRadio(ctx) {
    const v = vars();
    for (const { el, alpha } of visibleLeaves(radioLayout, v)) {
      if (alpha <= 0) continue;
      const [x, y, w, h] = el.rect;
      ctx.globalAlpha = alpha;
      if (el.kind === 'picture') {
        const img = icons.get(el.texture);
        if (img) ctx.drawImage(img, x, y, w, h);
      } else if (el.kind === 'text' && font) {
        const str = leafText(el, v);
        if (!str) continue;
        const rgb = (el.color || [1, 1, 1]).slice(0, 3);
        const tw = measure(str);
        // BfOutlineStyle centres in its rect (the file pairs it with a
        // BfLeftOutlineStyle for left-set text); a plain Style is left-set.
        const tx = el.outline || el.align === 'center' ? x + (w - tw) / 2 : x;
        text(ctx, str, Math.round(tx), y + font.meta.baseline, rgb, el.outline);
      }
    }
    ctx.globalAlpha = 1;
  }

  function paintChat(ctx) {
    const { rows, dividers } = chat.rows();
    // The divider: a white 1-px column at the box's x 5, black either side
    // and black end caps (`menu/InGame`'s BfTransformNodeSize).
    for (const d of dividers) {
      const g = dividerGeometry(chatLayout, d.firstRow, d.count);
      ctx.fillStyle = '#000';
      ctx.fillRect(g.x - 1, g.y - 1, 3, g.h + 2);
      ctx.fillStyle = '#fff';
      ctx.fillRect(g.x, g.y, 1, g.h);
    }
    for (const row of rows) {
      const g = rowGeometry(chatLayout, row.row);
      if (row.team === 1 || row.team === 2) {
        const flag = page.sprite?.(`flag_ticket_${page.teamNation?.(row.team)}`);
        if (flag) ctx.drawImage(flag, ...g.flag);
      }
      if (font) text(ctx, row.text, g.textX, g.baseline, lineColor(chatLayout, row), true);
    }
    if (centre && font) {
      const [x, y, w] = chatLayout.killMessage.rect;
      const tw = measure(centre.text);
      text(ctx, centre.text, Math.round(x + (w - tw) / 2), y + font.meta.baseline,
        chatLayout.killMessage.color, true);
    }
  }

  comms.paint = (stageW, stageH) => {
    if (!canvas || !stageW || !stageH) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const sig = `${chat.version}|${radio.category}|${stageW}x${stageH}@${dpr}|${centre?.text ?? ''}|${icons.size}|${!!font}`
      + `|${page.radioIconType?.() ?? 0}|${radioPoints().map(f => f.team).join('')}`;
    if (!dirty && sig === lastSig) return;
    dirty = false;
    lastSig = sig;
    const cw = Math.round(stageW * dpr);
    const ch = Math.round(stageH * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.setTransform(stageW / VIRTUAL_W * dpr, 0, 0, stageH / VIRTUAL_H * dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (chatLayout) paintChat(ctx);
    if (radioLayout) paintRadio(ctx);
  };

  /** For the test hooks: the log's rows and the menu's state. */
  comms.state = () => ({
    category: radio.category,
    back: radio.back,
    rows: chat.rows().rows.map(r => ({ row: r.row, section: r.section, text: r.text, team: r.team, buddy: r.buddy })),
    centre: centre?.text ?? null,
    ready: !!(radioLayout && chatLayout && font),
  });

  return comms;
}
