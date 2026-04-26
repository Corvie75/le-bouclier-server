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
    hand.forEach(c => deck.unshift(c)); shuffle(deck);
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
    // Marquer que le dragon doit se déclencher APRÈS la fin du tour
    if (room.optDragon && room.deck.length > 0) {
      room.dragonPending = true;
    }
  }
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
  // Attendre que le popup dragon soit fermé (3.2s) puis lancer le prochain tour
  nextAliveTurn(room);
  setTimeout(()=>startTurn(room), 3500);
}
function lobbyPlayers(room) {
  return room.players.map(p => ({ id:p.id, name:p.name, wins:p.wins||0, avatar:p.avatar||null }));
}

// ════════ STATE ════════
function publicState(room) {
  const espionneInGame = hasEspionne(room);
  return {
    players: room.players.map(p => {
      // Bouclier caché si: espionne en jeu ET bouclier pas encore révélé
      // ou si c'est l'espionne elle-même (toujours caché pour les autres)
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
  // Espionne voit TOUS les boucliers (même cachés)
  if (player.heroId === 'espionne') {
    base.players.forEach(bp => {
      const real = room.players.find(rp => rp.id === bp.id);
      if (real) { bp.shield = real.shield; bp.shieldVal = getShieldVal(real); bp.shieldHidden = false; }
    });
  } else {
    // Chaque joueur voit son propre bouclier s'il est révélé
    const myData = base.players.find(bp => bp.id === playerId);
    const realMe = room.players.find(rp => rp.id === playerId);
    if (myData && realMe && realMe.shieldRevealed) {
      myData.shield = realMe.shield; myData.shieldVal = getShieldVal(realMe); myData.shieldHidden = false;
    }
    // Si espionne en jeu, le joueur ne voit PAS son propre bouclier non plus (sauf s'il est révélé)
  }
  // Alchimiste voit ses potions
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
  while (room.deck.length > 0) {
    const c = room.deck.pop();
    if (c.numVal === val) { temp.forEach(x => room.deck.unshift(x)); return c; }
    temp.push(c);
  }
  temp.forEach(x => room.deck.unshift(x));
  return room.deck.length > 0 ? room.deck.pop() : null;
}
function applyDamage(room, target, dmg) {
  // Réinitialiser pour le barde avant chaque calcul
  if (target.heroId === 'barde') target.bardePendingPvValue = undefined;
  let rem = dmg;
  while (rem > 0 && target.pv.length > 0) {
    target.pv.sort((a,b) => a.numVal - b.numVal);
    const w = target.pv[0];
    if (rem >= w.numVal) {
      // Carte entièrement éliminée
      rem -= w.numVal; room.discard.push(w); target.pv.shift();
    } else {
      // Carte partiellement réduite → valeur restante
      const nv = w.numVal - rem; rem = 0;
      room.discard.push(w); target.pv.shift();
      if (target.heroId === 'barde') {
        // Barde choisit sa carte de remplacement dans la défausse
        target.bardePendingPvValue = nv;
      } else {
        const f = findCardOfValue(room, nv);
        if (f) target.pv.push(f);
      }
    }
  }
}
function checkEliminated(room, player) {
  if (totalPV(player) <= 0 && !player.eliminated) {
    player.eliminated = true;
    player.pv.forEach(c => room.discard.push(c));
    player.charges.forEach(c => room.discard.push(c));
    // Nécromancien : bouclier défaussé en dernier
    if (player.shield) room.discard.push(player.shield);
    player.pv = []; player.charges = [];
    io.to(room.code).emit('player_eliminated', { playerId:player.id, playerName:player.name });
    // Option Meurtre : le joueur actif gagne une action bonus
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
    room.players.forEach(p => {
      p.pv=[]; p.shield=null; p.charges=[]; p.drawnCard=null; p.eliminated=false;
      p.heroId=null; p.heroName=null; p.heroEmoji=null; p.heroChosen=false;
      p.heroChoices=[]; p.potions=[]; p.woundMarkers={};
      p.bardeChoices=null; p.pendingDraw=null; p.pendingAction=null;
      p.mageTransform=false; p.bonusAction=false;
      p.potionInvis=false; p.potionFeu=false; p.potionFeuTarget2=null;
    });
    // Délai : laisser reveal(2s) + anim(0.8s) + popup(3.2s) se jouer = 6s
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
    }, 16000); // 6s + 3s victoire + 7s marge
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
  if (cards.length === 0) return false;
  // Joker compte comme toutes les couleurs
  const nonJoker = cards.filter(c => c.suit !== '🃏');
  if (nonJoker.length === 0) return true; // que des jokers
  const isRed = c => ['♥','♦'].includes(c.suit);
  return nonJoker.every(isRed) || nonJoker.every(c => !isRed(c));
}
function bardeSymbolSame(p) {
  const cards = [...p.pv, p.shield].filter(Boolean);
  if (cards.length === 0) return false;
  // Joker compte comme tous les symboles
  const nonJoker = cards.filter(c => c.suit !== '🃏');
  if (nonJoker.length === 0) return true; // que des jokers
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

// ════════ TURN ════════
function startTurn(room) {
  const player = room.players[room.turnIdx];
  if (!player || player.eliminated) { nextAliveTurn(room); startTurn(room); return; }
  broadcastState(room);
  const mustAttack = player.charges.length > 0 && player.heroId !== 'guerriere';

  // Clairvoyance : si exactement 1 PV (une seule carte PV de valeur 1) ou totalPV = 1
  const clairvoyant = room.optClairvoyance && totalPV(player) === 1;
  const topCard = clairvoyant && room.deck.length > 0 ? room.deck[room.deck.length-1] : null;

  const ps = io.sockets.sockets.get(player.id);
  if (ps) ps.emit('choose_action', {
    deckCount:room.deck.length,
    discardTop:room.discard.length>0 ? room.discard[room.discard.length-1] : null,
    mustAttack,
    canUsePotion:player.heroId==='alchimiste' && player.potions?.some(p=>!p.used),
    potions:player.heroId==='alchimiste' ? player.potions : null,
    clairvoyantCard: topCard, // Carte du dessus visible si clairvoyant
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
      // Options de jeu
      optMeurtre: false,      // Tuer un joueur → action bonus
      optClairvoyance: false, // 1 PV → voir première carte pioche
      optDragon: false,       // Pioche vide → chaque joueur subit une attaque
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

  // Abandon hôte — ferme la partie et renvoie tout le monde au lobby
  socket.on('abandon_game', ({ code }) => {
    const room = rooms[code];
    if (!room || room.host!==socket.id || room.status!=='playing') return;
    room.status = 'lobby';
    room.players.forEach(p => {
      p.pv=[]; p.shield=null; p.charges=[]; p.drawnCard=null; p.eliminated=false;
      p.heroId=null; p.heroName=null; p.heroEmoji=null; p.heroChosen=false;
      p.heroChoices=[]; p.potions=[]; p.woundMarkers={};
      p.bardeChoices=null; p.pendingDraw=null; p.pendingAction=null;
      p.mageTransform=false; p.bonusAction=false;
      p.potionInvis=false; p.potionFeu=false; p.potionFeuTarget2=null;
    });
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
    if (!player || player.heroChosen) return;
    const hero = player.heroChoices.find(h=>h.id===heroId);
    if (!hero) { socket.emit('err',{msg:'Héros invalide'}); return; }
    player.heroId=hero.id; player.heroName=hero.name; player.heroEmoji=hero.emoji; player.heroChosen=true;
    socket.emit('hero_chosen', { hero });
    io.to(code).emit('hero_pick_update', { playerId:player.id, playerName:player.name, heroEmoji:hero.emoji, heroName:hero.name, allChosen:room.players.every(p=>p.heroChosen) });
    if (room.players.every(p=>p.heroChosen)) setTimeout(()=>launchGame(room), 1000);
  });

  socket.on('action', ({ code, type, targetId, extra }) => {
    const room = rooms[code];
    if (!room || room.status!=='playing') return;
    const actor = room.players[room.turnIdx];
    if (!actor || actor.id!==socket.id) { socket.emit('err',{msg:"Ce n'est pas votre tour !"}); return; }
    if (actor.charges.length>0 && actor.heroId!=='guerriere' && type!=='attack') {
      socket.emit('err',{msg:'Vous devez attaquer avec votre charge !'}); return;
    }
    const target = targetId ? room.players.find(p=>p.id===targetId) : null;

    // Nécromancien : proposer le choix défausse avant de continuer
    if (actor.heroId==='necromancien' && type!=='necro_discard' && room.discard.length>0) {
      const lastDiscard = room.discard[room.discard.length-1];
      actor.pendingAction=type; actor.pendingTargetId=targetId; actor.pendingExtra=extra;
      const ps=io.sockets.sockets.get(actor.id);
      if (ps) ps.emit('necro_choose',{lastDiscard, type, targetId});
      return;
    }

    // Barde multiple draw — s'applique aussi en charge
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
    actor.drawnCard = drawn;

    if (type==='charge') {
      // Barde : seul lui voit sa carte de charge
      if (actor.heroId==='barde') {
        const ps=io.sockets.sockets.get(actor.id);
        if (ps) ps.emit('card_reveal',{card:drawn,chargeCard:null,actorName:actor.name,actionLabel:'⚡ Se charge (vous voyez votre charge)',isCharge:false});
        // Les autres voient juste un dos
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
      const espionneInGame = hasEspionne(room);
      // Espionne qui change un bouclier → carte cachée (dos) pour tout le monde
      const espionneHiding = actor.heroId==='espionne' && type==='shield_swap';
      io.to(room.code).emit('card_reveal', {
        card: espionneHiding ? null : drawn,
        chargeCard, actorName:actor.name,
        actionLabel:actionLabel(type, target?target.name:''),
        isCharge: espionneHiding ? true : false, // true = affiche dos de carte
        targetShieldHidden: espionneInGame && target && target.heroId!=='espionne',
      });
    }

    // Mage intercept — As ou Roi sur TOUTE action par N'IMPORTE QUI (même le mage lui-même)
    const mage = room.players.find(p => p.heroId==='mage' && !p.eliminated);
    if (mage && (drawn.numVal===1 || drawn.numVal===13)) {
      actor.pendingDraw=drawn; actor.pendingAction=type; actor.pendingTargetId=targetId; actor.pendingExtra=extra;
      // Broadcast "en attente du mage"
      room.waitingFor = { playerId:mage.id, playerName:mage.name, heroEmoji:'🔮', reason:'fait son choix…' };
      io.to(room.code).emit('waiting_for', room.waitingFor);
      const ms = io.sockets.sockets.get(mage.id);
      if (ms) ms.emit('mage_can_transform', { card:drawn, actorName:actor.name, targetName:target?target.name:'', actionType:type });
      actor.mageTimer = setTimeout(() => {
        if (actor.pendingDraw) {
          actor.mageTransform = false;
          room.waitingFor = null;
          io.to(room.code).emit('waiting_for', null);
          io.to(room.code).emit('mage_timer_expired'); // fermer popup côté client
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

  // Nécromancien choisit d'utiliser la défausse ou la pioche
  socket.on('necro_use_discard', ({ code }) => {
    const room = rooms[code]; if (!room) return;
    const actor = room.players[room.turnIdx];
    if (!actor || actor.id!==socket.id || actor.heroId!=='necromancien') return;
    if (room.discard.length===0) { socket.emit('err',{msg:'Défausse vide !'}); return; }
    const type=actor.pendingAction, targetId=actor.pendingTargetId, extra=actor.pendingExtra;
    actor.pendingAction=null; actor.pendingTargetId=null; actor.pendingExtra=null;
    // Prendre la dernière carte de la défausse
    const drawn = room.discard.pop();
    actor.drawnCard = drawn;
    const target = targetId ? room.players.find(p=>p.id===targetId) : null;
    const chargeCard = actor.charges.length>0 ? actor.charges[0] : null;
    // Révéler la carte
    if (type==='charge') {
      // Charge nécro : dos pour les autres, vraie carte pour lui
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
    // Annoncer le choix à tout le monde
    const card = actor.pendingDraw;
    if (transform) {
      const newVal = card.numVal===1?13:1;
      io.to(room.code).emit('action_popup',{emoji:'🔮',main:`${mage.name} transforme la carte !`,detail:`${card.display}${card.suit} devient ${newVal===13?'K':'A'}${card.suit}`,result:`${card.numVal} → ${newVal}`,'resultType':'neutral'});
    } else {
      io.to(room.code).emit('action_popup',{emoji:'🔮',main:`${mage.name} ne transforme pas`,detail:`${card.display}${card.suit} reste inchangé`,result:null,resultType:null});
    }
    const drawn=actor.pendingDraw, type=actor.pendingAction, targetId=actor.pendingTargetId, extra=actor.pendingExtra;
    actor.pendingDraw=null; actor.pendingAction=null; actor.pendingTargetId=null;
    // Délai pour laisser le popup du choix s'afficher avant de continuer
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
    const chosen = actor.bardeChoices[cardIndex];
    actor.bardeChoices.forEach((c,i) => { if (i!==cardIndex) room.discard.push(c); });
    const type=actor.bardeAction, targetId=actor.bardeTargetId, extra=actor.bardeExtra;
    actor.bardeChoices=null; actor.drawnCard=chosen;
    const target = targetId ? room.players.find(p=>p.id===targetId) : null;
    const chargeCard = actor.charges.length>0 ? actor.charges[0] : null;

    if (type==='charge') {
      // Barde charge : seul lui voit la carte
      io.sockets.sockets.get(actor.id)?.emit('card_reveal',{card:chosen,chargeCard:null,actorName:actor.name,actionLabel:'⚡ Se charge (vous voyez votre charge)',isCharge:false});
      room.players.forEach(p=>{
        if(p.id===actor.id||p.eliminated) return;
        io.sockets.sockets.get(p.id)?.emit('card_reveal',{card:null,chargeCard:null,actorName:actor.name,actionLabel:'⚡ Se charge',isCharge:true});
      });
    } else {
      io.to(room.code).emit('card_reveal', { card:chosen, chargeCard, actorName:actor.name, actionLabel:actionLabel(type, target?target.name:''), isCharge:false });
    }
    setTimeout(()=>handleAction(room, actor, type, targetId, chosen, extra), 300);
  });

  // Barde choisit sa carte PV dans la défausse
  socket.on('barde_pv_pick', ({ code, cardIndex }) => {
    const room = rooms[code]; if (!room) return;
    const barde = room.players.find(p=>p.id===socket.id);
    if (!barde || !barde.bardePvChoices) return;
    const chosen = barde.bardePvChoices[cardIndex];
    // Retirer la carte choisie de la défausse
    const discardIdx = room.discard.findIndex(c => c.suit===chosen.suit && c.numVal===chosen.numVal && c.display===chosen.display);
    if (discardIdx !== -1) room.discard.splice(discardIdx, 1);
    barde.bardePvChoices = null;
    barde.pv.push(chosen);
    room.waitingFor = null;
    io.to(room.code).emit('waiting_for', null);
    broadcastPopup(room,'🎵',`${barde.name} choisit sa carte PV`,`${cStr(chosen)} (${chosen.numVal} PV) depuis la défausse`,null,'neutral');
    broadcastState(room);
    // Reprendre le tour normalement
    const actor = barde.bardePvSuspendedActor || room.players[room.turnIdx];
    barde.bardePvSuspendedActor = null;
    nextAliveTurn(room);
    broadcastState(room);
    setTimeout(()=>startTurn(room), 5500);
  });

  socket.on('voleuse_exchange', ({ code, myType, myIdx, theirType, theirIdx, targetId }) => {
    const room = rooms[code]; if (!room) return;
    const actor=room.players.find(p=>p.id===socket.id), target=room.players.find(p=>p.id===targetId);
    if (!actor||!target) return;
    const myCard=myType==='shield'?actor.shield:actor.pv[myIdx];
    const theirCard=theirType==='shield'?target.shield:target.pv[theirIdx||0];
    if (!myCard||!theirCard) return;
    if (myType==='shield') actor.shield=theirCard; else actor.pv[myIdx]=theirCard;
    if (theirType==='shield') target.shield=myCard; else target.pv[theirIdx||0]=myCard;
    room.waitingFor = null;
    io.to(room.code).emit('waiting_for', null);
    broadcastPopup(room,'🗡️',`${actor.name} échange avec ${target.name}`,`échange de cartes`,null,'neutral');
    broadcastState(room);

    const paladinTargetId = actor.pendingPaladinTarget;
    const bardeTargetId = actor.pendingBardeTarget;
    actor.pendingPaladinTarget = null;
    actor.pendingBardeTarget = null;

    // Barde d'abord si en attente
    if (bardeTargetId) {
      const bardePlayer = room.players.find(p=>p.id===bardeTargetId&&!p.eliminated);
      if (bardePlayer && room.discard.length>0) {
        const discardChoices = room.discard.splice(-Math.min(3, room.discard.length));
        bardePlayer.bardePvChoices = discardChoices;
        room.waitingFor = { playerId:bardePlayer.id, playerName:bardePlayer.name, heroEmoji:'🎵', reason:'choisit sa nouvelle carte PV…' };
        io.to(room.code).emit('waiting_for', room.waitingFor);
        const bs = io.sockets.sockets.get(bardePlayer.id);
        if (bs) bs.emit('barde_pv_prompt', { choices:discardChoices, paladinPending:!!paladinTargetId, actorId:actor.id });
        return;
      }
    }

    // Paladin après voleuse (et barde si applicable)
    if (paladinTargetId) {
      const paladinPlayer = room.players.find(p=>p.id===paladinTargetId&&!p.eliminated);
      if (paladinPlayer && totalPV(paladinPlayer)>0) {
        launchPaladinRiposte(room, paladinPlayer, actor);
        return;
      }
    }

    nextAliveTurn(room); broadcastState(room); setTimeout(()=>startTurn(room),5500);
  });

  socket.on('potion_feu_target2', ({ code, target2Id }) => {
    const room = rooms[code]; if (!room) return;
    const actor = room.players[room.turnIdx];
    if (!actor||actor.id!==socket.id||!actor.pendingDraw) return;
    actor.potionFeuTarget2 = target2Id;
    const drawn=actor.pendingDraw, type=actor.pendingAction, targetId=actor.pendingTargetId;
    actor.pendingDraw=null; actor.pendingAction=null; actor.pendingTargetId=null;
    // Révéler la carte pour tout le monde maintenant
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
      // Potion feu : pas de 2e cible à l'activation, on la choisit pendant l'attaque
      actor.potionFeu=true; actor.potionFeuTarget2=null;
      broadcastPopup(room,'🔥',`${actor.name} prépare une Potion de Feu !`,'Sa prochaine attaque touchera une 2e cible.',null,null);
    }
    broadcastState(room);
    const ps = io.sockets.sockets.get(actor.id);
    if (ps) ps.emit('choose_action', { deckCount:room.deck.length, discardTop:room.discard.length>0?room.discard[room.discard.length-1]:null, mustAttack, canUsePotion:actor.potions.some(p=>!p.used), potions:actor.potions });
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
    // Bouclier révélé au départ si pas d'espionne (géré dynamiquement dans publicState)
    p.shieldRevealed = false; // sera mis à true si le joueur perd des PV
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

  // Appliquer transformation Mage sur toute action
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
      // Stocker l'action en attente et demander la 2e cible au joueur
      actor.pendingDraw=drawn; actor.pendingAction=type; actor.pendingTargetId=targetId;
      const ps=io.sockets.sockets.get(actor.id);
      const others=room.players.filter(p=>!p.eliminated&&p.id!==actor.id&&p.id!==targetId);
      if (ps && others.length>0) {
        ps.emit('potion_feu_pick_target2',{
          target1:{id:target.id,name:target.name},
          others:others.map(p=>({id:p.id,name:p.name,shieldVal:p.shieldHidden?'?':getShieldVal(p)}))
        });
        return; // attendre la 2e cible
      } else {
        // Personne d'autre → attaque uniquement la 1ère cible
        actor.potionFeu=false;
      }
    }

    let atkVal = drawn.numVal, chargeUsed = null;

    // Charges
    if (actor.heroId==='guerriere') {
      actor.charges.forEach(c=>{atkVal+=c.numVal; room.discard.push(c);});
      chargeUsed=actor.charges[0]||null; actor.charges=[];
    } else if (actor.charges.length>0) {
      atkVal+=actor.charges[0].numVal; chargeUsed=actor.charges[0];
      room.discard.push(actor.charges[0]); actor.charges=[];
    }

    // Bête marqueurs
    if (actor.heroId==='bete') {
      const wounds = actor.woundMarkers[targetId]||0;
      atkVal += wounds*3;
    }

    const shieldVal = getShieldVal(target);
    const isOgreKill = actor.heroId==='ogre' && atkVal===shieldVal;
    // Bouclier caché par défaut si espionne en jeu et pas encore révélé
    const shieldHiddenNow = espionneInGame && !target.shieldRevealed && target.heroId !== 'espionne';
    const shieldDisplay = shieldHiddenNow ? '?' : shieldVal;

    if (!isOgreKill && atkVal<=shieldVal) {
      // Bloqué — bouclier reste caché
      broadcastPopup(room,'🛡️',`${actor.name} attaque ${target.name}`,
        `${cStr(drawn)}${chargeUsed?` + ⚡${cStr(chargeUsed)}`:''} (${atkVal}) contre bouclier ${shieldDisplay}`,
        'Bloqué !','block');
    } else {
      const dmg = isOgreKill ? totalPV(target) : atkVal-shieldVal;
      const pvBefore=totalPV(target);
      applyDamage(room, target, dmg);
      const pvAfter=totalPV(target), didDamage=pvAfter<pvBefore;

      // Révéler bouclier si perd des PV — AVANT le popup pour que la valeur soit visible
      if (didDamage && espionneInGame) target.shieldRevealed = true;

      // Bête : info dégâts bonus
      const woundBonus = actor.heroId==='bete' ? (actor.woundMarkers[targetId]||0)*3 : 0;
      const detailExtra = woundBonus>0 ? ` (+${woundBonus} 🐾)` : '';

      // Si dégâts : bouclier maintenant révélé → afficher la vraie valeur
      const shieldDisplayAfter = didDamage ? shieldVal : shieldDisplay;

      broadcastPopup(room,'⚔️',`${actor.name} attaque ${target.name}`,
        `${cStr(drawn)}${chargeUsed?` + ⚡${cStr(chargeUsed)}`:''} (${atkVal}${detailExtra}) contre bouclier ${shieldDisplayAfter}${isOgreKill?' — Ogre !':''}`,
        `−${dmg} PV → ${pvAfter} PV restants`,'dmg');

      if (didDamage && target.charges.length>0) { target.charges.forEach(c=>room.discard.push(c)); target.charges=[]; }

      // Bête marqueur
      if (actor.heroId==='bete' && didDamage && !target.eliminated) {
        if (!actor.woundMarkers) actor.woundMarkers={};
        actor.woundMarkers[targetId]=(actor.woundMarkers[targetId]||0)+1;
      }

      // Barde : si perd des PV partiellement, choisit dans la défausse la carte exacte
      if (target.heroId==='barde' && didDamage && !target.eliminated && target.bardePendingPvValue !== undefined) {
        const nv = target.bardePendingPvValue;
        target.bardePendingPvValue = undefined;
        const discardMatches = room.discard.filter(c => c.numVal === nv);
        if (discardMatches.length > 0) {
          // Barde choisit — suspendre finishTurn jusqu'au choix
          target.bardePvChoices = discardMatches;
          target.bardePvSuspendedActor = actor; // pour relancer le tour après
          room.waitingFor = { playerId:target.id, playerName:target.name, heroEmoji:'🎵', reason:`choisit une carte de ${nv} PV…` };
          io.to(room.code).emit('waiting_for', room.waitingFor);
          io.to(room.code).emit('hero_action_announce',{emoji:'🎵',text:`${target.name} (Barde) choisit sa carte de ${nv} PV`});
          const bs = io.sockets.sockets.get(target.id);
          if (bs) bs.emit('barde_pv_prompt', { choices:discardMatches, pvValue:nv });
          // NE PAS appeler finishTurn ici — barde_pv_pick s'en charge
          room.discard.push(drawn); actor.drawnCard=null;
          broadcastState(room);
          return; // sortir sans finishTurn
        } else {
          // Pas dans la défausse → findCardOfValue cherche valeur exacte
          const fromPioche = findCardOfValue(room, nv);
          if (fromPioche) {
            target.pv.push(fromPioche);
            broadcastPopup(room,'🎵',`${target.name} (Barde)`,`Aucun ${nv} en défausse — carte aléatoire de la pioche`,null,'neutral');
          }
          // Pas de carte trouvée → le barde garde ses PV actuels (pas de remplacement)
        }
      }

      // Potion feu 2e cible
      if (actor.potionFeu && actor.potionFeuTarget2) {
        const t2=room.players.find(p=>p.id===actor.potionFeuTarget2&&!p.eliminated);
        if (t2 && t2.id!==targetId) {
          const sv2=getShieldVal(t2);
          if (atkVal>sv2) {
            const dmg2=atkVal-sv2;
            const pv2Before=totalPV(t2);
            applyDamage(room,t2,dmg2);
            const pv2After=totalPV(t2);
            if (pv2After<pv2Before) { if(t2.charges.length>0){t2.charges.forEach(c=>room.discard.push(c));t2.charges=[];} if(espionneInGame)t2.shieldRevealed=true; }
            broadcastPopup(room,'🔥',`Potion de Feu — ${t2.name} aussi !`,`${cStr(drawn)} (${atkVal}) contre bouclier ${espionneInGame&&!t2.shieldRevealed?'?':sv2}`,`−${dmg2} PV → ${pv2After} PV`,'dmg');
            checkEliminated(room,t2);
          } else {
            broadcastPopup(room,'🔥🛡️',`Potion de Feu — ${t2.name} bloque !`,`${cStr(drawn)} (${atkVal}) contre bouclier ${espionneInGame?'?':sv2}`,'Bloqué !','block');
          }
        }
        actor.potionFeu=false; actor.potionFeuTarget2=null;
      }

      checkEliminated(room, target);
      if (checkGameOver(room)) { room.discard.push(drawn); actor.drawnCard=null; return; }

      // ══ PRIORITÉ : L'ATTAQUANT AGIT EN PREMIER ══
      // 1. Voleuse (attaquant) → échange en premier
      // 2. Démoniste a déjà agi avant d'arriver ici
      // 3. Puis le défenseur : Paladin riposte, Barde choisit PV
      // La règle : tous les pouvoirs de l'attaquant se déclenchent avant ceux du défenseur

      const paladinPending = target.heroId==='paladin' && !target.eliminated && totalPV(target)>0 && didDamage;
      const bardePending = target.heroId==='barde' && didDamage && !target.eliminated && room.discard.length>0;

      if (actor.heroId==='voleuse' && !target.eliminated) {
        // Voleuse agit EN PREMIER
        room.waitingFor = { playerId:actor.id, playerName:actor.name, heroEmoji:'🗡️', reason:'choisit sa carte à échanger…' };
        io.to(room.code).emit('waiting_for', room.waitingFor);
        io.to(room.code).emit('hero_action_announce',{emoji:'🗡️',text:`${actor.name} (Voleuse) va échanger une carte avec ${target.name}`});
        const ps=io.sockets.sockets.get(actor.id);
        if (ps) ps.emit('voleuse_prompt',{targetId:target.id,targetName:target.name,targetPV:target.pv,targetShield:target.shield,myPV:actor.pv,myShield:actor.shield});
        // Stocker les actions défenseur à déclencher après
        actor.pendingPaladinTarget = paladinPending ? target.id : null;
        actor.pendingBardeTarget = bardePending ? target.id : null;
        room.discard.push(drawn); actor.drawnCard=null;
        broadcastState(room);
        return;
      }

      // Barde défenseur : choisit sa PV (si pas de voleuse)
      if (bardePending) {
        const discardChoices = room.discard.splice(-Math.min(3, room.discard.length));
        target.bardePvChoices = discardChoices;
        room.waitingFor = { playerId:target.id, playerName:target.name, heroEmoji:'🎵', reason:'choisit sa nouvelle carte PV…' };
        io.to(room.code).emit('waiting_for', room.waitingFor);
        io.to(room.code).emit('hero_action_announce',{emoji:'🎵',text:`${target.name} (Barde) choisit sa nouvelle carte PV`});
        const bs = io.sockets.sockets.get(target.id);
        if (bs) bs.emit('barde_pv_prompt', { choices:discardChoices, paladinPending, actorId:actor.id });
        room.discard.push(drawn); actor.drawnCard=null;
        broadcastState(room);
        return;
      }

      // Paladin défenseur riposte (si pas de voleuse ni barde)
      if (paladinPending) {
        launchPaladinRiposte(room, target, actor);
        room.discard.push(drawn); actor.drawnCard=null;
        broadcastState(room);
        return;
      }
    }
    room.discard.push(drawn); actor.drawnCard=null;

  } else if (aType==='shield_swap') {
    if (!target||target.eliminated) { notifyErr(actor,'Cible invalide !'); return; }
    const old=target.shield;
    const wasHidden = espionneInGame && !target.shieldRevealed && target.heroId !== 'espionne';
    room.discard.push(old); target.shield=drawn; actor.drawnCard=null;

    if (actor.heroId==='espionne') {
      // Espionne change → nouveau bouclier CACHÉ pour tout le monde sauf elle
      target.shieldRevealed = false;
    } else {
      // Quelqu'un d'autre change → nouveau bouclier RÉVÉLÉ (même si était caché)
      target.shieldRevealed = true;
    }

    const shieldTitle = target.id===actor.id ? `${actor.name} change son bouclier` : `${actor.name} change le bouclier de ${target.name}`;

    if (actor.heroId==='espionne') {
      // Pour tout le monde : carte cachée
      const publicDetail = `bouclier de ${target.name} changé (caché)`;
      room.players.forEach(p => {
        if (p.eliminated) return;
        const s = io.sockets.sockets.get(p.id);
        if (!s) return;
        if (p.heroId === 'espionne') {
          // L'espionne voit la vraie valeur
          s.emit('action_popup',{emoji:'🛡️',main:shieldTitle,detail:`${cStr(old)} → ${cStr(drawn)} (caché pour les autres)`,result:null,resultType:'neutral'});
        } else {
          s.emit('action_popup',{emoji:'🛡️',main:shieldTitle,detail:publicDetail,result:null,resultType:'neutral'});
        }
      });
    } else {
      // Quelqu'un d'autre : tout le monde voit
      const shieldDetail = wasHidden
        ? `${cStr(old)} (révélé) → ${cStr(drawn)}`
        : `${cStr(old)} → ${cStr(drawn)}`;
      broadcastPopup(room,'🛡️', shieldTitle, shieldDetail, null, 'neutral');
    }

  } else if (aType==='charge') {
    if (actor.heroId!=='guerriere'&&actor.charges.length>0) { notifyErr(actor,'Vous avez déjà une charge !'); return; }
    actor.charges.push(drawn); actor.drawnCard=null;
    broadcastPopup(room,'⚡',`${actor.name} se charge`,'Carte cachée',`${actor.charges.length} charge${actor.charges.length>1?'s':''}`, 'neutral');

  } else if (aType==='heal_pv') {
    const pvIdx=extra?.pvIdx||0;
    if (!actor.pv[pvIdx]) { notifyErr(actor,'Carte PV invalide'); return; }
    const old=actor.pv[pvIdx]; room.discard.push(old); actor.pv[pvIdx]=drawn; actor.drawnCard=null;
    broadcastPopup(room,'✨',`${actor.name} soigne ses PV`,`${cStr(old)} → ${cStr(drawn)}`,`${old.numVal} → ${drawn.numVal}`,'neutral');

  } else { notifyErr(actor,'Action inconnue'); return; }

  finishTurn(room, actor);
}

function launchPaladinRiposte(room, paladin, victim) {
  const rc1=drawCard(room), rc2=drawCard(room);
  const rsv=getShieldVal(victim);
  io.to(room.code).emit('hero_action_announce',{emoji:'🛡️⚔️',text:`${paladin.name} (Paladin) contre-attaque !`});
  setTimeout(()=>{
    io.to(room.code).emit('card_reveal',{ card:rc1, chargeCard:null, actorName:paladin.name, actionLabel:`🛡️⚔️ Riposte 1 sur ${victim.name}`, isCharge:false });
    setTimeout(()=>{
      const dmg1=rc1.numVal>rsv?rc1.numVal-rsv:0;
      if(dmg1>0){ applyDamage(room,victim,dmg1); if(victim.charges.length>0){victim.charges.forEach(c=>room.discard.push(c));victim.charges=[];} }
      room.discard.push(rc1);
      io.to(room.code).emit('action_popup',{emoji:'🛡️⚔️',main:`${paladin.name} riposte (1/2)`,detail:`${cStr(rc1)} (${rc1.numVal}) contre bouclier ${rsv}`,result:dmg1>0?`−${dmg1} PV`:null,resultType:dmg1>0?'dmg':'block'});
      setTimeout(()=>{
        io.to(room.code).emit('card_reveal',{ card:rc2, chargeCard:null, actorName:paladin.name, actionLabel:`🛡️⚔️ Riposte 2 sur ${victim.name}`, isCharge:false });
        setTimeout(()=>{
          const dmg2=rc2.numVal>rsv?rc2.numVal-rsv:0;
          if(dmg2>0){ applyDamage(room,victim,dmg2); if(victim.charges.length>0){victim.charges.forEach(c=>room.discard.push(c));victim.charges=[];} }
          room.discard.push(rc2);
          io.to(room.code).emit('action_popup',{emoji:'🛡️⚔️',main:`${paladin.name} riposte (2/2)`,detail:`${cStr(rc2)} (${rc2.numVal}) contre bouclier ${rsv}`,result:dmg2>0?`−${dmg2} PV`:null,resultType:dmg2>0?'dmg':'block'});
          checkEliminated(room,victim);
          if(!checkGameOver(room)){ broadcastState(room); setTimeout(()=>startTurn(room),5500); }
        },2000);
      },5500);
    },2000);
  },5500);
}

function finishTurn(room, actor) {
  if (actor.bonusAction) {
    actor.bonusAction=false; broadcastState(room);
    const ps=io.sockets.sockets.get(actor.id);
    const mustAttack=actor.charges.length>0&&actor.heroId!=='guerriere';
    if (ps) ps.emit('choose_action',{deckCount:room.deck.length,discardTop:room.discard.length>0?room.discard[room.discard.length-1]:null,mustAttack,canUsePotion:false,potions:actor.potions,isBonus:true});
    return;
  }
  // Dragon : se déclenche APRÈS le tour
  if (room.dragonPending) {
    room.dragonPending = false;
    broadcastState(room);
    io.to(room.code).emit('action_popup',{emoji:'🐉',main:'Le Dragon se réveille !',detail:'La pioche était vide — chaque joueur subit une attaque !',result:null,resultType:'neutral'});
    // Dragon gère lui-même nextTurn après ses attaques
    setTimeout(()=>dragonAttack(room), 5500);
    return;
  }
  nextAliveTurn(room); broadcastState(room);
  setTimeout(()=>startTurn(room), 5500);
}

function showToastAll(room, msg) {
  io.to(room.code).emit('show_toast', { msg });
}

function makePlayer(id, name, avatar=null) {
  return { id, name, avatar, wins:0, pv:[], shield:null, charges:[], drawnCard:null, eliminated:false,
    heroId:null, heroName:null, heroEmoji:null, heroChoices:[], heroChosen:false,
    potions:[], woundMarkers:{}, bardePvChoices:null, bardePendingPvValue:undefined, bardePvSuspendedActor:null, shieldRevealed:false,
    pendingPaladinTarget:null, pendingBardeTarget:null,
    bardeChoices:null, bardeAction:null, bardeTargetId:null, bardeExtra:null,
    pendingDraw:null, pendingAction:null, pendingTargetId:null, pendingExtra:null, mageTimer:null,
    mageTransform:false, bonusAction:false,
    potionInvis:false, potionFeu:false, potionFeuTarget2:null,
  };
}

function leaveRoom(socket, code) {
  const room=rooms[code]; if(!room) return;
  room.players=room.players.filter(p=>p.id!==socket.id);
  socket.leave(code);
  if (room.players.length===0) { delete rooms[code]; return; }
  if (room.host===socket.id) room.host=room.players[0].id;
  io.to(code).emit('player_left',{players:lobbyPlayers(room), newHost:room.host});
}

const PORT = process.env.PORT||3000;
server.listen(PORT,()=>{ console.log(`\n🛡️  Le Bouclier — http://localhost:${PORT}\n`); });
