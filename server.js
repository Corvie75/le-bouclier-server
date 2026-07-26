// ═══════════════════════════════════════════════
//  Le Bouclier — Serveur v6
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
  { id:'voleuse',      name:'Voleuse',      emoji:'🗡️',  desc:'Après avoir infligé des dégâts, échange une carte avec la cible.' },
  { id:'mage',         name:'Mage',         emoji:'🔮',  desc:'Quand un As ou Roi est joué en attaque (par n\'importe qui), le Mage peut choisir de transformer la carte.' },
  { id:'paladin',      name:'Paladin',      emoji:'🛡️',  desc:'Si perd des PV sur une attaque, riposte automatiquement avec 2 attaques.' },
  { id:'pretresse',    name:'Prêtresse',    emoji:'✨',  desc:'Peut choisir quelle carte PV échanger contre la première carte de la pioche.' },
  { id:'demoniste',    name:'Démoniste',    emoji:'🔥',  desc:'Peut relancer la carte piochée en payant 3 PV. Utilisable plusieurs fois par tour.' },
  { id:'espionne',     name:'Espionne',     emoji:'🕵️', desc:'Son bouclier est toujours caché pour les autres. Si une Espionne est en jeu, tous les boucliers sont cachés sauf pour elle.' },
  { id:'alchimiste',   name:'Alchimiste',   emoji:'⚗️',  desc:'3 potions : Feu (attaque 2 cibles), Invisibilité (esquive une action), Vitesse (action bonus).' },
  { id:'ogre',         name:'Ogre',         emoji:'👹',  desc:'Commence avec 3 cartes PV. Si attaque = bouclier adverse → élimination directe.' },
  { id:'barde',        name:'Barde',        emoji:'🎵',  desc:'Même couleur → choisit parmi 2 cartes. Même symbole → parmi 3. Quand il perd des PV, choisit sa nouvelle carte PV dans la défausse.' },
  { id:'bete',         name:'Bête',         emoji:'🐾',  desc:'Chaque attaque qui blesse une cible ajoute un marqueur blessure (+3 dégâts par marqueur aux prochaines attaques sur cette cible).' },
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
    for (let k=deck.length-1;k>0;k--){const j=Math.floor(Math.random()*(k+1));[deck[k],deck[j]]=[deck[j],deck[k]];}
  }
  const hand = [];
  for (let i=0; i<count; i++) { if (deck.length) hand.push(deck.pop()); }
  hand.sort((a,b) => b.numVal - a.numVal);
  if (isOgre && hand.length >= 4) return { pv:[hand[0],hand[1],hand[2]], shield:hand[3] };
  if (isOgre && hand.length === 3) return { pv:[hand[0],hand[1]], shield:hand[2] };
  return { pv:[hand[0],hand[1]], shield:hand[2] };
}

// ════════ UTILS ════════
function genCode() {
  let code;
  do { code = String(Math.floor(100000 + Math.random()*900000)); } while (rooms[code]);
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
function hasEspionne(room) {
  return room.players.some(p => p.heroId === 'espionne' && !p.eliminated);
}
function drawCard(room) {
  if (room.deck.length === 0) {
    const inPlay = new Set();
    room.players.forEach(p => {
      p.pv.forEach(c => inPlay.add(c));
      if (p.shield) inPlay.add(p.shield);
      p.charges.forEach(c => inPlay.add(c));
    });
    room.deck = shuffle(room.discard.filter(c => !inPlay.has(c)));
    room.discard = [];
    if (room.optDragon && room.deck.length > 0) {
      room.dragonPending = true;
    }
  }
  if (room.deck.length === 0) return null;
  return room.deck.pop();
}

function dragonAttack(room) {
  if (room.status !== 'playing') return;
  const nextIdx = (room.turnIdx + 1) % room.players.length;
  const ordered = [];
  let i = nextIdx;
  for (let c = 0; c < room.players.length; c++) {
    if (!room.players[i].eliminated) ordered.push(room.players[i]);
    i = (i + 1) % room.players.length;
  }
  const attacked = [];
  for (const p of ordered) {
    if (room.deck.length === 0) break;
    const card = room.deck.pop();
    const sv = getShieldVal(p);
    const dmg = card.numVal > sv ? card.numVal - sv : 0;
    if (dmg > 0) {
      applyDamage(room, p, dmg);
      if (p.charges.length>0) { p.charges.forEach(c=>room.discard.push(c)); p.charges=[]; }
    }
    attacked.push({ name:p.name, card:cStr(card), dmg });
    room.discard.push(card);
    checkEliminated(room, p);
  }
  const detail = attacked.map(a=>`${a.name}: ${a.card}${a.dmg>0?` −${a.dmg}PV`:' ✋'}`).join(' · ');
  io.to(room.code).emit('action_popup',{emoji:'🐉',main:'Attaque du Dragon !',detail,result:null,resultType:'dmg'});
  broadcastState(room);
  if (checkGameOver(room)) return;
  nextAliveTurn(room);
  scheduleNextTurn(room,3500);
}
function lobbyPlayers(room) {
  return room.players.map(p => ({ id:p.id, name:p.name, wins:p.wins||0, avatar:p.avatar||null }));
}

// ════════ STATE ════════
function publicState(room) {
  const espionneInGame = hasEspionne(room);
  return {
    players: room.players.map(p => {
      const hideShield = (espionneInGame && !p.shieldRevealed) || p.heroId === 'espionne';
      return {
        id:p.id, name:p.name, eliminated:p.eliminated,
        pv:p.pv,
        shield: hideShield ? null : p.shield,
        shieldVal: hideShield ? '?' : getShieldVal(p),
        shieldHidden: hideShield,
        hasCharge: p.charges.length > 0,
        chargeCount: p.charges.length,
        heroId:p.heroId, heroName:p.heroName, heroEmoji:p.heroEmoji,
        heroChosen:p.heroChosen,
        wins:p.wins||0,
        avatar:p.avatar||null,
        potions:null,
        woundMarkers:p.woundMarkers||{},
      };
    }),
    deckCount: room.deck.length,
    discardTop: room.discard.length > 0 ? room.discard[room.discard.length-1] : null,
    currentTurnId: room.players[room.turnIdx]?.id || null,
    heroMode: room.heroMode,
    espionneInGame,
    waitingFor: room.waitingFor || null,
  };
}
function privateState(room, playerId) {
  const base = publicState(room);
  const player = room.players.find(p => p.id === playerId);
  if (!player) return base;
  if (player.heroId === 'espionne') {
    base.players.forEach(bp => {
      const real = room.players.find(rp => rp.id === bp.id);
      if (real) { bp.shield = real.shield; bp.shieldVal = getShieldVal(real); bp.shieldHidden = false; }
    });
  } else {
    const myData = base.players.find(bp => bp.id === playerId);
    const realMe = room.players.find(rp => rp.id === playerId);
    if (myData && realMe && realMe.shieldRevealed) {
      myData.shield = realMe.shield; myData.shieldVal = getShieldVal(realMe); myData.shieldHidden = false;
    }
  }
  if (player.heroId === 'alchimiste') {
    const me = base.players.find(bp => bp.id === playerId);
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
  do { room.turnIdx = (room.turnIdx+1) % room.players.length; tries++; }
  while (room.players[room.turnIdx]?.eliminated && tries <= room.players.length);
}
function findCardOfValue(room, val) {
  const idx = room.discard.findIndex(c => c.numVal === val);
  if (idx !== -1) return room.discard.splice(idx, 1)[0];
  const temp = [];
  let found = null;
  while (room.deck.length > 0) {
    const c = room.deck.pop();
    if (c.numVal === val && !found) {
      found = c;
    } else {
      temp.push(c);
    }
  }
  temp.reverse().forEach(x => room.deck.push(x));
  return found;
}
function applyDamage(room, target, dmg) {
  if (target.heroId === 'barde') target.bardePendingPvValue = undefined;
  let rem = dmg;
  while (rem > 0 && target.pv.length > 0) {
    target.pv.sort((a,b) => a.numVal - b.numVal);
    const w = target.pv[0];
    if (rem >= w.numVal) {
      rem -= w.numVal; room.discard.push(w); target.pv.shift();
    } else {
      const nv = w.numVal - rem; rem = 0;
      room.discard.push(w); target.pv.shift();
      if (target.heroId === 'barde') {
        target.bardePendingPvValue = nv;
      } else {
        const f = findCardOfValue(room, nv);
        if (f) target.pv.push(f);
      }
    }
  }
}
function checkEliminated(room, player) {
  if (player.heroId === 'barde' && player.bardePendingPvValue !== undefined) return false;
  if (player.heroId === 'barde' && player.bardePvChoices && player.bardePvChoices.length > 0) return false;
  if (totalPV(player) <= 0 && !player.eliminated) {
    player.eliminated = true;
    player.pv.forEach(c => room.discard.push(c));
    player.charges.forEach(c => room.discard.push(c));
    if (player.shield) room.discard.push(player.shield);
    player.pv = []; player.charges = []; player.shield = null;
    io.to(room.code).emit('player_eliminated', { playerId:player.id, playerName:player.name });
    if (room.optMeurtre && room.status==='playing') {
      const killer = room.players[room.turnIdx];
      if (killer && !killer.eliminated && killer.id !== player.id) {
        killer.bonusAction = true;
        setTimeout(()=>{ broadcastPopup(room,'⚔️💀',`${killer.name} — Meurtre !`,`Action supplémentaire accordée`,null,'neutral'); }, 500);
      }
    }
    return true;
  }
  return false;
}
function checkGameOver(room) {
  if (countAlive(room) <= 1) {
    const winner = room.players.find(p => !p.eliminated) || room.players[0];
    winner.wins = (winner.wins||0) + 1;
    room.status = 'lobby';
    resetPlayers(room);
    setTimeout(()=>{
      io.to(room.code).emit('game_over', {
        winner:{ id:winner.id, name:winner.name, wins:winner.wins, avatar:winner.avatar||null },
        finalState: publicState(room),
      });
    }, 6000);
    setTimeout(() => {
      if (rooms[room.code]) {
        io.to(room.code).emit('return_to_lobby', {
          players: lobbyPlayers(room), heroMode:room.heroMode, hostId:room.host,
        });
      }
    }, 16000);
    return true;
  }
  return false;
}
function resetPlayers(room) {
  room.players.forEach(p => {
    p.pv=[]; p.shield=null; p.charges=[]; p.drawnCard=null; p.eliminated=false;
    p.heroId=null; p.heroName=null; p.heroEmoji=null; p.heroChosen=false;
    p.heroChoices=[]; p.potions=[]; p.woundMarkers={}; p.shieldRevealed=false;
    p.bardeChoices=null; p.bardePvChoices=null; p.bardePvSuspendedActor=null;
    p.bardePvPaladinPending=null; p.bardePendingPvValue=undefined;
    p.bardeAction=null; p.bardeTargetId=null; p.bardeExtra=null;
    p.pendingDraw=null; p.pendingAction=null; p.pendingTargetId=null; p.pendingExtra=null;
    p.pendingPaladinTarget=null; p.pendingBardeTarget=null;
    if(p.mageTimer){ clearTimeout(p.mageTimer); p.mageTimer=null; }
    p.mageTransform=false; p.bonusAction=false;
    p.potionInvis=false; p.potionFeu=false; p.potionFeuTarget2=null;
  });
  room.waitingFor=null; room.dragonPending=false;
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
  if (cards.length === 0) return false;
  const nonJoker = cards.filter(c => c.suit !== '🃏');
  if (nonJoker.length === 0) return true;
  const isRed = c => ['♥','♦'].includes(c.suit);
  return nonJoker.every(isRed) || nonJoker.every(c => !isRed(c));
}
function bardeSymbolSame(p) {
  const cards = [...p.pv, p.shield].filter(Boolean);
  if (cards.length === 0) return false;
  const nonJoker = cards.filter(c => c.suit !== '🃏');
  if (nonJoker.length === 0) return true;
  const suits = new Set(nonJoker.map(c => c.suit));
  return suits.size === 1;
}
function actionLabel(type, targetName) {
  const map = {
    attack:`⚔️ Attaque ${targetName}`, shield_swap:`🛡️ Change bouclier de ${targetName}`,
    charge:'⚡ Se charge', heal_pv:'✨ Soigne ses PV', necro_discard:`⚔️ Attaque ${targetName} (défausse)`,
  };
  return map[type] || type;
}

// ════════ HELPERS ════════
function makePlayer(id, name, avatar) {
  return {
    id, name, avatar:avatar||null, wins:0,
    pv:[], shield:null, charges:[], drawnCard:null, eliminated:false,
    heroId:null, heroName:null, heroEmoji:null, heroChosen:false,
    heroChoices:[], potions:[], woundMarkers:{}, shieldRevealed:false,
    bardeChoices:null, bardePvChoices:null, bardePvSuspendedActor:null,
    bardePvPaladinPending:null, bardePendingPvValue:undefined,
    bardeAction:null, bardeTargetId:null, bardeExtra:null,
    pendingDraw:null, pendingAction:null, pendingTargetId:null, pendingExtra:null,
    pendingPaladinTarget:null, pendingBardeTarget:null,
    mageTimer:null, mageTransform:false, bonusAction:false,
    potionInvis:false, potionFeu:false, potionFeuTarget2:null,
  };
}
function leaveRoom(socket, code) {
  const room = rooms[code]; if (!room) return;
  const wasPlaying = room.status === 'playing';
  const leavingIdx = room.players.findIndex(p => p.id === socket.id);
  if (leavingIdx < 0) return;
  const leavingPlayer = room.players[leavingIdx];
  if (wasPlaying) leavingPlayer.eliminated = true;

  // Clean up if game was waiting for this player's decision
  if (wasPlaying && room.waitingFor && room.waitingFor.playerId === socket.id) {
    room.waitingFor = null;
    io.to(room.code).emit('waiting_for', null);
  }
  // Clean up pending hero states involving this player
  if (wasPlaying) {
    if (leavingPlayer.bardePvChoices) { leavingPlayer.bardePvChoices=null; leavingPlayer.bardePvSuspendedActor=null; leavingPlayer.bardePvPaladinPending=null; }
    if (leavingPlayer.bardeChoices) { leavingPlayer.bardeChoices.forEach(c=>room.discard.push(c)); leavingPlayer.bardeChoices=null; }
    if (leavingPlayer.pendingDraw) { room.discard.push(leavingPlayer.pendingDraw); leavingPlayer.pendingDraw=null; }
    if (leavingPlayer.mageTimer) { clearTimeout(leavingPlayer.mageTimer); leavingPlayer.mageTimer=null; }
    room.players.forEach(p => {
      if (p.pendingPaladinTarget===socket.id) p.pendingPaladinTarget=null;
      if (p.pendingBardeTarget===socket.id) p.pendingBardeTarget=null;
      // If actor had pending action targeting the leaving player
      if (p.pendingTargetId===socket.id && p.pendingDraw) {
        room.discard.push(p.pendingDraw);
        p.pendingDraw=null; p.pendingAction=null; p.pendingTargetId=null;
      }
    });
  }

  // Adjust turnIdx BEFORE removing the player
  const wasCurrentTurn = leavingIdx === room.turnIdx;
  if (wasPlaying && leavingIdx < room.turnIdx) room.turnIdx--;

  room.players = room.players.filter(p => p.id !== socket.id);
  socket.leave(code);
  if (room.players.length === 0) { delete rooms[code]; return; }
  if (room.host === socket.id) room.host = room.players[0].id;

  if (wasPlaying) {
    if (room.turnIdx >= room.players.length) room.turnIdx = room.turnIdx % room.players.length;
    broadcastState(room);
    if (checkGameOver(room)) return;
    if (wasCurrentTurn || (room.players[room.turnIdx] && room.players[room.turnIdx].eliminated)) {
      nextAliveTurn(room);
      startTurn(room);
    }
  }
  io.to(code).emit('player_left', { players:lobbyPlayers(room), newHost:room.host });
}
function showToastAll(room, msg) {
  io.to(room.code).emit('show_toast', { msg });
}
function finishTurn(room, actor) {
  if (room.status !== 'playing') return;
  if (checkGameOver(room)) return;
  if (room.dragonPending) {
    room.dragonPending = false;
    dragonAttack(room);
    return;
  }
  if (actor && actor.bonusAction) {
    actor.bonusAction = false;
    broadcastState(room);
    scheduleNextTurn(room,3500);
    return;
  }
  nextAliveTurn(room);
  broadcastState(room);
  scheduleNextTurn(room,3500);
}
function launchPaladinRiposte(room, paladin, attacker) {
  if (paladin.eliminated || attacker.eliminated || room.status !== 'playing') {
    nextAliveTurn(room); broadcastState(room);
    scheduleNextTurn(room,3500);
    return;
  }
  broadcastPopup(room,'🛡️',`${paladin.name} — Riposte du Paladin !`,
    `2 attaques automatiques contre ${attacker.name}`,null,'neutral');
  let riposteCount = 0;
  function doRiposte() {
    if (riposteCount >= 2 || attacker.eliminated || paladin.eliminated || room.status !== 'playing') {
      checkEliminated(room, attacker);
      if (!checkGameOver(room)) {
        nextAliveTurn(room); broadcastState(room);
        scheduleNextTurn(room,3500);
      }
      return;
    }
    const card = drawCard(room);
    if (!card) { scheduleNextTurn(room,1000); return; }
    riposteCount++;
    const shieldVal = getShieldVal(attacker);
    io.to(room.code).emit('card_reveal', {
      card, chargeCard:null, actorName:paladin.name,
      actionLabel:`🛡️ Riposte ${riposteCount}/2 → ${attacker.name}`, isCharge:false,
    });
    setTimeout(() => {
      if (card.numVal <= shieldVal) {
        broadcastPopup(room,'🛡️',`Riposte ${riposteCount}/2 de ${paladin.name}`,
          `${cStr(card)} (${card.numVal}) vs 🛡️${shieldVal}`,'Bloqué !','block');
        room.discard.push(card);
      } else {
        const dmg = card.numVal - shieldVal;
        applyDamage(room, attacker, dmg);
        broadcastPopup(room,'🛡️',`Riposte ${riposteCount}/2 de ${paladin.name}`,
          `${cStr(card)} (${card.numVal}) vs 🛡️${shieldVal}`,
          `−${dmg} PV → ${totalPV(attacker)} PV`,'dmg');
        room.discard.push(card);
        if (attacker.charges.length>0) { attacker.charges.forEach(c=>room.discard.push(c)); attacker.charges=[]; }
        checkEliminated(room, attacker);
      }
      broadcastState(room);
      if (checkGameOver(room)) return;
      setTimeout(doRiposte, 3500);
    }, 2200);
  }
  setTimeout(doRiposte, 3500);
}

// ════════ TURN ════════
function scheduleNextTurn(room, delay) {
  const gen = room.turnGen||0;
  setTimeout(()=>{ if(room.status==='playing'&&room.turnGen===gen) startTurn(room); }, delay||3500);
}
function startTurn(room) {
  if (room.status !== 'playing') return;
  if (countAlive(room) <= 0) { checkGameOver(room); return; }
  room.turnGen = (room.turnGen||0) + 1;
  const player = room.players[room.turnIdx];
  if (!player || player.eliminated) { nextAliveTurn(room); startTurn(room); return; }
  broadcastState(room);
  const mustAttack = player.charges.length > 0 && player.heroId !== 'guerriere';
  const clairvoyant = room.optClairvoyance && totalPV(player) === 1;
  const topCard = clairvoyant && room.deck.length > 0 ? room.deck[room.deck.length-1] : null;
  const ps = io.sockets.sockets.get(player.id);
  if (ps) ps.emit('choose_action', {
    deckCount:room.deck.length,
    discardTop:room.discard.length>0 ? room.discard[room.discard.length-1] : null,
    mustAttack,
    canUsePotion:player.heroId==='alchimiste' && player.potions?.some(p=>!p.used),
    potions:player.heroId==='alchimiste' ? player.potions : null,
    clairvoyantCard: topCard,
  });
  room.players.forEach(p => {
    if (p.id===player.id || p.eliminated) return;
    const s = io.sockets.sockets.get(p.id);
    if (s) s.emit('wait_turn', { playerName:player.name, deckCount:room.deck.length });
  });
}

// ════════ SOCKET ════════
io.on('connection', socket => {
  socket.on('create_room', ({ name, heroMode, avatar }) => {
    const code = genCode();
    rooms[code] = {
      code, host:socket.id, heroMode:!!heroMode,
      optMeurtre: false, optClairvoyance: false, optDragon: false,
      players:[makePlayer(socket.id, name, avatar)],
      status:'lobby', deck:[], discard:[], turnIdx:0, chatMessages:[],
      waitingFor: null,
    };
    socket.join(code);
    socket.emit('room_created', { code, heroMode:!!heroMode, optMeurtre:false, optClairvoyance:false, optDragon:false });
  });

  socket.on('join_room', ({ name, code, avatar }) => {
    const room = rooms[code];
    if (!room)                   { socket.emit('err',{msg:'Partie introuvable !'}); return; }
    if (room.status !== 'lobby') { socket.emit('err',{msg:'Partie déjà commencée !'}); return; }
    if (room.players.length >= 6){ socket.emit('err',{msg:'Partie complète (max 6) !'}); return; }
    if (room.players.find(p=>p.id===socket.id)) { socket.emit('err',{msg:'Déjà connecté !'}); return; }
    room.players.push(makePlayer(socket.id, name, avatar));
    socket.join(code);
    socket.emit('room_joined', { code, players:lobbyPlayers(room), heroMode:room.heroMode, hostId:room.host, chatMessages:room.chatMessages.slice(-20), optMeurtre:room.optMeurtre, optClairvoyance:room.optClairvoyance, optDragon:room.optDragon });
    socket.to(code).emit('player_joined', { players:lobbyPlayers(room) });
  });

  socket.on('toggle_hero_mode', ({ code }) => {
    const room = rooms[code];
    if (!room || room.host!==socket.id || room.status!=='lobby') return;
    room.heroMode = !room.heroMode;
    io.to(code).emit('hero_mode_changed', { heroMode:room.heroMode });
  });

  socket.on('toggle_option', ({ code, option }) => {
    const room = rooms[code];
    if (!room || room.host!==socket.id || room.status!=='lobby') return;
    if (!['optMeurtre','optClairvoyance','optDragon'].includes(option)) return;
    room[option] = !room[option];
    io.to(code).emit('option_changed', { option, value:room[option] });
  });

  socket.on('chat_message', ({ code, text }) => {
    const room = rooms[code]; if (!room) return;
    const player = room.players.find(p => p.id===socket.id); if (!player) return;
    if (!text || !text.trim()) return;
    const msg = { id:Date.now(), playerId:socket.id, playerName:player.name, avatar:player.avatar||null, text:text.trim().slice(0,200) };
    room.chatMessages.push(msg);
    if (room.chatMessages.length > 100) room.chatMessages.shift();
    socket.to(code).emit('chat_message', msg);
  });

  // ═══ EMOJI REACTIONS ═══
  socket.on('emoji_reaction', ({ code, emoji }) => {
    const room = rooms[code]; if (!room) return;
    const player = room.players.find(p => p.id === socket.id); if (!player) return;
    if (!emoji || emoji.length > 4) return;
    socket.to(code).emit('emoji_reaction', {
      playerId: socket.id,
      playerName: player.name,
      emoji
    });
  });

  socket.on('abandon_game', ({ code }) => {
    const room = rooms[code];
    if (!room || room.host!==socket.id || room.status!=='playing') return;
    room.status = 'lobby';
    resetPlayers(room);
    io.to(code).emit('return_to_lobby', { players:lobbyPlayers(room), heroMode:room.heroMode, hostId:room.host });
    showToastAll(room, '🏳️ Partie abandonnée par l\'hôte');
  });

  socket.on('start_game', ({ code }) => {
    const room = rooms[code];
    if (!room || room.host!==socket.id) return;
    if (room.players.length < 2) { socket.emit('err',{msg:'Il faut au moins 2 joueurs !'}); return; }
    if (room.heroMode) {
      room.status = 'hero_pick';
      room.deck = buildDeck(); room.discard = [];
      const pool = shuffle([...HEROES]);
      room.players.forEach((p,i) => { p.heroChoices=[pool[(i*2)%pool.length], pool[(i*2+1)%pool.length]]; p.heroChosen=false; });
      io.to(code).emit('hero_pick_started', { players:room.players.map(p=>({id:p.id,name:p.name,heroChosen:false})) });
      setTimeout(() => {
        room.players.forEach(p => { const s=io.sockets.sockets.get(p.id); if(s) s.emit('pick_hero',{choices:p.heroChoices}); });
      }, 400);
    } else { launchGame(room); }
  });

  socket.on('choose_hero', ({ code, heroId }) => {
    const room = rooms[code];
    if (!room || room.status!=='hero_pick') return;
    const player = room.players.find(p=>p.id===socket.id);
    if (!player) return;
    const hero = player.heroChoices.find(h=>h.id===heroId);
    if (!hero) { socket.emit('err',{msg:'Héros invalide'}); return; }
    player.heroId=hero.id; player.heroName=hero.name; player.heroEmoji=hero.emoji; player.heroChosen=true;
    socket.emit('hero_chosen', { hero });
    io.to(code).emit('hero_pick_update', { playerId:player.id, playerName:player.name, heroEmoji:hero.emoji, heroName:hero.name, allChosen:room.players.every(p=>p.heroChosen) });
    if (room.players.every(p=>p.heroChosen)) setTimeout(()=>launchGame(room), 1500);
  });

  socket.on('action', ({ code, type, targetId, extra }) => {
    const room = rooms[code];
    if (!room || room.status!=='playing') return;
    let safetyCount = 0;
    while (room.players[room.turnIdx]?.eliminated && safetyCount < room.players.length) {
      room.turnIdx = (room.turnIdx + 1) % room.players.length;
      safetyCount++;
    }
    const actor = room.players[room.turnIdx];
    if (!actor || actor.id!==socket.id) {
      const ps = io.sockets.sockets.get(socket.id);
      if (ps) ps.emit('err',{msg:"Ce n'est pas votre tour !"});
      broadcastState(room);
      return;
    }
    if (actor.charges.length>0 && actor.heroId!=='guerriere' && type!=='attack') {
      socket.emit('err',{msg:'Vous devez attaquer avec votre charge !'}); return;
    }
    const target = targetId ? room.players.find(p=>p.id===targetId) : null;

    if (actor.heroId==='necromancien' && (type==='attack'||type==='charge') && room.discard.length>0) {
      const lastDiscard = room.discard[room.discard.length-1];
      actor.pendingAction=type; actor.pendingTargetId=targetId; actor.pendingExtra=extra;
      const ps=io.sockets.sockets.get(actor.id);
      if (ps) ps.emit('necro_choose',{lastDiscard, type, targetId});
      return;
    }

    if (actor.heroId==='barde') {
      const count = bardeSymbolSame(actor) ? 3 : bardeColorSame(actor) ? 2 : 1;
      if (count > 1) {
        const choices = [];
        for (let i=0; i<count; i++) choices.push(drawCard(room));
        actor.bardeChoices=choices; actor.bardeAction=type; actor.bardeTargetId=targetId; actor.bardeExtra=extra;
        socket.emit('barde_choose', { choices, action:type, count }); return;
      }
    }

    let drawn;
    if (type==='necro_discard') {
      if (room.discard.length===0) { socket.emit('err',{msg:'Défausse vide !'}); return; }
      drawn = room.discard.pop();
    } else { drawn = drawCard(room); }
    if (!drawn) { socket.emit('err',{msg:'Plus de cartes disponibles !'}); return; }
    actor.drawnCard = drawn;

    if (type==='charge') {
      if (actor.heroId==='barde') {
        const ps=io.sockets.sockets.get(actor.id);
        if (ps) ps.emit('card_reveal',{card:drawn,chargeCard:null,actorName:actor.name,actionLabel:'⚡ Se charge (vous voyez votre charge)',isCharge:false});
        room.players.forEach(p=>{
          if(p.id===actor.id||p.eliminated) return;
          const s=io.sockets.sockets.get(p.id);
          if(s) s.emit('card_reveal',{card:null,chargeCard:null,actorName:actor.name,actionLabel:'⚡ Se charge',isCharge:true});
        });
      } else {
        io.to(room.code).emit('card_reveal', { card:null, chargeCard:null, actorName:actor.name, actionLabel:'⚡ Se charge', isCharge:true });
      }
    } else {
      const chargeCard = actor.charges.length>0 ? actor.charges[0] : null;
      const espionneHiding = actor.heroId==='espionne' && type==='shield_swap';
      io.to(room.code).emit('card_reveal', {
        card: espionneHiding ? null : drawn,
        chargeCard, actorName:actor.name,
        actionLabel:actionLabel(type, target?target.name:''),
        isCharge: espionneHiding ? true : false,
        targetShieldHidden: hasEspionne(room) && target && target.heroId!=='espionne',
      });
    }

    const mage = room.players.find(p => p.heroId==='mage' && !p.eliminated);
    if (mage && (drawn.numVal===1 || drawn.numVal===13) && type!=='charge') {
      actor.pendingDraw=drawn; actor.pendingAction=type; actor.pendingTargetId=targetId; actor.pendingExtra=extra;
      room.waitingFor = { playerId:mage.id, playerName:mage.name, heroEmoji:'🔮', reason:'fait son choix…' };
      io.to(room.code).emit('waiting_for', room.waitingFor);
      const ms = io.sockets.sockets.get(mage.id);
      if (ms) ms.emit('mage_can_transform', { card:drawn, actorName:actor.name, targetName:target?target.name:'', actionType:type });
      actor.mageTimer = setTimeout(() => {
        if (actor.pendingDraw) {
          actor.mageTransform = false;
          room.waitingFor = null;
          io.to(room.code).emit('waiting_for', null);
          io.to(room.code).emit('mage_timer_expired');
          const d=actor.pendingDraw, t=actor.pendingAction, ti=actor.pendingTargetId, ex=actor.pendingExtra;
          actor.pendingDraw=null; actor.pendingAction=null; actor.pendingTargetId=null;
          handleAction(room, actor, t, ti, d, ex);
        }
      }, 15000);
      return;
    }

    if (actor.heroId==='demoniste' && type!=='charge') {
      actor.pendingDraw=drawn; actor.pendingAction=type; actor.pendingTargetId=targetId; actor.pendingExtra=extra;
      socket.emit('demoniste_can_reroll', { card:drawn, cost:3, pvLeft:totalPV(actor) }); return;
    }

    setTimeout(()=>handleAction(room, actor, type, targetId, drawn, extra), 300);
  });

  socket.on('necro_use_discard', ({ code }) => {
    const room = rooms[code]; if (!room) return;
    const actor = room.players[room.turnIdx];
    if (!actor || actor.id!==socket.id || actor.heroId!=='necromancien') return;
    if (room.discard.length===0) { socket.emit('err',{msg:'Défausse vide !'}); return; }
    const type=actor.pendingAction, targetId=actor.pendingTargetId, extra=actor.pendingExtra;
    actor.pendingAction=null; actor.pendingTargetId=null; actor.pendingExtra=null;
    const drawn = room.discard.pop();
    actor.drawnCard = drawn;
    const target = targetId ? room.players.find(p=>p.id===targetId) : null;
    const chargeCard = actor.charges.length>0 ? actor.charges[0] : null;
    if (type==='charge') {
      io.sockets.sockets.get(actor.id)?.emit('card_reveal',{card:drawn,chargeCard:null,actorName:actor.name,actionLabel:'⚡ Se charge (défausse)',isCharge:false});
      room.players.forEach(p=>{ if(p.id!==actor.id&&!p.eliminated) io.sockets.sockets.get(p.id)?.emit('card_reveal',{card:null,chargeCard:null,actorName:actor.name,actionLabel:'⚡ Se charge',isCharge:true}); });
    } else {
      io.to(room.code).emit('card_reveal',{card:drawn,chargeCard,actorName:actor.name,actionLabel:actionLabel(type,target?target.name:''),isCharge:false});
    }
    setTimeout(()=>handleAction(room, actor, type, targetId, drawn, extra), 300);
  });

  socket.on('necro_use_random', ({ code }) => {
    const room = rooms[code]; if (!room) return;
    const actor = room.players[room.turnIdx];
    if (!actor || actor.id!==socket.id || actor.heroId!=='necromancien') return;
    const type=actor.pendingAction, targetId=actor.pendingTargetId, extra=actor.pendingExtra;
    actor.pendingAction=null; actor.pendingTargetId=null; actor.pendingExtra=null;
    const drawn = drawCard(room);
    actor.drawnCard = drawn;
    const target = targetId ? room.players.find(p=>p.id===targetId) : null;
    const chargeCard = actor.charges.length>0 ? actor.charges[0] : null;
    if (type==='charge') {
      io.sockets.sockets.get(actor.id)?.emit('card_reveal',{card:drawn,chargeCard:null,actorName:actor.name,actionLabel:'⚡ Se charge',isCharge:false});
      room.players.forEach(p=>{ if(p.id!==actor.id&&!p.eliminated) io.sockets.sockets.get(p.id)?.emit('card_reveal',{card:null,chargeCard:null,actorName:actor.name,actionLabel:'⚡ Se charge',isCharge:true}); });
    } else {
      io.to(room.code).emit('card_reveal',{card:drawn,chargeCard,actorName:actor.name,actionLabel:actionLabel(type,target?target.name:''),isCharge:false});
    }
    setTimeout(()=>handleAction(room, actor, type, targetId, drawn, extra), 300);
  });

  socket.on('mage_decision', ({ code, transform }) => {
    const room = rooms[code]; if (!room) return;
    const mage = room.players.find(p=>p.id===socket.id && p.heroId==='mage');
    if (!mage) return;
    const actor = room.players[room.turnIdx];
    if (!actor || !actor.pendingDraw) return;
    clearTimeout(actor.mageTimer);
    actor.mageTransform = transform;
    room.waitingFor = null;
    io.to(room.code).emit('waiting_for', null);
    const card = actor.pendingDraw;
    if (transform) {
      const newVal = card.numVal===1?13:1;
      io.to(room.code).emit('action_popup',{emoji:'🔮',main:`${mage.name} transforme la carte !`,detail:`${card.display}${card.suit} devient ${newVal===13?'K':'A'}${card.suit}`,result:`${card.numVal} → ${newVal}`,'resultType':'neutral'});
    } else {
      io.to(room.code).emit('action_popup',{emoji:'🔮',main:`${mage.name} ne transforme pas`,detail:`${card.display}${card.suit} reste inchangé`,result:null,resultType:null});
    }
    const drawn=actor.pendingDraw, type=actor.pendingAction, targetId=actor.pendingTargetId, extra=actor.pendingExtra;
    actor.pendingDraw=null; actor.pendingAction=null; actor.pendingTargetId=null;
    setTimeout(()=>handleAction(room, actor, type, targetId, drawn, extra), 3500);
  });

  socket.on('demoniste_reroll', ({ code }) => {
    const room = rooms[code]; if (!room) return;
    const actor = room.players[room.turnIdx];
    if (!actor || actor.id!==socket.id || actor.heroId!=='demoniste') return;
    if (totalPV(actor) < 2) { socket.emit('err',{msg:'PV insuffisants !'}); return; }
    const cost = Math.min(3, totalPV(actor)-1);
    room.discard.push(actor.pendingDraw);
    applyDamage(room, actor, cost);
    checkEliminated(room, actor);
    if (checkGameOver(room)) return;
    const newCard = drawCard(room);
    actor.pendingDraw=newCard; actor.drawnCard=newCard;
    const chargeCard = actor.charges.length>0 ? actor.charges[0] : null;
    io.to(room.code).emit('card_reveal', {
      card:newCard, chargeCard, actorName:actor.name,
      actionLabel:actionLabel(actor.pendingAction, actor.pendingTargetId?room.players.find(p=>p.id===actor.pendingTargetId)?.name:''),
      isCharge:false,
    });
    socket.emit('demoniste_can_reroll', { card:newCard, cost:3, pvLeft:totalPV(actor), rerolled:true });
  });

  socket.on('demoniste_confirm', ({ code }) => {
    const room = rooms[code]; if (!room) return;
    const actor = room.players[room.turnIdx];
    if (!actor || actor.id!==socket.id) return;
    const drawn=actor.pendingDraw, type=actor.pendingAction, targetId=actor.pendingTargetId, extra=actor.pendingExtra;
    actor.pendingDraw=null; actor.pendingAction=null; actor.pendingTargetId=null;
    setTimeout(()=>handleAction(room, actor, type, targetId, drawn, extra), 100);
  });

  socket.on('barde_pick', ({ code, cardIndex }) => {
    const room = rooms[code]; if (!room) return;
    const actor = room.players[room.turnIdx];
    if (!actor || actor.id!==socket.id || !actor.bardeChoices) return;
    if (typeof cardIndex!=='number'||cardIndex<0||cardIndex>=actor.bardeChoices.length) return;
    const chosen = actor.bardeChoices[cardIndex];
    actor.bardeChoices.forEach((c,i) => { if (i!==cardIndex) room.discard.push(c); });
    const type=actor.bardeAction, targetId=actor.bardeTargetId, extra=actor.bardeExtra;
    actor.bardeChoices=null; actor.drawnCard=chosen;
    const target = targetId ? room.players.find(p=>p.id===targetId) : null;
    const chargeCard = actor.charges.length>0 ? actor.charges[0] : null;

    if (type==='charge') {
      io.sockets.sockets.get(actor.id)?.emit('card_reveal',{card:chosen,chargeCard:null,actorName:actor.name,actionLabel:'⚡ Se charge (vous voyez votre charge)',isCharge:false});
      room.players.forEach(p=>{
        if(p.id===actor.id||p.eliminated) return;
        io.sockets.sockets.get(p.id)?.emit('card_reveal',{card:null,chargeCard:null,actorName:actor.name,actionLabel:'⚡ Se charge',isCharge:true});
      });
    } else {
      io.to(room.code).emit('card_reveal', { card:chosen, chargeCard, actorName:actor.name, actionLabel:actionLabel(type, target?target.name:''), isCharge:false });
    }

    const mage = room.players.find(p => p.heroId==='mage' && !p.eliminated);
    if (mage && (chosen.numVal===1 || chosen.numVal===13) && type!=='charge') {
      actor.pendingDraw=chosen; actor.pendingAction=type; actor.pendingTargetId=targetId; actor.pendingExtra=extra;
      room.waitingFor = { playerId:mage.id, playerName:mage.name, heroEmoji:'🔮', reason:'fait son choix…' };
      io.to(room.code).emit('waiting_for', room.waitingFor);
      const ms = io.sockets.sockets.get(mage.id);
      if (ms) ms.emit('mage_can_transform', { card:chosen, actorName:actor.name, targetName:target?target.name:'', actionType:type });
      actor.mageTimer = setTimeout(() => {
        if (actor.pendingDraw) {
          actor.mageTransform = false;
          room.waitingFor = null;
          io.to(room.code).emit('waiting_for', null);
          io.to(room.code).emit('mage_timer_expired');
          const d=actor.pendingDraw, t=actor.pendingAction, ti=actor.pendingTargetId, ex=actor.pendingExtra;
          actor.pendingDraw=null; actor.pendingAction=null; actor.pendingTargetId=null;
          handleAction(room, actor, t, ti, d, ex);
        }
      }, 15000);
      return;
    }

    setTimeout(()=>handleAction(room, actor, type, targetId, chosen, extra), 300);
  });

  socket.on('barde_pv_pick', ({ code, cardIndex }) => {
    const room = rooms[code]; if (!room) return;
    const barde = room.players.find(p=>p.id===socket.id);
    if (!barde || !barde.bardePvChoices) return;
    if (typeof cardIndex!=='number'||cardIndex<0||cardIndex>=barde.bardePvChoices.length) return;
    const chosen = barde.bardePvChoices[cardIndex];
    const discardIdx = room.discard.findIndex(c => c.suit===chosen.suit && c.numVal===chosen.numVal && c.display===chosen.display);
    if (discardIdx !== -1) room.discard.splice(discardIdx, 1);
    barde.bardePvChoices = null;
    barde.pv.push(chosen);
    const paladinPending = barde.bardePvPaladinPending;
    const suspendedActor = barde.bardePvSuspendedActor;
    barde.bardePvPaladinPending = null;
    barde.bardePvSuspendedActor = null;
    room.waitingFor = null;
    io.to(room.code).emit('waiting_for', null);
    broadcastPopup(room,'🎵',`${barde.name} choisit sa carte PV`,`${cStr(chosen)} (${chosen.numVal} PV) depuis la défausse`,null,'neutral');
    broadcastState(room);
    if (paladinPending && suspendedActor && !suspendedActor.eliminated) {
      launchPaladinRiposte(room, barde, suspendedActor);
    } else {
      nextAliveTurn(room);
      broadcastState(room);
      scheduleNextTurn(room,5500);
    }
  });

  socket.on('voleuse_skip', ({ code }) => {
    const room = rooms[code]; if (!room) return;
    const actor = room.players.find(p=>p.id===socket.id);
    if (!actor) return;
    room.waitingFor = null;
    io.to(room.code).emit('waiting_for', null);
    broadcastPopup(room,'🗡️',`${actor.name} (Voleuse) passe`,'Aucun échange',null,'neutral');
    if (actor.pendingPaladinTarget) {
      const paladinPlayer = room.players.find(p=>p.id===actor.pendingPaladinTarget&&!p.eliminated);
      actor.pendingPaladinTarget=null; actor.pendingBardeTarget=null;
      if (paladinPlayer && totalPV(paladinPlayer)>0) {
        launchPaladinRiposte(room, paladinPlayer, actor); return;
      }
    }
    actor.pendingPaladinTarget=null; actor.pendingBardeTarget=null;
    finishTurn(room, actor);
  });

  socket.on('voleuse_exchange', ({ code, myType, myIdx, theirType, theirIdx, targetId }) => {
    const room = rooms[code]; if (!room) return;
    const actor=room.players.find(p=>p.id===socket.id), target=room.players.find(p=>p.id===targetId);
    if (!actor||!target) return;
    const myCard=myType==='shield'?actor.shield:actor.pv[myIdx];
    const theirCard=theirType==='shield'?target.shield:target.pv[theirIdx||0];
    if (!myCard||!theirCard) {
      room.waitingFor=null; io.to(room.code).emit('waiting_for',null);
      broadcastPopup(room,'🗡️',`${actor.name} (Voleuse)`,'Échange annulé',null,'neutral');
      actor.pendingPaladinTarget=null; actor.pendingBardeTarget=null;
      finishTurn(room,actor); return;
    }
    if (myType==='shield') actor.shield=theirCard; else actor.pv[myIdx]=theirCard;
    if (theirType==='shield') target.shield=myCard; else target.pv[theirIdx||0]=myCard;
    room.waitingFor = null;
    io.to(room.code).emit('waiting_for', null);
    broadcastPopup(room,'🗡️',`${actor.name} échange avec ${target.name}`,`échange de cartes`,null,'neutral');
    broadcastState(room);
    const paladinTargetId = actor.pendingPaladinTarget;
    actor.pendingPaladinTarget = null; actor.pendingBardeTarget = null;
    if (paladinTargetId) {
      const paladinPlayer = room.players.find(p=>p.id===paladinTargetId&&!p.eliminated);
      if (paladinPlayer && totalPV(paladinPlayer)>0) {
        launchPaladinRiposte(room, paladinPlayer, actor); return;
      }
    }
    nextAliveTurn(room); broadcastState(room); scheduleNextTurn(room,5500);
  });

  socket.on('potion_feu_target2', ({ code, target2Id }) => {
    const room = rooms[code]; if (!room) return;
    const actor = room.players[room.turnIdx];
    if (!actor||actor.id!==socket.id||!actor.pendingDraw) return;
    actor.potionFeuTarget2 = target2Id;
    const drawn=actor.pendingDraw, type=actor.pendingAction, targetId=actor.pendingTargetId;
    actor.pendingDraw=null; actor.pendingAction=null; actor.pendingTargetId=null;
    const target=room.players.find(p=>p.id===targetId);
    const chargeCard=actor.charges.length>0?actor.charges[0]:null;
    io.to(room.code).emit('card_reveal',{card:drawn,chargeCard,actorName:actor.name,actionLabel:actionLabel(type,target?target.name:'')+'🔥',isCharge:false});
    setTimeout(()=>handleAction(room,actor,type,targetId,drawn,null),300);
  });

  socket.on('use_potion', ({ code, potionType, targetId }) => {
    const room = rooms[code]; if (!room||room.status!=='playing') return;
    const actor = room.players[room.turnIdx];
    if (!actor||actor.id!==socket.id||actor.heroId!=='alchimiste') return;
    const potion = actor.potions.find(p=>p.type===potionType&&!p.used);
    if (!potion) { socket.emit('err',{msg:'Potion indisponible !'}); return; }
    potion.used=true;
    const mustAttack = actor.charges.length>0 && actor.heroId!=='guerriere';
    if (potionType==='invisibilite') {
      actor.potionInvis=true;
      broadcastPopup(room,'⚗️',`${actor.name} boit une Potion d'Invisibilité !`,'La prochaine action qui le cible sera esquivée.',null,null);
    } else if (potionType==='vitesse') {
      actor.bonusAction=true;
      broadcastPopup(room,'⚗️',`${actor.name} boit une Potion de Vitesse !`,'Il jouera une action supplémentaire.',null,null);
    } else if (potionType==='feu') {
      actor.potionFeu=true; actor.potionFeuTarget2=null;
      broadcastPopup(room,'🔥',`${actor.name} prépare une Potion de Feu !`,'Sa prochaine attaque touchera une 2e cible.',null,null);
    }
    broadcastState(room);
    const ps = io.sockets.sockets.get(actor.id);
    if (ps) ps.emit('choose_action', { deckCount:room.deck.length, discardTop:room.discard.length>0?room.discard[room.discard.length-1]:null, mustAttack, canUsePotion:actor.potions.some(p=>!p.used), potions:actor.potions });
  });

  socket.on('request_state', ({ code }) => {
    const room = rooms[code]; if (!room) return;
    const player = room.players.find(p=>p.id===socket.id);
    if (!player) return;
    socket.emit('state_update', { state: privateState(room, socket.id) });
    const actor = room.players[room.turnIdx];
    if (actor && actor.id===socket.id && !actor.pendingDraw) {
      const mustAttack = actor.charges.length>0 && actor.heroId!=='guerriere';
      const clairvoyant = room.optClairvoyance && totalPV(actor)===1;
      const topCard = clairvoyant && room.deck.length>0 ? room.deck[room.deck.length-1] : null;
      socket.emit('choose_action',{
        deckCount:room.deck.length,
        discardTop:room.discard.length>0?room.discard[room.discard.length-1]:null,
        mustAttack, canUsePotion:actor.heroId==='alchimiste'&&actor.potions?.some(p=>!p.used),
        potions:actor.heroId==='alchimiste'?actor.potions:null,
        clairvoyantCard:topCard,
      });
    }
  });

  socket.on('leave_room', ({ code }) => leaveRoom(socket, code));
  socket.on('disconnect', () => {
    Object.keys(rooms).forEach(code => { if (rooms[code]?.players.find(p=>p.id===socket.id)) leaveRoom(socket,code); });
  });
});

// ════════ LAUNCH ════════
function launchGame(room) {
  room.status='playing'; room.deck=buildDeck(); room.discard=[];
  room.players.forEach(p => {
    const isOgre = p.heroId==='ogre';
    const h = dealStartHand(room.deck, isOgre);
    p.pv=h.pv; p.shield=h.shield; p.charges=[]; p.drawnCard=null; p.eliminated=false;
    p.shieldRevealed = false;
    p.woundMarkers={}; p.bardeChoices=null; p.bardePvChoices=null; p.bardePvSuspendedActor=null; p.bardeAction=null;
    p.pendingDraw=null; p.pendingAction=null; p.pendingTargetId=null; p.mageTimer=null;
    p.mageTransform=false; p.bonusAction=false;
    p.potionInvis=false; p.potionFeu=false; p.potionFeuTarget2=null;
    p.potions = p.heroId==='alchimiste' ? [{type:'feu',used:false},{type:'invisibilite',used:false},{type:'vitesse',used:false}] : [];
  });
  room.players.sort((a,b) => { const sa=totalPV(a)+a.shield.numVal, sb=totalPV(b)+b.shield.numVal; return sa!==sb?sa-sb:a.shield.numVal-b.shield.numVal; });
  room.turnIdx=0;
  room.players.forEach(p => { const s=io.sockets.sockets.get(p.id); if(s) s.emit('game_started',{state:privateState(room,p.id)}); });
  startTurn(room);
}

// ════════ HANDLE ACTION ════════
function handleAction(room, actor, type, targetId, drawn, extra) {
  const aType = type==='necro_discard' ? 'attack' : type;
  const target = targetId ? room.players.find(p=>p.id===targetId) : null;
  const espionneInGame = hasEspionne(room);

  // Potion invisibilité
  if (target && target.potionInvis && (aType==='attack'||aType==='shield_swap')) {
    target.potionInvis=false;
    room.discard.push(drawn);
    actor.charges.forEach(c=>room.discard.push(c)); actor.charges=[];
    actor.drawnCard=null;
    broadcastPopup(room,'⚗️',`${target.name} esquive !`,`La Potion d'Invisibilité annule l'action de ${actor.name}.`,null,null);
    finishTurn(room, actor); return;
  }

  // Appliquer transformation Mage
  if (actor.mageTransform && (drawn.numVal===1 || drawn.numVal===13)) {
    const newVal = drawn.numVal===1 ? 13 : 1;
    const mageName = room.players.find(p=>p.heroId==='mage')?.name||'Mage';
    io.to(room.code).emit('card_transformed', { original:drawn, transformed:{...drawn,numVal:newVal,display:newVal===13?'K':'A'}, mageName });
    drawn = {...drawn, numVal:newVal, display:newVal===13?'K':'A'};
    actor.drawnCard = drawn;
  }
  actor.mageTransform = false;

  if (aType==='attack') {
    if (!target||target.eliminated) { notifyErr(actor,'Cible invalide !'); return; }

    // Potion feu : demander la 2e cible si pas encore choisie
    if (actor.potionFeu && actor.potionFeuTarget2===null) {
      actor.pendingDraw=drawn; actor.pendingAction=type; actor.pendingTargetId=targetId;
      const ps=io.sockets.sockets.get(actor.id);
      const others=room.players.filter(p=>!p.eliminated&&p.id!==actor.id&&p.id!==targetId);
      if (ps && others.length>0) {
        ps.emit('potion_feu_pick_target2',{
          target1:{id:target.id,name:target.name},
          others:others.map(p=>({id:p.id,name:p.name,shieldVal:p.shieldHidden?'?':getShieldVal(p)}))
        });
        return;
      } else { actor.potionFeu=false; }
    }

    if (!drawn) { notifyErr(actor,'Plus de cartes !'); finishTurn(room,actor); return; }
    let atkVal = drawn.numVal, chargeUsed = null, chargesUsed = [];

    if (actor.heroId==='guerriere') {
      chargesUsed=[...actor.charges];
      actor.charges.forEach(c=>{atkVal+=c.numVal; room.discard.push(c);});
      chargeUsed=chargesUsed[0]||null; actor.charges=[];
    } else if (actor.charges.length>0) {
      chargesUsed=[actor.charges[0]];
      atkVal+=actor.charges[0].numVal; chargeUsed=actor.charges[0];
      room.discard.push(actor.charges[0]); actor.charges=[];
    }

    if (actor.heroId==='bete') {
      const wounds = actor.woundMarkers[targetId]||0;
      atkVal += wounds*3;
    }

    const shieldVal = getShieldVal(target);
    const isOgreKill = actor.heroId==='ogre' && atkVal===shieldVal;
    const shieldHiddenNow = espionneInGame && !target.shieldRevealed && target.heroId !== 'espionne';
    const shieldDisplay = shieldHiddenNow ? '?' : shieldVal;

    if (!isOgreKill && atkVal<=shieldVal) {
      // Bloqué
      const chargeStr=chargesUsed.length>0?' + ⚡'+chargesUsed.map(c=>cStr(c)).join('+'):'';
      broadcastPopup(room,'🛡️',`${actor.name} attaque ${target.name}`,
        `${cStr(drawn)}${chargeStr} (${atkVal}) contre bouclier ${shieldDisplay}`,
        'Bloqué !','block');
      room.discard.push(drawn);
      finishTurn(room, actor);
    } else {
      // Touché
      const dmg = isOgreKill ? totalPV(target) : atkVal-shieldVal;
      const pvBefore=totalPV(target);
      applyDamage(room, target, dmg);
      const bardePvPending = target.heroId==='barde' && target.bardePendingPvValue !== undefined ? target.bardePendingPvValue : 0;
      const pvAfter = totalPV(target) + bardePvPending;
      const didDamage = pvAfter < pvBefore;

      if (didDamage && espionneInGame && target.heroId !== 'espionne') target.shieldRevealed = true;

      const woundBonus = actor.heroId==='bete' ? (actor.woundMarkers[targetId]||0)*3 : 0;
      const detailExtra = woundBonus>0 ? ` (+${woundBonus} 🐾)` : '';
      const shieldDisplayAfter = (didDamage && target.heroId !== 'espionne' && target.shieldRevealed) ? shieldVal : shieldDisplay;

      const chargeStr2=chargesUsed.length>0?' + ⚡'+chargesUsed.map(c=>cStr(c)).join('+'):'';
      broadcastPopup(room,'⚔️',`${actor.name} attaque ${target.name}`,
        `${cStr(drawn)}${chargeStr2} (${atkVal}${detailExtra}) contre bouclier ${shieldDisplayAfter}${isOgreKill?' — Ogre !':''}`,
        `−${dmg} PV → ${pvAfter} PV restants`,'dmg');

      if (didDamage && target.charges.length>0) { target.charges.forEach(c=>room.discard.push(c)); target.charges=[]; }

      // Bête marqueur
      if (actor.heroId==='bete' && didDamage && !target.eliminated) {
        if (!actor.woundMarkers) actor.woundMarkers={};
        actor.woundMarkers[targetId]=(actor.woundMarkers[targetId]||0)+1;
      }

      // Paladin flag (calculé avant barde pour stockage)
      const paladinPending = target.heroId==='paladin' && didDamage && totalPV(target)>0 && !target.eliminated;

      // Barde : choix de carte PV dans la défausse
      if (target.heroId==='barde' && didDamage && !target.eliminated && target.bardePendingPvValue !== undefined) {
        const nv = target.bardePendingPvValue;
        target.bardePendingPvValue = undefined;
        const discardMatches = room.discard.filter(c => c.numVal === nv);
        if (discardMatches.length > 0) {
          target.bardePvChoices = discardMatches;
          target.bardePvSuspendedActor = actor;
          target.bardePvPaladinPending = paladinPending;
          room.waitingFor = { playerId:target.id, playerName:target.name, heroEmoji:'🎵', reason:`choisit une carte de ${nv} PV…` };
          io.to(room.code).emit('waiting_for', room.waitingFor);
          io.to(room.code).emit('hero_action_announce',{emoji:'🎵',text:`${target.name} (Barde) choisit sa carte de ${nv} PV`});
          const bs = io.sockets.sockets.get(target.id);
          if (bs) bs.emit('barde_pv_prompt', { choices:discardMatches, pvValue:nv });
          room.discard.push(drawn); actor.drawnCard=null;
          broadcastState(room);
          return; // barde_pv_pick gère la suite (y compris paladin)
        } else {
          const f = findCardOfValue(room, nv);
          if (f) target.pv.push(f);
        }
      }

      room.discard.push(drawn);
      checkEliminated(room, target);
      if (checkGameOver(room)) return;

      // Potion feu — 2e cible
      if (actor.potionFeu && actor.potionFeuTarget2) {
        actor.potionFeu = false;
        const t2 = room.players.find(p=>p.id===actor.potionFeuTarget2);
        actor.potionFeuTarget2 = null;
        if (t2 && !t2.eliminated) {
          const sv2 = getShieldVal(t2);
          if (drawn.numVal > sv2) {
            const d2 = drawn.numVal - sv2;
            applyDamage(room, t2, d2);
            broadcastPopup(room,'🔥',`Potion de Feu — ${t2.name}`,
              `${cStr(drawn)} (${drawn.numVal}) vs 🛡️${sv2}`,`−${d2} PV → ${totalPV(t2)} PV`,'dmg');
            if(t2.charges.length>0){t2.charges.forEach(c=>room.discard.push(c));t2.charges=[];}
            checkEliminated(room, t2);
          } else {
            broadcastPopup(room,'🔥',`Potion de Feu — ${t2.name}`,
              `${cStr(drawn)} (${drawn.numVal}) vs 🛡️${sv2}`,'Bloqué !','block');
          }
          broadcastState(room);
          if (checkGameOver(room)) return;
        }
      } else { actor.potionFeu=false; actor.potionFeuTarget2=null; }

      // Voleuse échange
      if (actor.heroId==='voleuse' && didDamage && !target.eliminated) {
        actor.pendingPaladinTarget = paladinPending ? target.id : null;
        room.waitingFor={playerId:actor.id,playerName:actor.name,heroEmoji:'🗡️',reason:'choisit une carte à échanger…'};
        io.to(room.code).emit('waiting_for',room.waitingFor);
        const as=io.sockets.sockets.get(actor.id);
        if(as) as.emit('voleuse_prompt',{targetId:target.id,targetName:target.name,targetPV:target.pv,targetShield:target.shield,myPV:actor.pv,myShield:actor.shield});
        return;
      }

      // Paladin riposte
      if (paladinPending) {
        launchPaladinRiposte(room, target, actor);
        return;
      }

      finishTurn(room, actor);
    }

  } else if (aType==='shield_swap') {
    if (!target) { notifyErr(actor,'Cible invalide !'); return; }
    const old = target.shield;
    target.shield = drawn;
    if (old) room.discard.push(old);
    if (espionneInGame && target.heroId!=='espionne') target.shieldRevealed = true;
    broadcastPopup(room,'🛡️',`${actor.name} change le bouclier de ${target.name}`,
      `Nouveau : ${cStr(drawn)} (${drawn.numVal})`,
      `${old?cStr(old):'?'} → ${cStr(drawn)}`,'neutral');
    broadcastState(room);
    finishTurn(room, actor);

  } else if (aType==='charge') {
    actor.charges.push(drawn);
    broadcastPopup(room,'⚡',`${actor.name} se charge`,'Carte cachée pour la prochaine attaque',null,'neutral');
    broadcastState(room);
    finishTurn(room, actor);

  } else if (aType==='heal_pv') {
    const pvIdx = extra ? extra.pvIdx : 0;
    if (pvIdx>=0 && pvIdx<actor.pv.length) {
      const old = actor.pv[pvIdx];
      actor.pv[pvIdx] = drawn;
      room.discard.push(old);
      broadcastPopup(room,'✨',`${actor.name} soigne ses PV`,
        `${cStr(old)} → ${cStr(drawn)}`,`${old.numVal} → ${drawn.numVal} PV`,'neutral');
    } else { room.discard.push(drawn); }
    broadcastState(room);
    finishTurn(room, actor);
  }
}

// ════════ START ════════
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🛡️ Le Bouclier — Serveur démarré sur le port ${PORT}`));


