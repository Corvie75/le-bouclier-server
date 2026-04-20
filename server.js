// ═══════════════════════════════════════════════
//  Le Bouclier — Serveur v5
//  + Victoires persistantes, retour lobby, chat, toggle héros
//  npm install express socket.io cors | node server.js
// ═══════════════════════════════════════════════

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(cors());
app.use(express.static('public'));
app.get('/health', (_, res) => res.json({ ok: true }));

const rooms = {};

// ════════ HÉROS ════════
const HEROES = [
  { id:'guerriere',    name:'Guerrière',    emoji:'⚔️',  desc:'Cumule plusieurs charges. Bouclier +2 par charge. Doit toutes les utiliser en attaquant.' },
  { id:'necromancien', name:'Nécromancien', emoji:'💀',  desc:'Peut utiliser la dernière carte de la défausse pour attaquer ou charger.' },
  { id:'voleuse',      name:'Voleuse',      emoji:'🗡️',  desc:'Après avoir infligé des PV, échange une carte avec la cible.' },
  { id:'mage',         name:'Mage',         emoji:'🔮',  desc:'Quand un As ou Roi est joué en attaque, peut le transformer en Roi ou As.' },
  { id:'paladin',      name:'Paladin',      emoji:'🛡️',  desc:'Si perd des PV sur une attaque, riposte avec 2 attaques.' },
  { id:'pretresse',    name:'Prêtresse',    emoji:'✨',  desc:'Peut échanger une de ses cartes PV contre la première carte de la pioche.' },
  { id:'demoniste',    name:'Démoniste',    emoji:'🔥',  desc:'Peut relancer la carte piochée en payant 3 PV.' },
  { id:'espionne',     name:'Espionne',     emoji:'🕵️', desc:'Bouclier caché. Peut regarder les charges adverses.' },
  { id:'alchimiste',   name:'Alchimiste',   emoji:'⚗️',  desc:'3 potions : Feu (2 cibles), Invisibilité (esquive), Vitesse (action bonus).' },
  { id:'ogre',         name:'Ogre',         emoji:'👹',  desc:'Commence avec 3 cartes PV. Si attaque = bouclier adverse → élimination directe.' },
  { id:'barde',        name:'Barde',        emoji:'🎵',  desc:'Même couleur → choisit parmi 2 cartes. Même symbole → parmi 3.' },
  { id:'bete',         name:'Bête',         emoji:'🐾',  desc:'Chaque attaque qui blesse donne un marqueur blessure (+3 aux prochaines attaques).' },
];

// ════════ DECK ════════
function buildDeck() {
  const suits = ['♠','♣','♥','♦'];
  const faces = [
    {display:'A',numVal:1},{display:'2',numVal:2},{display:'3',numVal:3},
    {display:'4',numVal:4},{display:'5',numVal:5},{display:'6',numVal:6},
    {display:'7',numVal:7},{display:'8',numVal:8},{display:'9',numVal:9},
    {display:'10',numVal:10},{display:'J',numVal:11},{display:'Q',numVal:12},{display:'K',numVal:13},
  ];
  const deck = [];
  suits.forEach(s => faces.forEach(f => deck.push({ suit:s, display:f.display, numVal:f.numVal })));
  deck.push({ suit:'🃏', display:'JKR', numVal:15 });
  deck.push({ suit:'🃏', display:'JKR', numVal:15 });
  return shuffle(deck);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

function dealStartHand(deck, isOgre=false) {
  const count = isOgre ? 4 : 3;
  for (let attempt = 0; attempt < 50; attempt++) {
    const hand = [];
    for (let i=0; i<count; i++) { if (deck.length) hand.push(deck.pop()); }
    const hasJoker = hand.some(c => c.suit === '🃏');
    const total = hand.reduce((s,c) => s+c.numVal, 0);
    if (!hasJoker && total > 15) {
      hand.sort((a,b) => b.numVal - a.numVal);
      if (isOgre) return { pv:[hand[0],hand[1],hand[2]], shield:hand[3] };
      return { pv:[hand[0],hand[1]], shield:hand[2] };
    }
    hand.forEach(c => deck.unshift(c));
    shuffle(deck);
  }
  const hand = [];
  for (let i=0; i<count; i++) { if (deck.length) hand.push(deck.pop()); }
  hand.sort((a,b) => b.numVal - a.numVal);
  if (isOgre) return { pv:[hand[0],hand[1],hand[2]||hand[1]], shield:hand[3]||hand[2] };
  return { pv:[hand[0],hand[1]], shield:hand[2] };
}

// ════════ UTILS ════════
function genCode() {
  let code;
  do { code = String(Math.floor(100000 + Math.random()*900000)); }
  while (rooms[code]);
  return code;
}
function totalPV(p) { return p.pv.reduce((s,c) => s+c.numVal, 0); }
function countAlive(r) { return r.players.filter(p => !p.eliminated).length; }
function cStr(c) { return c ? `${c.display}${c.suit}` : '?'; }
function getShieldVal(p) {
  const base = p.shield ? p.shield.numVal : 0;
  if (p.heroId === 'guerriere') return base + p.charges.length * 2;
  return base;
}
function drawCard(room) {
  if (room.deck.length === 0) {
    // Récupérer toutes les cartes actuellement en jeu (PV, boucliers, charges)
    const inPlay = new Set();
    room.players.forEach(p => {
      p.pv.forEach(c => inPlay.add(c));
      if (p.shield) inPlay.add(p.shield);
      p.charges.forEach(c => inPlay.add(c));
    });
    // Remelanger uniquement les cartes de la défausse qui ne sont pas en jeu
    const reshuffled = room.discard.filter(c => !inPlay.has(c));
    room.deck = shuffle(reshuffled);
    room.discard = [];
    console.log(`[🔄] Pioche vide — remélange de ${room.deck.length} cartes`);
  }
  return room.deck.pop();
}

function lobbyPlayers(room) {
  return room.players.map(p => ({
    id: p.id, name: p.name, wins: p.wins || 0, avatar: p.avatar || null,
  }));
}

function publicState(room) {
  return {
    players: room.players.map(p => ({
      id: p.id, name: p.name, eliminated: p.eliminated,
      pv: p.pv,
      shield: p.heroId === 'espionne' ? null : p.shield,
      shieldVal: p.heroId === 'espionne' ? '?' : getShieldVal(p),
      hasCharge: p.charges.length > 0,
      chargeCount: p.charges.length,
      heroId: p.heroId, heroName: p.heroName, heroEmoji: p.heroEmoji,
      heroChosen: p.heroChosen,
      wins: p.wins || 0,
      avatar: p.avatar || null, // Fix 2: toujours inclure l'avatar
      potions: null,
      woundMarkers: p.woundMarkers || {},
    })),
    deckCount: room.deck.length,
    discardTop: room.discard.length > 0 ? room.discard[room.discard.length-1] : null,
    currentTurnId: room.players[room.turnIdx]?.id || null,
    heroMode: room.heroMode,
  };
}

function privateState(room, playerId) {
  const base = publicState(room);
  const player = room.players.find(p => p.id === playerId);
  if (player?.heroId === 'alchimiste') {
    const me = base.players.find(p => p.id === playerId);
    if (me) me.potions = player.potions;
  }
  return base;
}

function broadcastState(room) {
  room.players.forEach(p => {
    const s = io.sockets.sockets.get(p.id);
    if (s) s.emit('state_update', { state: privateState(room, p.id) });
  });
}

function nextAliveTurn(room) {
  let tries = 0;
  do {
    room.turnIdx = (room.turnIdx + 1) % room.players.length;
    tries++;
  } while (room.players[room.turnIdx]?.eliminated && tries <= room.players.length);
}

function findCardOfValue(room, val) {
  const idx = room.discard.findIndex(c => c.numVal === val);
  if (idx !== -1) return room.discard.splice(idx, 1)[0];
  const temp = [];
  while (room.deck.length > 0) {
    const c = room.deck.pop();
    if (c.numVal === val) { temp.forEach(x => room.deck.unshift(x)); return c; }
    temp.push(c);
  }
  temp.forEach(x => room.deck.unshift(x));
  return room.deck.length > 0 ? room.deck.pop() : null;
}

function applyDamage(room, target, dmg) {
  let rem = dmg;
  while (rem > 0 && target.pv.length > 0) {
    target.pv.sort((a,b) => a.numVal - b.numVal);
    const w = target.pv[0];
    if (rem >= w.numVal) { rem -= w.numVal; room.discard.push(w); target.pv.shift(); }
    else {
      const nv = w.numVal - rem; rem = 0;
      room.discard.push(w); target.pv.shift();
      const f = findCardOfValue(room, nv);
      if (f) target.pv.push(f);
    }
  }
}

function checkEliminated(room, player) {
  if (totalPV(player) <= 0 && !player.eliminated) {
    player.eliminated = true;
    player.pv.forEach(c => room.discard.push(c));
    player.charges.forEach(c => room.discard.push(c));
    if (player.shield) room.discard.push(player.shield);
    player.pv = []; player.charges = [];
    io.to(room.code).emit('player_eliminated', { playerId:player.id, playerName:player.name });
    return true;
  }
  return false;
}

function checkGameOver(room) {
  if (countAlive(room) <= 1) {
    const winner = room.players.find(p => !p.eliminated) || room.players[0];
    // +1 victoire au gagnant
    winner.wins = (winner.wins || 0) + 1;
    room.status = 'lobby';

    // Reset pour le prochain round
    room.players.forEach(p => {
      p.pv=[]; p.shield=null; p.charges=[]; p.drawnCard=null; p.eliminated=false;
      p.heroId=null; p.heroName=null; p.heroEmoji=null; p.heroChosen=false;
      p.heroChoices=[]; p.potions=[]; p.woundMarkers={};
      p.bardeChoices=null; p.pendingDraw=null; p.pendingAction=null;
      p.mageTransform=false; p.bonusAction=false;
      p.potionInvis=false; p.potionFeu=false; p.potionFeuTarget2=null;
    });

    io.to(room.code).emit('game_over', {
      winner: { id:winner.id, name:winner.name, wins:winner.wins, avatar:winner.avatar||null },
      finalState: publicState(room),
    });

    // Retour au lobby après 5 secondes
    setTimeout(() => {
      if (rooms[room.code]) {
        io.to(room.code).emit('return_to_lobby', {
          players: lobbyPlayers(room),
          heroMode: room.heroMode,
          isHost: room.host,
        });
      }
    }, 5000);

    return true;
  }
  return false;
}

function notifyErr(player, msg) {
  const s = io.sockets.sockets.get(player.id);
  if (s) s.emit('err', { msg });
}

function broadcastPopup(room, emoji, main, detail, result, resultType) {
  io.to(room.code).emit('action_popup', { emoji, main, detail, result, resultType });
}

function bardeColorSame(p) {
  const cards = [...p.pv, p.shield].filter(Boolean);
  const isRed = c => ['♥','♦','🃏'].includes(c.suit);
  const isBlk = c => ['♠','♣','🃏'].includes(c.suit);
  return cards.every(isRed) || cards.every(isBlk);
}
function bardeSymbolSame(p) {
  const cards = [...p.pv, p.shield].filter(Boolean);
  const suits = new Set(cards.map(c => c.suit === '🃏' ? 'JOKER' : c.suit));
  suits.delete('JOKER');
  return suits.size === 1;
}

function actionLabel(type, targetName) {
  const map = {
    attack: `⚔️ Attaque ${targetName}`,
    shield_swap: `🛡️ Change le bouclier de ${targetName}`,
    charge: '⚡ Se charge',
    heal_pv: '✨ Soigne ses PV',
    necro_discard: `⚔️ Attaque ${targetName} (défausse)`,
  };
  return map[type] || type;
}

// ════════ TURN ════════
function startTurn(room) {
  const player = room.players[room.turnIdx];
  if (!player || player.eliminated) { nextAliveTurn(room); startTurn(room); return; }

  broadcastState(room);

  const mustAttack = player.charges.length > 0 && player.heroId !== 'guerriere';

  const ps = io.sockets.sockets.get(player.id);
  if (ps) ps.emit('choose_action', {
    deckCount: room.deck.length,
    discardTop: room.discard.length > 0 ? room.discard[room.discard.length-1] : null,
    mustAttack,
    canUsePotion: player.heroId === 'alchimiste' && player.potions?.some(p => !p.used),
    potions: player.heroId === 'alchimiste' ? player.potions : null,
  });

  room.players.forEach(p => {
    if (p.id === player.id || p.eliminated) return;
    const s = io.sockets.sockets.get(p.id);
    if (s) s.emit('wait_turn', { playerName:player.name, deckCount:room.deck.length });
  });
}

// ════════ SOCKET ════════
io.on('connection', socket => {
  console.log(`[+] ${socket.id}`);

  socket.on('create_room', ({ name, heroMode, avatar }) => {
    const code = genCode();
    rooms[code] = {
      code, host:socket.id, heroMode:!!heroMode,
      players: [makePlayer(socket.id, name, avatar)],
      status:'lobby', deck:[], discard:[], turnIdx:0,
      chatMessages: [],
    };
    socket.join(code);
    socket.emit('room_created', { code, heroMode:!!heroMode });
  });

  socket.on('join_room', ({ name, code, avatar }) => {
    const room = rooms[code];
    if (!room)                   { socket.emit('err',{msg:'Partie introuvable !'}); return; }
    if (room.status !== 'lobby') { socket.emit('err',{msg:'Partie déjà commencée !'}); return; }
    if (room.players.length >= 6){ socket.emit('err',{msg:'Partie complète (max 6) !'}); return; }
    if (room.players.find(p => p.id === socket.id)) { socket.emit('err',{msg:'Déjà connecté !'}); return; }

    room.players.push(makePlayer(socket.id, name, avatar));
    socket.join(code);
    socket.emit('room_joined', {
      code,
      players: lobbyPlayers(room),
      heroMode: room.heroMode,
      isHost: room.host,
      chatMessages: room.chatMessages.slice(-20),
    });
    socket.to(code).emit('player_joined', { players: lobbyPlayers(room) });
  });

  // Hôte toggle héros depuis le lobby
  socket.on('toggle_hero_mode', ({ code }) => {
    const room = rooms[code];
    if (!room || room.host !== socket.id || room.status !== 'lobby') return;
    room.heroMode = !room.heroMode;
    io.to(code).emit('hero_mode_changed', { heroMode: room.heroMode });
  });

  // Chat
  socket.on('chat_message', ({ code, text }) => {
    const room = rooms[code];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    if (!text || text.trim().length === 0) return;
    const msg = {
      id: Date.now(),
      playerId: socket.id,
      playerName: player.name,
      avatar: player.avatar || null,
      text: text.trim().slice(0, 200),
      ts: Date.now(),
    };
    room.chatMessages.push(msg);
    if (room.chatMessages.length > 100) room.chatMessages.shift();
    // Envoyer aux AUTRES seulement (l'expéditeur l'affiche déjà localement)
    socket.to(code).emit('chat_message', msg);
  });

  socket.on('start_game', ({ code }) => {
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    if (room.players.length < 2) { socket.emit('err',{msg:'Il faut au moins 2 joueurs !'}); return; }

    if (room.heroMode) {
      room.status = 'hero_pick';
      room.deck = buildDeck(); room.discard = [];
      const pool = shuffle([...HEROES]);
      room.players.forEach((p,i) => {
        p.heroChoices = [pool[(i*2) % pool.length], pool[(i*2+1) % pool.length]];
        p.heroChosen = false;
      });
      io.to(code).emit('hero_pick_started', {
        players: room.players.map(p => ({ id:p.id, name:p.name, heroChosen:false }))
      });
      setTimeout(() => {
        room.players.forEach(p => {
          const s = io.sockets.sockets.get(p.id);
          if (s) s.emit('pick_hero', { choices:p.heroChoices });
        });
      }, 400);
    } else {
      launchGame(room);
    }
  });

  socket.on('choose_hero', ({ code, heroId }) => {
    const room = rooms[code];
    if (!room || room.status !== 'hero_pick') return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.heroChosen) return;
    const hero = player.heroChoices.find(h => h.id === heroId);
    if (!hero) { socket.emit('err',{msg:'Héros invalide'}); return; }
    player.heroId = hero.id; player.heroName = hero.name; player.heroEmoji = hero.emoji;
    player.heroChosen = true;
    socket.emit('hero_chosen', { hero });
    io.to(code).emit('hero_pick_update', {
      playerId:player.id, playerName:player.name,
      heroEmoji:hero.emoji, heroName:hero.name,
      allChosen: room.players.every(p => p.heroChosen),
    });
    if (room.players.every(p => p.heroChosen)) setTimeout(() => launchGame(room), 1000);
  });

  socket.on('action', ({ code, type, targetId, extra }) => {
    const room = rooms[code];
    if (!room || room.status !== 'playing') return;
    const actor = room.players[room.turnIdx];
    if (!actor || actor.id !== socket.id) { socket.emit('err',{msg:"Ce n'est pas votre tour !"}); return; }

    if (actor.charges.length > 0 && actor.heroId !== 'guerriere' && type !== 'attack' && type !== 'necro_discard') {
      socket.emit('err',{msg:'Vous devez attaquer avec votre charge !'}); return;
    }

    const target = targetId ? room.players.find(p => p.id === targetId) : null;

    if (actor.heroId === 'barde' && type !== 'charge') {
      const count = bardeSymbolSame(actor) ? 3 : bardeColorSame(actor) ? 2 : 1;
      if (count > 1) {
        const choices = [];
        for (let i=0; i<count; i++) choices.push(drawCard(room));
        actor.bardeChoices = choices; actor.bardeAction = type;
        actor.bardeTargetId = targetId; actor.bardeExtra = extra;
        socket.emit('barde_choose', { choices, action:type }); return;
      }
    }

    let drawn;
    if (type === 'necro_discard') {
      if (room.discard.length === 0) { socket.emit('err',{msg:'Défausse vide !'}); return; }
      drawn = room.discard.pop();
    } else { drawn = drawCard(room); }
    actor.drawnCard = drawn;

    if (type === 'charge') {
      io.to(room.code).emit('card_reveal', { card:null, chargeCard:null, actorName:actor.name, actionLabel:'⚡ Se charge', isCharge:true });
    } else {
      const chargeCard = actor.charges.length > 0 ? actor.charges[0] : null;
      io.to(room.code).emit('card_reveal', {
        card:drawn, chargeCard,
        actorName:actor.name,
        actionLabel:actionLabel(type, target ? target.name : ''),
        isCharge:false,
      });
    }

    if (actor.heroId === 'demoniste' && type !== 'charge') {
      actor.pendingDraw = drawn; actor.pendingAction = type;
      actor.pendingTargetId = targetId; actor.pendingExtra = extra;
      socket.emit('demoniste_can_reroll', { card:drawn, cost:3, pvLeft:totalPV(actor) });
      return;
    }

    setTimeout(() => handleAction(room, actor, type, targetId, drawn, extra), 300);
  });

  socket.on('demoniste_reroll', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    const actor = room.players[room.turnIdx];
    if (!actor || actor.id !== socket.id || actor.heroId !== 'demoniste') return;
    if (totalPV(actor) < 2) { socket.emit('err',{msg:'PV insuffisants !'}); return; }
    const cost = Math.min(3, totalPV(actor) - 1);
    room.discard.push(actor.pendingDraw);
    applyDamage(room, actor, cost);
    checkEliminated(room, actor);
    if (checkGameOver(room)) return;
    const newCard = drawCard(room);
    actor.pendingDraw = newCard; actor.drawnCard = newCard;
    const chargeCard = actor.charges.length > 0 ? actor.charges[0] : null;
    io.to(room.code).emit('card_reveal', {
      card:newCard, chargeCard, actorName:actor.name,
      actionLabel:actionLabel(actor.pendingAction, actor.pendingTargetId ? room.players.find(p=>p.id===actor.pendingTargetId)?.name : ''),
      isCharge:false,
    });
    socket.emit('demoniste_can_reroll', { card:newCard, cost:3, pvLeft:totalPV(actor), rerolled:true });
  });

  socket.on('demoniste_confirm', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    const actor = room.players[room.turnIdx];
    if (!actor || actor.id !== socket.id) return;
    const drawn = actor.pendingDraw, type = actor.pendingAction;
    const targetId = actor.pendingTargetId, extra = actor.pendingExtra;
    actor.pendingDraw=null; actor.pendingAction=null; actor.pendingTargetId=null;
    setTimeout(() => handleAction(room, actor, type, targetId, drawn, extra), 100);
  });

  socket.on('barde_pick', ({ code, cardIndex }) => {
    const room = rooms[code];
    if (!room) return;
    const actor = room.players[room.turnIdx];
    if (!actor || actor.id !== socket.id || !actor.bardeChoices) return;
    const chosen = actor.bardeChoices[cardIndex];
    actor.bardeChoices.forEach((c,i) => { if (i !== cardIndex) room.discard.push(c); });
    const type = actor.bardeAction, targetId = actor.bardeTargetId, extra = actor.bardeExtra;
    actor.bardeChoices=null; actor.drawnCard=chosen;
    const target = targetId ? room.players.find(p => p.id === targetId) : null;
    const chargeCard = actor.charges.length > 0 ? actor.charges[0] : null;
    io.to(room.code).emit('card_reveal', {
      card:chosen, chargeCard, actorName:actor.name,
      actionLabel:actionLabel(type, target ? target.name : ''), isCharge:false,
    });
    setTimeout(() => handleAction(room, actor, type, targetId, chosen, extra), 300);
  });

  socket.on('voleuse_exchange', ({ code, myType, myIdx, theirType, theirIdx, targetId }) => {
    const room = rooms[code]; if (!room) return;
    const actor = room.players.find(p => p.id === socket.id);
    const target = room.players.find(p => p.id === targetId);
    if (!actor || !target) return;
    const myCard    = myType    === 'shield' ? actor.shield  : actor.pv[myIdx];
    const theirCard = theirType === 'shield' ? target.shield : target.pv[theirIdx||0];
    if (!myCard || !theirCard) return;
    if (myType    === 'shield') actor.shield  = theirCard; else actor.pv[myIdx]        = theirCard;
    if (theirType === 'shield') target.shield = myCard;    else target.pv[theirIdx||0] = myCard;
    broadcastPopup(room, '🗡️', `${actor.name} échange avec ${target.name}`, `${cStr(myCard)} ↔ ${cStr(theirCard)}`, null, null);
    broadcastState(room);
  });

  socket.on('use_potion', ({ code, potionType, targetId }) => {
    const room = rooms[code]; if (!room || room.status !== 'playing') return;
    const actor = room.players[room.turnIdx];
    if (!actor || actor.id !== socket.id || actor.heroId !== 'alchimiste') return;
    const potion = actor.potions.find(p => p.type === potionType && !p.used);
    if (!potion) { socket.emit('err',{msg:'Potion indisponible !'}); return; }
    potion.used = true;
    const mustAttack = actor.charges.length > 0 && actor.heroId !== 'guerriere';
    if (potionType === 'invisibilite') {
      actor.potionInvis = true;
      broadcastPopup(room, '⚗️', `${actor.name} boit une Potion d'Invisibilité !`, 'La prochaine action qui le cible sera esquivée.', null, null);
    } else if (potionType === 'vitesse') {
      actor.bonusAction = true;
      broadcastPopup(room, '⚗️', `${actor.name} boit une Potion de Vitesse !`, 'Il jouera une action supplémentaire ce tour.', null, null);
    } else if (potionType === 'feu') {
      actor.potionFeu = true; actor.potionFeuTarget2 = targetId;
      broadcastPopup(room, '🔥', `${actor.name} prépare une Potion de Feu !`, 'Sa prochaine attaque touchera 2 cibles.', null, null);
    }
    broadcastState(room);
    const ps = io.sockets.sockets.get(actor.id);
    if (ps) ps.emit('choose_action', {
      deckCount:room.deck.length,
      discardTop:room.discard.length>0?room.discard[room.discard.length-1]:null,
      mustAttack, canUsePotion:actor.potions.some(p=>!p.used), potions:actor.potions,
      potionFeuActive: potionType==='feu',
    });
  });

  socket.on('leave_room', ({ code }) => leaveRoom(socket, code));
  socket.on('disconnect', () => {
    Object.keys(rooms).forEach(code => {
      if (rooms[code]?.players.find(p => p.id === socket.id)) leaveRoom(socket, code);
    });
  });
});

// ════════ LAUNCH ════════
function launchGame(room) {
  room.status = 'playing';
  room.deck = buildDeck(); room.discard = [];
  room.chatMessages = room.chatMessages || [];

  room.players.forEach(p => {
    const isOgre = p.heroId === 'ogre';
    const h = dealStartHand(room.deck, isOgre);
    p.pv=h.pv; p.shield=h.shield; p.charges=[]; p.drawnCard=null; p.eliminated=false;
    p.woundMarkers={}; p.bardeChoices=null; p.bardeAction=null;
    p.pendingDraw=null; p.pendingAction=null; p.pendingTargetId=null;
    p.mageTransform=false; p.bonusAction=false;
    p.potionInvis=false; p.potionFeu=false; p.potionFeuTarget2=null;
    if (p.heroId === 'alchimiste') {
      p.potions = [{type:'feu',used:false},{type:'invisibilite',used:false},{type:'vitesse',used:false}];
    } else { p.potions = []; }
  });

  room.players.sort((a,b) => {
    const sa=totalPV(a)+a.shield.numVal, sb=totalPV(b)+b.shield.numVal;
    return sa!==sb?sa-sb:a.shield.numVal-b.shield.numVal;
  });
  room.turnIdx = 0;

  room.players.forEach(p => {
    const s = io.sockets.sockets.get(p.id);
    if (s) s.emit('game_started', { state: privateState(room, p.id) });
  });
  startTurn(room);
  console.log(`[🎮] ${room.code} lancé (${room.players.length}j)`);
}

// ════════ HANDLE ACTION ════════
function handleAction(room, actor, type, targetId, drawn, extra) {
  const aType = type === 'necro_discard' ? 'attack' : type;
  const target = targetId ? room.players.find(p => p.id === targetId) : null;

  if (target && target.potionInvis && (aType === 'attack' || aType === 'shield_swap')) {
    target.potionInvis = false;
    room.discard.push(drawn);
    actor.charges.forEach(c => room.discard.push(c)); actor.charges = [];
    actor.drawnCard = null;
    broadcastPopup(room, '⚗️', `${target.name} esquive !`, `La Potion d'Invisibilité annule l'action de ${actor.name}.`, null, null);
    finishTurn(room, actor); return;
  }

  if (aType === 'attack') {
    if (!target || target.eliminated) { notifyErr(actor,'Cible invalide !'); return; }
    let atkVal = drawn.numVal, chargeUsed = null;
    if (actor.heroId === 'mage' && (drawn.numVal === 1 || drawn.numVal === 13)) {
      if (actor.mageTransform) { atkVal = drawn.numVal === 1 ? 13 : 1; }
      actor.mageTransform = false;
    }
    if (actor.heroId === 'guerriere') {
      actor.charges.forEach(c => { atkVal += c.numVal; room.discard.push(c); });
      chargeUsed = actor.charges[0]||null; actor.charges = [];
    } else if (actor.charges.length > 0) {
      atkVal += actor.charges[0].numVal; chargeUsed = actor.charges[0];
      room.discard.push(actor.charges[0]); actor.charges = [];
    }
    if (actor.heroId === 'bete') atkVal += (actor.woundMarkers[targetId]||0)*3;
    const shieldVal = getShieldVal(target);
    const isOgreKill = actor.heroId === 'ogre' && atkVal === shieldVal;
    if (!isOgreKill && atkVal <= shieldVal) {
      broadcastPopup(room, '🛡️', `${actor.name} attaque ${target.name}`,
        `${cStr(drawn)}${chargeUsed?` + ⚡${cStr(chargeUsed)}`:''}  (${atkVal}) contre bouclier ${shieldVal}`,
        'Bloqué !', 'block');
    } else {
      const dmg = isOgreKill ? totalPV(target) : atkVal - shieldVal;
      const pvBefore = totalPV(target);
      applyDamage(room, target, dmg);
      const pvAfter = totalPV(target), didDamage = pvAfter < pvBefore;
      broadcastPopup(room, '⚔️', `${actor.name} attaque ${target.name}`,
        `${cStr(drawn)}${chargeUsed?` + ⚡${cStr(chargeUsed)}`:''}  (${atkVal}) contre bouclier ${shieldVal}${isOgreKill?' — Ogre !':''}`,
        `−${dmg} PV → ${pvAfter} PV restants`, 'dmg');
      if (didDamage && target.charges.length > 0) { target.charges.forEach(c=>room.discard.push(c)); target.charges=[]; }
      if (actor.heroId === 'bete' && didDamage && !target.eliminated) {
        if (!actor.woundMarkers) actor.woundMarkers={};
        actor.woundMarkers[targetId] = (actor.woundMarkers[targetId]||0)+1;
      }
      if (actor.potionFeu && actor.potionFeuTarget2) {
        const t2 = room.players.find(p=>p.id===actor.potionFeuTarget2&&!p.eliminated);
        if (t2 && t2.id !== targetId) {
          const sv2=getShieldVal(t2);
          if (atkVal>sv2) { applyDamage(room,t2,atkVal-sv2); checkEliminated(room,t2); }
        }
        actor.potionFeu=false; actor.potionFeuTarget2=null;
      }
      checkEliminated(room, target);
      if (checkGameOver(room)) { room.discard.push(drawn); actor.drawnCard=null; return; }
      if (actor.heroId==='voleuse'&&!target.eliminated) {
        const ps=io.sockets.sockets.get(actor.id);
        if (ps) ps.emit('voleuse_prompt',{targetId:target.id,targetName:target.name,targetPV:target.pv,targetShield:target.shield,myPV:actor.pv,myShield:actor.shield});
      }
      if (target.heroId==='paladin'&&!target.eliminated&&totalPV(target)>0&&didDamage) {
        for (let r=0;r<2;r++) {
          const rc=drawCard(room), rsv=getShieldVal(actor);
          if (rc.numVal>rsv) { const rpv=totalPV(actor); applyDamage(room,actor,rc.numVal-rsv); if(totalPV(actor)<rpv&&actor.charges.length>0){actor.charges.forEach(c=>room.discard.push(c));actor.charges=[];} }
          room.discard.push(rc);
        }
        broadcastPopup(room,'🛡️⚔️',`${target.name} riposte !`,`Le Paladin contre-attaque ${actor.name}`,null,null);
        checkEliminated(room,actor);
        if (checkGameOver(room)) { room.discard.push(drawn); actor.drawnCard=null; return; }
      }
    }
    room.discard.push(drawn); actor.drawnCard=null;
  } else if (aType==='shield_swap') {
    if (!target||target.eliminated) { notifyErr(actor,'Cible invalide !'); return; }
    const old=target.shield; room.discard.push(old); target.shield=drawn; actor.drawnCard=null;
    broadcastPopup(room,'🛡️',
      target.id===actor.id?`${actor.name} change son bouclier`:`${actor.name} change le bouclier de ${target.name}`,
      `${cStr(old)} → ${cStr(drawn)}`, `${old.numVal} → ${drawn.numVal}`, 'neutral');
  } else if (aType==='charge') {
    if (actor.heroId!=='guerriere'&&actor.charges.length>0) { notifyErr(actor,'Vous avez déjà une charge !'); return; }
    actor.charges.push(drawn); actor.drawnCard=null;
    broadcastPopup(room,'⚡',`${actor.name} se charge`,'Carte cachée — personne ne la voit',`${actor.charges.length} charge${actor.charges.length>1?'s':''}`, 'neutral');
  } else if (aType==='heal_pv') {
    const pvIdx=extra?.pvIdx||0;
    if (!actor.pv[pvIdx]) { notifyErr(actor,'Carte PV invalide'); return; }
    const old=actor.pv[pvIdx]; room.discard.push(old); actor.pv[pvIdx]=drawn; actor.drawnCard=null;
    broadcastPopup(room,'✨',`${actor.name} soigne ses PV`,`${cStr(old)} → ${cStr(drawn)}`,`${old.numVal} → ${drawn.numVal}`,'neutral');
  } else { notifyErr(actor,'Action inconnue'); return; }

  finishTurn(room, actor);
}

function finishTurn(room, actor) {
  if (actor.bonusAction) {
    actor.bonusAction = false;
    broadcastState(room);
    const ps = io.sockets.sockets.get(actor.id);
    const mustAttack = actor.charges.length > 0 && actor.heroId !== 'guerriere';
    if (ps) ps.emit('choose_action', {
      deckCount:room.deck.length, discardTop:room.discard.length>0?room.discard[room.discard.length-1]:null,
      mustAttack, canUsePotion:false, potions:actor.potions, isBonus:true,
    });
    return;
  }
  nextAliveTurn(room);
  broadcastState(room);
  setTimeout(() => startTurn(room), 5500);
}

function makePlayer(id, name, avatar=null) {
  return {
    id, name, avatar, wins:0,
    pv:[], shield:null, charges:[], drawnCard:null, eliminated:false,
    heroId:null, heroName:null, heroEmoji:null, heroChoices:[], heroChosen:false,
    potions:[], woundMarkers:{},
    bardeChoices:null, bardeAction:null, bardeTargetId:null, bardeExtra:null,
    pendingDraw:null, pendingAction:null, pendingTargetId:null, pendingExtra:null,
    mageTransform:false, bonusAction:false,
    potionInvis:false, potionFeu:false, potionFeuTarget2:null,
  };
}

function leaveRoom(socket, code) {
  const room = rooms[code]; if (!room) return;
  room.players = room.players.filter(p => p.id !== socket.id);
  socket.leave(code);
  if (room.players.length === 0) { delete rooms[code]; return; }
  if (room.host === socket.id) room.host = room.players[0].id;
  io.to(code).emit('player_left', { players: lobbyPlayers(room), newHost: room.host });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`\n🛡️  Le Bouclier — http://localhost:${PORT}\n`); });
