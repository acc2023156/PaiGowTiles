/* 畫面：牌桌、發牌／翻牌動畫、押門、自動投注、上莊、紀錄、牌型表、公平性視窗 */
(function () {
  'use strict';
  const P = window.PaiGow;
  const $ = s => document.querySelector(s);
  const fmt = x => (+x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const signed = x => (x > 0 ? '+' : x < 0 ? '-' : '') + fmt(Math.abs(x));
  const pct = (x, d = 2) => (x * 100).toFixed(d) + '%';
  const wait = ms => new Promise(r => setTimeout(r, ms));

  const KEY = 'paigow.v2';
  const START_BALANCE = 1000;
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const OUT_TXT = { win: '贏', push: '走', lose: '輸' };

  const el = {
    balance: $('#balance'), wallet: $('.wallet'), bet: $('#betAmount'), main: $('#mainBtn'), fast: $('#fastChk'),
    doorPick: $('#doorPick'), total: $('#totalOut'), mult: $('#multOut'), pay: $('#payOut'), prob: $('#probOut'),
    playerFields: $('#playerFields'), playerStats: $('#playerStats'),
    bankFields: $('#bankFields'), vipSel: $('#vipSel'), roomPick: $('#roomPick'), bankStatus: $('#bankStatus'), unbank: $('#unbankBtn'),
    bankBox: $('#bankBox'), bankBal: $('#bankBal'), bankRoom: $('#bankRoom'), dealerName: $('#dealerName'),
    table: $('#table'), wall: $('#wall'), shoeTag: $('#shoeTag'), result: $('#result'), resultVal: $('#resultVal'), resultSub: $('#resultSub'),
    recent: $('#recent'), betLine: $('#betLine'), nonce: $('#nonceOut'), shoeOut: $('#shoeOut'), rtp: $('#rtpOut'), dealerTag: $('#dealerTag'),
    modeSeg: $('#modeSeg'), autoFields: $('#autoFields'),
    autoCount: $('#autoCount'), onWin: $('#onWin'), onLoss: $('#onLoss'), stopProfit: $('#stopProfit'), stopLoss: $('#stopLoss'),
    myList: $('#myList'), summary: $('#summary'), ranks: $('#tab-ranks'),
    tapHint: $('#tapHint'), sound: $('#soundBtn'), back: $('#backBtn'), demoTag: $('#demoTag'),
    fair: $('#fairDialog'), clientSeed: $('#clientSeed'), nextHash: $('#nextHash'), curHash: $('#curHash'), curHashField: $('#curHashField'),
    vServer: $('#vServer'), vClient: $('#vClient'), vNonce: $('#vNonce'), vRound: $('#vRound'), verifyOut: $('#verifyOut')
  };

  // ---------- 骨牌外觀 ----------
  // 半邊 3×3 格位置（1 左上 … 9 右下），跟骰子排法一樣
  const PIPS = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
  // 傳統配色：1 點、4 點為紅；天牌上下兩個 6 紅白相間、左右相反：上半左排紅右排白，下半左排白右排紅
  // heaven：0 = 一般，1 = 天牌上半，2 = 天牌下半
  function half(n, heaven) {
    const red = c => n === 1 || n === 4 || (heaven === 1 && c % 3 === 1) || (heaven === 2 && c % 3 === 0);
    return `<span class="half${n === 1 ? ' one' : ''}">` +
      PIPS[n].map(c => `<i class="${red(c) ? 'r' : ''}" style="grid-area:${Math.ceil(c / 3)}/${(c - 1) % 3 + 1}"></i>`).join('') + '</span>';
  }
  const faceHTML = id => { const t = P.TILES[id]; const h = t.group === '天'; return half(t.pips[0], h ? 1 : 0) + half(t.pips[1], h ? 2 : 0); };
  const mini = id => `<span class="mt" title="${P.TILES[id].name} ${P.TILES[id].pips.join('-')}">${faceHTML(id)}</span>`;
  const minis = (ids, gapAfter) => `<span class="mts">${ids.map((t, i) => mini(t) + (i === gapAfter ? '<span class="gap"></span>' : '')).join('')}</span>`;

  // ---------- 存檔 ----------
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { saved = {}; }
  if (saved.balance === undefined) { // 舊版（v1）只沿用餘額與客戶種子
    try { const old = JSON.parse(localStorage.getItem('paigow.v1')) || {}; saved.balance = old.balance; saved.clientSeed = old.clientSeed; } catch (e) { /* ignore */ }
  }
  const game = new P.PaiGowGame({
    balance: saved.balance ?? START_BALANCE, clientSeed: saved.clientSeed, nonce: saved.nonce, roundNo: saved.roundNo, shoe: saved.shoe
  });
  if (saved.nextServerSeed) game.nextServerSeed = saved.nextServerSeed;
  const history = Array.isArray(saved.history) ? saved.history : [];
  const picked = new Set(Array.isArray(saved.doors) ? saved.doors.filter(d => P.DOORS.includes(d)) : ['初']);
  if (saved.bet) el.bet.value = saved.bet;
  el.fast.checked = !!saved.fast;

  // 玩家 UID（示範：本機產生 17 開頭 7 碼）與 VIP 等級（網址 ?vip= 優先）
  const uid = /^17\d{5}$/.test(saved.uid) ? saved.uid : '17' + String(Math.floor(Math.random() * 1e5)).padStart(5, '0');
  const maskedUid = uid.slice(0, 2) + 'X'.repeat(uid.length - 2);
  const urlVip = +new URLSearchParams(location.search).get('vip');
  let vip = urlVip >= 1 && urlVip <= P.VIP_MAX ? Math.floor(urlVip) : (+saved.vip >= 1 ? +saved.vip : 1);
  let roomId = P.ROOMS.some(r => r.id === saved.roomId) ? saved.roomId : P.ROOMS[0].id;
  // 上莊中：{ room, rounds, net }（重新整理頁面仍維持）
  let banking = saved.banking && P.ROOMS.some(r => r.id === saved.banking.room) ? saved.banking : null;

  let mode = banking ? 'bank' : 'manual';
  let dealing = false;
  let autoRunning = false;
  let autoStopReq = false;
  let shownBalance = null; // 動畫進行中顯示「已扣注、未結算」的餘額
  let shownBets = null;    // 桌上這一局各門的押注（桌上沒牌時為 null）
  let shownRole = null;    // 桌上這一局是閒家局還是上莊局
  let tableTaps = +saved.tableTaps || 0; // 直接點桌面開牌的次數，滿 3 次就不再顯示點擊提示
  const roomOf = id => P.ROOMS.find(r => r.id === id);

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        balance: game.balance, clientSeed: game.clientSeed, nonce: game.nonce, roundNo: game.roundNo, shoe: game.shoe,
        nextServerSeed: game.nextServerSeed, history: history.slice(0, 100), bet: el.bet.value, doors: [...picked],
        fast: el.fast.checked, tableTaps, uid, vip, roomId, banking
      }));
    } catch (e) { /* storage unavailable */ }
  }

  // ---------- 返回大廳（只接受自家網域，避免被當成跳轉跳板） ----------
  (function () {
    const ret = new URLSearchParams(location.search).get('return');
    if (!ret) return;
    try {
      const u = new URL(ret);
      const okHost = u.hostname === 'acc2023156.github.io' || u.hostname === location.hostname || u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      if (!/^https?:$/.test(u.protocol) || !okHost) return;
      el.back.href = u.href;
      el.back.hidden = false;
    } catch (e) { /* invalid url */ }
  })();

  // ---------- 小提示 ----------
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;left:50%;top:70px;transform:translateX(-50%);background:#ed4163;color:#fff;padding:8px 16px;border-radius:99px;font-weight:700;z-index:50;display:none;box-shadow:0 4px 16px rgba(0,0,0,.4);max-width:calc(100vw - 32px);text-align:center';
  document.body.appendChild(toast);
  let toastTimer = 0;
  function say(msg, ok) {
    toast.textContent = msg;
    toast.style.background = ok ? '#1f8a2c' : '#ed4163';
    toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 2600);
  }

  // ---------- 牌桌 ----------
  const pairHTML = (key, label) => `<div class="pair" data-pair="${key}" data-label="${label}"><div class="slots"><div class="slot"></div><div class="slot"></div></div><em class="hname"></em></div>`;
  P.DOORS.forEach((d, i) => {
    $(`#seat${i + 1}`).innerHTML = `<div class="seat-head"><b>${d}門</b><span class="seat-tag"></span></div>` +
      `<div class="hand">${pairHTML('front', '前')}${pairHTML('back', '後')}</div><span class="chip" hidden></span>`;
  });
  $('#seat0 .hand').innerHTML = pairHTML('front', '前') + pairHTML('back', '後');

  const seats = [0, 1, 2, 3].map(s => {
    const root = $(`#seat${s}`);
    const pair = k => {
      const p = root.querySelector(`[data-pair="${k}"]`);
      return { el: p, slots: [...p.querySelectorAll('.slot')], name: p.querySelector('.hname') };
    };
    return { el: root, front: pair('front'), back: pair('back'), tag: s ? root.querySelector('.seat-tag') : el.dealerTag, chip: root.querySelector('.chip') };
  });
  const doorSeats = seats.slice(1);

  // 牌墩：16 棟（每棟 2 張）= 一副 32 張；每局每家拿 2 棟，兩局拿完
  el.wall.innerHTML = '<i></i>'.repeat(16);
  const wallPieces = [...el.wall.children];
  // used = 這副牌已經打了幾局（0、1、2）
  function setWall(used) {
    wallPieces.forEach((w, i) => w.classList.toggle('gone', i < used * 8));
    el.shoeTag.textContent = used >= P.ROUNDS_PER_SHOE ? '待洗牌' : used ? '剩 1 局' : '新牌';
    el.shoeTag.className = 'shoe-tag' + (used === 1 ? ' last' : '');
  }

  function makeTile(id, up) {
    const t = document.createElement('div');
    t.className = 'tile' + (up ? ' up' : '');
    t.innerHTML = `<div class="flip"><div class="bk"></div><div class="fc">${faceHTML(id)}</div></div>`;
    return t;
  }

  function clearTable() {
    el.table.querySelectorAll('.tile, .mark').forEach(x => x.remove());
    seats.forEach(s => {
      [s.front, s.back].forEach(p => { p.name.className = 'hname'; p.name.textContent = ''; });
      s.tag.className = 'seat-tag';
      s.tag.textContent = '';
      s.el.classList.remove('win', 'push', 'lose');
    });
    el.result.hidden = true;
  }

  function showName(pair, ev) {
    pair.name.innerHTML = `<small>${pair.el.dataset.label}</small>${ev.name}`;
    pair.name.className = 'hname show' + (ev.kind !== 'points' ? ' sp' : '');
  }

  // 一家的 4 張依配牌順序：前 2 張、後 2 張
  const seatTiles = arr => [arr.front[0], arr.front[1], arr.back[0], arr.back[1]];
  const slotsOf = s => [...s.front.slots, ...s.back.slots];

  // 發一家：從牌墩飛到位子上（FLIP：先放到終點，再從牌墩位置補間回來）
  function dealSeat(si, arr, round, fast) {
    const s = seats[si];
    const from = el.wall.getBoundingClientRect();
    const ids = seatTiles(arr);
    wallPieces[round * 8 + si * 2].classList.add('gone');
    wallPieces[round * 8 + si * 2 + 1].classList.add('gone');
    const dur = fast ? 160 : 320;
    return Promise.all(slotsOf(s).map((slot, k) => new Promise(done => {
      const t = makeTile(ids[k], false);
      slot.appendChild(t);
      const to = slot.getBoundingClientRect();
      const dx = from.left + from.width / 2 - (to.left + to.width / 2);
      const dy = from.top + from.height / 2 - (to.top + to.height / 2);
      t.style.transform = `translate(${dx}px, ${dy}px) scale(.55) rotate(${(k % 2 ? 1 : -1) * 20}deg)`;
      t.style.opacity = '0';
      setTimeout(() => {
        t.style.transition = `transform ${dur}ms cubic-bezier(.2,.8,.3,1), opacity ${dur / 2}ms`;
        t.style.transform = '';
        t.style.opacity = '';
        setTimeout(() => { Sound.clack(0.5); done(); }, dur);
      }, k * (fast ? 25 : 60));
    })));
  }

  function flipSeat(si) {
    slotsOf(seats[si]).forEach(slot => { const t = slot.querySelector('.tile'); if (t) t.classList.add('up'); });
    Sound.flip();
  }

  function names(si, arr) {
    showName(seats[si].front, P.evalPair(arr.front[0], arr.front[1]));
    showName(seats[si].back, P.evalPair(arr.back[0], arr.back[1]));
  }

  function markDoor(di, cmp) {
    const s = doorSeats[di];
    const mk = (pair, w) => {
      const m = document.createElement('span');
      m.className = 'mark ' + (w ? 'w' : 'l');
      m.textContent = w ? '✓' : '✗';
      pair.el.appendChild(m);
    };
    mk(s.front, cmp.front);
    mk(s.back, cmp.back);
    s.el.classList.add(cmp.outcome);
    s.tag.className = 'seat-tag ' + cmp.outcome;
    s.tag.textContent = OUT_TXT[cmp.outcome];
  }

  function dealerVerdict(doors) {
    const w = doors.filter(d => d.outcome === 'win').length, l = doors.filter(d => d.outcome === 'lose').length;
    return l === 3 ? { t: '通殺', c: 'win' } : w === 3 ? { t: '通賠', c: 'lose' } : { t: '', c: '' };
  }

  // 不做動畫，直接擺出某一局的牌（初始化時還原上一局）
  function placeRound(arranged, doors) {
    clearTable();
    arranged.forEach((arr, si) => {
      const ids = seatTiles(arr);
      slotsOf(seats[si]).forEach((slot, k) => slot.appendChild(makeTile(ids[k], true)));
      names(si, arr);
    });
    doors.forEach((d, i) => markDoor(i, d));
    const v = dealerVerdict(doors);
    el.dealerTag.textContent = v.t;
    el.dealerTag.className = 'seat-tag ' + v.c;
  }

  // ---------- 面板 ----------
  el.doorPick.innerHTML = P.DOORS.map((d, i) => `<button type="button" data-door="${d}">${d}門 <small>${i + 1}</small></button>`).join('') +
    '<button type="button" class="all" data-door="all">全押</button>';
  el.vipSel.innerHTML = Array.from({ length: P.VIP_MAX }, (_, i) => `<option value="${i + 1}">V${i + 1}</option>`).join('');

  const fmtInt = x => (+x).toLocaleString('en-US');

  function renderBalance() {
    const b = shownBalance ?? game.balance;
    el.balance.textContent = fmt(b);
    el.bankBal.textContent = fmt(b);
  }

  const amountNow = () => P.cents(Math.max(0, +el.bet.value || 0));

  function renderRooms(lock) {
    el.roomPick.innerHTML = P.ROOMS.map(r => {
      const why = banking ? null : P.bankBlock(r, vip, game.balance);
      const on = (banking ? banking.room : roomId) === r.id;
      const dis = lock || !!banking || !!why;
      return `<button type="button" data-room="${r.id}" class="${on ? 'on' : ''}${why && !banking ? ' no' : ''}"${dis ? ' disabled' : ''}>` +
        `<b>${r.name}</b><span>每門 ${fmtInt(r.min)}–${fmtInt(r.max)}</span>` +
        `<span>最大賠付 <em>${fmtInt(P.maxPayout(r))}</em></span>` +
        `<small>${why && !banking ? why : `V${r.vipMin}–V${P.VIP_MAX} 可上莊`}</small></button>`;
    }).join('');
  }

  function renderControls() {
    const lock = dealing || autoRunning;
    const bankMode = mode === 'bank';
    const amount = amountNow();
    const n = picked.size;
    const total = P.cents(amount * n);

    el.modeSeg.querySelectorAll('button').forEach(x => {
      x.classList.toggle('on', x.dataset.mode === mode);
      x.disabled = lock || (!!banking && x.dataset.mode !== 'bank');
    });
    el.playerFields.hidden = el.playerStats.hidden = bankMode;
    el.autoFields.hidden = mode !== 'auto';
    el.bankFields.hidden = !bankMode;

    el.doorPick.querySelectorAll('button').forEach(b => {
      b.classList.toggle('on', b.dataset.door === 'all' ? n === 3 : picked.has(b.dataset.door));
      b.disabled = lock;
    });
    doorSeats.forEach((s, i) => {
      const on = picked.has(P.DOORS[i]);
      s.el.classList.toggle('locked', lock || bankMode);
      if (bankMode) {
        // 上莊：門上的籌碼是其他玩家的押注
        const b = shownRole === 'bank' && shownBets ? shownBets[i] : 0;
        s.el.classList.toggle('bet', b > 0);
        s.chip.hidden = !(b > 0);
        s.chip.classList.remove('zero');
        s.chip.textContent = fmtInt(b);
        s.el.setAttribute('aria-pressed', false);
        s.el.setAttribute('aria-label', `${P.DOORS[i]}門`);
        return;
      }
      // 桌上還留著上一局的牌時，門框維持那一局的押注與勝負，只改下注籌碼的數字
      const mine = shownRole === 'player' ? shownBets : null;
      s.el.classList.toggle('bet', mine ? mine[i] > 0 : on);
      s.el.setAttribute('aria-pressed', on);
      s.el.setAttribute('aria-label', `${P.DOORS[i]}門${on ? '（已押）' : ''}`);
      s.chip.hidden = !(amount > 0) || (!on && !mine);
      s.chip.classList.toggle('zero', !on);
      s.chip.textContent = fmt(on ? amount : 0);
    });

    // 上莊資訊
    el.vipSel.value = vip;
    el.vipSel.disabled = lock || !!banking;
    renderRooms(lock);
    const room = roomOf(banking ? banking.room : roomId);
    el.bankBox.hidden = !banking;
    el.wallet.classList.toggle('locked', !!banking);
    el.dealerName.textContent = banking ? `莊家 ${maskedUid}` : '莊家';
    el.dealerName.classList.toggle('me', !!banking);
    if (banking) {
      el.bankRoom.textContent = `${room.name} · 賠付上限 ${fmtInt(P.maxPayout(room))}`;
      el.bankStatus.hidden = false;
      el.bankStatus.innerHTML = `<div><span>上莊中</span><b>${room.name}</b></div><div><span>已打</span><b>${banking.rounds} 局</b></div>` +
        `<div><span>上莊損益</span><b class="${banking.net > 0 ? 'g' : banking.net < 0 ? 'r' : ''}">${signed(banking.net)}</b></div>`;
    } else el.bankStatus.hidden = true;
    el.unbank.hidden = !banking;
    el.unbank.disabled = lock;

    el.total.textContent = fmt(total);
    el.mult.textContent = '1 賠 1';
    el.pay.textContent = fmt(P.cents(amount * P.WIN_MULT) * n);
    el.prob.innerHTML = `<small>${pct(P.PROB.win, 1)} / ${pct(P.PROB.push, 1)} / ${pct(P.PROB.lose, 1)}</small>`;

    const ok = n > 0 && amount > 0;
    const bankWhy = P.bankBlock(room, vip, game.balance);
    if (bankMode) {
      el.betLine.innerHTML = banking
        ? `你是莊家 <b>${maskedUid}</b>　${room.name} 每門 <b>${fmtInt(room.min)}–${fmtInt(room.max)}</b>　吃輸門、賠贏門（1 賠 1）`
        : bankWhy ? `<span style="color:var(--gold)">${room.name}：${bankWhy}</span>`
          : `上 <b>${room.name}</b> 需鎖定錢包，最大賠付 <b>${fmtInt(P.maxPayout(room))}</b>`;
    } else {
      el.betLine.innerHTML = ok
        ? `押 <b>${[...P.DOORS].filter(d => picked.has(d)).map(d => d + '門').join('、')}</b> 各 <b>${fmt(amount)}</b>　兩對全贏 <span class="g">1 賠 1</span>　一勝一負 <b>走</b>（退回）`
        : '<span style="color:var(--gold)">點桌上的門或左側按鈕，至少押一門</span>';
    }

    el.main.classList.remove('stop');
    el.main.disabled = false;
    if (autoRunning) {
      el.main.classList.add('stop');
      el.main.textContent = autoStopReq ? '停止中…' : '停止自動投注';
    } else if (dealing) {
      el.main.textContent = '開牌中…';
      el.main.disabled = true;
    } else if (bankMode) {
      el.main.textContent = banking ? '開牌' : `上莊（${room.name}）`;
      el.main.disabled = !banking && !!bankWhy;
    } else {
      el.main.textContent = mode === 'auto' ? '開始自動投注' : '開牌';
      el.main.disabled = !ok || total > game.balance + 1e-9;
    }
    document.querySelectorAll('[data-amt]').forEach(x => { x.disabled = lock; });
    el.bet.disabled = lock;
    [el.autoCount, el.onWin, el.onLoss, el.stopProfit, el.stopLoss].forEach(i => { i.disabled = autoRunning; });

    const used = game.shoeInProgress ? game.shoe.used : game.shoe ? P.ROUNDS_PER_SHOE : 0;
    el.nonce.textContent = game.roundNo + (dealing ? 0 : 1);
    el.shoeOut.textContent = `第 ${game.nonce + (game.shoeInProgress || dealing ? 0 : 1)} 副牌 · ${dealing ? used : game.nextShoeRound + 1}/${P.ROUNDS_PER_SHOE} 局`;
    const canTap = mode === 'manual' || (bankMode && banking);
    el.tapHint.classList.toggle('show', canTap && !lock && !el.main.disabled && tableTaps < 3);
    renderBalance();
  }

  function toggleDoor(d) {
    if (dealing || autoRunning || mode === 'bank') return;
    if (d === 'all') {
      if (picked.size === 3) picked.clear(); else P.DOORS.forEach(x => picked.add(x));
    } else if (picked.has(d)) picked.delete(d); else picked.add(d);
    Sound.select();
    save();
    renderControls();
  }

  // ---------- 上莊 / 下莊 ----------
  function takeBank() {
    const room = roomOf(roomId);
    const why = P.bankBlock(room, vip, game.balance);
    if (why) { say(`不能上莊：${why}`); return; }
    banking = { room: room.id, rounds: 0, net: 0 };
    Sound.win(false);
    say(`上莊成功：${room.name}，錢包已鎖定`, true);
    save();
    renderControls();
  }

  function leaveBank(reason) {
    if (!banking) return;
    const b = banking;
    banking = null;
    say(`${reason || '已下莊'}：打了 ${b.rounds} 局，上莊損益 ${signed(b.net)}`, b.net >= 0 && !reason);
    save();
    renderControls();
  }

  // ---------- 牌型大小表 ----------
  function renderRanks() {
    const byGroup = g => P.TILES.filter(t => t.group === g).map(t => t.id);
    const rows = [];
    let no = 0;
    const row = (ids, name, note) => rows.push(`<div class="rk"><span class="no">${++no}</span><span>${minis(ids, 1)}</span><span><b>${name}</b>${note ? ` <small>${note}</small>` : ''}</span></div>`);
    row(byGroup('至尊'), '至尊寶（皇帝）', '丁三＋二四，最大');
    P.PAIR_ORDER.forEach(g => {
      const ids = byGroup(g);
      row(ids.slice(0, 2), P.PAIR_NAME[g], P.TILES[ids[0]].civil ? '文子對' : '武子對');
    });
    const tian = byGroup('天')[0], di = byGroup('地')[0];
    const byVal = v => P.TILES.find(t => !t.civil && t.value === v).id;
    const sp = { 天王: [tian, byVal(9)], 地王: [di, byVal(9)], 天槓: [tian, byVal(8)], 地槓: [di, byVal(8)], 天高九: [tian, byVal(7)], 地高九: [di, byVal(7)] };
    const spNote = { 天王: '天配任一 9 點', 地王: '地配任一 9 點', 天槓: '天配任一 8 點（含人牌）', 地槓: '地配任一 8 點（含人牌）', 天高九: '天配任一 7 點', 地高九: '地配任一 7 點' };
    P.SPECIALS.forEach(s => row(sp[s.name], s.name, spNote[s.name]));
    const singles = [];
    const seen = new Set();
    P.TILES.forEach(t => {
      if (seen.has(t.group)) return;
      seen.add(t.group);
      singles.push(`<span>${P.TILES.filter(x => x.group === t.group).map(x => mini(x.id)).join('')}${t.name}</span>`);
    });
    el.ranks.innerHTML =
      `<h4>牌型（由大到小）</h4>${rows.join('')}` +
      `<h4>一般點數</h4><p>兩張相加取個位數：<b>9 點</b>最大 → 0 點（<b>鱉十</b>）最小。同點數比兩張中較大的一張；再一樣或都是鱉十 → 莊家贏。至尊不成對時可當 3 或 6 點。</p>` +
      `<h4>單張大小（比同點用，由大到小）</h4><div class="singles">${singles.join('')}</div>`;
  }

  // ---------- 紀錄 ----------
  // 閒家局：只押的門亮；上莊局：有人押的門亮
  const resDots = h => P.DOORS.map((d, i) => `<i class="${h.doors[i]}${h.bets[i] ? '' : ' nb'}" title="${d}門 ${OUT_TXT[h.doors[i]]}">${d}</i>`).join('');

  function renderRecent() {
    el.recent.innerHTML = history.slice(0, 10).map(h => {
      const bank = h.role === 'bank';
      return `<span class="rd${h.net > 0 ? ' up' : h.net < 0 ? ' down' : ''}${bank ? ' bk' : ''}" title="#${h.roundNo}${bank ? ' 上莊' : ''} ${signed(h.net)}">${bank ? '<b>莊</b>' : ''}${resDots(h)}</span>`;
    }).join('');
  }

  function renderHistory() {
    if (!history.length) {
      el.myList.innerHTML = '<div class="empty">還沒有紀錄，開一把吧！</div>';
    } else {
      el.myList.innerHTML = history.slice(0, 50).map(h => {
        const who = h.role === 'bank' ? '<span class="bk-tag">上莊</span>' : P.DOORS.filter((d, i) => h.bets[i]).join('');
        return `<div class="row"><span>#${h.roundNo}<small class="sr">${h.round + 1}/2</small></span><span>${who}</span><span class="res">${resDots(h)}</span><span>${fmt(h.total)}</span>` +
          `<span class="${h.net > 0 ? 'g' : h.net < 0 ? 'r' : ''}">${signed(h.net)}</span></div>`;
      }).join('');
    }
    const ps = history.filter(h => h.role !== 'bank'), bs = history.filter(h => h.role === 'bank');
    const wagered = ps.reduce((s, h) => s + h.total, 0);
    const paid = ps.reduce((s, h) => s + h.payout, 0);
    let doorBets = 0, doorWins = 0;
    ps.forEach(h => h.bets.forEach((b, i) => { if (b) { doorBets++; if (h.doors[i] === 'win') doorWins++; } }));
    const net = paid - wagered, bnet = bs.reduce((s, h) => s + h.net, 0);
    el.summary.innerHTML =
      `<div>閒家局數<b>${ps.length}</b></div>` +
      `<div>押門勝率<b>${doorBets ? pct(doorWins / doorBets, 1) : '-'}</b></div>` +
      `<div>閒家損益<b class="${net > 0 ? 'g' : net < 0 ? 'r' : ''}">${signed(net)}</b></div>` +
      `<div>實際回報<b>${wagered ? pct(paid / wagered) : '-'}</b></div>` +
      `<div>上莊局數<b>${bs.length}</b></div>` +
      `<div>上莊損益<b class="${bnet > 0 ? 'g' : bnet < 0 ? 'r' : ''}">${signed(bnet)}</b></div>`;
    renderRecent();
  }

  function record(r) {
    history.unshift({
      role: r.role, roundNo: r.roundNo, shoe: r.shoe, round: r.round, room: r.room,
      bets: r.bets, doors: r.doors.map(d => d.outcome), total: r.total, payout: r.payout, net: r.net,
      arranged: r.arranged.map(a => ({ front: a.front, back: a.back })),
      serverHash: r.serverHash, serverSeed: r.serverSeed, clientSeed: r.clientSeed, t: Date.now()
    });
    // 這副牌打完：把種子補進同一副牌的第 1 局
    if (r.shoeDone) history.forEach(h => { if (h.shoe === r.shoe) h.serverSeed = r.serverSeed; });
    if (history.length > 100) history.length = 100;
  }

  function bumpWallet() {
    el.wallet.classList.remove('bump');
    void el.wallet.offsetWidth;
    el.wallet.classList.add('bump');
    el.bankBox.classList.remove('bump');
    void el.bankBox.offsetWidth;
    el.bankBox.classList.add('bump');
  }

  function refillIfBroke() {
    if (game.balance < 0.1 && !banking) {
      game.balance = START_BALANCE;
      say(`遊戲幣用完了，已補回 ${START_BALANCE}`, true);
    }
  }

  // ---------- 一局 ----------
  function showResult(r) {
    const v = dealerVerdict(r.doors);
    el.dealerTag.textContent = v.t;
    el.dealerTag.className = 'seat-tag ' + v.c;
    const net = r.net;
    let cls, big, sub;
    if (r.role === 'bank') {
      cls = net > 0 ? 'win' : net < 0 ? 'lose' : 'push';
      big = net ? signed(net) : '0.00';
      sub = v.t ? `莊家${v.t}` : net > 0 ? '莊家吃' : net < 0 ? '莊家賠' : '桌上打平';
    } else {
      const betOutcomes = r.doors.filter((d, i) => r.bets[i]).map(d => d.outcome);
      if (net > 0) { cls = 'win'; big = signed(net); sub = `派彩 ${fmt(r.payout)}`; }
      else if (net < 0) { cls = 'lose'; big = signed(net); sub = betOutcomes.some(o => o !== 'lose') ? `派彩 ${fmt(r.payout)}` : (v.t === '通殺' ? '莊家通殺' : '沒中'); }
      else { cls = 'push'; big = '走'; sub = `退回 ${fmt(r.payout)}`; }
      if (v.t === '通賠' && net > 0) sub = '莊家通賠！' + sub;
    }
    el.resultVal.textContent = big;
    el.resultSub.textContent = sub;
    el.result.className = 'result ' + cls;
    el.result.hidden = false;
    if (cls === 'win') { Sound.win(v.t !== ''); bumpWallet(); } else if (cls === 'lose') Sound.lose(); else Sound.push();
  }

  async function doRound(fast) {
    if (dealing) return null;
    let r;
    try {
      if (mode === 'bank') {
        if (!banking) return null;
        const room = roomOf(banking.room);
        r = game.bank(room, vip, P.randomTableBets(room));
      } else {
        const amount = readBet();
        const bets = {};
        P.DOORS.forEach(d => { bets[d] = picked.has(d) ? amount : 0; });
        r = game.play(bets);
      }
    } catch (e) { say(e.message); return null; }
    record(r);
    if (r.role === 'bank') { banking.rounds += 1; banking.net = P.cents(banking.net + r.net); }
    save();
    dealing = true;
    shownBets = r.bets;
    shownRole = r.role;
    shownBalance = P.cents(game.balance - (r.role === 'bank' ? r.net : r.payout));
    clearTable();
    fast = fast || reduceMotion;
    const T = ms => wait(fast ? ms * 0.35 : ms);
    // 新的一副牌：補滿牌墩再洗；第 2 局直接從剩下的牌墩發
    if (r.round === 0) {
      setWall(0);
      Sound.shuffle();
      if (!fast) {
        el.wall.classList.remove('shuffle');
        void el.wall.offsetWidth;
        el.wall.classList.add('shuffle');
      }
      el.shoeTag.textContent = '洗牌中';
      await T(450);
      el.wall.classList.remove('shuffle');
    } else {
      setWall(1);
      await T(150);
    }
    el.shoeTag.textContent = `第 ${r.round + 1} 局`;
    renderControls();
    // 發牌：莊、初、川、尾
    for (let si = 0; si < 4; si++) { dealSeat(si, r.arranged[si], r.round, fast); await T(220); }
    await T(380);
    // 三門先翻，莊家最後翻
    for (let di = 0; di < 3; di++) {
      flipSeat(di + 1);
      await T(160);
      names(di + 1, r.arranged[di + 1]);
      await T(240);
    }
    await T(350);
    flipSeat(0);
    await T(180);
    names(0, r.arranged[0]);
    await T(300);
    r.doors.forEach((d, i) => markDoor(i, d));

    dealing = false;
    shownBalance = null;
    setWall(r.round + 1);
    showResult(r);
    if (banking && P.bankBlock(roomOf(banking.room), vip, game.balance)) leaveBank('錢包低於最大賠付，自動下莊');
    refillIfBroke();
    save();
    renderHistory();
    renderControls();
    return r;
  }

  function readBet() {
    const v = amountNow();
    el.bet.value = v.toFixed(2);
    return v;
  }

  // ---------- 自動投注 ----------
  async function runAuto() {
    const baseBet = readBet();
    const rounds = Math.max(0, Math.floor(+el.autoCount.value || 0));
    const onWin = Math.max(0, +el.onWin.value || 0);
    const onLoss = Math.max(0, +el.onLoss.value || 0);
    const stopProfit = Math.max(0, +el.stopProfit.value || 0);
    const stopLoss = Math.max(0, +el.stopLoss.value || 0);
    let amount = baseBet;
    let net = 0;
    let done = 0;
    autoRunning = true;
    autoStopReq = false;
    renderControls();
    while (!autoStopReq && (rounds === 0 || done < rounds)) {
      if (amount * picked.size > game.balance + 1e-9) { say('餘額不足，自動投注停止'); break; }
      el.bet.value = amount.toFixed(2);
      const r = await doRound(el.fast.checked);
      if (!r) break;
      net += r.net;
      done += 1;
      if (rounds) el.autoCount.value = rounds - done;
      if (r.net > 0) amount = onWin ? P.cents(amount * (1 + onWin / 100)) : baseBet;
      else if (r.net < 0) amount = onLoss ? P.cents(amount * (1 + onLoss / 100)) : baseBet;
      amount = Math.max(0.01, amount);
      if (stopProfit && net >= stopProfit) { say(`已達獲利目標 ${fmt(net)}`, true); break; }
      if (stopLoss && -net >= stopLoss) { say(`已達虧損上限 ${fmt(net)}`); break; }
      await wait(el.fast.checked ? 400 : 900);
    }
    if (rounds) el.autoCount.value = rounds;
    el.bet.value = baseBet.toFixed(2);
    autoRunning = false;
    autoStopReq = false;
    save();
    renderControls();
  }

  // ---------- 事件 ----------
  el.main.addEventListener('click', () => {
    if (autoRunning) { autoStopReq = true; renderControls(); return; }
    if (mode === 'auto') runAuto();
    else if (mode === 'bank' && !banking) takeBank();
    else doRound(el.fast.checked);
  });
  el.unbank.addEventListener('click', () => { if (!dealing) leaveBank(); });

  // 點桌面上半部（莊家、牌墩）也能開牌：手動模式或上莊中；下方三門是押門用
  el.table.addEventListener('click', e => {
    if (e.target.closest('.doors') || autoRunning || el.main.disabled) return;
    if (!(mode === 'manual' || (mode === 'bank' && banking))) return;
    tableTaps += 1;
    el.main.click();
  });

  el.doorPick.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b && !b.disabled) toggleDoor(b.dataset.door);
  });
  doorSeats.forEach(s => {
    s.el.addEventListener('click', () => toggleDoor(s.el.dataset.door));
    s.el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); toggleDoor(s.el.dataset.door); } });
  });

  el.roomPick.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled || banking) return;
    roomId = b.dataset.room;
    Sound.select();
    save();
    renderControls();
  });
  el.vipSel.addEventListener('change', () => { vip = +el.vipSel.value; save(); renderControls(); });

  document.querySelectorAll('[data-amt]').forEach(b => b.addEventListener('click', () => {
    const v = +el.bet.value || 0;
    const a = b.dataset.amt;
    const cap = game.balance / Math.max(1, picked.size);
    const n = a === 'half' ? v / 2 : a === 'double' ? v * 2 : cap;
    el.bet.value = P.cents(Math.min(cap, Math.max(0.01, n))).toFixed(2);
    save();
    renderControls();
  }));
  el.bet.addEventListener('change', () => { readBet(); save(); renderControls(); });
  el.bet.addEventListener('input', renderControls);
  el.fast.addEventListener('change', save);

  el.modeSeg.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled || dealing || autoRunning || banking) return;
    mode = b.dataset.mode;
    renderControls();
  });

  document.querySelector('.tabs').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.tab-body').forEach(x => { x.hidden = x.id !== 'tab-' + b.dataset.tab; });
  });

  el.sound.addEventListener('click', () => { el.sound.classList.toggle('off', !Sound.toggle()); });
  el.sound.classList.toggle('off', !Sound.enabled);

  document.addEventListener('keydown', e => {
    if (e.target.closest('input, select, textarea, dialog, .door')) return;
    if (e.code === 'Space') { e.preventDefault(); if (!el.main.disabled) el.main.click(); }
    else if (/^[123]$/.test(e.key)) toggleDoor(P.DOORS[+e.key - 1]);
  });

  // ---------- 公平性 ----------
  function renderVerify() {
    const s = el.vServer.value.trim(), c = el.vClient.value.trim();
    const nonce = Math.floor(+el.vNonce.value), round = +el.vRound.value;
    if (!s || !c || !(nonce >= 1)) {
      el.verifyOut.innerHTML = '<span class="r">請填入完整資料（進行中的這副牌要打完第 2 局才有種子）</span>';
      return;
    }
    let r;
    try { r = P.deal(s, c, nonce, round); } catch (e) { el.verifyOut.innerHTML = '<span class="r">種子只能包含英數字元</span>'; return; }
    const line = (si, label) => {
      const a = r.arranged[si];
      const f = P.evalPair(a.front[0], a.front[1]).name, b = P.evalPair(a.back[0], a.back[1]).name;
      const out = si ? `　<span class="${r.doors[si - 1].outcome === 'win' ? 'g' : r.doors[si - 1].outcome === 'lose' ? 'r' : ''}">${OUT_TXT[r.doors[si - 1].outcome]}</span>` : '';
      return `<b>${label}</b><span>${minis(seatTiles(a), 1)}　前 ${f}／後 ${b}${out}</span>`;
    };
    el.verifyOut.innerHTML = `SHA256(伺服器種子) = <span class="g">${window.sha256(s)}</span><br>` +
      `整副牌序：${r.deck.join(', ')}<br>第 ${round + 1} 局用第 ${round * 16 + 1}–${round * 16 + 16} 張` +
      `<div class="vs">${line(0, '莊家')}${line(1, '初門')}${line(2, '川門')}${line(3, '尾門')}</div>`;
  }

  $('#fairBtn').addEventListener('click', () => {
    el.clientSeed.value = game.clientSeed;
    el.nextHash.textContent = game.nextServerHash;
    el.curHashField.hidden = !game.shoeInProgress;
    if (game.shoeInProgress) el.curHash.textContent = window.sha256(game.shoe.serverSeed);
    const last = history.find(h => h.serverSeed);
    el.vServer.value = last ? last.serverSeed : '';
    el.vClient.value = last ? last.clientSeed : '';
    el.vNonce.value = last ? last.shoe : '';
    el.vRound.value = last ? last.round : 0;
    renderVerify();
    el.fair.showModal();
  });
  [el.vServer, el.vClient, el.vNonce, el.vRound].forEach(i => i.addEventListener('input', renderVerify));
  el.clientSeed.addEventListener('change', () => {
    const v = el.clientSeed.value.replace(/[^\x20-\x7e]/g, '').trim();
    if (!v) { el.clientSeed.value = game.clientSeed; return; }
    game.clientSeed = v;
    el.clientSeed.value = v;
    save();
  });
  $('#seedRandom').addEventListener('click', () => {
    game.clientSeed = P.randomHex(8);
    game.nextServerSeed = P.randomHex(32);
    el.clientSeed.value = game.clientSeed;
    el.nextHash.textContent = game.nextServerHash;
    save();
  });

  // ---------- 初始化 ----------
  const rtpTxt = pct(P.RTP);
  el.rtp.textContent = `RTP ${rtpTxt}`;
  el.demoTag.textContent = `模擬遊戲幣 · 非真錢 · 1 賠 1 · RTP ${rtpTxt}`;
  $('#ruleRtp').textContent = rtpTxt;
  $('#ruleRtp2').textContent = pct(P.RTP, 3);
  $('#ruleEdge').textContent = pct(P.PROB.lose - P.PROB.win, 3);
  $('#rulePw').textContent = pct(P.PROB.win, 3);
  $('#rulePp').textContent = pct(P.PROB.push, 3);
  $('#rulePl').textContent = pct(P.PROB.lose, 3);
  $('#roomRules').innerHTML = P.ROOMS.map(r => `${r.name} 每門 ${fmtInt(r.min)}–${fmtInt(r.max)}（最大賠付 ${fmtInt(P.maxPayout(r))}，V${r.vipMin}–V${P.VIP_MAX}）`).join('；');
  renderRanks();
  setWall(game.shoeInProgress ? game.shoe.used : game.shoe ? P.ROUNDS_PER_SHOE : 0);
  const last = history[0];
  if (last && last.arranged) {
    const dealer = P.arrange(seatTiles(last.arranged[0]));
    placeRound(last.arranged, last.arranged.slice(1).map(a => P.compare(P.arrange(seatTiles(a)), dealer)));
    shownBets = last.bets;
    shownRole = last.role;
  }
  save();
  renderHistory();
  renderControls();
  window.addEventListener('beforeunload', save);
})();
