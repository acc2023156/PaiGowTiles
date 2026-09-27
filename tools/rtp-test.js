/* 驗證：node tools/rtp-test.js
   1. 窮舉所有「莊家 4 張 × 一門 4 張」（35,960 × 20,475 組）算出單門的贏／走／輸機率與 RTP
   2. 用 PaiGowGame 跑蒙地卡羅核對實際派彩
   3. 幾個牌型的抽查 */
'use strict';
const P = require('../js/engine.js');

let fail = 0;
const check = (cond, msg) => { if (!cond) { fail++; console.log('✗', msg); } };

// ---------- 牌組 ----------
check(P.TILES.length === 32, '32 張牌');
check(P.TILES.reduce((s, t) => s + t.value, 0) === 227, '點數總和 227');

// ---------- 牌型抽查 ----------
const id = (name, pips) => P.TILES.find(t => t.name === name && (!pips || t.pips.join() === pips)).id;
const idx = name => P.TILES.filter(t => t.name === name).map(t => t.id);
const ev = (a, b) => P.evalPair(a, b);
const [t1, t2] = idx('天'), [d1, d2] = idx('地'), [r1] = idx('人');
const z12 = id('至尊', '1,2'), z24 = id('至尊', '2,4');
check(ev(z12, z24).name === '至尊寶', '至尊寶');
check(ev(t1, t2).name === '雙天' && ev(t1, t2).score < ev(z12, z24).score, '雙天 < 至尊寶');
check(ev(id('雜五', '1,4'), id('雜五', '2,3')).name === '雜五對', '雜五對（武子不同點也算對）');
check(ev(t1, id('雜九', '4,5')).name === '天王', '天王');
check(ev(d1, id('雜九', '3,6')).name === '地王', '地王');
check(ev(t1, r1).name === '天槓', '天配人 = 天槓');
check(ev(d1, id('高腳七')).name === '地高九', '地高九');
check(ev(id('雜五', '2,3'), id('梅')).name === '5 點', '5+10 = 5 點');
check(ev(z12, id('雜九', '4,5')).pts === 5, '丁三當 6：6+9 = 5 點（比 3+9=2 大）');
check(ev(z24, id('雜五', '1,4')).pts === 8, '二四當 3：3+5 = 8 點（比 6+5=1 大）');
check(ev(id('梅'), id('紅頭十')).name === '鱉十' && ev(id('梅'), id('紅頭十')).score === 0, '鱉十 = 0 分');
check(ev(t1, d1).score > ev(id('鵝'), id('梅')).score, '同為 4 點：天地 > 鵝梅（比大牌）');

// ---------- 窮舉 ----------
const hands = [];
for (let a = 0; a < 32; a++) for (let b = a + 1; b < 32; b++) for (let c = b + 1; c < 32; c++) for (let d = c + 1; d < 32; d++) hands.push([a, b, c, d]);
const N = hands.length;
const mask = new Int32Array(N), lo = new Int16Array(N), hi = new Int16Array(N);
hands.forEach((h, i) => {
  mask[i] = h.reduce((m, t) => m | (1 << t), 0);
  const r = P.arrange(h);
  lo[i] = r.lo; hi[i] = r.hi;
  if (r.lo > r.hi) fail++;
});
const t0 = Date.now();
let win = 0, push = 0, lose = 0;
for (let i = 0; i < N; i++) {
  const mi = mask[i], li = lo[i], hI = hi[i];
  for (let j = 0; j < N; j++) {
    if (mi & mask[j]) continue;
    const f = lo[j] > li, b = hi[j] > hI; // j = 門，i = 莊
    if (f && b) win++; else if (!f && !b) lose++; else push++;
  }
}
const total = win + push + lose;
check(total === N * 20475, '組合數');
const pw = win / total, pp = push / total, pl = lose / total;
console.log(`窮舉 ${total.toLocaleString()} 組（${Date.now() - t0} ms）`);
console.log(`次數  贏 ${win}  走 ${push}  輸 ${lose}`);
console.log(`單門  贏 ${(pw * 100).toFixed(4)}%  走 ${(pp * 100).toFixed(4)}%  輸 ${(pl * 100).toFixed(4)}%`);
console.log(`RTP = 走 + 倍數 × 贏：`);
for (const m of [1.9, 1.95, 1.96, 1.97, 1.98, 2]) console.log(`  ${m.toFixed(2)}× → ${((pp + m * pw) * 100).toFixed(4)}%`);
console.log(`98% 需要倍數 ${((0.98 - pp) / pw).toFixed(5)}`);
console.log(`目前 WIN_MULT = ${P.WIN_MULT} → RTP ${((pp + P.WIN_MULT * pw) * 100).toFixed(4)}%`);
console.log(`引擎常數 PROB = ${JSON.stringify(P.PROB)} RTP = ${P.RTP}`);
check(Math.abs(P.PROB.win - pw) < 1e-9 && Math.abs(P.PROB.push - pp) < 1e-9, 'engine PROB 與窮舉一致');
check(Math.abs(P.RTP - (pp + P.WIN_MULT * pw)) < 1e-9, 'engine RTP 與窮舉一致');

// ---------- 蒙地卡羅 ----------
const g = new P.PaiGowGame({ balance: 1e12 });
const R = 200000;
let bet = 0, paid = 0;
for (let k = 0; k < R; k++) {
  const r = g.play({ 初: 1, 川: 1, 尾: 1 });
  bet += r.total; paid += r.payout;
}
console.log(`蒙地卡羅 ${R.toLocaleString()} 局 × 3 門：RTP ${(paid / bet * 100).toFixed(3)}%`);
check(Math.abs(paid / bet - (pp + P.WIN_MULT * pw)) < 0.006, '蒙地卡羅 RTP 接近理論值');

// ---------- 公平性：同種子同結果 ----------
const a = P.deal('s', 'c', 7), b = P.deal('s', 'c', 7);
check(a.deck.join() === b.deck.join(), '同種子同牌序');
check(new Set(a.deck).size === 32, '洗牌不重複');

console.log(fail ? `\n${fail} 項失敗` : '\n全部通過');
process.exit(fail ? 1 : 0);
