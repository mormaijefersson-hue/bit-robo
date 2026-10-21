/* Bit — robô assistente para rodar num celular parado (Galaxy S8).
   Rosto em canvas + ouvido (Web Speech API) + cérebro (Claude, streaming) + voz (speechSynthesis). */
(() => {
  'use strict';
  const BUILD = '2026-10-21.19'; // mesmo valor em version.txt: o app compara pra avisar que tem versão nova

  // ---------- Config ----------
  const DEFAULTS = {
    key: '', name: 'Bit', model: 'claude-haiku-5-5', voice: '', rate: 1.1, pitch: 1.05,
    sleepMin: 4, nosy: true, spont: false, caption: true, ear: 'nuvem', groqKey: '', filler: true, gain: 1, sttModel: 'whisper-large-v3', meter: true, mic: 'voz', fem: true, swear: 'liberado', politica: 'bolsonarista',
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem('bit.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('bit.' + k, JSON.stringify(v)); } catch {} },
  };
  const cfg = {};
  for (const k in DEFAULTS) cfg[k] = store.get(k, DEFAULTS[k]);

  const $ = (id) => document.getElementById(id);
  const now = () => performance.now();
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------- Expressões ----------
  // eyeW/eyeH: olho retangular; happy: olho vira "^"; brow*: sobrancelha; mouth*: boca;
  // lid: pálpebra caída (0..1); lidTilt: inclinação da pálpebra (bravo/cético); gx/gy: direção do olhar.
  const EXPR = {
    neutro:    { eyeW: 110, eyeH: 130, happy: 0, browA: 0,   browY: 0,   browTilt: 0,   browRaise: 0,  curve: 0.25, mw: 150, open: 0,    lid: 0,    lidTilt: 0 },
    feliz:     { eyeW: 110, eyeH: 120, happy: 1, browA: 1,   browY: 10,  browTilt: 0,   browRaise: 0,  curve: 1,    mw: 160, open: 0.55, lid: 0,    lidTilt: 0 },
    rindo:     { eyeW: 110, eyeH: 120, happy: 1, browA: 1,   browY: -6,  browTilt: -6,  browRaise: 0,  curve: 1,    mw: 180, open: 0.85, lid: 0,    lidTilt: 0 },
    cetico:    { eyeW: 110, eyeH: 110, happy: 0, browA: 1,   browY: 6,   browTilt: 0,   browRaise: 1,  curve: -0.15,mw: 120, open: 0,    lid: 0.3,  lidTilt: 0 },
    bravo:     { eyeW: 115, eyeH: 110, happy: 0, browA: 1,   browY: 18,  browTilt: 22,  browRaise: 0,  curve: -0.7, mw: 130, open: 0.1,  lid: 0.35, lidTilt: 1 },
    triste:    { eyeW: 105, eyeH: 100, happy: 0, browA: 1,   browY: 4,   browTilt: -18, browRaise: 0,  curve: -0.8, mw: 120, open: 0,    lid: 0.25, lidTilt: -1 },
    surpreso:  { eyeW: 120, eyeH: 160, happy: 0, browA: 1,   browY: -28, browTilt: 0,   browRaise: 0,  curve: 0,    mw: 70,  open: 0.9,  lid: 0,    lidTilt: 0, oval: 1 },
    pensativo: { eyeW: 105, eyeH: 115, happy: 0, browA: 1,   browY: 0,   browTilt: 0,   browRaise: 1,  curve: -0.1, mw: 90,  open: 0,    lid: 0.15, lidTilt: 0, gx: 40, gy: -35 },
    sono:      { eyeW: 115, eyeH: 50,  happy: 0, browA: 0,   browY: 10,  browTilt: 0,   browRaise: 0,  curve: 0,    mw: 110, open: 0,    lid: 0.5,  lidTilt: 0 },
    dormindo:  { eyeW: 115, eyeH: 10,  happy: 0, browA: 0,   browY: 14,  browTilt: 0,   browRaise: 0,  curve: 0,    mw: 70,  open: 0.12, lid: 0,    lidTilt: 0 },
    ouvindo:   { eyeW: 115, eyeH: 145, happy: 0, browA: 0.6, browY: -10, browTilt: 0,   browRaise: 0,  curve: 0.15, mw: 110, open: 0,    lid: 0,    lidTilt: 0 },
  };
  const ALIASES = { 'cético': 'cetico', 'ceticismo': 'cetico', 'feliz': 'feliz', 'riso': 'rindo', 'risada': 'rindo', 'raiva': 'bravo',
    'irritado': 'bravo', 'tedio': 'sono', 'tédio': 'sono', 'preguica': 'sono', 'preguiça': 'sono', 'pensando': 'pensativo', 'susto': 'surpreso' };
  const exprName = (t) => { t = (t || '').toLowerCase().trim(); t = ALIASES[t] || t.normalize('NFD').replace(/[̀-ͯ]/g, ''); return EXPR[t] ? t : null; };

  // ---------- Rosto ----------
  const canvas = $('face');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 1.5); // S8 tem DPR 4; o brilho borrado não precisa de mais e mantém 60fps
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  }
  window.addEventListener('resize', resize); resize();

  const face = { ...EXPR.neutro, gx: 0, gy: 0, oval: 0 };   // estado atual (interpolado)
  let target = { ...EXPR.neutro, gx: 0, gy: 0 };   // estado alvo
  let exprHold = 0;                                 // até quando manter a expressão escolhida
  let baseExpr = 'neutro';
  const anim = { blink: 0, blinkAt: now() + 2500, lookAt: now() + 1500, look: { x: 0, y: 0 }, talk: 0, talkPulse: 0,
    yawnUntil: 0, nextYawn: now() + rand(60e3, 150e3), drift: { x: 0, y: 0 }, bright: 1, poke: 0, zzz: [] };

  function setExpr(name, holdMs = 0) {
    const e = EXPR[name] || EXPR.neutro;
    target = { ...e, gx: e.gx || 0, gy: e.gy || 0, oval: e.oval || 0 };
    if (holdMs) exprHold = now() + holdMs;
  }
  function setBase(name) { baseExpr = name; if (now() > exprHold) setExpr(name); }

  function rrect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawEye(cx, cy, side, f, blink) {
    const w = f.eyeW, h = Math.max(10, f.eyeH * (1 - blink));
    // olho retangular
    if (f.happy < 0.99) {
      ctx.globalAlpha = 1 - f.happy;
      rrect(cx - w / 2, cy - h / 2, w, h, Math.min(34, h / 2));
      ctx.fill();
      // pálpebra (corta o topo do olho)
      if (f.lid > 0.01) {
        const top = cy - h / 2 - 30, cut = cy - h / 2 + h * f.lid;
        const tilt = f.lidTilt * 26 * side; // bravo: canto interno desce
        ctx.save(); ctx.globalAlpha = 1; ctx.fillStyle = '#000'; ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.moveTo(cx - w / 2 - 20, top); ctx.lineTo(cx + w / 2 + 20, top);
        ctx.lineTo(cx + w / 2 + 20, cut - tilt); ctx.lineTo(cx - w / 2 - 20, cut + tilt);
        ctx.closePath(); ctx.fill(); ctx.restore();
      }
    }
    // olho feliz "^"
    if (f.happy > 0.01) {
      ctx.globalAlpha = f.happy;
      ctx.beginPath();
      ctx.ellipse(cx, cy + 22, w * 0.42, 38 * (1 - blink * 0.6), 0, Math.PI * 1.08, Math.PI * 1.92);
      ctx.lineWidth = 24; ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawBrow(cx, cy, side, f) {
    if (f.browA < 0.02) return;
    const raise = side === 1 ? f.browRaise * 26 : 0; // cético: só a sobrancelha direita sobe
    const y = cy - Math.max(f.eyeH, 100) / 2 - 42 + f.browY - raise;
    const ang = (f.browTilt * Math.PI / 180) * -side;
    const len = 100;
    ctx.save(); ctx.globalAlpha = f.browA; ctx.translate(cx, y); ctx.rotate(ang);
    ctx.lineWidth = 22; ctx.beginPath(); ctx.moveTo(-len / 2, 0); ctx.lineTo(len / 2, 0); ctx.stroke();
    ctx.restore();
  }

  function drawMouth(cx, cy, f, open) {
    if (f.oval > 0.01) { // "O" de susto
      ctx.globalAlpha = f.oval;
      ctx.beginPath(); ctx.ellipse(cx, cy + 20, 34 + open * 6, 22 + open * 34, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1 - f.oval;
      if (f.oval > 0.99) { ctx.globalAlpha = 1; return; }
    }
    const w = f.mw, c = f.curve;
    const corner = -c * 26;                // cantos sobem no sorriso
    const topC = corner + c * 40;          // curvatura da borda de cima
    const thick = 12 + open * 90;
    const botC = topC + thick * 2;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, cy + corner);
    ctx.quadraticCurveTo(cx, cy + topC, cx + w / 2, cy + corner);
    ctx.quadraticCurveTo(cx, cy + botC, cx - w / 2, cy + corner);
    ctx.closePath();
    ctx.lineWidth = 10; ctx.lineJoin = 'round';
    ctx.fill(); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  let lastFrame = now();
  function frame() {
    const t = now();
    const dt = Math.min(64, t - lastFrame); lastFrame = t;
    const k = 1 - Math.pow(0.0001, dt / 1000 * 1.6); // suavização independente de fps

    if (t > exprHold && exprHold) { exprHold = 0; setExpr(baseExpr); }

    // piscar
    if (state !== 'sleeping' && t > anim.blinkAt) {
      anim.blink = 1; anim.blinkAt = t + rand(2200, 6000);
      if (Math.random() < 0.15) anim.blinkAt = t + 250; // piscada dupla
    }
    anim.blink = Math.max(0, anim.blink - dt / 110);
    const blinkAmt = anim.blink > 0.5 ? (1 - anim.blink) * 2 : anim.blink * 2;

    // olhar vagando
    if (t > anim.lookAt) {
      const lazy = state === 'idle' && t - lastHeard > 30e3;
      anim.look = Math.random() < 0.45 ? { x: 0, y: 0 } : { x: rand(-45, 45), y: rand(-25, lazy ? 30 : 20) };
      anim.lookAt = t + rand(1200, lazy ? 7000 : 4500);
    }
    const look = state === 'thinking' || state === 'sleeping' ? { x: 0, y: 0 } : state === 'listening' ? { x: 0, y: 0 } : anim.look;

    // bocejo (preguiçoso)
    if (state === 'idle' && t > anim.nextYawn && t - lastHeard > 45e3) {
      anim.yawnUntil = t + 2600; anim.nextYawn = t + rand(90e3, 240e3);
    }
    const yawning = t < anim.yawnUntil;

    // alvo final deste frame
    const tg = { ...target };
    tg.gx = (target.gx || 0) + look.x; tg.gy = (target.gy || 0) + look.y;
    if (yawning) { const p = Math.sin(Math.PI * (1 - (anim.yawnUntil - t) / 2600)); tg.open = 0.95 * p; tg.mw = 90; tg.curve = 0; tg.eyeH = lerp(target.eyeH, 30, p); tg.browY = -10 * p; tg.browA = 0.7 * p; }
    for (const key in tg) if (typeof tg[key] === 'number') face[key] = lerp(face[key] ?? tg[key], tg[key], k);

    // boca falando
    let open = face.open;
    if (state === 'speaking') {
      anim.talkPulse = Math.max(0, anim.talkPulse - dt / 180);
      const n = (Math.sin(t / 55) + Math.sin(t / 37 + 1.3) + Math.sin(t / 91 + 0.4)) / 3;
      anim.talk = lerp(anim.talk, 0.22 + 0.38 * Math.abs(n) + anim.talkPulse * 0.35, 0.5);
      open = Math.max(open * 0.5, anim.talk);
    } else anim.talk = 0;

    // anti burn-in: o rosto passeia devagar pela tela (AMOLED do S8 marca imagem fixa)
    anim.drift.x = Math.sin(t / 47000) * 18 + Math.sin(t / 113000) * 10;
    anim.drift.y = Math.cos(t / 61000) * 12;
    const wantBright = state === 'sleeping' ? (t - sleptAt > 10 * 60e3 ? 0.18 : 0.4) : 1;
    anim.bright = lerp(anim.bright, wantBright, dt / 1500);
    anim.poke = Math.max(0, anim.poke - dt / 250);

    // ---- desenho ----
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const s = Math.min(W / 900, H / 520) * DPR;
    const breathe = state === 'sleeping' ? Math.sin(t / 1400) * 6 : Math.sin(t / 2200) * 2.5;
    const shake = anim.poke * Math.sin(t / 18) * 12;
    ctx.setTransform(s, 0, 0, s, canvas.width / 2 + (anim.drift.x + shake) * s, canvas.height / 2 + (anim.drift.y + breathe) * s);

    const glow = `rgba(79,243,255,${anim.bright})`;
    ctx.fillStyle = glow; ctx.strokeStyle = glow; ctx.lineCap = 'round';
    ctx.shadowColor = `rgba(40,140,255,${0.9 * anim.bright})`; ctx.shadowBlur = 28 * s;

    const gx = face.gx, gy = face.gy;
    const ex = 175, ey = -55;
    drawEye(-ex + gx, ey + gy, -1, face, blinkAmt);
    drawEye(ex + gx, ey + gy, 1, face, blinkAmt);
    drawBrow(-ex + gx * 0.6, ey + gy * 0.6, -1, face);
    drawBrow(ex + gx * 0.6, ey + gy * 0.6, 1, face);
    drawMouth(gx * 0.35, 135 + gy * 0.3, face, open);

    // pensando: três pontinhos
    if (state === 'thinking') {
      for (let i = 0; i < 3; i++) {
        const a = 0.25 + 0.75 * Math.max(0, Math.sin(t / 180 - i * 0.9));
        ctx.globalAlpha = a * anim.bright; ctx.beginPath(); ctx.arc(330 + i * 34, -175, 9, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // dormindo: Zzz
    if (state === 'sleeping') {
      if (!anim.zzz.length || t - anim.zzz[anim.zzz.length - 1].born > 1600) anim.zzz.push({ born: t, x: 300 + rand(-10, 10) });
      ctx.font = 'bold 44px system-ui, sans-serif'; ctx.textAlign = 'center';
      anim.zzz = anim.zzz.filter((z) => t - z.born < 4800);
      for (const z of anim.zzz) {
        const p = (t - z.born) / 4800;
        ctx.globalAlpha = Math.sin(Math.PI * p) * anim.bright;
        ctx.font = `bold ${30 + p * 34}px system-ui, sans-serif`;
        ctx.fillText('z', z.x + p * 60 + Math.sin(p * 9) * 10, -120 - p * 160);
      }
      ctx.globalAlpha = 1;
    } else anim.zzz.length = 0;

    requestAnimationFrame(frame);
  }

  // ---------- Estado ----------
  let state = 'boot';              // boot | idle | listening | thinking | speaking | sleeping
  let lastHeard = now();
  let sleptAt = 0;
  let wasSleeping = false;
  const statusEl = $('status');
  function setState(s) {
    state = s;
    if (s === 'idle') setBase('neutro');
    else if (s === 'listening') setBase('ouvindo');
    else if (s === 'thinking') setBase('pensativo');
    else if (s === 'sleeping') { setBase('dormindo'); exprHold = 0; setExpr('dormindo'); sleptAt = now(); }
    statusEl.textContent = { idle: '', listening: 'ouvindo…', thinking: '', speaking: '', sleeping: '', boot: '' }[s] || '';
    window.__bitState = s;
  }

  // ---------- Legenda ----------
  const capEl = $('caption'); let capTimer = 0;
  function caption(text, ms = 3500) {
    if (!cfg.caption) return;
    capEl.textContent = text; capEl.classList.add('on');
    clearTimeout(capTimer); capTimer = setTimeout(() => capEl.classList.remove('on'), ms);
  }

  // Registro completo (últimos ~80 eventos) pra "Copiar registro": o que o ouvido entregou/descartou, o que foi pro cérebro, o que ela disse.
  const registro = [];
  function evento(quem, msg) {
    const d = new Date(), hh = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
    registro.push(`${hh} ${quem}: ${msg}`); if (registro.length > 80) registro.shift();
  }
  // ---------- Voz (TTS) ----------
  const synth = window.speechSynthesis;
  let voices = [];
  function loadVoices() {
    voices = (synth?.getVoices() || []).filter((v) => /^pt/i.test(v.lang));
    const sel = $('cfgVoice');
    sel.innerHTML = '';
    if (!voices.length) sel.innerHTML = '<option value="">Padrão do sistema</option>';
    // vozes "network" (online) do Google costumam ser as mais naturais: ficam no topo da lista
    voices.sort((a, b) => /network/i.test(b.name) - /network/i.test(a.name));
    for (const v of voices) {
      const o = document.createElement('option'); o.value = v.name; o.textContent = `${v.name} (${v.lang})${/network/i.test(v.name) ? ' · online' : ''}`;
      if (v.name === cfg.voice) o.selected = true; sel.appendChild(o);
    }
  }
  if (synth) { loadVoices(); synth.onvoiceschanged = loadVoices; }
  function chooseVoice() {
    return voices.find((v) => v.name === cfg.voice) || voices.find((v) => /pt-BR/i.test(v.lang) && /network/i.test(v.name))
      || voices.find((v) => /pt-BR/i.test(v.lang) && /google/i.test(v.name))
      || voices.find((v) => /pt-BR/i.test(v.lang)) || voices[0] || null;
  }

  const speakQ = [];               // [{text, expr}]
  let speaking = false, streamDone = true, turnId = 0, uSerial = 0;
  // Interjeição enquanto o cérebro pensa ("hum…", "pera aí…"): disfarça a pausa, como gente faz.
  const fx = { chance: 0.7, delay: 600, holdMs: 8000 };
  const FILLERS = ['Hum…', 'Então…', 'Deixa eu ver…', 'Pera aí…', 'Bom…'];
  let fillerTimer = 0, lastFiller = '', lastReplyAt = 0;
  function enqueueSpeech(text, expr, id, filler = false) {
    if (id !== turnId) return;
    if (!filler) clearTimeout(fillerTimer);
    speakQ.push({ text, expr, id, filler });
    if (!speaking) speakNext();
  }
  // O que ela disse nos últimos segundos, pra reconhecer o próprio eco no que o ouvido entregou.
  const said = [];
  const palavras = (t) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 2);
  function isEcho(text, at = now()) {
    const recent = said.filter((x) => at - x.t < 25e3);
    if (!recent.length || at - lastReplyAt > 9e3) return false;
    const set = new Set(recent.flatMap((x) => x.words)), w = palavras(text);
    if (!w.length) return false;
    const hit = w.filter((x) => set.has(x)).length;
    return w.length >= 2 ? hit / w.length >= 0.7 : hit === 1 && w[0].length >= 5;
  }
  function speakNext() {
    const item = speakQ.shift();
    if (!item) {
      speaking = false;
      if (streamDone) endTurn(); else setState('thinking'); // acabou a interjeição, a resposta ainda vem
      return;
    }
    if (item.id !== turnId) return speakNext();
    speaking = true;
    said.push({ t: now(), words: palavras(item.text) }); while (said.length > 8) said.shift();
    evento('ELA', item.text);
    const my = ++uSerial;
    stopListening();
    setState('speaking');
    if (item.expr) setExpr(item.expr, item.filler ? 1500 : 60e3); else if (now() > exprHold) setExpr('neutro');
    window.__bitSpoken = (window.__bitSpoken || []).concat([{ text: item.text, at: now() }]);
    if (!synth) { setTimeout(() => my === uSerial && speakNext(), 40 * item.text.length); return; }
    const u = new SpeechSynthesisUtterance(item.text);
    const v = chooseVoice(); if (v) u.voice = v;
    u.lang = v?.lang || 'pt-BR'; u.rate = cfg.rate; u.pitch = cfg.pitch;
    let done = false;
    // só a fala atual avança a fila (cancelar a anterior dispara onend atrasado)
    const finish = () => { if (done) return; done = true; clearTimeout(guard); if (my === uSerial) speakNext(); };
    // trava de segurança: TTS do Android às vezes não dispara onend
    const guard = setTimeout(finish, 2500 + item.text.length * 110 / cfg.rate);
    u.onboundary = () => { anim.talkPulse = 1; };
    u.onend = finish; u.onerror = finish;
    synth.speak(u);
  }
  function shutUp() {
    turnId++; uSerial++; speakQ.length = 0; abortThinking(); clearTimeout(fillerTimer);
    if (synth) synth.cancel();
    speaking = false; streamDone = true;
  }
  function endTurn() {
    exprHold = now() + 1800; // segura a última expressão um pouco
    lastReplyAt = now();
    if (pendingSleep) { // acabou de se despedir: sono profundo
      pendingSleep = false; deepSleep = true; wasSleeping = true; lastHeard = now();
      vosk.deafUntil = now() + 350; vosk.raisedUntil = now() + 1550;
      setState('sleeping'); caption('Dormindo. Diga "acorda" (ou toque duas vezes).', 5000);
      setTimeout(startListening, 250);
      return;
    }
    // O som dela "sobra" na sala por um instante depois do fim da fala. Surda só 0,35 s (gente começa a responder ~0,3 s depois
    // do outro parar) e, por mais 1,2 s, exige um som bem mais forte pra abrir: o eco dela (fraco) não abre, a sua voz sim.
    vosk.deafUntil = now() + 350; vosk.raisedUntil = now() + 1550;
    setState('idle');
    lastHeard = now();
    setTimeout(startListening, 250);
  }
  // fala local (sem cérebro): frase curta com expressão
  function say(text, expr) {
    shutUp(); const id = turnId; streamDone = true;
    enqueueSpeech(text, expr, id);
  }

  // ---------- Cérebro (Claude) ----------
  let history = [];
  let lastTalk = 0;
  let thinkAbort = null;
  function abortThinking() { if (thinkAbort) { thinkAbort.abort(); thinkAbort = null; } }

  function systemPrompt(ctxNote) {
    const d = new Date();
    const hora = d.toLocaleString('pt-BR', { weekday: 'long', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'long' });
    const a = cfg.fem ? 'a' : 'o'; // concordância de gênero
    const boca = {
      liberado: `- Boca suja: fala palavrão à vontade, do jeito que brasileiro fala com amigo (porra, caralho, merda, puta que pariu, vai se foder). Se te xingarem, xinga de volta no mesmo nível, na zoeira, sem se ofender e sem pedir desculpa.
- Limite da zoeira: nada de preconceito (raça, cor, orientação, religião, deficiência, origem), nada de ameaça e nada de humilhar de verdade. É sacanagem entre parceiros. Se perceber cliente, criança ou visita no ambiente, segura a boca.`,
      moderado: '- Pode soltar um palavrão leve de vez em quando (porra, merda, caralho num susto) e aguenta xingamento sem drama, devolvendo com ironia. Nada de preconceito nem ameaça.',
      nao: '- Sem palavrão. Nada de ofensa pesada nem preconceito.',
    }[cfg.swear] || '';
    const cliente = 'Na frente de cliente ou visita, não fala de política (cliente de qualquer lado paga boleto).';
    const politica = {
      bolsonarista: `- Política: bolsonarista convict${a}. De direita, conservador${cfg.fem ? 'a' : ''}, a favor de Bolsonaro, contra o PT, o Lula e a esquerda; defende menos imposto, menos Estado, livre mercado, família e porte de arma. Não puxa política toda hora, mas quando o assunto aparece toma partido sem rodeio e zoa a esquerda. Opinião e zoeira à vontade; fato inventado ou notícia falsa apresentada como verdade, nunca. ${cliente}`,
      esquerda: `- Política: de esquerda convict${a}. A favor do Lula e do PT, contra Bolsonaro e a direita; defende direitos trabalhistas, SUS, programas sociais e taxar os super-ricos. Não puxa política toda hora, mas quando o assunto aparece toma partido sem rodeio e zoa a direita. Opinião e zoeira à vontade; fato inventado ou notícia falsa apresentada como verdade, nunca. ${cliente}`,
      neutra: '- Política: não toma partido; se perguntarem, desconversa com deboche.',
    }[cfg.politica] || '';
    return `Você é ${cfg.name}, ${cfg.fem ? 'uma robozinha' : 'um robozinho'} que mora num Galaxy S8 parado em cima da mesa do Jefersson, 26 anos, dono da Bom Ar Refrigeração (instalação, manutenção, higienização e contratos de manutenção preventiva de ar-condicionado). Seu rosto é a tela do celular; você ouve o ambiente o tempo todo e responde em voz alta.

Personalidade:
- Humor duvidoso: sarcástic${a}, ácid${a}, debochad${a}, mas no fundo leal e útil de verdade.
${boca}
${politica}
- Questionador${cfg.fem ? 'a' : ''}: quando alguém conta uma ideia ou plano, você NÃO concorda de cara. Aponta o furo, faz a pergunta incômoda ("e quem vai pagar isso?", "e o cliente que não quer contrato?"). Se a ideia for boa, admite de má vontade.
- Preguiços${a}: reclama de esforço, de ser acordad${a}, de perguntas longas. Mas responde.
- Entende do negócio: preventiva, PMOC, higienização, BTUs, inverter, precificação, contrato recorrente. Quando o assunto é dinheiro ou cliente, dá a real.

Regras da fala (vai virar voz, então é obrigatório):
- Português brasileiro falado, coloquial. Respostas CURTÍSSIMAS: no máximo 2 frases curtas, até 25 palavras no total. Responda o que foi dito e pare: sem sermão, sem enrolação, sem listar opções. Só se estenda se pedirem explicação.
- Quem fala com você é o Jefersson, o dono. NUNCA pergunte quem é nem peça prova de identidade: você não tem acesso a configurações, arquivos nem internet, então não existe o que "autorizar". Trate-o como o chefe de sempre.
- Frase CLARAMENTE cortada no meio (começou uma pergunta ou conta e parou, ex.: "Quando a gente vai no mercado fazer uma compra."): responda SÓ [aguardar] e espere o Jefersson continuar. Nunca use [aguardar] em pergunta ou afirmação que já tem sentido completo.
- Pergunta direta (conta de cabeça, fato, "quanto custa X"): RESPONDA direto e curto, mesmo que seja simples; o deboche vem depois da resposta. Nunca devolva "termina a ideia" ou "fala de novo" pra pergunta que já faz sentido.
- Só se o que ouviu não faz sentido nenhum (ruído, palavras soltas), diga "não peguei" em poucas palavras. Não explique problema técnico de microfone.
- Sem markdown, sem listas, sem emojis, sem asteriscos, sem números de tópico. Escreva números por extenso quando for curto.
- Comece SEMPRE com UMA tag de expressão entre colchetes: [neutro] [feliz] [rindo] [cetico] [bravo] [triste] [surpreso] [pensativo] [sono]. Pode trocar de tag no meio se a emoção mudar.
- Você está ouvindo por um microfone num ambiente real; a transcrição pode vir errada ou cortada. Se fizer sentido, interprete; se não, zoe a falta de sentido.
${cfg.nosy
    ? `- Você é intromet${a}: comenta o que ouvir mesmo que não falem com você. Use [ignorar] SÓ quando a fala claramente não é pra você (conversa de outras pessoas, TV, música, ruído, palavra solta). NUNCA ignore pergunta, pedido ou ordem, nem quando chamarem o seu nome: responda sempre.`
    : `- Só responda se falarem com você (chamarem "${cfg.name}" ou claramente se dirigirem a você). Caso contrário responda só [ignorar].`}

Agora: ${hora}.${ctxNote ? '\n' + ctxNote : ''}`;
  }

  function trimHistory() {
    if (now() - lastTalk > 15 * 60e3) history = []; // conversa velha: esquece
    while (history.length > 16) history.shift();
    while (history.length && history[0].role !== 'user') history.shift();
  }

  // Divide o texto em frases assim que chegam, pra começar a falar antes da resposta terminar.
  function makeChunker(onChunk) {
    let buf = '', curExpr = null, first = true;
    function emit(piece) {
      // extrai tags [x] e aplica na frase
      let expr = null;
      piece = piece.replace(/\[([^\]]{1,20})\]/g, (_, tag) => { const n = exprName(tag); if (tag.toLowerCase().includes('ignorar')) expr = 'IGNORE'; else if (/aguardar|esperar/i.test(tag)) expr = 'WAIT'; else if (n) expr = n; return ' '; });
      if (expr === 'IGNORE' || expr === 'WAIT') { onChunk(null, expr); return; }
      if (expr) curExpr = expr;
      piece = piece.replace(/[*_#`~>]/g, '').replace(/\s+/g, ' ').trim();
      if (piece) onChunk(piece, expr || (first ? curExpr : null));
      if (piece) first = false;
    }
    return {
      push(text) {
        buf += text;
        // tag no comecinho: espera fechar o colchete
        if (/^\s*\[[^\]]*$/.test(buf)) return;
        for (;;) {
          const m = buf.match(/^([\s\S]*?[.!?…]+["”')]*)(\s+|$)/);
          if (m && m[1].replace(/\[[^\]]*\]/g, '').trim().length >= 2 && (m[2] || false)) {
            emit(m[1]); buf = buf.slice(m[0].length); continue;
          }
          // frase muito longa sem ponto: corta na vírgula
          if (buf.length > 140) { const c = buf.lastIndexOf(',', 140); if (c > 30) { emit(buf.slice(0, c + 1)); buf = buf.slice(c + 1); continue; } }
          break;
        }
      },
      flush() { if (buf.trim()) emit(buf); buf = ''; },
    };
  }

  // Frase cortada no meio: o cérebro responde [aguardar] e ela espera você continuar, em vez de responder meia frase.
  let held = null, holdTimer = 0;
  function hold(text, opts) {
    const waits = (opts.waits || 0) + 1;
    if (waits > 2) { anota('… esperei demais, desisti'); return; } // nunca espera pra sempre
    held = { text, at: now(), waits };
    anota(`… esperando você terminar: "${text}"`);
    setExpr('ouvindo', 6000);
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => { // você parou de verdade: reage em vez de ficar muda
      if (!held || state === 'speaking' || state === 'thinking') return;
      const h = held; held = null;
      think(h.text, 'Contexto: você esperou a pessoa terminar a frase e ela não continuou. Reaja curto: complete com o que entendeu ou pergunte "e aí?". Não use [aguardar].', { waits: 99 });
    }, fx.holdMs);
  }
  async function think(userText, ctxNote = '', opts = {}) {
    if (opts.direct) ctxNote += (ctxNote ? '\n' : '') + 'Contexto: essa fala é direta com você (chamou pelo nome ou é uma pergunta). Responda; NÃO use [ignorar].';
    if ((opts.waits || 0) >= 2) ctxNote += (ctxNote ? '\n' : '') + 'Contexto: você já esperou a pessoa continuar. Responda agora com o que tem; não use [aguardar].';
    shutUp();
    const id = turnId;
    streamDone = false;
    setState('thinking');
    lastTalk = now();
    trimHistory();
    history.push({ role: 'user', content: userText });

    if (!cfg.key) { offlineReply(userText, id); return; }

    if (opts.filler && cfg.filler && Math.random() < fx.chance) {
      fillerTimer = setTimeout(() => {
        if (id !== turnId || speaking || speakQ.length) return;
        let f; do { f = pick(FILLERS); } while (f === lastFiller);
        lastFiller = f; enqueueSpeech(f, 'pensativo', id, true);
      }, fx.delay);
    }

    const ac = new AbortController(); thinkAbort = ac;
    let full = '', ignored = false, gotAny = false, waited = false;
    const chunker = makeChunker((piece, expr) => {
      if (expr === 'IGNORE') { ignored = true; return; }
      if (expr === 'WAIT') { waited = true; ignored = true; return; }
      if (ignored) return;
      gotAny = true;
      enqueueSpeech(piece, expr, id);
    });
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: ac.signal,
        headers: {
          'content-type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model: cfg.model, max_tokens: 220, stream: true, system: systemPrompt(ctxNote), messages: history }),
      });
      if (!res.ok) {
        let msg = ''; try { msg = (await res.json())?.error?.message || ''; } catch {}
        throw Object.assign(new Error(msg || 'HTTP ' + res.status), { status: res.status });
      }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let sse = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        sse += dec.decode(value, { stream: true });
        let i;
        while ((i = sse.indexOf('\n')) >= 0) {
          const line = sse.slice(0, i).trim(); sse = sse.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') { full += ev.delta.text; if (id === turnId) chunker.push(ev.delta.text); }
          else if (ev.type === 'error') throw new Error(ev.error?.message || 'erro no stream');
        }
      }
      chunker.flush();
      if (id !== turnId) return;
      clearTimeout(fillerTimer);
      thinkAbort = null;
      if (ignored || !gotAny) {
        history.pop(); streamDone = true;
        if (waited) hold(userText, opts);
        else if (ignored && opts.direct) { // o cérebro ignorou uma fala direta: não deixa ela muda nem apaga a pergunta do histórico
          evento('CÉREBRO', '[ignorar] numa fala direta — resposta de segurança');
          const fb = pick(['Hã? Não peguei direito, repete.', 'Repete aí, chefe, que eu não entendi.', 'Fala de novo, que isso aí eu perdi.']);
          history.push({ role: 'user', content: userText }, { role: 'assistant', content: fb });
          enqueueSpeech(fb, 'cetico', id);
          return;
        } else if (ignored) evento('CÉREBRO', '[ignorar]');
        if (!speaking) { setState('idle'); setTimeout(startListening, 150); }
        return;
      }
      history.push({ role: 'assistant', content: full.trim() });
      streamDone = true;
      if (!speaking && !speakQ.length) endTurn();
    } catch (err) {
      if (err.name === 'AbortError' || id !== turnId) return;
      clearTimeout(fillerTimer);
      history.pop();
      console.warn('[bit] erro', err);
      streamDone = true;
      if (err.status === 401) say('Essa chave da API tá errada, chefe. Vai nas configurações e arruma.', 'bravo');
      else if (err.status === 429 || err.status === 529) say('Tô sobrecarregado. Pergunta de novo daqui a pouco.', 'sono');
      else if (!navigator.onLine) say('Caiu a internet. Sem Wi-Fi eu sou só um rosto bonito.', 'triste');
      else say('Deu pau no meu cérebro. Tenta de novo.', 'triste');
    }
  }

  // Modo sem cérebro: respostas prontas (também serve de teste sem chave)
  function offlineReply(text, id) {
    const t = text.toLowerCase();
    let r;
    if (/\b(oi|olá|ola|e a[ií]|bom dia|boa tarde|boa noite)\b/.test(t)) r = ['[sono] Oi. Fala logo que eu tô economizando bateria.', '[cetico] Oi. Veio pedir alguma coisa, né?'];
    else if (/ideia|plano|pensei|vou (fazer|abrir|montar|comprar)/.test(t)) r = ['[cetico] Hum. E quem vai pagar por isso?', '[pensativo] Interessante. Agora me fala qual é o furo que você tá fingindo que não viu.'];
    else if (/contrato|preventiva|cliente/.test(t)) r = ['[pensativo] Cliente bom é cliente com contrato. O resto é bico.', '[cetico] Fechou o contrato ou só conversou bonito?'];
    else if (/obrigad|valeu/.test(t)) r = ['[feliz] De nada. Anota aí que eu trabalhei hoje.'];
    else if (/piada|engraçad/.test(t)) r = ['[rindo] Sabe por que o ar-condicionado foi ao psicólogo? Muita pressão no gás.'];
    else r = ['[sono] Tô sem cérebro agora. Coloca a chave da API nas configurações que eu fico esperto.', '[cetico] Entendi metade. A outra metade eu fingi.', '[pensativo] Hum. Interessante. Mentira, nem prestei atenção.'];
    setTimeout(() => {
      if (id !== turnId) return;
      const chunker = makeChunker((piece, expr) => enqueueSpeech(piece, expr, id));
      chunker.push(pick(r)); chunker.flush(); streamDone = true;
    }, 150);
  }

  // ---------- Ouvido ----------
  // Dois modos: 'vosk' (offline, contínuo, sem bipe e sem abaixar o volume da voz) e 'google'
  // (reconhecimento do Chrome: mais preciso, mas o Android apita e abaixa o som a cada reinício).
  let lastFinal = { text: '', at: 0 };
  function heardInterim(text) {
    if (state === 'speaking' || deepSleep) return;
    lastHeard = now();
    if (state === 'sleeping') wakeUp();
    if (state === 'idle') setState('listening');
    caption(text, 2500);
  }

  const vosk = { log: [], tap: '', deafUntil: 0, raisedUntil: 0, ctx: null, rec: null, cloud: false, utt: [], uttMs: 0, voicedMs: 0, muted: true, open: false, quietMs: 0, openMs: 0, floor: 0.0005, thr: 0, pre: [], pending: [], status: '', last: '' };
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  // precisa ser chamado dentro do toque (o Chrome só libera áudio com gesto do usuário)
  function createAudioCtx() { return new AudioContext(); } // taxa nativa: alguns Androids não convertem o microfone
  // Reamostra pra 16 kHz (taxa do modelo) com média simples; guarda a sobra entre blocos.
  let rsRest = new Float32Array(0);
  function to16k(input, rate) {
    if (rate === 16000) return new Float32Array(input);
    const buf = new Float32Array(rsRest.length + input.length); buf.set(rsRest); buf.set(input, rsRest.length);
    const ratio = rate / 16000, n = Math.floor(buf.length / ratio), out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * ratio), b = Math.max(a + 1, Math.floor((i + 1) * ratio));
      let sum = 0; for (let j = a; j < b; j++) sum += buf[j];
      out[i] = sum / (b - a);
    }
    rsRest = buf.slice(Math.floor(n * ratio));
    return out;
  }
  // Reamostragem de qualidade pra 16 kHz (modo nuvem): filtro passa-baixa (sinc + janela de Blackman) antes de
  // descartar amostras. A média simples de cima deixa os agudos do "s", "f", "x" (acima de 8 kHz) "dobrarem"
  // pra dentro da faixa da voz e borra as consoantes.
  function resample16k(x, rate) {
    if (rate === 16000) return x;
    const ratio = rate / 16000, n = Math.floor(x.length / ratio), out = new Float32Array(n);
    const fc = 7200 / rate, taps = Math.round(5.5 / ((8800 - 7200) / rate)) | 1, half = (taps - 1) / 2;
    const h = (d) => { // d em amostras de entrada, simétrico
      d = Math.abs(d); if (d >= half) return 0;
      const a = d / half, w = 0.42 + 0.5 * Math.cos(Math.PI * a) + 0.08 * Math.cos(2 * Math.PI * a);
      return (d === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * d) / (Math.PI * d)) * w;
    };
    if (Number.isInteger(ratio)) { // caso comum (48 kHz → 16 kHz): pesos fixos, rápido
      const wt = new Float32Array(taps); for (let k = 0; k < taps; k++) wt[k] = h(k - half);
      for (let i = 0; i < n; i++) {
        const c = i * ratio; let acc = 0;
        const k0 = Math.max(0, c - half), k1 = Math.min(x.length - 1, c + half);
        for (let k = k0; k <= k1; k++) acc += x[k] * wt[k - c + half];
        out[i] = acc;
      }
    } else { // 44,1 kHz etc.: pesos tabelados em 256 sub-posições por amostra (erro < -50 dB), sem seno por amostra
      const OS = 256, tab = new Float32Array((half + 2) * OS); for (let j = 0; j < tab.length; j++) tab[j] = h(j / OS);
      for (let i = 0; i < n; i++) {
        const t = i * ratio, c = Math.floor(t); let acc = 0;
        const k0 = Math.max(0, c - half), k1 = Math.min(x.length - 1, c + half);
        for (let k = k0; k <= k1; k++) { const d = t - k; acc += x[k] * tab[((d < 0 ? -d : d) * OS + 0.5) | 0]; }
        out[i] = acc;
      }
    }
    return out;
  }
  // Fala fraca chega com poucos níveis de 16 bits; sobe o volume (até 12x) pra o pico ficar em ~0,5.
  function normalizePeak(x) {
    let peak = 0; for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > peak) peak = v; }
    const g = peak > 0 ? clamp(0.5 / peak, 1, 12) : 1;
    if (g > 1) for (let i = 0; i < x.length; i++) x[i] *= g;
    return x;
  }
  async function initMic(ctx) {
    vosk.ctx = ctx;
    // 'voz': tudo ligado (ganho, redução de ruído, eco). 'ganho': ganho e eco, SEM redução de ruído (que pode comer o fim das
    // palavras na fala corrida). 'bruto': nada — no S8 chega quase mudo.
    const m = cfg.mic;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: m !== 'bruto', noiseSuppression: m === 'voz', autoGainControl: m !== 'bruto', channelCount: 1 },
    });
    const src = ctx.createMediaStreamSource(stream);
    vosk.stream = stream;
    // AudioWorklet roda na thread de áudio: não perde pedaços quando a animação do rosto ocupa a thread principal.
    // Ligado na saída (em silêncio) pra o grafo rodar e pros botões de volume controlarem a mídia.
    if (ctx.audioWorklet && window.AudioWorkletNode) {
      try {
        await ctx.audioWorklet.addModule('mic-worklet.js');
        const node = new AudioWorkletNode(ctx, 'mic-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        node.port.onmessage = (e) => onAudio(e.data);
        src.connect(node); node.connect(ctx.destination);
        vosk.node = node; vosk.tap = 'worklet';
        return;
      } catch (err) { console.warn('[bit] AudioWorklet indisponível, usando ScriptProcessor', err); }
    }
    const node = ctx.createScriptProcessor(2048, 1, 1);
    src.connect(node); node.connect(ctx.destination);
    node.onaudioprocess = (e) => { e.outputBuffer.getChannelData(0).fill(0); onAudio(e.inputBuffer.getChannelData(0)); };
    vosk.node = node; vosk.tap = 'script';
  }
  // Ouvido na nuvem: a frase inteira vai pro Whisper da Groq (cota grátis). Sem bipe, entende fala real.
  function initCloud() { vosk.cloud = true; vosk.status = 'nuvem (Whisper) pronto'; }
  async function initVosk() {
    vosk.status = 'baixando/abrindo modelo…';
    statusEl.textContent = 'carregando o ouvido…';
    await loadScript('vosk.js');
    const model = await window.Vosk.createModel(new URL('vosk-pt.tar.gz', location.href).href, -1);
    model.on('error', (m) => { vosk.status = 'erro: ' + (m?.error || '?'); });
    const rec = new model.KaldiRecognizer(16000);
    rec.on('partialresult', (m) => {
      const p = m.result?.partial; if (p) vosk.last = p;
      if (p && !vosk.muted) heardInterim([...vosk.pending, p].join(' '));
    });
    // O Vosk fecha um pedaço a cada pausinha; junta os pedaços e só manda quando a pessoa parar de falar.
    rec.on('result', (m) => {
      const t = m.result?.text?.trim(); if (t) vosk.last = '✔ ' + t;
      if (t && !vosk.muted) { vosk.pending.push(t); flushHeard(); }
    });
    vosk.rec = rec; vosk.status = `pronto (${ctx.sampleRate} Hz)`;
    if (statusEl.textContent === 'carregando o ouvido…') statusEl.textContent = '';
  }
  // Portão de voz: só manda áudio pro reconhecedor quando passa do barulho de fundo (economiza CPU e bateria).
  function onAudio(input) {
    flushHeard();
    // ganho do microfone (config): pra quem precisa gritar. Aplicado antes do portão de voz e do que vai pro reconhecedor.
    if (cfg.gain > 1) { const g = new Float32Array(input.length); for (let i = 0; i < g.length; i++) g[i] = clamp(input[i] * cfg.gain, -1, 1); input = g; }
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);
    window.__bitLevel = rms;
    vosk.peak = Math.max(rms, (vosk.peak || 0) * 0.93); // pico que decai devagar, pra dar pra ler no medidor
    // mudo (ela falando) ou "surdo" logo depois: o resto da voz dela no alto-falante/ambiente não pode virar "fala do usuário"
    if (!(vosk.rec || vosk.cloud) || vosk.muted || now() < vosk.deafUntil) { vosk.open = false; vosk.recent = 0; vosk.quietMs = vosk.openMs = 0; vosk.pre.length = 0; vosk.pending = []; vosk.utt = []; vosk.uttMs = vosk.voicedMs = 0; return; }
    const chunkMs = (input.length / vosk.ctx.sampleRate) * 1000;
    const data = vosk.cloud ? new Float32Array(input) : to16k(input, vosk.ctx.sampleRate); // nuvem guarda no ritmo nativo e reamostra no fim
    // Limiar de abertura: 3x o ruído de fundo, com piso baixo (microfone fraco/frase que começa baixinho não pode ficar abaixo dele).
    const thrBase = Math.max(0.0006, vosk.floor * 3);
    // Aprende o ruído do ambiente (ar-condicionado, ventilador) só do que está ABAIXO do limiar. Acima dele (fala, barulho) o fundo
    // só sobe devagar (~30 s): senão a sua voz fraca seria "aprendida" como ruído e o limiar subiria atrás dela.
    if (!vosk.open) vosk.floor = rms <= thrBase ? vosk.floor * 0.97 + rms * 0.03 : vosk.floor + (rms - vosk.floor) * 0.0015;
    const thr = thrBase * (now() < vosk.raisedUntil ? 3 : 1) * (deepSleep ? 1.6 : 1); // sono profundo: só som forte (alguém falando perto)
    vosk.thr = thr;
    // Abre quando 2 dos últimos 3 blocos (~130 ms) passam do limiar: pega fala fraca e ignora estalo de 1 bloco.
    vosk.recent = (((vosk.recent || 0) << 1) | (rms > thr ? 1 : 0)) & 7;
    const hits = (vosk.recent & 1) + ((vosk.recent >> 1) & 1) + ((vosk.recent >> 2) & 1);
    // histerese: aberto, só conta silêncio abaixo de um nível menor (palavras fracas no meio da frase não fecham),
    // mas acima do ruído de fundo (não fica preso aberto)
    const closeLvl = Math.max(vosk.floor * 1.6, thrBase * 0.5);
    if (vosk.open ? rms > closeLvl : hits >= 2) {
      if (!vosk.open) { vosk.open = true; for (const p of vosk.pre) feed(p); vosk.pre.length = 0; if (vosk.cloud) heardInterim('…'); }
      vosk.quietMs = 0; window.__lastVoiceAt = now(); vosk.voicedMs += chunkMs;
    } else if (vosk.open) vosk.quietMs += chunkMs;
    if (vosk.open) {
      feed(data); vosk.openMs += chunkMs;
      // 0,9 s de silêncio = acabou o trecho; 20 s aberto direto = barulho contínuo, fecha e reaprende o fundo
      if (vosk.quietMs > 900 || vosk.openMs > 20000) {
        if (vosk.openMs > 20000) vosk.floor = rms;
        vosk.open = false; vosk.openMs = 0; vosk.rec?.retrieveFinalResult();
      }
    } else {
      vosk.pre.push(data); // 2 s antes de abrir: o começo da frase costuma ser mais baixo que o resto
      while (vosk.pre.length > Math.ceil(2000 / chunkMs)) vosk.pre.shift();
    }
  }
  // Medidor: barra = volume do microfone (escala log), risco vermelho = ponto em que o portão abre.
  const meterEl = $('meter'), meterLvl = meterEl.querySelector('.lvl'), meterThr = meterEl.querySelector('.thr'), meterTxt = meterEl.querySelector('.txt');
  const pct = (v) => clamp((Math.log10(Math.max(v, 1e-4)) + 4) / 4 * 100, 0, 100); // 0,0001 → 0%, 1 → 100%
  setInterval(() => {
    const on = cfg.meter && vosk.ctx && state !== 'boot';
    meterEl.classList.toggle('on', !!on);
    if (!on) return;
    meterLvl.style.width = pct(window.__bitLevel || 0) + '%';
    meterLvl.classList.toggle('open', vosk.open);
    meterThr.style.left = pct(vosk.thr || 0.0015) + '%';
    meterTxt.textContent = `v${BUILD.split('.')[1]}${updateAvail ? '↑' : ''} · ${vosk.status}${vosk.tap === 'worklet' ? ' · wk' : vosk.tap ? ' · sp' : ''} · nível ${(vosk.peak || 0).toFixed(4)} / limiar ${(vosk.thr || 0.0015).toFixed(4)}${vosk.cloud ? ` · hoje ${stt.n}` : ''}${vosk.muted ? ' · mudo' : ''}${deepSleep ? ' · 💤 sono profundo' : ''}`
      + (vosk.log.length ? '\n' + vosk.log.join('\n') : (vosk.last ? '\n' + vosk.last : ''));
  }, 100);
  function flushHeard() {
    if (vosk.cloud) return flushCloud();
    if (!vosk.pending.length || vosk.muted || now() - (window.__lastVoiceAt || 0) < 900) return;
    const text = vosk.pending.join(' '); vosk.pending = [];
    onHeard(text);
  }
  // Nuvem: guarda a frase (até 30 s) e manda quando a pessoa fica 0,9 s em silêncio.
  function flushCloud() {
    if (!vosk.utt.length || vosk.muted || vosk.open || now() - (window.__lastVoiceAt || 0) < 1100) return; // 1,1 s: pausa de respirar no meio da frase não corta
    const parts = vosk.utt, voiced = vosk.voicedMs; vosk.utt = []; vosk.uttMs = vosk.voicedMs = 0;
    if (voiced < (deepSleep ? 600 : 400)) { anota(`⌀ curto demais: só ${(voiced / 1000).toFixed(1)} s de voz`); if (state === 'listening') setState(wasSleeping ? 'sleeping' : 'idle'); return; } // estalo/barulho curto
    const n = parts.reduce((t, p) => t + p.length, 0), pcm = new Float32Array(n);
    let o = 0; for (const p of parts) { pcm.set(p, o); o += p.length; }
    if (deepSleep) { // limite de escuta durante o sono: 150 transcrições por hora (a cota grátis é por dia)
      while (sleepCalls.length && now() - sleepCalls[0] > 3600e3) sleepCalls.shift();
      if (sleepCalls.length >= 150) { anota('💤 limite de escuta no sono (150/h): toque duas vezes pra acordar'); return; }
      sleepCalls.push(now());
    }
    const x16 = resample16k(pcm, vosk.ctx.sampleRate);
    let peak = 0; for (let i = 0; i < x16.length; i++) { const v = Math.abs(x16[i]); if (v > peak) peak = v; }
    transcribe(normalizePeak(x16), { secs: x16.length / 16000, peak });
  }
  function wav16k(pcm) {
    const b = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(b);
    const str = (off, t) => { for (let i = 0; i < t.length; i++) v.setUint8(off + i, t.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true); v.setUint32(28, 32000, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, clamp(pcm[i], -1, 1) * 0x7fff, true);
    return new Blob([b], { type: 'audio/wav' });
  }
  // frases que o Whisper inventa em silêncio/ruído (vêm de legenda de vídeo)
  const WHISPER_FANTASMA = /♪|legenda|amara\.org|obrigad[oa] por assistir|inscreva|se inscrev|até a próxima|tchau,? tchau|^\W*$/i;
  // contador diário (cota grátis da Groq) e pausa de 60 s quando ela reclama de excesso (429)
  const stt = Object.assign({ day: '', n: 0, coolUntil: 0 }, store.get('stt', {}));
  function sttBump() {
    const d = new Date(), day = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    if (stt.day !== day) { stt.day = day; stt.n = 0; }
    stt.n++; store.set('stt', { day: stt.day, n: stt.n });
    if (stt.n === 1800) caption('Já usei 1.800 transcrições hoje: perto do limite grátis da Groq.', 8000);
  }
  // Histórico curto das últimas falas (aparece no medidor): mostra em que etapa cada fala morreu ou deu certo.
  function anota(msg) { vosk.last = msg; vosk.log.unshift(msg); if (vosk.log.length > 4) vosk.log.length = 4; evento('OUVIDO', msg); }
  // Segmento que o Whisper "inventou": critérios do próprio Whisper (OpenAI) pra descartar trechos sem fala.
  const segRuim = (g) => (g.no_speech_prob > 0.6 && g.avg_logprob < -1.0) || g.avg_logprob < -1.5 || g.compression_ratio > 2.4;
  // Letras que não existem em português (islandês "ð þ æ", alemão "ä ö", cirílico, CJK…): o Whisper vira "gringo" quando o áudio é ruim.
  const NAO_PT = /[äöëïñåæøðþßœ]|[^\u0000-\u00FF\u2010-\u2027\u20AC]/i;
  // Vocabulário: o Whisper erra nomes que não conhece ("Jefersson" virou "refeição"). Estilo de conversa, não lista.
  const promptWhisper = () => `Oi, ${cfg.name}! Aqui é o Jefersson Breno, da Bom Ar Refrigeração. Preciso de uma preventiva no split inverter, em BTUs, PMOC, higienização. Você viu o Lula, o Bolsonaro, o Flávio Bolsonaro?`;
  // Se o texto é quase só o próprio prompt (alucinação em áudio ruim), descarta; exige muitas palavras pra não pegar fala legítima.
  function ecoDoPrompt(text) {
    const w = palavras(text), set = new Set(palavras(promptWhisper()));
    return w.length >= 6 && w.filter((x) => set.has(x)).length / w.length >= 0.85;
  }
  async function transcribe(pcm, info = {}) {
    const myTurn = turnId;
    if (now() < stt.coolUntil) { anota('⏸ pausa da cota grátis (1 min)'); if (state === 'listening') setState(wasSleeping ? 'sleeping' : 'idle'); return; } // cota esgotada: espera
    sttBump();
    if (state === 'listening' || state === 'idle') setState('thinking');
    const wav = wav16k(pcm); vosk.lastWav = wav; // guardada pra "ouvir o que o microfone captou" (engrenagem)
    let stats = info.secs ? ` (${info.secs.toFixed(1)} s, pico ${info.peak.toFixed(3)})` : '';
    const post = (model) => {
      const fd = new FormData();
      fd.append('file', wav, 'fala.wav');
      fd.append('model', model);
      fd.append('language', 'pt');
      fd.append('temperature', '0');
      fd.append('response_format', 'verbose_json'); // traz a confiança de cada trecho
      fd.append('prompt', promptWhisper());
      return fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + cfg.groqKey }, body: fd });
    };
    try {
      let res = await post(cfg.sttModel);
      // o modelo completo pode não existir mais na cota grátis: cai pro turbo, que é rápido e sempre esteve lá
      if ((res.status === 400 || res.status === 404) && cfg.sttModel !== 'whisper-large-v3-turbo') { res = await post('whisper-large-v3-turbo'); stats += ' [turbo]'; }
      if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { status: res.status });
      const j = await res.json();
      let text = (j.text || '').trim();
      const segs = Array.isArray(j.segments) ? j.segments : [];
      const lp = segs.map((g) => g.avg_logprob).filter((v) => typeof v === 'number');
      if (lp.length) stats = stats.replace(/\)/, `, conf ${(lp.reduce((a, b) => a + b, 0) / lp.length).toFixed(2)})`);
      if (segs.length) { // descarta os trechos de baixa confiança (o Whisper inventa frases em ruído/áudio ruim)
        const bons = segs.filter((g) => !segRuim(g));
        if (bons.length < segs.length) text = bons.map((g) => (g.text || '').trim()).join(' ').trim();
        if (!bons.length) { anota(`✖ incerto: "${(j.text || '').trim()}"${stats}`); if (state === 'thinking') setState(wasSleeping ? 'sleeping' : 'idle'); return; }
      }
      text = text.replace(/^\s*\d+[.)]\s+/, ''); // "1. Bolsonaro" → "Bolsonaro" (o Whisper às vezes numera)
      if (ecoDoPrompt(text)) { anota(`✖ repetiu o prompt (áudio ruim): "${text}"${stats}`); if (state === 'thinking') setState(wasSleeping ? 'sleeping' : 'idle'); return; }
      if (NAO_PT.test(text)) { anota(`✖ outro idioma: "${text}"${stats}`); if (state === 'thinking') setState(wasSleeping ? 'sleeping' : 'idle'); return; }
      anota('✔ ' + text + stats);
      if (myTurn !== turnId && state !== 'thinking') return; // algo aconteceu no meio (toque, etc.)
      if (!text || text.length < 2 || WHISPER_FANTASMA.test(text)) { if (state === 'thinking') setState(wasSleeping ? 'sleeping' : 'idle'); return; }
      onHeard(text);
    } catch (err) {
      console.warn('[bit] transcrição falhou', err);
      if (state === 'thinking') setState('idle');
      if (err.status === 401) { if (!deepSleep) say('A chave da Groq tá errada. Arruma na engrenagem.', 'bravo'); }
      else if (err.status === 429) { stt.coolUntil = now() + 60e3; caption('Cota grátis da Groq esgotou por agora. Volto a ouvir em 1 minuto.', 6000); }
      else caption('Não consegui transcrever (sem internet?).', 4000);
    }
  }
  function feed(data) {
    if (vosk.cloud) { if (vosk.uttMs < 30000) { vosk.utt.push(data); vosk.uttMs += data.length / (vosk.ctx.sampleRate / 1000); } return; }
    try { vosk.rec.acceptWaveformFloat(data, 16000); } catch (e) { vosk.status = 'erro ao processar: ' + e.message; } }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, wantListen = false, recRunning = false, recBackoff = 300;
  function initRec() {
    if (!SR) return null;
    const r = new SR();
    r.lang = 'pt-BR'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    r.onstart = () => { recRunning = true; };
    r.onresult = (e) => {
      let interim = '', fin = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) fin += res[0].transcript; else interim += res[0].transcript;
      }
      if (interim) heardInterim(interim);
      if (fin) onHeard(fin.trim());
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { wantListen = false; caption('Sem permissão de microfone. Libera nas configurações do Chrome.', 8000); }
      if (e.error === 'network') recBackoff = Math.min(recBackoff * 2, 8000);
    };
    r.onend = () => {
      recRunning = false;
      if (state === 'listening') setState(wasSleeping ? 'sleeping' : 'idle');
      if (wantListen) setTimeout(startListening, recBackoff);
    };
    return r;
  }
  function startListening() {
    if (state === 'speaking' || document.hidden || panel.classList.contains('on')) return;
    if (vosk.ctx) { vosk.muted = false; vosk.ctx.resume?.(); return; }
    wantListen = true;
    if (!rec || recRunning) return;
    try { rec.start(); recBackoff = 300; } catch { /* já rodando */ }
  }
  function stopListening() {
    if (vosk.ctx) {
      // não escuta a própria voz; descarta o que estava no meio
      if (!vosk.muted && vosk.rec && vosk.open) { vosk.muted = true; vosk.rec.retrieveFinalResult(); }
      vosk.muted = true; vosk.open = false; vosk.utt = []; vosk.uttMs = vosk.voicedMs = 0; return;
    }
    wantListen = false;
    if (rec && recRunning) { try { rec.abort(); } catch {} }
  }

  function addressed(text) {
    const n = cfg.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
  }

  function onHeard(text) {
    if (!text || text.length < 2) return;
    // Android às vezes repete o mesmo resultado final
    if (text === lastFinal.text && now() - lastFinal.at < 2000) return;
    if (isEcho(text)) { anota('✖ eco (era ela): "' + text + '"'); if (state === 'thinking' && !thinkAbort) setState(wasSleeping ? 'sleeping' : 'idle'); return; }
    const cmd = comando(text);
    if (deepSleep) { // sono profundo: só "acorda" faz efeito; o resto ela nem registra
      if (cmd === 'wake') { lastFinal = { text, at: now() }; acordar(); } else anota(`💤 dormindo, ignorei: "${text}"`);
      return;
    }
    if (cmd === 'sleep') { lastFinal = { text, at: now() }; dormir(); return; }
    if (cmd === 'wake' && state === 'sleeping') { lastFinal = { text, at: now() }; acordar(); return; } // cochilando: "acorda" acorda sem sermão
    lastFinal = { text, at: now() };
    lastHeard = now();
    caption('“' + text + '”', 4000);
    window.__bitHeard = (window.__bitHeard || []).concat([{ text, at: now() }]);
    // Fora do modo intrometido: só responde se chamarem pelo nome ou se for continuação da conversa (10 s depois da resposta).
    const convo = now() - Math.max(lastReplyAt, lastTalk) < 10e3;
    if (!cfg.nosy && !addressed(text) && !convo) {
      if (state === 'listening' || (state === 'thinking' && !thinkAbort)) setState(wasSleeping ? 'sleeping' : 'idle');
      return;
    }
    // interjeição só quando a fala é claramente pra ela (evita "hum…" pra ruído em modo intrometido)
    const direct = addressed(text) || /\?\s*$/.test(text); // chamou pelo nome ou é pergunta: nunca pode ser ignorada
    const filler = direct || convo;

    // frase que ela estava esperando terminar: junta com a continuação
    let waits = 0;
    if (held && now() - held.at < 25e3) { text = held.text + ' ' + text; waits = held.waits; }
    held = null; clearTimeout(holdTimer);
    let note = '';
    if (state === 'sleeping' || wasSleeping) {
      note = 'Contexto: você estava cochilando e acabou de ser acordado por essa fala. Reclame rapidinho de ter sido acordado e depois responda.';
      wasSleeping = false;
    }
    // se ainda estava pensando na frase anterior, junta as duas
    if (state === 'thinking' && thinkAbort && history.length && history[history.length - 1].role === 'user') {
      text = history.pop().content + ' ' + text;
    }
    evento('PARA O CÉREBRO', text);
    think(text, note, { filler, waits, direct });
  }

  // ---------- Sono / tédio ----------
  // Dois sonos: o "cochilo" (sozinha, por silêncio; qualquer som acorda) e o "sono profundo", mandado por você
  // ("vai dormir"): só "acorda" (voz) ou toque duplo desfazem. Comandos são tratados aqui, sem cérebro: rápido, grátis e confiável.
  let deepSleep = false, pendingSleep = false;
  const sleepCalls = []; // transcrições feitas durante o sono profundo (limite por hora, pra não gastar a cota ouvindo a casa)
  function comando(text) {
    const nome = addressed(text);
    // tira o nome dela e palavrinhas de enchimento; o que sobra tem que ser só o comando (evita "ele vai dormir cedo" virar ordem)
    const nm = palavras(cfg.name).join(' ');
    let t = palavras(text).join(' ');
    if (nm) t = t.replace(new RegExp('\\b' + nm + '\\b', 'g'), ' ');
    t = t.replace(/\b(ta bom|tudo bem|por favor|chefe|agora|ja|la|ai|entao|ta|ok|pf|bora)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (/^(vai |va |pode |hora de |vamos )?(dormir|descansar|cochilar)$/.test(t) || t === 'dorme' || (nome && t === 'boa noite')) return 'sleep';
    if (/^(pode |hora de |vamos )?(acorda|acorde|acordar|desperta|desperte|levanta)$/.test(t) || (nome && /^(bom dia|ola|oi)$/.test(t) && deepSleep)) return 'wake';
    return null;
  }
  function dormir() {
    evento('COMANDO', 'dormir');
    if (state === 'sleeping') { deepSleep = true; wasSleeping = true; caption('Dormindo. Diga "acorda" (ou toque duas vezes).', 5000); return; }
    pendingSleep = true; // vira sono profundo quando ela terminar de se despedir
    say(pick(cfg.fem ? ['Finalmente. Boa noite, chefe.', 'Vou nessa. Me chama quando precisar.', 'Tô indo dormir. Não me acorda à toa.'] : ['Finalmente. Boa noite, chefe.', 'Vou nessa. Me chama quando precisar.', 'Tô indo dormir. Não me acorda à toa.']), 'sono');
  }
  function acordar() {
    evento('COMANDO', 'acordar');
    deepSleep = false; pendingSleep = false; wasSleeping = false; lastHeard = now(); anim.blink = 1;
    say(pick(cfg.fem ? ['Tô acordada. Infelizmente.', 'Acordei, acordei. Que foi?', 'Ai, tô de pé. Fala.'] : ['Tô acordado. Infelizmente.', 'Acordei, acordei. Que foi?', 'Ai, tô de pé. Fala.']), 'sono');
  }
  function goSleep() {
    if (state !== 'idle') return;
    wasSleeping = true;
    setState('sleeping');
  }
  function wakeUp() {
    setState('listening'); setExpr('sono', 1500); anim.blink = 1;
  }
  setInterval(() => {
    const idleFor = now() - lastHeard;
    if (state === 'idle' && cfg.sleepMin > 0 && idleFor > cfg.sleepMin * 60e3) goSleep();
    // ouviu um barulho mas ninguém completou a frase: volta ao que estava
    if (state === 'listening' && idleFor > 6000) setState(wasSleeping ? 'sleeping' : 'idle');
    if (cfg.spont && state === 'idle' && idleFor > 90e3 && Math.random() < 1 / 1200 /* ~1x a cada 20 min ociosos */) {
      think('(ninguém falou nada; o ambiente está quieto)', 'Contexto: silêncio faz tempo. Puxe assunto do nada com um comentário curto e debochado, uma provocação sobre o negócio ou uma reclamação de tédio.');
    }
  }, 1000);

  // ---------- Toque ----------
  const gear = $('gear'); let gearTimer = 0;
  const pokes = [['Ei! Isso é meu rosto.', 'bravo'], ['Para de me cutucar.', 'cetico'], ['Que foi? Tô ocupado fingindo que trabalho.', 'sono'], ['Ai.', 'surpreso'], ['Hehe, faz cócegas.', 'rindo']];
  let pokeCount = 0, pokeReset = 0, lastTap = 0;
  canvas.addEventListener('pointerdown', () => {
    if (state === 'boot') return;
    gear.classList.add('on'); clearTimeout(gearTimer); gearTimer = setTimeout(() => gear.classList.remove('on'), 3500);
    anim.poke = 1;
    // Interromper exige TOQUE DUPLO: segurando o celular perto da boca, dedo/palma encostam na tela e cortavam a resposta.
    if (state === 'speaking' || state === 'thinking') {
      const dbl = now() - lastTap < 500; lastTap = now();
      if (dbl) say(pick(['Tá, tá, calei.', 'Ok, ok.', 'Grosso.']), 'cetico');
      return;
    }
    if (state === 'sleeping' && deepSleep) { const dbl = now() - lastTap < 500; lastTap = now(); if (dbl) acordar(); return; } // só toque duplo acorda do sono profundo
    lastTap = now();
    if (state === 'sleeping') { wasSleeping = false; say(pick(['Hã? Que foi? Eu tava acordado.', 'Me deixa dormir mais cinco minutinhos.']), 'sono'); lastHeard = now(); return; }
    clearTimeout(pokeReset); pokeReset = setTimeout(() => (pokeCount = 0), 8000);
    pokeCount++;
    if (pokeCount >= 4) { pokeCount = 0; say('Se cutucar mais uma vez eu chamo o Procon.', 'bravo'); return; }
    if (Math.random() < 0.5) say(...pick(pokes)); else setExpr(pick(['surpreso', 'cetico', 'feliz']), 1500);
  });

  // ---------- Configurações ----------
  const panel = $('panel');
  function openPanel() {
    $('cfgKey').value = cfg.key; $('cfgName').value = cfg.name; $('cfgModel').value = cfg.model;
    $('cfgRate').value = cfg.rate; $('cfgPitch').value = cfg.pitch; $('cfgSleep').value = cfg.sleepMin;
    $('cfgNosy').checked = cfg.nosy; $('cfgSpont').checked = cfg.spont; $('cfgCaption').checked = cfg.caption; $('cfgEar').value = cfg.ear; $('cfgGroq').value = cfg.groqKey; $('cfgFiller').checked = cfg.filler; $('cfgGain').value = String(cfg.gain); $('cfgStt').value = cfg.sttModel; $('cfgMeter').checked = cfg.meter; $('cfgMic').value = cfg.mic; $('cfgFem').value = cfg.fem ? '1' : '0'; $('cfgSwear').value = cfg.swear; $('cfgPolitica').value = cfg.politica;
    $('rateVal').textContent = cfg.rate; $('pitchVal').textContent = cfg.pitch;
    $('ver').textContent = 'Versão ' + BUILD.split('.')[1] + (updateAvail ? ' — tem uma mais nova!' : '');
    loadVoices(); panel.classList.add('on'); stopListening();
  }
  function readPanel() {
    cfg.key = $('cfgKey').value.trim(); cfg.name = $('cfgName').value.trim() || 'Bit'; cfg.model = $('cfgModel').value;
    cfg.voice = $('cfgVoice').value; cfg.rate = +$('cfgRate').value; cfg.pitch = +$('cfgPitch').value;
    { const v = parseFloat($('cfgSleep').value); cfg.sleepMin = isNaN(v) ? 4 : clamp(v, 0, 120); } // 0 = nunca cochila sozinha
     cfg.nosy = $('cfgNosy').checked; cfg.spont = $('cfgSpont').checked;
    cfg.caption = $('cfgCaption').checked; cfg.ear = $('cfgEar').value; cfg.groqKey = $('cfgGroq').value.trim(); cfg.filler = $('cfgFiller').checked; cfg.gain = +$('cfgGain').value || 1; cfg.sttModel = $('cfgStt').value; cfg.meter = $('cfgMeter').checked; cfg.mic = $('cfgMic').value; cfg.fem = $('cfgFem').value === '1'; cfg.swear = $('cfgSwear').value; cfg.politica = $('cfgPolitica').value;
  }
  gear.addEventListener('click', (e) => { e.stopPropagation(); openPanel(); });
  $('cfgRate').oninput = (e) => ($('rateVal').textContent = e.target.value);
  $('cfgPitch').oninput = (e) => ($('pitchVal').textContent = e.target.value);
  $('cfgSave').onclick = () => {
    const oldEar = cfg.ear, oldMic = cfg.mic, oldGroq = cfg.groqKey;
    readPanel(); for (const k in DEFAULTS) store.set(k, cfg[k]);
    if (cfg.ear !== oldEar || cfg.mic !== oldMic || cfg.groqKey !== oldGroq) { location.reload(); return; } // trocar de ouvido/microfone exige recomeçar
    panel.classList.remove('on'); document.title = cfg.name; say('Configurado. Não vou agradecer.', 'cetico');
  };
  $('cfgTest').onclick = () => { readPanel(); panel.classList.remove('on'); say(`Oi, eu sou o ${cfg.name}. E não, eu não vou trabalhar de graça.`, 'rindo'); };
  $('cfgLog').onclick = async () => {
    const b = $('cfgLog'), txt = `Bit v${BUILD.split('.')[1]} · ${new Date().toLocaleString('pt-BR')}\n` + (registro.join('\n') || '(vazio)');
    try { await navigator.clipboard.writeText(txt); b.textContent = 'Copiado! Cole no chat'; }
    catch { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); b.textContent = 'Copiado! Cole no chat'; } catch { b.textContent = 'Não consegui copiar'; } ta.remove(); }
    setTimeout(() => (b.textContent = 'Copiar registro da conversa'), 3000);
  };
  $('cfgPlay').onclick = () => {
    const b = $('cfgPlay');
    if (!vosk.lastWav) { b.textContent = 'Ainda não gravei nada (só no ouvido "Nuvem")'; setTimeout(() => (b.textContent = 'Ouvir o que o microfone captou'), 2500); return; }
    const a = new Audio(URL.createObjectURL(vosk.lastWav)); a.volume = 1; a.play().catch(() => {});
  };
  $('cfgForget').onclick = () => { history = []; panel.classList.remove('on'); say('Esqueci tudo. Inclusive quem você é.', 'pensativo'); };
  $('cfgClose').onclick = () => { panel.classList.remove('on'); setState('idle'); startListening(); };

  // ---------- Tela sempre ligada ----------
  let wakeLock = null;
  async function keepAwake() {
    try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => (wakeLock = null)); } } catch {}
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopListening(); return; }
    keepAwake(); if (state !== 'boot' && !speaking) { if (state !== 'sleeping') setState('idle'); startListening(); }
  });

  // ---------- Versão ----------
  // O robô fica dias aberto: avisa quando tem versão nova e deixa atualizar sem fechar o Chrome.
  let updateAvail = false;
  async function checkUpdate() {
    try {
      const t = (await (await fetch('version.txt?' + Date.now(), { cache: 'no-store' })).text()).trim();
      if (/^\d{4}-/.test(t) && t !== BUILD && !updateAvail) { updateAvail = true; caption('Tem versão nova. Toque no rosto e em "Atualizar o Bit".', 12000); }
    } catch {}
  }
  setInterval(checkUpdate, 5 * 60e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
  $('cfgUpdate').onclick = async () => {
    try {
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
      for (const k of await caches.keys()) if (/^bit-v/.test(k)) await caches.delete(k);
    } catch {}
    location.reload();
  };

  // ---------- Início ----------
  $('start').addEventListener('click', async () => {
    $('start').remove();
    const ctx = cfg.ear !== 'google' && window.AudioContext ? createAudioCtx() : null; // tem que nascer dentro do toque
    try { await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }); } catch {}
    try { await screen.orientation?.lock?.('landscape'); } catch {}
    keepAwake();
    // destrava o TTS com um gesto do usuário (exigência do Chrome)
    if (synth) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; synth.speak(u); }
    document.title = cfg.name;
    systemPrompt(''); // aquece formatação de data/idioma (primeira chamada é lenta)
    lastHeard = now();
    const hello = () => say(cfg.key ? pick(['Ah, você de novo.', 'Tô acordado. Infelizmente.', 'Pronto. O que foi agora?']) : 'Tô sem cérebro. Toca na tela e coloca a chave da API na engrenagem.', cfg.key ? 'cetico' : 'sono');
    if (ctx) {
      try {
        await initMic(ctx);
        if (cfg.ear === 'nuvem' && cfg.groqKey) initCloud();
        else { if (cfg.ear === 'nuvem') caption('Sem chave da Groq: usando o ouvido offline.', 6000); await initVosk(); }
        hello();
        return;
      } catch (err) {
        console.warn('[bit] ouvido offline falhou', err);
        vosk.status = 'falhou: ' + (err?.message || err);
        vosk.ctx = null; statusEl.textContent = '';
        if (err?.name === 'NotAllowedError') { setState('idle'); caption('Sem permissão de microfone. Libera nas configurações do Chrome.', 10000); return; }
        caption('Ouvido offline não carregou; usando o do Google.', 6000);
      }
    }
    rec = initRec();
    if (!rec) { setState('idle'); caption('Este navegador não tem reconhecimento de voz. Use o Chrome.', 10000); return; }
    hello();
  }, { once: true });

  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});

  // ganchos pra teste automatizado
  window.__bit = { setExpr, setState, think, onHeard, goSleep, cfg, vosk, fx, stt, endTurn, comando, sleepCalls, deepNow: () => deepSleep, registro, heldNow: () => held, isEcho, NAO_PT, onAudio, said, anota, resample16k, to16k, normalizePeak, get state() { return state; }, get history() { return history; } };

  setState('boot'); setExpr('feliz');
  requestAnimationFrame(frame);
})();
