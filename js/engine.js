/* 黑粒仔（台灣推牌九）遊戲引擎：一莊三門，每家 4 張骨牌分前、後兩對「公比」。
   不碰 DOM，Node 也能跑（見 tools/rtp-test.js）。 */
(function (global) {
  'use strict';

  const sha256 = global.sha256 || (typeof require !== 'undefined' && require('./sha256.js') && global.sha256);

  // ---------- 32 張骨牌 ----------
  // 文子 11 種各 2 張、武子 10 張各 1 張。rank：單張大小（比同點用），group：同 group 兩張成對
  const KINDS = [
    { name: '天', pips: [6, 6], rank: 16, group: '天', civil: true },
    { name: '地', pips: [1, 1], rank: 15, group: '地', civil: true },
    { name: '人', pips: [4, 4], rank: 14, group: '人', civil: true },
    { name: '鵝', pips: [1, 3], rank: 13, group: '鵝', civil: true },
    { name: '梅', pips: [5, 5], rank: 12, group: '梅', civil: true },
    { name: '長三', pips: [3, 3], rank: 11, group: '長三', civil: true },
    { name: '板凳', pips: [2, 2], rank: 10, group: '板凳', civil: true },
    { name: '斧頭', pips: [5, 6], rank: 9, group: '斧頭', civil: true },
    { name: '紅頭十', pips: [4, 6], rank: 8, group: '紅頭十', civil: true },
    { name: '高腳七', pips: [1, 6], rank: 7, group: '高腳七', civil: true },
    { name: '銅錘六', pips: [1, 5], rank: 6, group: '銅錘六', civil: true },
    { name: '雜九', pips: [4, 5], rank: 5, group: '雜九' },
    { name: '雜九', pips: [3, 6], rank: 5, group: '雜九' },
    { name: '雜八', pips: [3, 5], rank: 4, group: '雜八' },
    { name: '雜八', pips: [2, 6], rank: 4, group: '雜八' },
    { name: '雜七', pips: [3, 4], rank: 3, group: '雜七' },
    { name: '雜七', pips: [2, 5], rank: 3, group: '雜七' },
    { name: '雜五', pips: [1, 4], rank: 2, group: '雜五' },
    { name: '雜五', pips: [2, 3], rank: 2, group: '雜五' },
    { name: '至尊', pips: [1, 2], rank: 1, group: '至尊' },
    { name: '至尊', pips: [2, 4], rank: 1, group: '至尊' }
  ];
  // TILES[id]，id 0–31
  const TILES = [];
  KINDS.forEach((k, kind) => {
    for (let c = 0; c < (k.civil ? 2 : 1); c++) {
      TILES.push(Object.assign({ id: TILES.length, kind, value: k.pips[0] + k.pips[1] }, k));
    }
  });

  // 對子由大到小（至尊寶另計，排在最上面）
  const PAIR_ORDER = ['天', '地', '人', '鵝', '梅', '長三', '板凳', '斧頭', '紅頭十', '高腳七', '銅錘六', '雜九', '雜八', '雜七', '雜五'];
  const PAIR_NAME = {
    天: '雙天', 地: '雙地', 人: '雙人', 鵝: '雙鵝', 梅: '雙梅', 長三: '雙長三', 板凳: '雙板凳', 斧頭: '雙斧頭',
    紅頭十: '雙紅頭', 高腳七: '雙高腳', 銅錘六: '雙銅錘', 雜九: '雜九對', 雜八: '雜八對', 雜七: '雜七對', 雜五: '雜五對'
  };
  // 天/地 配 9、8、7 的特殊牌（王 > 槓 > 高九）
  const SPECIALS = [
    { name: '天王', head: '天', value: 9 },
    { name: '地王', head: '地', value: 9 },
    { name: '天槓', head: '天', value: 8 },
    { name: '地槓', head: '地', value: 8 },
    { name: '天高九', head: '天', value: 7 },
    { name: '地高九', head: '地', value: 7 }
  ];

  const S_SUPREME = 1000;
  const S_PAIR = 900;     // 900 + 15 - i
  const S_SPECIAL = 850;  // 850 - i
  // 一般點數：點數 × 20 + 較大那張的 rank（0 點一律 0 → 鱉十遇鱉十莊家贏）

  const points = (a, b) => {
    // 至尊（丁三、二四）可當 3 或 6 點，取較大
    const vals = t => (t.group === '至尊' ? [3, 6] : [t.value]);
    let best = 0;
    for (const x of vals(a)) for (const y of vals(b)) best = Math.max(best, (x + y) % 10);
    return best;
  };

  // 兩張牌的牌型：{ score, name, kind: 'supreme'|'pair'|'special'|'points', pts }
  function evalPair(a, b) {
    const A = TILES[a], B = TILES[b];
    if (A.group === B.group) {
      if (A.group === '至尊') return { score: S_SUPREME, name: '至尊寶', kind: 'supreme' };
      const i = PAIR_ORDER.indexOf(A.group);
      return { score: S_PAIR + 15 - i, name: PAIR_NAME[A.group], kind: 'pair' };
    }
    for (let i = 0; i < SPECIALS.length; i++) {
      const s = SPECIALS[i];
      if ((A.group === s.head && B.value === s.value) || (B.group === s.head && A.value === s.value)) {
        return { score: S_SPECIAL - i, name: s.name, kind: 'special' };
      }
    }
    const pts = points(A, B);
    const hi = Math.max(A.rank, B.rank);
    return { score: pts ? pts * 20 + hi : 0, name: pts ? `${pts} 點` : '鱉十', kind: 'points', pts };
  }

  // 只要分數的快速版（窮舉用）
  const scoreCache = new Int16Array(32 * 32);
  for (let a = 0; a < 32; a++) for (let b = 0; b < 32; b++) if (a !== b) scoreCache[a * 32 + b] = evalPair(a, b).score;
  const pairScore = (a, b) => scoreCache[a * 32 + b];

  // 4 張的三種分法：[前(小)對, 後(大)對]
  const SPLITS = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];

  // 配牌法（莊家與各門相同）：前對盡量大；前對一樣時後對盡量大。後對一定 ≥ 前對
  function arrange(hand) {
    let best = null;
    for (const [p, q] of SPLITS) {
      let x = [hand[p[0]], hand[p[1]]], y = [hand[q[0]], hand[q[1]]];
      let sx = pairScore(x[0], x[1]), sy = pairScore(y[0], y[1]);
      if (sx > sy) { [x, y] = [y, x]; [sx, sy] = [sy, sx]; }
      if (!best || sx > best.lo || (sx === best.lo && sy > best.hi)) best = { front: x, back: y, lo: sx, hi: sy };
    }
    return best;
  }

  // 一門對莊家：分數嚴格較大才贏，相同算莊家贏（同點莊吃）
  // 兩對都贏 = win，都輸 = lose，一勝一負 = push（走）
  function compare(door, dealer) {
    const f = door.lo > dealer.lo, b = door.hi > dealer.hi;
    return { front: f, back: b, outcome: f && b ? 'win' : !f && !b ? 'lose' : 'push' };
  }

  // 單門的精確機率：窮舉全部 35,960 × 20,475 = 736,281,000 種「莊家 4 張 × 該門 4 張」（tools/rtp-test.js）
  const PROB = { win: 268894332 / 736281000, push: 193406044 / 736281000, lose: 273980624 / 736281000 };
  // 贏了抽水 4%：派彩 = 下注 × 1.96（含本金）；走 = 退回本金
  const COMMISSION = 0.04;
  const WIN_MULT = 2 - COMMISSION;
  const RTP = PROB.push + WIN_MULT * PROB.win; // 97.85%

  const DOORS = ['初', '川', '尾'];
  const SEATS = ['莊', '初', '川', '尾'];

  function randomHex(bytes) {
    const a = new Uint8Array(bytes);
    const c = global.crypto || (typeof require !== 'undefined' ? require('crypto').webcrypto : null);
    c.getRandomValues(a);
    return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
  }

  // 由種子產生 0~1 浮點數串流：每個 SHA-256 取 8 組 32-bit
  function floats(serverSeed, clientSeed, nonce, count) {
    const out = [];
    for (let cursor = 0; out.length < count; cursor++) {
      const h = sha256(`${serverSeed}:${clientSeed}:${nonce}:${cursor}`);
      for (let i = 0; i < 64 && out.length < count; i += 8) out.push(parseInt(h.slice(i, i + 8), 16) / 0x100000000);
    }
    return out;
  }

  // 洗牌：Fisher–Yates，第 k 步（i = 31 → 1）與 floor(float_k × (i+1)) 交換
  function shuffle(serverSeed, clientSeed, nonce) {
    const deck = Array.from({ length: 32 }, (_, i) => i);
    const f = floats(serverSeed, clientSeed, nonce, 31);
    for (let i = 31, k = 0; i > 0; i--, k++) {
      const j = Math.floor(f[k] * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  // 發牌：牌墩順序 莊、初、川、尾 各 4 張，其餘 16 張不用
  function deal(serverSeed, clientSeed, nonce) {
    const deck = shuffle(serverSeed, clientSeed, nonce);
    const hands = SEATS.map((_, s) => deck.slice(s * 4, s * 4 + 4));
    const arranged = hands.map(arrange);
    const dealer = arranged[0];
    const doors = DOORS.map((_, d) => compare(arranged[d + 1], dealer));
    return { deck, hands, arranged, doors };
  }

  const cents = x => Math.floor(x * 100 + 1e-7) / 100;

  class PaiGowGame {
    constructor(opts = {}) {
      this.balance = opts.balance ?? 1000;
      this.clientSeed = opts.clientSeed || randomHex(8);
      this.nonce = opts.nonce || 0;
      this.nextServerSeed = randomHex(32);
    }

    get nextServerHash() { return sha256(this.nextServerSeed); }

    // bets：{ 初: 金額, 川: 金額, 尾: 金額 }（沒押的門給 0）。下注並立即結算
    play(rawBets) {
      const bets = DOORS.map(d => cents(Math.max(0, +(rawBets && rawBets[d]) || 0)));
      const total = cents(bets.reduce((a, b) => a + b, 0));
      if (!(total > 0)) throw new Error('請至少押一門');
      if (total > this.balance + 1e-9) throw new Error('餘額不足');
      const serverSeed = this.nextServerSeed;
      this.nextServerSeed = randomHex(32);
      this.nonce += 1;
      const r = deal(serverSeed, this.clientSeed, this.nonce);
      const pays = r.doors.map((d, i) => (!bets[i] ? 0 : d.outcome === 'win' ? cents(bets[i] * WIN_MULT) : d.outcome === 'push' ? bets[i] : 0));
      const payout = cents(pays.reduce((a, b) => a + b, 0));
      this.balance = cents(this.balance - total + payout);
      return Object.assign(r, {
        nonce: this.nonce, bets, total, pays, payout,
        serverSeed, serverHash: sha256(serverSeed), clientSeed: this.clientSeed
      });
    }
  }

  global.PaiGow = {
    TILES, KINDS, PAIR_ORDER, PAIR_NAME, SPECIALS, DOORS, SEATS, SPLITS, WIN_MULT, COMMISSION, PROB, RTP,
    evalPair, pairScore, points, arrange, compare, shuffle, deal, floats, randomHex, cents, PaiGowGame
  };
  if (typeof module !== 'undefined') module.exports = global.PaiGow;
})(typeof window !== 'undefined' ? window : globalThis);
