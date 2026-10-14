import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 9811;
const DB_PATH = path.join(__dirname, 'database.json');

// --- ROULETTE CONSTANTS ---
const ROULETTE_REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

// --- DATABASE MANAGEMENT ---
function initDefaultDB() {
  const defaultPockets = {};
  for (let i = 0; i <= 36; i++) defaultPockets[String(i)] = 0;

  const defaultTripleFun = {};
  for (let i = 1; i <= 12; i++) defaultTripleFun[String(i)] = 0;

  return {
    adminMasterPoints: 10000000,
    systemSettings: { defaultStartingPoints: 5000, allowPlayerTransfers: true },
    users: {
      'gk00000001': { playerKey: 'gk00000001', username: 'GK00000001', password: '123456', points: 50000, totalBet: 0, totalWon: 0, isOnline: false, createdAt: new Date().toISOString() },
      'guest_001': { playerKey: 'guest_001', username: 'Guest_001', password: 'password123', points: 15000, totalBet: 0, totalWon: 0, createdAt: new Date().toISOString() },
      'player_vip': { playerKey: 'player_vip', username: 'VIP Member', password: 'secret777', points: 50000, totalBet: 0, totalWon: 0, createdAt: new Date().toISOString() },
      'player_teenpatti': { playerKey: 'player_teenpatti', username: 'LuckyPlayer', password: 'patti123', points: 25000, totalBet: 0, totalWon: 0, createdAt: new Date().toISOString() }
    },
    transactions: [],
    liveBets: {
      funTarget: { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7': 0, '8': 0, '9': 0, total: 0 },
      funRoulette: { total: 0, pockets: defaultPockets, outside: { red: 0, black: 0, even: 0, odd: 0, low: 0, high: 0, d1: 0, d2: 0, d3: 0 } },
      tripleFun: { slots: defaultTripleFun, total: 0 },
      sevenUpDown: { '7down': 0, 'lucky7': 0, '7up': 0, total: 0 },
      aviator: []
    },
    gameResults: {
      aviator: { roundId: 101, phase: 'waiting', multiplier: 1.0, nextCrashMultiplier: null, countdown: 5 },
      funTarget: { roundId: 201, nextWinningNumber: null, lastResult: 7, countdown: 35 },
      funRoulette: { roundId: 301, nextWinningNumber: null, lastResult: 17, countdown: 40 },
      tripleFun: { roundId: 501, nextWinningNumber: null, lastResult: 9, countdown: 45 },
      sevenUpDown: { roundId: 401, nextDiceTotal: null, lastResult: '7 Up (9)', countdown: 30 }
    }
  };
}

function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      if (!parsed.adminMasterPoints) parsed.adminMasterPoints = 10000000;
      if (!parsed.liveBets) parsed.liveBets = {};
      if (!parsed.liveBets.funTarget) parsed.liveBets.funTarget = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7': 0, '8': 0, '9': 0, total: 0 };
      
      // Ensure roulette pockets 0-36
      if (!parsed.liveBets.funRoulette || !parsed.liveBets.funRoulette.pockets) {
        const pockets = {};
        for (let i = 0; i <= 36; i++) pockets[String(i)] = 0;
        parsed.liveBets.funRoulette = { total: 0, pockets, outside: { red: 0, black: 0, even: 0, odd: 0, low: 0, high: 0, d1: 0, d2: 0, d3: 0 } };
      }

      // Ensure Triple Fun / FunRep slots 1-12
      if (!parsed.liveBets.tripleFun || !parsed.liveBets.tripleFun.slots) {
        const slots = {};
        for (let i = 1; i <= 12; i++) slots[String(i)] = 0;
        parsed.liveBets.tripleFun = { slots, total: 0 };
      }

      // Ensure 7 Up Down
      if (!parsed.liveBets.sevenUpDown) {
        parsed.liveBets.sevenUpDown = { '7down': 0, 'lucky7': 0, '7up': 0, total: 0 };
      }

      // Ensure Aviator
      if (!parsed.liveBets.aviator) parsed.liveBets.aviator = [];

      // Ensure gameResults
      if (!parsed.gameResults) parsed.gameResults = {};
      if (!parsed.gameResults.tripleFun) parsed.gameResults.tripleFun = { roundId: 501, nextWinningNumber: null, lastResult: 7, countdown: 45 };

      return parsed;
    }
  } catch (err) {
    console.error('[DB Read Error]', err.message);
  }
  return initDefaultDB();
}

function saveDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[DB Save Error]', err.message);
  }
}

let db = loadDB();
saveDB(db);

// Helper: Create player with username & password
function createPlayerAccount(playerKey, username, password, initialPoints = 5000) {
  playerKey = playerKey.trim().toLowerCase();
  if (db.users[playerKey]) {
    return { success: false, message: 'Player ID already exists!' };
  }
  initialPoints = parseInt(initialPoints, 10) || 0;
  db.users[playerKey] = {
    playerKey,
    username: username || playerKey,
    password: password || '123456',
    points: initialPoints,
    totalBet: 0,
    totalWon: 0,
    status: 'active',
    isOnline: false,
    lastSeen: null,
    lastIp: null,
    lastSeenTimestamp: 0,
    createdAt: new Date().toISOString()
  };

  if (initialPoints > 0) {
    db.adminMasterPoints -= initialPoints;
    db.transactions.unshift({
      id: 'tx_' + Date.now(),
      type: 'account_created',
      sender: 'ADMIN',
      receiver: playerKey,
      amount: initialPoints,
      balanceAfter: initialPoints,
      timestamp: new Date().toISOString(),
      note: 'Account creation with initial points'
    });
  }
  saveDB(db);
  return { success: true, user: db.users[playerKey] };
}

// Helper: Track player active presence & client IP
function markUserActive(user, req) {
  if (!user) return;
  const now = Date.now();
  user.isOnline = true;
  user.lastSeen = new Date().toISOString();
  user.lastSeenTimestamp = now;
  let clientIp = '127.0.0.1';
  if (req && req.headers) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      clientIp = forwarded.split(',')[0].trim();
    } else if (req.socket && req.socket.remoteAddress) {
      clientIp = req.socket.remoteAddress;
    }
  }
  user.lastIp = clientIp.replace(/^::ffff:/, '');
}

// Helper: Recall points from player back to Admin
function recallPoints(playerKey, amount = null) {
  const user = db.users[playerKey];
  if (!user) return { success: false, message: 'User not found' };

  const recallAmt = amount === null ? user.points : Math.min(user.points, parseInt(amount, 10));
  if (recallAmt <= 0) return { success: false, message: 'Player has no points to recall' };

  user.points -= recallAmt;
  db.adminMasterPoints += recallAmt;

  const tx = {
    id: 'tx_' + Date.now(),
    type: 'admin_recall',
    sender: playerKey,
    receiver: 'ADMIN_VAULT',
    amount: recallAmt,
    balanceAfter: user.points,
    timestamp: new Date().toISOString(),
    note: `Admin recalled ${recallAmt} points back to vault`
  };
  db.transactions.unshift(tx);
  if (db.transactions.length > 500) db.transactions.pop();
  saveDB(db);

  return { success: true, user, recalledAmount: recallAmt };
}

// Helper: Transfer points
function transferPoints(senderKey, receiverKey, amount, note = 'Transfer') {
  amount = parseInt(amount, 10);
  if (isNaN(amount) || amount <= 0) return { success: false, message: 'Invalid amount' };

  const sender = db.users[senderKey] || (senderKey === 'ADMIN' ? { points: db.adminMasterPoints } : null);
  const receiver = db.users[receiverKey] || (receiverKey === 'ADMIN' ? { points: db.adminMasterPoints } : null);

  if (!sender || !receiver) return { success: false, message: 'Sender or receiver does not exist' };
  if (sender.points < amount) return { success: false, message: 'Insufficient points in balance' };

  sender.points -= amount;
  receiver.points += amount;

  if (senderKey === 'ADMIN') db.adminMasterPoints = sender.points;
  if (receiverKey === 'ADMIN') db.adminMasterPoints = receiver.points;

  const tx = {
    id: 'tx_' + Date.now(),
    type: senderKey === 'ADMIN' ? 'admin_credit' : 'player_transfer',
    sender: senderKey,
    receiver: receiverKey,
    amount,
    balanceAfterSender: sender.points,
    balanceAfterReceiver: receiver.points,
    timestamp: new Date().toISOString(),
    note
  };
  db.transactions.unshift(tx);
  if (db.transactions.length > 500) db.transactions.pop();
  saveDB(db);

  return { success: true, tx, sender, receiver };
}

// Helper: Reset round bets
function resetBets(game) {
  if (game === 'funTarget') {
    db.liveBets.funTarget = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7': 0, '8': 0, '9': 0, total: 0 };
  } else if (game === 'funRoulette') {
    const pockets = {};
    for (let i = 0; i <= 36; i++) pockets[String(i)] = 0;
    db.liveBets.funRoulette = { total: 0, pockets, outside: { red: 0, black: 0, even: 0, odd: 0, low: 0, high: 0, d1: 0, d2: 0, d3: 0 } };
  } else if (game === 'tripleFun') {
    const slots = {};
    for (let i = 1; i <= 12; i++) slots[String(i)] = 0;
    db.liveBets.tripleFun = { slots, total: 0 };
  } else if (game === 'sevenUpDown') {
    db.liveBets.sevenUpDown = { '7down': 0, 'lucky7': 0, '7up': 0, total: 0 };
  } else if (game === 'aviator') {
    db.liveBets.aviator = [];
  }
}

// --- GAME SIMULATOR & TIMERS ---
setInterval(() => {
  // Player presence idle check (mark offline after 45s of inactivity)
  const now = Date.now();
  for (const key in db.users) {
    const u = db.users[key];
    if (u.isOnline && (!u.lastSeenTimestamp || (now - u.lastSeenTimestamp > 45000))) {
      u.isOnline = false;
    }
  }

  // 1. Aviator
  const av = db.gameResults.aviator;
  if (av.phase === 'waiting') {
    av.countdown--;
    if (av.countdown <= 0) {
      av.phase = 'running';
      av.multiplier = 1.0;
      av.actualCrash = av.nextCrashMultiplier ? parseFloat(av.nextCrashMultiplier) : parseFloat((1.1 + Math.random() * Math.random() * 8).toFixed(2));
      av.nextCrashMultiplier = null;
      av.roundId++;
    }
  } else if (av.phase === 'running') {
    av.multiplier = parseFloat((av.multiplier + 0.05 + av.multiplier * 0.03).toFixed(2));
    if (av.multiplier >= av.actualCrash) {
      av.phase = 'crashed';
      av.multiplier = av.actualCrash;
      av.countdown = 6;
      resetBets('aviator');
    }
  } else if (av.phase === 'crashed') {
    av.countdown--;
    if (av.countdown <= 0) {
      av.phase = 'waiting';
      av.countdown = 5;
    }
  }

  // 2. Fun Target (Numbers 0 to 9)
  const ft = db.gameResults.funTarget;
  ft.countdown--;
  if (ft.countdown <= 0) {
    ft.lastResult = ft.nextWinningNumber !== null ? parseInt(ft.nextWinningNumber, 10) : Math.floor(Math.random() * 10);
    ft.nextWinningNumber = null;
    ft.roundId++;
    ft.countdown = 40;
    resetBets('funTarget');
  }

  // 3. Fun Roulette (0 to 36)
  const fr = db.gameResults.funRoulette;
  fr.countdown--;
  if (fr.countdown <= 0) {
    fr.lastResult = fr.nextWinningNumber !== null ? parseInt(fr.nextWinningNumber, 10) : Math.floor(Math.random() * 37);
    fr.nextWinningNumber = null;
    fr.roundId++;
    fr.countdown = 45;
    resetBets('funRoulette');
  }

  // 4. Triple Fun / FunRep (1 to 12)
  const tf = db.gameResults.tripleFun;
  tf.countdown--;
  if (tf.countdown <= 0) {
    tf.lastResult = tf.nextWinningNumber !== null ? parseInt(tf.nextWinningNumber, 10) : (Math.floor(Math.random() * 12) + 1);
    tf.nextWinningNumber = null;
    tf.roundId++;
    tf.countdown = 45;
    resetBets('tripleFun');
  }

  // 5. 7 Up Down
  const sud = db.gameResults.sevenUpDown;
  sud.countdown--;
  if (sud.countdown <= 0) {
    let roll = sud.nextDiceTotal !== null ? parseInt(sud.nextDiceTotal, 10) : (Math.floor(1 + Math.random() * 6) + Math.floor(1 + Math.random() * 6));
    sud.lastResult = roll < 7 ? `7 Down (${roll})` : roll > 7 ? `7 Up (${roll})` : `Lucky 7 (${roll})`;
    sud.nextDiceTotal = null;
    sud.roundId++;
    sud.countdown = 30;
    resetBets('sevenUpDown');
  }
}, 1000);

// --- HTTP SERVER ---
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    let jsonBody = {};
    try {
      if (body && (body.startsWith('{') || body.startsWith('['))) jsonBody = JSON.parse(body);
    } catch (e) {}

    // 1. ADMIN DASHBOARD UI & ROOT CLIENT HANDLER
    if (pathname === '/admin' || pathname === '/admin/') {
      return serveAdminDashboard(res);
    }
    if (pathname === '/') {
      const isHtmlBrowser = req.headers.accept && req.headers.accept.includes('text/html') && (!req.headers['user-agent'] || !req.headers['user-agent'].includes('Unity'));
      if (isHtmlBrowser) {
        return serveAdminDashboard(res);
      }
      const addressBundle = JSON.stringify({
        ApiServerUrl: 'funrepinternal.vip',
        SocketUrl: 'funrepinternal.vip',
        ResourceUrl: 'funrepinternal.vip'
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        status: 'ok',
        code: 200,
        server: 'FunGame Master Authority',
        encryptedData: addressBundle,
        data: addressBundle,
        ApiServerUrl: 'funrepinternal.vip',
        SocketUrl: 'funrepinternal.vip',
        ResourceUrl: 'funrepinternal.vip'
      }));
    }

    // 2. ADMIN API - DATA & STATS
    if (pathname === '/api/admin/data' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        status: 'success',
        adminVault: db.adminMasterPoints,
        users: Object.values(db.users),
        transactions: db.transactions.slice(0, 100),
        gameResults: db.gameResults,
        liveBets: db.liveBets,
        stats: {
          totalUsers: Object.keys(db.users).length,
          onlineUsers: Object.values(db.users).filter(u => u.isOnline).length,
          totalPointsInCirculation: Object.values(db.users).reduce((sum, u) => sum + (u.points || 0), 0),
          totalTransactions: db.transactions.length
        }
      }));
    }

    // 3. ADMIN API - CREATE PLAYER
    if (pathname === '/api/admin/players/create' && req.method === 'POST') {
      const { playerKey, username, password, points } = jsonBody;
      const resData = createPlayerAccount(playerKey, username, password, points);
      res.writeHead(resData.success ? 200 : 400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(resData));
    }

    // 4. ADMIN API - RECALL POINTS
    if (pathname === '/api/admin/points/recall' && req.method === 'POST') {
      const { playerKey, amount } = jsonBody;
      const resData = recallPoints(playerKey, amount !== undefined ? amount : null);
      res.writeHead(resData.success ? 200 : 400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(resData));
    }

    // 5. ADMIN API - CREDIT / TRANSFER POINTS
    if (pathname === '/api/admin/points/transfer' && req.method === 'POST') {
      const { senderKey, receiverKey, amount, note } = jsonBody;
      const result = transferPoints(senderKey, receiverKey, amount, note);
      res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    }

    // 6. ADMIN API - SET NEXT GAME RESULT
    if (pathname === '/api/admin/set-result' && req.method === 'POST') {
      const { game, value } = jsonBody;
      if (game === 'aviator') db.gameResults.aviator.nextCrashMultiplier = value ? parseFloat(value) : null;
      if (game === 'funTarget') db.gameResults.funTarget.nextWinningNumber = value !== '' ? parseInt(value, 10) : null;
      if (game === 'funRoulette') db.gameResults.funRoulette.nextWinningNumber = value !== '' ? parseInt(value, 10) : null;
      if (game === 'tripleFun') db.gameResults.tripleFun.nextWinningNumber = value !== '' ? parseInt(value, 10) : null;
      if (game === 'sevenUpDown') db.gameResults.sevenUpDown.nextDiceTotal = value !== '' ? parseInt(value, 10) : null;
      saveDB(db);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'success', gameResults: db.gameResults }));
    }

    // 7. PLACE BET (FunTarget, FunRoulette, TripleFun, 7UpDown, Aviator)
    if (pathname === '/api/bet' || pathname.toLowerCase().includes('placebet')) {
      const { playerKey, game, targetNumber, betType, amount } = jsonBody;
      const user = db.users[playerKey];
      const betAmt = parseInt(amount, 10);
      if (!user || user.points < betAmt) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'error', message: 'Insufficient points' }));
      }
      markUserActive(user, req);
      user.points -= betAmt;
      user.totalBet = (user.totalBet || 0) + betAmt;

      // Update Live Bets board
      if (game === 'funTarget' && targetNumber !== undefined) {
        const numStr = String(targetNumber);
        db.liveBets.funTarget[numStr] = (db.liveBets.funTarget[numStr] || 0) + betAmt;
        db.liveBets.funTarget.total += betAmt;
      } else if (game === 'funRoulette') {
        if (targetNumber !== undefined) {
          const pStr = String(targetNumber);
          db.liveBets.funRoulette.pockets[pStr] = (db.liveBets.funRoulette.pockets[pStr] || 0) + betAmt;
        } else if (betType && db.liveBets.funRoulette.outside[betType] !== undefined) {
          db.liveBets.funRoulette.outside[betType] += betAmt;
        }
        db.liveBets.funRoulette.total += betAmt;
      } else if (game === 'tripleFun' && targetNumber !== undefined) {
        const tfStr = String(targetNumber);
        db.liveBets.tripleFun.slots[tfStr] = (db.liveBets.tripleFun.slots[tfStr] || 0) + betAmt;
        db.liveBets.tripleFun.total += betAmt;
      } else if (game === 'sevenUpDown' && betType) {
        if (db.liveBets.sevenUpDown[betType] !== undefined) {
          db.liveBets.sevenUpDown[betType] += betAmt;
          db.liveBets.sevenUpDown.total += betAmt;
        }
      } else if (game === 'aviator') {
        db.liveBets.aviator.push({
          playerKey: user.playerKey,
          amount: betAmt,
          autoCashout: jsonBody.autoCashout || 2.0,
          status: 'flying',
          timestamp: new Date().toISOString()
        });
      }

      saveDB(db);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'success', balancePoints: user.points }));
    }

    // 8. GAME CLIENT - LOGIN WITH ID & PASSWORD
    if (pathname.toLowerCase().includes('login') || pathname.toLowerCase().includes('auth')) {
      const pKey = (jsonBody.playerKey || jsonBody.userId || jsonBody.username || jsonBody.account || jsonBody.memberId || url.searchParams.get('playerKey') || url.searchParams.get('account') || 'gk00000001').toLowerCase();
      const pPass = jsonBody.password || url.searchParams.get('password') || '123456';

      let user = db.users[pKey];
      if (!user) {
        user = createPlayerAccount(pKey, jsonBody.playerName || pKey.toUpperCase(), pPass, 50000).user;
      }

      markUserActive(user, req);
      saveDB(db);

      const token = 'tok_' + crypto.randomBytes(16).toString('hex');
      const innerPayload = {
        code: 200,
        status: 'success',
        playerKey: user.playerKey,
        username: user.username,
        account: user.playerKey,
        token: token,
        balance: user.points,
        points: user.points,
        balancePoints: user.points
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        status: 'success',
        code: 200,
        playerKey: user.playerKey,
        playerName: user.username,
        token: token,
        balancePoints: user.points,
        points: user.points,
        balance: user.points,
        encryptedData: JSON.stringify(innerPayload)
      }));
    }

    // 9. GAME CLIENT - BALANCE
    if (pathname.toLowerCase().includes('balance')) {
      const pKey = (jsonBody.playerKey || jsonBody.userId || url.searchParams.get('playerKey') || 'guest_001').toLowerCase();
      const user = db.users[pKey] || createPlayerAccount(pKey, pKey, '123456', 5000).user;
      markUserActive(user, req);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        status: 'success',
        playerKey: user.playerKey,
        balance: user.points,
        balancePoints: user.points
      }));
    }

    // 10. GAME CLIENT - TRANSFER
    if (pathname.toLowerCase().includes('transfer')) {
      const sender = (jsonBody.senderKey || jsonBody.fromUser || jsonBody.playerKey || '').toLowerCase();
      const receiver = (jsonBody.receiverKey || jsonBody.toUser || jsonBody.targetKey || '').toLowerCase();
      const amt = jsonBody.amount || jsonBody.points;
      if (db.users[sender]) markUserActive(db.users[sender], req);
      const result = transferPoints(sender, receiver, amt, jsonBody.note || 'In-game Player Transfer');
      res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    }

    // 11. HEARTBEAT / PING (Live player keepalive)
    if (pathname === '/api/heartbeat' || pathname === '/ping') {
      const pKey = (jsonBody.playerKey || url.searchParams.get('playerKey') || '').toLowerCase();
      if (db.users[pKey]) {
        markUserActive(db.users[pKey], req);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', online: true }));
    }

    // 12. SIGNALR NEGOTIATE
    if (pathname.includes('negotiate')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        connectionId: 'conn_' + crypto.randomBytes(8).toString('hex'),
        availableTransports: [{ transport: 'WebSockets', transferFormats: ['Text', 'Binary'] }]
      }));
    }

    // 13. SOAP XML (Teen Patti / Poker)
    if (body.includes('GetPlayerBalanceFromXML') || body.includes('GetPokerBalanceFromXml')) {
      const match = body.match(/<[^>]*playerKey[^>]*>([^<]+)<\//i) || body.match(/<[^>]*UserID[^>]*>([^<]+)<\//i);
      const pKey = (match ? match[1] : 'guest_001').toLowerCase();
      const user = db.users[pKey] || createPlayerAccount(pKey, pKey, '123456', 5000).user;
      markUserActive(user, req);
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
      return res.end(`<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <GetPlayerBalanceResponse xmlns="http://tempuri.org/">
      <GetPlayerBalanceResult>
        <Status>Success</Status>
        <Balance>${user.points}</Balance>
        <Points>${user.points}</Points>
        <UserID>${user.playerKey}</UserID>
      </GetPlayerBalanceResult>
    </GetPlayerBalanceResponse>
  </s:Body>
</s:Envelope>`);
    }

    // Default Fallback
    const fallbackBundle = JSON.stringify({
      ApiServerUrl: 'funrepinternal.vip',
      SocketUrl: 'funrepinternal.vip',
      ResourceUrl: 'funrepinternal.vip'
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      code: 200,
      server: 'FunGame Master Authority',
      encryptedData: fallbackBundle,
      data: fallbackBundle,
      ApiServerUrl: 'funrepinternal.vip',
      SocketUrl: 'funrepinternal.vip',
      ResourceUrl: 'funrepinternal.vip'
    }));
  });
});

// --- ADMIN DASHBOARD HTML ---
function serveAdminDashboard(res) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FunGame Master Operations & Live Betting</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card: #121826;
      --border: #232d42;
      --accent: #238636;
      --accent-hover: #2ea043;
      --danger: #da3633;
      --blue: #58a6ff;
      --yellow: #f1e05a;
      --purple: #bc8cff;
      --red-chip: #ea3943;
      --black-chip: #21262d;
      --green-chip: #238636;
      --text: #c9d1d9;
      --text-bright: #ffffff;
    }
    body {
      margin: 0;
      padding: 0;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .container { max-width: 1350px; margin: 0 auto; padding: 24px; }
    .header {
      display: flex; justify-content: space-between; align-items: center;
      padding-bottom: 18px; border-bottom: 1px solid var(--border); margin-bottom: 20px;
    }
    .badge { background: #23863626; color: #3fb950; padding: 4px 12px; border-radius: 12px; font-size: 13px; font-weight: 600; border: 1px solid #23863650; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 18px; margin-bottom: 20px; }
    .card h2 { margin: 0 0 10px 0; font-size: 18px; display: flex; align-items: center; gap: 8px; }
    .card h3 { font-size: 13px; text-transform: uppercase; color: #8b949e; margin: 0 0 6px 0; }
    .card .val { font-size: 26px; font-weight: 700; color: var(--text-bright); }
    .btn { background: var(--accent); color: #fff; border: none; padding: 8px 12px; border-radius: 6px; font-weight: 600; cursor: pointer; }
    .btn:hover { background: var(--accent-hover); }
    .btn-danger { background: var(--danger); }
    .btn-blue { background: #1f6feb; }
    .btn-yellow { background: var(--yellow); color: #000; }
    .btn-purple { background: #8957e5; }
    .btn-tab { background: #161f30; color: #8b949e; border: 1px solid var(--border); padding: 10px 18px; border-radius: 6px; font-weight: 600; cursor: pointer; }
    .btn-tab.active { background: #1f6feb; color: #fff; border-color: #388bfd; }
    .form-group { margin-bottom: 12px; }
    label { display: block; font-size: 12px; color: #8b949e; margin-bottom: 4px; }
    input, select { width: 100%; box-sizing: border-box; background: #090d13; border: 1px solid var(--border); color: var(--text-bright); padding: 8px 10px; border-radius: 6px; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 13px; }
    th { color: #8b949e; background: #0c1119; font-weight: 600; }
    .grid-2 { display: grid; grid-template-columns: 2fr 1.2fr; gap: 20px; margin-bottom: 20px; }
    .grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-bottom: 20px; }
    
    /* TABS BAR */
    .tabs-bar { display: flex; gap: 10px; margin-bottom: 18px; flex-wrap: wrap; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }

    /* BET CELL GRIDS */
    .bet-grid-10 { display: grid; grid-template-columns: repeat(10, 1fr); gap: 8px; margin-top: 10px; }
    .bet-grid-12 { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-top: 10px; }
    .bet-grid-roulette { display: grid; grid-template-columns: 60px repeat(12, 1fr); gap: 6px; margin-top: 10px; }
    
    .bet-cell {
      background: #0c1119; border: 1px solid var(--border); border-radius: 6px; padding: 10px 4px; text-align: center;
      transition: all 0.2s; position: relative;
    }
    .bet-cell .num { font-size: 20px; font-weight: bold; color: var(--yellow); }
    .bet-cell .amt { font-size: 12px; color: var(--blue); font-weight: 600; margin-top: 4px; }
    .bet-cell.hot { border-color: var(--danger); background: #da363325; box-shadow: 0 0 10px #da363335; }
    .bet-cell.cold { border-color: #238636; background: #23863625; box-shadow: 0 0 10px #23863635; }
    
    /* ROULETTE SPECIFIC STYLING */
    .r-pocket { padding: 10px 2px; text-align: center; border-radius: 5px; font-weight: bold; border: 1px solid var(--border); }
    .r-pocket.red { background: #b91c1c; color: #fff; }
    .r-pocket.black { background: #1c1f26; color: #fff; }
    .r-pocket.green { background: #15803d; color: #fff; grid-row: span 3; display: flex; flex-direction: column; justify-content: center; align-items: center; }
    .r-pocket .p-num { font-size: 18px; }
    .r-pocket .p-bet { font-size: 11px; margin-top: 2px; color: #fef08a; }

    /* 7 UP DOWN CARDS */
    .sud-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-top: 12px; }
    .sud-card { background: #0c1119; border: 2px solid var(--border); border-radius: 8px; padding: 16px; text-align: center; }
    .sud-card.selected { border-color: var(--blue); }
    .sud-title { font-size: 22px; font-weight: 800; }
    .sud-bet { font-size: 26px; font-weight: bold; color: var(--yellow); margin: 8px 0; }
    .sud-ratio { font-size: 13px; color: #8b949e; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1 style="margin:0;">🎮 FunGame Master Operations &amp; Live Multi-Game Betting</h1>
        <div style="font-size: 13px; color: #8b949e; margin-top:4px;">
          Port: <strong>${PORT}</strong> | Master Vault: <strong style="color:var(--yellow);" id="valAdminVault">--</strong> pts | 
          Players Online: <strong style="color:#3fb950; font-size:14px;" id="valOnlineCount">0</strong> / <span id="valTotalUsers">0</span>
        </div>
      </div>
      <div>
        <span class="badge">● SERVER &amp; LIVE WEBSOCKETS ACTIVE</span>
      </div>
    </div>

    <!-- GAME SELECTOR TABS -->
    <div class="tabs-bar">
      <button class="btn-tab active" onclick="switchTab('tab-target')">🎯 Fun Target (0-9)</button>
      <button class="btn-tab" onclick="switchTab('tab-roulette')">🎡 Fun Roulette (0-36)</button>
      <button class="btn-tab" onclick="switchTab('tab-triplefun')">🎪 Triple Fun / FunRep (1-12)</button>
      <button class="btn-tab" onclick="switchTab('tab-7updown')">🎲 7 Up Down</button>
      <button class="btn-tab" onclick="switchTab('tab-aviator')">✈️ Aviator (Crash)</button>
    </div>

    <!-- ================= TAB 1: FUN TARGET (0-9) ================= -->
    <div id="tab-target" class="tab-content active">
      <div class="card" style="border-top: 3px solid var(--yellow);">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div>
            <h2 style="margin:0;">🎯 Fun Target — Live Betting on Numbers (0 to 9)</h2>
            <div style="font-size:12px; color:#8b949e;">Next Spin in: <strong id="timeFunTarget" style="color:var(--yellow);">--</strong>s | Total Placed: <strong id="ftTotalBet" style="color:var(--blue);">0</strong> pts | Payout: <strong>10x</strong></div>
          </div>
          <div style="display:flex; gap:10px; align-items:center;">
            <span style="font-size:12px; color:#8b949e;">🟢 Safe (Least Bet) | 🔴 High House Risk</span>
            <input type="number" min="0" max="9" id="setFunTarget" placeholder="Force # (0-9)" style="width:110px;" />
            <button class="btn btn-yellow" onclick="saveResult('funTarget', 'setFunTarget')">Force Next Win</button>
          </div>
        </div>
        <div class="bet-grid-10" id="ftGrid"></div>
      </div>
    </div>

    <!-- ================= TAB 2: FUN ROULETTE (0-36) ================= -->
    <div id="tab-roulette" class="tab-content">
      <div class="card" style="border-top: 3px solid #1f6feb;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div>
            <h2 style="margin:0;">🎡 Fun Roulette — Live Betting on Pockets (0 to 36)</h2>
            <div style="font-size:12px; color:#8b949e;">Next Spin in: <strong id="timeFunRoulette" style="color:var(--yellow);">--</strong>s | Total Placed: <strong id="frTotalBet" style="color:var(--blue);">0</strong> pts | Last Result: <strong id="resFunRoulette" style="color:#fff;">17</strong></div>
          </div>
          <div style="display:flex; gap:10px; align-items:center;">
            <input type="number" min="0" max="36" id="setFunRoulette" placeholder="Force Pocket (0-36)" style="width:140px;" />
            <button class="btn btn-blue" onclick="saveResult('funRoulette', 'setFunRoulette')">Force Roulette Pocket</button>
          </div>
        </div>

        <!-- OUTSIDE BETS SUMMARY -->
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:10px; margin-top:14px;">
          <div style="background:#b91c1c20; border:1px solid #b91c1c; padding:8px; border-radius:6px; text-align:center;">
            <div style="font-size:12px; color:#fca5a5;">RED</div>
            <div id="frBetRed" style="font-size:16px; font-weight:bold; color:#fff;">0 pts</div>
          </div>
          <div style="background:#1c1f26; border:1px solid #30363d; padding:8px; border-radius:6px; text-align:center;">
            <div style="font-size:12px; color:#8b949e;">BLACK</div>
            <div id="frBetBlack" style="font-size:16px; font-weight:bold; color:#fff;">0 pts</div>
          </div>
          <div style="background:#0c1119; border:1px solid var(--border); padding:8px; border-radius:6px; text-align:center;">
            <div style="font-size:12px; color:#8b949e;">EVEN</div>
            <div id="frBetEven" style="font-size:16px; font-weight:bold; color:#fff;">0 pts</div>
          </div>
          <div style="background:#0c1119; border:1px solid var(--border); padding:8px; border-radius:6px; text-align:center;">
            <div style="font-size:12px; color:#8b949e;">ODD</div>
            <div id="frBetOdd" style="font-size:16px; font-weight:bold; color:#fff;">0 pts</div>
          </div>
          <div style="background:#0c1119; border:1px solid var(--border); padding:8px; border-radius:6px; text-align:center;">
            <div style="font-size:12px; color:#8b949e;">1-18 (LOW)</div>
            <div id="frBetLow" style="font-size:16px; font-weight:bold; color:#fff;">0 pts</div>
          </div>
          <div style="background:#0c1119; border:1px solid var(--border); padding:8px; border-radius:6px; text-align:center;">
            <div style="font-size:12px; color:#8b949e;">19-36 (HIGH)</div>
            <div id="frBetHigh" style="font-size:16px; font-weight:bold; color:#fff;">0 pts</div>
          </div>
        </div>

        <!-- 0 to 36 POCKETS GRID -->
        <div style="font-size:12px; color:#8b949e; margin-top:14px;">Single Number Wagers (36x Payout):</div>
        <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(85px, 1fr)); gap:6px; margin-top:8px;" id="frGrid"></div>
      </div>
    </div>

    <!-- ================= TAB 3: TRIPLE FUN / FUNREP (1-12) ================= -->
    <div id="tab-triplefun" class="tab-content">
      <div class="card" style="border-top: 3px solid #8957e5;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div>
            <h2 style="margin:0;">🎪 Triple Fun / FunRep — Live Betting on 12 Slots</h2>
            <div style="font-size:12px; color:#8b949e;">Next Spin in: <strong id="timeTripleFun" style="color:var(--yellow);">--</strong>s | Total Placed: <strong id="tfTotalBet" style="color:var(--blue);">0</strong> pts | Payout: <strong>10x/12x</strong></div>
          </div>
          <div style="display:flex; gap:10px; align-items:center;">
            <input type="number" min="1" max="12" id="setTripleFun" placeholder="Force Slot (1-12)" style="width:130px;" />
            <button class="btn btn-purple" onclick="saveResult('tripleFun', 'setTripleFun')">Force Winning Slot</button>
          </div>
        </div>
        <div class="bet-grid-12" id="tfGrid"></div>
      </div>
    </div>

    <!-- ================= TAB 4: 7 UP DOWN ================= -->
    <div id="tab-7updown" class="tab-content">
      <div class="card" style="border-top: 3px solid #f1e05a;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div>
            <h2 style="margin:0;">🎲 7 Up Down — Live Dice Betting Zones</h2>
            <div style="font-size:12px; color:#8b949e;">Next Roll in: <strong id="time7UpDown" style="color:var(--yellow);">--</strong>s | Total Placed: <strong id="sudTotalBet" style="color:var(--blue);">0</strong> pts | Last: <strong id="res7UpDown" style="color:#fff;">7 Up</strong></div>
          </div>
          <div style="display:flex; gap:10px; align-items:center;">
            <input type="number" min="2" max="12" id="set7UpDown" placeholder="Force Sum (2-12)" style="width:130px;" />
            <button class="btn btn-yellow" onclick="saveResult('sevenUpDown', 'set7UpDown')">Force Dice Roll</button>
          </div>
        </div>

        <div class="sud-grid">
          <div class="sud-card" id="card7Down" style="border-color:#388bfd;">
            <div class="sud-title" style="color:#58a6ff;">🔻 7 DOWN (2 to 6)</div>
            <div class="sud-ratio">Payout: 2x</div>
            <div class="sud-bet" id="sudAmt7Down">0 pts</div>
            <div style="font-size:12px; color:#8b949e;" id="sudPct7Down">0% of total bets</div>
          </div>

          <div class="sud-card" id="cardLucky7" style="border-color:#d29922;">
            <div class="sud-title" style="color:#f1e05a;">⭐ LUCKY 7 (Exact 7)</div>
            <div class="sud-ratio">Payout: 5x</div>
            <div class="sud-bet" id="sudAmtLucky7">0 pts</div>
            <div style="font-size:12px; color:#8b949e;" id="sudPctLucky7">0% of total bets</div>
          </div>

          <div class="sud-card" id="card7Up" style="border-color:#a371f7;">
            <div class="sud-title" style="color:#bc8cff;">🔺 7 UP (8 to 12)</div>
            <div class="sud-ratio">Payout: 2x</div>
            <div class="sud-bet" id="sudAmt7Up">0 pts</div>
            <div style="font-size:12px; color:#8b949e;" id="sudPct7Up">0% of total bets</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ================= TAB 5: AVIATOR ================= -->
    <div id="tab-aviator" class="tab-content">
      <div class="card" style="border-top: 3px solid var(--danger);">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div>
            <h2 style="margin:0;">✈️ Aviator — Live Flight Multiplier & Active Bets</h2>
            <div style="font-size:12px; color:#8b949e;">Status: <strong id="resAviatorStatus" style="color:#fca5a5;">WAITING</strong> | Current Multiplier: <strong id="resAviator" style="color:var(--danger); font-size:22px;">1.00x</strong></div>
          </div>
          <div style="display:flex; gap:10px; align-items:center;">
            <input type="number" step="0.1" id="setAviator" placeholder="Crash at (e.g. 5.50x)" style="width:160px;" />
            <button class="btn btn-danger" onclick="saveResult('aviator', 'setAviator')">Set Crash Multiplier</button>
          </div>
        </div>

        <div style="margin-top:14px;">
          <h3 style="margin-bottom:8px;">Live Round Bets</h3>
          <table>
            <thead>
              <tr>
                <th>Player ID</th>
                <th>Bet Points</th>
                <th>Auto Cashout</th>
                <th>Flight Status</th>
              </tr>
            </thead>
            <tbody id="aviatorBetsTable">
              <tr><td colspan="4" style="color:#8b949e;">No active bets in current flight.</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- PLAYERS & ACTIONS -->
    <div class="grid-2">
      <!-- PLAYERS TABLE -->
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin:0;">👥 Player Accounts &amp; Points</h2>
          <button class="btn btn-blue" onclick="loadData()">↻ Refresh</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>ID (Login)</th>
              <th>Password</th>
              <th>Status</th>
              <th>Device IP / Last Active</th>
              <th>Points</th>
              <th>Quick Actions</th>
            </tr>
          </thead>
          <tbody id="usersTable">
            <tr><td colspan="6">Loading player database...</td></tr>
          </tbody>
        </table>
      </div>

      <!-- CREATE PLAYER & TRANSFER PANELS -->
      <div>
        <!-- CREATE NEW PLAYER -->
        <div class="card" style="margin-bottom: 20px;">
          <h2 style="margin-top:0;">➕ Create New Player ID &amp; Password</h2>
          <div class="form-group">
            <label>Player ID (Login ID)</label>
            <input type="text" id="newPlayerId" placeholder="e.g. player777" />
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="text" id="newPlayerPass" placeholder="e.g. pass123" value="123456" />
          </div>
          <div class="form-group">
            <label>Starting Points</label>
            <input type="number" id="newPlayerPoints" value="5000" />
          </div>
          <button class="btn" style="width:100%;" onclick="createPlayer()">Create Player Account</button>
        </div>

        <!-- TRANSFER / RECALL POINTS -->
        <div class="card">
          <h2 style="margin-top:0;">💸 Transfer &amp; Recall Points</h2>
          <div class="form-group">
            <label>From</label>
            <select id="transferFrom"></select>
          </div>
          <div class="form-group">
            <label>To</label>
            <select id="transferTo"></select>
          </div>
          <div class="form-group">
            <label>Points Amount</label>
            <input type="number" id="transferAmount" value="2000" />
          </div>
          <button class="btn btn-blue" style="width:100%;" onclick="submitTransfer()">Execute Transfer</button>
        </div>
      </div>
    </div>

    <!-- TRANSACTION AUDIT LEDGER -->
    <div class="card">
      <h2 style="margin-top:0;">📜 Real-Time Audit Log (Transfers, Recalls &amp; Bets)</h2>
      <div style="max-height: 260px; overflow-y: auto; font-family: monospace; font-size: 12px; background: #090d13; padding: 12px; border-radius: 6px; border: 1px solid var(--border);" id="txLogs">
        <div>Loading ledger...</div>
      </div>
    </div>
  </div>

  <script>
    const ROULETTE_REDS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

    function switchTab(tabId) {
      document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.btn-tab').forEach(el => el.classList.remove('active'));
      document.getElementById(tabId).classList.add('active');
      event.target.classList.add('active');
    }

    async function loadData() {
      try {
        const res = await fetch('/api/admin/data');
        const data = await res.json();

        document.getElementById('valAdminVault').innerText = Number(data.adminVault).toLocaleString();

        // 1. FUN TARGET (0-9)
        const ftBets = data.liveBets.funTarget;
        document.getElementById('ftTotalBet').innerText = Number(ftBets.total || 0).toLocaleString();
        document.getElementById('timeFunTarget').innerText = data.gameResults.funTarget.countdown;
        const ftGrid = document.getElementById('ftGrid');
        ftGrid.innerHTML = '';
        let maxFt = 0, minFt = Infinity;
        for (let i = 0; i <= 9; i++) {
          const amt = ftBets[String(i)] || 0;
          if (amt > maxFt) maxFt = amt;
          if (amt < minFt) minFt = amt;
        }
        for (let i = 0; i <= 9; i++) {
          const amt = ftBets[String(i)] || 0;
          const isHot = amt > 0 && amt === maxFt;
          const isCold = amt === minFt;
          ftGrid.innerHTML += \`
            <div class="bet-cell \${isHot ? 'hot' : isCold ? 'cold' : ''}">
              <div class="num">\${i}</div>
              <div class="amt">\${Number(amt).toLocaleString()} pts</div>
            </div>
          \`;
        }

        // 2. FUN ROULETTE (0-36)
        const frBets = data.liveBets.funRoulette;
        document.getElementById('frTotalBet').innerText = Number(frBets.total || 0).toLocaleString();
        document.getElementById('timeFunRoulette').innerText = data.gameResults.funRoulette.countdown;
        document.getElementById('resFunRoulette').innerText = data.gameResults.funRoulette.lastResult;
        
        // Outside bets
        if (frBets.outside) {
          document.getElementById('frBetRed').innerText = Number(frBets.outside.red || 0).toLocaleString() + ' pts';
          document.getElementById('frBetBlack').innerText = Number(frBets.outside.black || 0).toLocaleString() + ' pts';
          document.getElementById('frBetEven').innerText = Number(frBets.outside.even || 0).toLocaleString() + ' pts';
          document.getElementById('frBetOdd').innerText = Number(frBets.outside.odd || 0).toLocaleString() + ' pts';
          document.getElementById('frBetLow').innerText = Number(frBets.outside.low || 0).toLocaleString() + ' pts';
          document.getElementById('frBetHigh').innerText = Number(frBets.outside.high || 0).toLocaleString() + ' pts';
        }

        const frGrid = document.getElementById('frGrid');
        frGrid.innerHTML = '';
        let maxFr = 0, minFr = Infinity;
        for (let i = 0; i <= 36; i++) {
          const amt = (frBets.pockets && frBets.pockets[String(i)]) || 0;
          if (amt > maxFr) maxFr = amt;
          if (amt < minFr) minFr = amt;
        }
        for (let i = 0; i <= 36; i++) {
          const amt = (frBets.pockets && frBets.pockets[String(i)]) || 0;
          const isRed = ROULETTE_REDS.includes(i);
          const isGreen = i === 0;
          const isHot = amt > 0 && amt === maxFr;
          const isCold = amt === minFr;
          const colorClass = isGreen ? 'green' : isRed ? 'red' : 'black';
          frGrid.innerHTML += \`
            <div class="r-pocket \${colorClass} \${isHot ? 'hot' : isCold ? 'cold' : ''}">
              <div class="p-num">\${i}</div>
              <div class="p-bet">\${Number(amt).toLocaleString()} pts</div>
            </div>
          \`;
        }

        // 3. TRIPLE FUN / FUNREP (1-12)
        const tfBets = (data.liveBets.tripleFun && data.liveBets.tripleFun.slots) || {};
        document.getElementById('tfTotalBet').innerText = Number((data.liveBets.tripleFun && data.liveBets.tripleFun.total) || 0).toLocaleString();
        document.getElementById('timeTripleFun').innerText = data.gameResults.tripleFun ? data.gameResults.tripleFun.countdown : '--';
        const tfGrid = document.getElementById('tfGrid');
        tfGrid.innerHTML = '';
        let maxTf = 0, minTf = Infinity;
        for (let i = 1; i <= 12; i++) {
          const amt = tfBets[String(i)] || 0;
          if (amt > maxTf) maxTf = amt;
          if (amt < minTf) minTf = amt;
        }
        for (let i = 1; i <= 12; i++) {
          const amt = tfBets[String(i)] || 0;
          const isHot = amt > 0 && amt === maxTf;
          const isCold = amt === minTf;
          tfGrid.innerHTML += \`
            <div class="bet-cell \${isHot ? 'hot' : isCold ? 'cold' : ''}">
              <div class="num" style="color:var(--purple);">#\${i}</div>
              <div class="amt">\${Number(amt).toLocaleString()} pts</div>
            </div>
          \`;
        }

        // 4. 7 UP DOWN
        const sudBets = data.liveBets.sevenUpDown || { '7down': 0, 'lucky7': 0, '7up': 0, total: 0 };
        const sudTotal = sudBets.total || 0;
        document.getElementById('sudTotalBet').innerText = Number(sudTotal).toLocaleString();
        document.getElementById('time7UpDown').innerText = data.gameResults.sevenUpDown.countdown;
        document.getElementById('res7UpDown').innerText = data.gameResults.sevenUpDown.lastResult;
        
        document.getElementById('sudAmt7Down').innerText = Number(sudBets['7down'] || 0).toLocaleString() + ' pts';
        document.getElementById('sudAmtLucky7').innerText = Number(sudBets['lucky7'] || 0).toLocaleString() + ' pts';
        document.getElementById('sudAmt7Up').innerText = Number(sudBets['7up'] || 0).toLocaleString() + ' pts';
        
        const pctDown = sudTotal > 0 ? Math.round(((sudBets['7down'] || 0) / sudTotal) * 100) : 0;
        const pctLucky = sudTotal > 0 ? Math.round(((sudBets['lucky7'] || 0) / sudTotal) * 100) : 0;
        const pctUp = sudTotal > 0 ? Math.round(((sudBets['7up'] || 0) / sudTotal) * 100) : 0;
        document.getElementById('sudPct7Down').innerText = pctDown + '% of total bets';
        document.getElementById('sudPctLucky7').innerText = pctLucky + '% of total bets';
        document.getElementById('sudPct7Up').innerText = pctUp + '% of total bets';

        // 5. AVIATOR
        const av = data.gameResults.aviator;
        document.getElementById('resAviator').innerText = av.multiplier + 'x';
        document.getElementById('resAviatorStatus').innerText = av.phase.toUpperCase() + (av.countdown ? ' (' + av.countdown + 's)' : '');
        const avTbody = document.getElementById('aviatorBetsTable');
        const avBets = data.liveBets.aviator || [];
        if (avBets.length === 0) {
          avTbody.innerHTML = '<tr><td colspan="4" style="color:#8b949e;">No active bets in current flight.</td></tr>';
        } else {
          avTbody.innerHTML = '';
          avBets.forEach(b => {
            avTbody.innerHTML += \`
              <tr>
                <td><code>\${b.playerKey}</code></td>
                <td><strong style="color:var(--yellow);">\${Number(b.amount).toLocaleString()} pts</strong></td>
                <td>\${b.autoCashout}x</td>
                <td><span class="badge" style="background:#1f6feb20; color:#58a6ff; border-color:#1f6feb50;">\${b.status.toUpperCase()}</span></td>
              </tr>
            \`;
          });
        }

        // 6. PLAYERS TABLE
        const tbody = document.getElementById('usersTable');
        const fromSel = document.getElementById('transferFrom');
        const toSel = document.getElementById('transferTo');

        document.getElementById('valOnlineCount').innerText = data.stats.onlineUsers || 0;
        document.getElementById('valTotalUsers').innerText = data.stats.totalUsers || 0;

        tbody.innerHTML = '';
        fromSel.innerHTML = '<option value="ADMIN">ADMIN_VAULT (' + Number(data.adminVault).toLocaleString() + ' pts)</option>';
        toSel.innerHTML = '<option value="ADMIN">ADMIN_VAULT</option>';

        data.users.forEach(u => {
          const isOnline = !!u.isOnline;
          const statusBadge = isOnline 
            ? '<span class="badge" style="background:#23863625; color:#3fb950; border-color:#23863650;">🟢 ONLINE</span>' 
            : '<span class="badge" style="background:#30363d25; color:#8b949e; border-color:#30363d;">⚪ OFFLINE</span>';

          const lastActiveStr = u.lastSeen ? new Date(u.lastSeen).toLocaleTimeString() : 'Never';
          const ipStr = u.lastIp || 'N/A';

          tbody.innerHTML += \`
            <tr>
              <td><code>\${u.playerKey}</code></td>
              <td><code>\${u.password || '******'}</code></td>
              <td>\${statusBadge}</td>
              <td><code style="color:var(--yellow);">\${ipStr}</code><div style="font-size:11px; color:#8b949e;">\${lastActiveStr}</div></td>
              <td><strong style="color:var(--blue); font-size:15px;">\${Number(u.points).toLocaleString()}</strong> pts</td>
              <td>
                <button class="btn" style="padding:2px 6px; font-size:11px;" onclick="quickCredit('\${u.playerKey}', 1000)">+1K</button>
                <button class="btn" style="padding:2px 6px; font-size:11px;" onclick="quickCredit('\${u.playerKey}', 10000)">+10K</button>
                <button class="btn btn-danger" style="padding:2px 6px; font-size:11px;" onclick="recallPointsPrompt('\${u.playerKey}', \${u.points})">Recall All</button>
              </td>
            </tr>
          \`;
          const opt = \`<option value="\${u.playerKey}">\${u.username} (\${Number(u.points).toLocaleString()} pts)</option>\`;
          fromSel.innerHTML += opt;
          toSel.innerHTML += opt;
        });

        // 7. LEDGER
        const logBox = document.getElementById('txLogs');
        logBox.innerHTML = '';
        data.transactions.forEach(t => {
          logBox.innerHTML += \`<div style="padding:4px 0; border-bottom:1px solid #1a2230;">
            [\${new Date(t.timestamp).toLocaleTimeString()}] <span style="color:var(--yellow);">[\${t.type.toUpperCase()}]</span> <strong>\${t.sender}</strong> &rarr; <strong>\${t.receiver}</strong> | <strong style="color:var(--blue);">\${Number(t.amount).toLocaleString()} pts</strong> | Note: \${t.note || ''}
          </div>\`;
        });

      } catch (e) { console.error(e); }
    }

    async function createPlayer() {
      const playerKey = document.getElementById('newPlayerId').value.trim();
      const password = document.getElementById('newPlayerPass').value.trim();
      const points = document.getElementById('newPlayerPoints').value;
      if (!playerKey) return alert('Enter player ID');
      const res = await fetch('/api/admin/players/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerKey, username: playerKey, password, points })
      });
      const data = await res.json();
      if (!res.ok) alert(data.message);
      else {
        alert('Player created successfully!');
        document.getElementById('newPlayerId').value = '';
        loadData();
      }
    }

    async function recallPointsPrompt(playerKey, totalPoints) {
      if (totalPoints <= 0) return alert('Player has 0 points.');
      if (!confirm('Recall all ' + totalPoints + ' points from ' + playerKey + ' back to Admin Vault?')) return;
      const res = await fetch('/api/admin/points/recall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerKey })
      });
      const data = await res.json();
      if (res.ok) alert('Recalled ' + data.recalledAmount + ' points back to Admin Vault!');
      loadData();
    }

    async function quickCredit(playerKey, amt) {
      await fetch('/api/admin/points/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderKey: 'ADMIN', receiverKey: playerKey, amount: amt, note: 'Quick Admin Credit' })
      });
      loadData();
    }

    async function submitTransfer() {
      const from = document.getElementById('transferFrom').value;
      const to = document.getElementById('transferTo').value;
      const amt = document.getElementById('transferAmount').value;
      if (from === to) return alert('Sender and receiver must be different.');
      const res = await fetch('/api/admin/points/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderKey: from, receiverKey: to, amount: amt, note: 'Admin Panel Transfer' })
      });
      const data = await res.json();
      if (!res.ok) alert(data.message);
      else alert('Transferred ' + amt + ' points successfully!');
      loadData();
    }

    async function saveResult(game, inputId) {
      const val = document.getElementById(inputId).value;
      await fetch('/api/admin/set-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game, value: val })
      });
      alert('Next outcome for ' + game + ' set!');
      document.getElementById(inputId).value = '';
      loadData();
    }

    setInterval(loadData, 1500);
    window.onload = loadData;
  </script>
</body>
</html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

// Start Server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[FunGame Master Server] Online on Port: ${PORT}`);
  console.log(`[Admin Operations Dashboard] http://localhost:${PORT}/admin`);
});
