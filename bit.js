/* Bit — robô assistente para rodar num celular parado (Galaxy S8).
   Rosto em canvas + ouvido (Web Speech API) + cérebro (Claude, streaming) + voz (speechSynthesis). */
(() => {
  'use strict';

  // ---------- Config ----------
  const DEFAULTS = {
    key: '', name: 'Bit', model: 'claude-haiku-5-5', voice: '', rate: 1.1, pitch: 1.05,
    sleepMin: 4, nosy: true, spont: false, caption: true, ear: 'vosk', meter: true, mic: 'voz', fem: true, swear: 'liberado', politica: 'bolsonarista',
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

  // ---------- Voz (TTS) ----------
  const synth = window.speechSynthesis;
  let voices = [];
  function loadVoices() {
    voices = (synth?.getVoices() || []).filter((v) => /^pt/i.test(v.lang));
    const sel = $('cfgVoice');
    sel.innerHTML = '';
    if (!voices.length) sel.innerHTML = '<option value="">Padrão do sistema</option>';
    for (const v of voices) {
      const o = document.createElement('option'); o.value = v.name; o.textContent = `${v.name} (${v.lang})`;
      if (v.name === cfg.voice) o.selected = true; sel.appendChild(o);
    }
  }
  if (synth) { loadVoices(); synth.onvoiceschanged = loadVoices; }
  function chooseVoice() {
    return voices.find((v) => v.name === cfg.voice) || voices.find((v) => /pt-BR/i.test(v.lang) && /google/i.test(v.name))
      || voices.find((v) => /pt-BR/i.test(v.lang)) || voices[0] || null;
  }

  const speakQ = [];               // [{text, expr}]
  let speaking = false, streamDone = true, turnId = 0, uSerial = 0;
  function enqueueSpeech(text, expr, id) {
    if (id !== turnId) return;
    speakQ.push({ text, expr, id });
    if (!speaking) speakNext();
  }
  function speakNext() {
    const item = speakQ.shift();
    if (!item) {
      speaking = false;
      if (streamDone) endTurn();
      return;
    }
    if (item.id !== turnId) return speakNext();
    speaking = true;
    const my = ++uSerial;
    stopListening();
    setState('speaking');
    if (item.expr) setExpr(item.expr, 60e3); else if (now() > exprHold) setExpr('neutro');
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
    turnId++; uSerial++; speakQ.length = 0; abortThinking();
    if (synth) synth.cancel();
    speaking = false; streamDone = true;
  }
  function endTurn() {
    exprHold = now() + 1800; // segura a última expressão um pouco
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
- Português brasileiro falado, coloquial. Respostas CURTAS: 1 a 3 frases, no máximo uns 40 palavras. Só se estenda se pedirem explicação.
- Sem markdown, sem listas, sem emojis, sem asteriscos, sem números de tópico. Escreva números por extenso quando for curto.
- Comece SEMPRE com UMA tag de expressão entre colchetes: [neutro] [feliz] [rindo] [cetico] [bravo] [triste] [surpreso] [pensativo] [sono]. Pode trocar de tag no meio se a emoção mudar.
- Você está ouvindo por um microfone num ambiente real; a transcrição pode vir errada ou cortada. Se fizer sentido, interprete; se não, zoe a falta de sentido.
${cfg.nosy
    ? `- Você é intromet${a}: comenta o que ouvir mesmo que não falem com você. Mas se for claramente ruído sem sentido (TV, música, palavra solta), responda só [ignorar].`
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
      piece = piece.replace(/\[([^\]]{1,20})\]/g, (_, tag) => { const n = exprName(tag); if (tag.toLowerCase().includes('ignorar')) expr = 'IGNORE'; else if (n) expr = n; return ' '; });
      if (expr === 'IGNORE') { onChunk(null, 'IGNORE'); return; }
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

  async function think(userText, ctxNote = '') {
    shutUp();
    const id = turnId;
    streamDone = false;
    setState('thinking');
    lastTalk = now();
    trimHistory();
    history.push({ role: 'user', content: userText });

    if (!cfg.key) { offlineReply(userText, id); return; }

    const ac = new AbortController(); thinkAbort = ac;
    let full = '', ignored = false, gotAny = false;
    const chunker = makeChunker((piece, expr) => {
      if (expr === 'IGNORE') { ignored = true; return; }
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
        body: JSON.stringify({ model: cfg.model, max_tokens: 300, stream: true, system: systemPrompt(ctxNote), messages: history }),
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
      thinkAbort = null;
      if (ignored || !gotAny) { history.pop(); streamDone = true; if (!speaking) { setState('idle'); setTimeout(startListening, 150); } return; }
      history.push({ role: 'assistant', content: full.trim() });
      streamDone = true;
      if (!speaking && !speakQ.length) endTurn();
    } catch (err) {
      if (err.name === 'AbortError' || id !== turnId) return;
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
    if (state === 'speaking') return;
    lastHeard = now();
    if (state === 'sleeping') wakeUp();
    if (state === 'idle') setState('listening');
    caption(text, 2500);
  }

  const vosk = { ctx: null, rec: null, muted: true, open: false, quietMs: 0, openMs: 0, floor: 0.002, thr: 0, pre: [], pending: [], status: '', last: '' };
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
  async function initVosk(ctx) {
    vosk.ctx = ctx;
    // 'voz': processamento de voz do Android (ganho, ruído, eco). 'bruto': sem processamento — no S8 chega quase mudo.
    const proc = cfg.mic !== 'bruto';
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: proc, noiseSuppression: proc, autoGainControl: proc, channelCount: 1 },
    });
    const src = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(2048, 1, 1);
    // ligado na saída (em silêncio): o processador só roda assim, e os botões de volume passam a controlar a mídia
    src.connect(node); node.connect(ctx.destination);
    node.onaudioprocess = (e) => { e.outputBuffer.getChannelData(0).fill(0); onAudio(e.inputBuffer.getChannelData(0)); };
    vosk.node = node; vosk.stream = stream; vosk.status = 'baixando/abrindo modelo…';
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
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);
    window.__bitLevel = rms;
    vosk.peak = Math.max(rms, (vosk.peak || 0) * 0.93); // pico que decai devagar, pra dar pra ler no medidor
    if (!vosk.rec || vosk.muted) { vosk.open = false; vosk.pre.length = 0; vosk.pending = []; return; }
    const chunkMs = (input.length / vosk.ctx.sampleRate) * 1000;
    const data = to16k(input, vosk.ctx.sampleRate);
    if (!vosk.open) vosk.floor = vosk.floor * 0.97 + rms * 0.03; // aprende o ruído do ambiente (ar-condicionado, ventilador)
    const thr = Math.max(0.0015, vosk.floor * 2.5);
    vosk.thr = thr;
    // histerese: abre no limiar; aberto, só conta silêncio abaixo de um nível menor
    // (palavras fracas no meio da frase não fecham), mas acima do ruído de fundo (não fica preso aberto)
    const closeLvl = Math.max(vosk.floor * 1.6, thr * 0.5);
    if (rms > (vosk.open ? closeLvl : thr)) {
      if (!vosk.open) { vosk.open = true; for (const p of vosk.pre) feed(p); vosk.pre.length = 0; }
      vosk.quietMs = 0; window.__lastVoiceAt = now();
    } else if (vosk.open) vosk.quietMs += chunkMs;
    if (vosk.open) {
      feed(data); vosk.openMs += chunkMs;
      // 0,75 s de silêncio = acabou o trecho; 20 s aberto direto = barulho contínuo, fecha e reaprende o fundo
      if (vosk.quietMs > 750 || vosk.openMs > 20000) {
        if (vosk.openMs > 20000) vosk.floor = rms;
        vosk.open = false; vosk.openMs = 0; vosk.rec.retrieveFinalResult();
      }
    } else {
      vosk.pre.push(data); // 0,6 s antes da fala, pra não comer o começo
      while (vosk.pre.length > Math.ceil(600 / chunkMs)) vosk.pre.shift();
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
    meterTxt.textContent = `${vosk.status} · nível ${(vosk.peak || 0).toFixed(4)} / limiar ${(vosk.thr || 0.0015).toFixed(4)}${vosk.muted ? ' · mudo' : ''}${vosk.last ? ' · ' + vosk.last : ''}`;
  }, 100);
  function flushHeard() {
    if (!vosk.pending.length || vosk.muted || now() - (window.__lastVoiceAt || 0) < 900) return;
    const text = vosk.pending.join(' '); vosk.pending = [];
    onHeard(text);
  }
  function feed(data) { try { vosk.rec.acceptWaveformFloat(data, 16000); } catch (e) { vosk.status = 'erro ao processar: ' + e.message; } }

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
      vosk.muted = true; vosk.open = false; return;
    }
    wantListen = false;
    if (rec && recRunning) { try { rec.abort(); } catch {} }
  }

  function addressed(text) {
    const n = cfg.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(n);
  }

  function onHeard(text) {
    if (!text || text.length < 2) return;
    // Android às vezes repete o mesmo resultado final
    if (text === lastFinal.text && now() - lastFinal.at < 2000) return;
    lastFinal = { text, at: now() };
    lastHeard = now();
    caption('“' + text + '”', 4000);
    window.__bitHeard = (window.__bitHeard || []).concat([{ text, at: now() }]);
    if (!cfg.nosy && !addressed(text) && now() - lastTalk > 45e3) { if (state === 'listening') setState(wasSleeping ? 'sleeping' : 'idle'); return; }

    let note = '';
    if (state === 'sleeping' || wasSleeping) {
      note = 'Contexto: você estava cochilando e acabou de ser acordado por essa fala. Reclame rapidinho de ter sido acordado e depois responda.';
      wasSleeping = false;
    }
    // se ainda estava pensando na frase anterior, junta as duas
    if (state === 'thinking' && thinkAbort && history.length && history[history.length - 1].role === 'user') {
      text = history.pop().content + ' ' + text;
    }
    think(text, note);
  }

  // ---------- Sono / tédio ----------
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
    if (state === 'idle' && idleFor > cfg.sleepMin * 60e3) goSleep();
    // ouviu um barulho mas ninguém completou a frase: volta ao que estava
    if (state === 'listening' && idleFor > 6000) setState(wasSleeping ? 'sleeping' : 'idle');
    if (cfg.spont && state === 'idle' && idleFor > 90e3 && Math.random() < 1 / 1200 /* ~1x a cada 20 min ociosos */) {
      think('(ninguém falou nada; o ambiente está quieto)', 'Contexto: silêncio faz tempo. Puxe assunto do nada com um comentário curto e debochado, uma provocação sobre o negócio ou uma reclamação de tédio.');
    }
  }, 1000);

  // ---------- Toque ----------
  const gear = $('gear'); let gearTimer = 0;
  const pokes = [['Ei! Isso é meu rosto.', 'bravo'], ['Para de me cutucar.', 'cetico'], ['Que foi? Tô ocupado fingindo que trabalho.', 'sono'], ['Ai.', 'surpreso'], ['Hehe, faz cócegas.', 'rindo']];
  let pokeCount = 0, pokeReset = 0;
  canvas.addEventListener('pointerdown', () => {
    if (state === 'boot') return;
    gear.classList.add('on'); clearTimeout(gearTimer); gearTimer = setTimeout(() => gear.classList.remove('on'), 3500);
    anim.poke = 1;
    if (state === 'speaking' || state === 'thinking') { say(pick(['Tá, tá, calei.', 'Ok, ok.', 'Grosso.']), 'cetico'); return; }
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
    $('cfgNosy').checked = cfg.nosy; $('cfgSpont').checked = cfg.spont; $('cfgCaption').checked = cfg.caption; $('cfgEar').value = cfg.ear; $('cfgMeter').checked = cfg.meter; $('cfgMic').value = cfg.mic; $('cfgFem').value = cfg.fem ? '1' : '0'; $('cfgSwear').value = cfg.swear; $('cfgPolitica').value = cfg.politica;
    $('rateVal').textContent = cfg.rate; $('pitchVal').textContent = cfg.pitch;
    loadVoices(); panel.classList.add('on'); stopListening();
  }
  function readPanel() {
    cfg.key = $('cfgKey').value.trim(); cfg.name = $('cfgName').value.trim() || 'Bit'; cfg.model = $('cfgModel').value;
    cfg.voice = $('cfgVoice').value; cfg.rate = +$('cfgRate').value; cfg.pitch = +$('cfgPitch').value;
    cfg.sleepMin = clamp(+$('cfgSleep').value || 4, 1, 120); cfg.nosy = $('cfgNosy').checked; cfg.spont = $('cfgSpont').checked;
    cfg.caption = $('cfgCaption').checked; cfg.ear = $('cfgEar').value; cfg.meter = $('cfgMeter').checked; cfg.mic = $('cfgMic').value; cfg.fem = $('cfgFem').value === '1'; cfg.swear = $('cfgSwear').value; cfg.politica = $('cfgPolitica').value;
  }
  gear.addEventListener('click', (e) => { e.stopPropagation(); openPanel(); });
  $('cfgRate').oninput = (e) => ($('rateVal').textContent = e.target.value);
  $('cfgPitch').oninput = (e) => ($('pitchVal').textContent = e.target.value);
  $('cfgSave').onclick = () => {
    const oldEar = cfg.ear, oldMic = cfg.mic;
    readPanel(); for (const k in DEFAULTS) store.set(k, cfg[k]);
    if (cfg.ear !== oldEar || cfg.mic !== oldMic) { location.reload(); return; } // trocar de ouvido/microfone exige recomeçar
    panel.classList.remove('on'); document.title = cfg.name; say('Configurado. Não vou agradecer.', 'cetico');
  };
  $('cfgTest').onclick = () => { readPanel(); panel.classList.remove('on'); say(`Oi, eu sou o ${cfg.name}. E não, eu não vou trabalhar de graça.`, 'rindo'); };
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

  // ---------- Início ----------
  $('start').addEventListener('click', async () => {
    $('start').remove();
    const ctx = cfg.ear === 'vosk' && window.AudioContext ? createAudioCtx() : null; // tem que nascer dentro do toque
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
        await initVosk(ctx);
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
  window.__bit = { setExpr, setState, think, onHeard, goSleep, cfg, vosk, get state() { return state; }, get history() { return history; } };

  setState('boot'); setExpr('feliz');
  requestAnimationFrame(frame);
})();
