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
console.log(`壓一賠一 RTP = 走 + 2 × 贏 = ${((pp + 2 * pw) * 100).toFixed(4)}%（莊家優勢 = 輸 − 贏 = ${((pl - pw) * 100).toFixed(4)}%）`);
console.log(`引擎常數 PROB = ${JSON.stringify(P.PROB)} RTP = ${P.RTP}`);
check(Math.abs(P.PROB.win - pw) < 1e-9 && Math.abs(P.PROB.push - pp) < 1e-9, 'engine PROB 與窮舉一致');
check(Math.abs(P.RTP - (pp + P.WIN_MULT * pw)) < 1e-9, 'engine RTP 與窮舉一致');

// ---------- 蒙地卡羅（一副牌打兩局） ----------
const g = new P.PaiGowGame({ balance: 1e12 });
const R = 300000;
const bet = [0, 0], paid = [0, 0];
const dist = new Map(); // 三門各押 1 時，莊家每局淨值的分布
let sh = 0, sh2 = 0;
for (let k = 0; k < R; k++) {
  const r = g.play({ 初: 1, 川: 1, 尾: 1 });
  bet[r.round] += r.total; paid[r.round] += r.payout;
  const bankNet = r.total - r.payout;
  dist.set(bankNet, (dist.get(bankNet) || 0) + 1);
  sh += bankNet; sh2 += bankNet * bankNet;
}
const rtpAll = (paid[0] + paid[1]) / (bet[0] + bet[1]);
console.log(`\n蒙地卡羅 ${R.toLocaleString()} 局 × 3 門：RTP ${(rtpAll * 100).toFixed(3)}%（第 1 局 ${(paid[0] / bet[0] * 100).toFixed(3)}%，第 2 局 ${(paid[1] / bet[1] * 100).toFixed(3)}%）`);
check(Math.abs(rtpAll - P.RTP) < 0.005, '蒙地卡羅 RTP 接近理論值');
check(Math.abs(paid[1] / bet[1] - P.RTP) < 0.007, '同一副牌第 2 局的 RTP 不變');

// ---------- 上莊起伏 ----------
const mean1 = sh / R, sd1 = Math.sqrt(sh2 / R - mean1 * mean1);
console.log('\n【上莊】三門各押 1、莊家每局淨值分布：');
[...dist.keys()].sort((a, b) => a - b).forEach(v => console.log(`  ${v > 0 ? '+' : ''}${v}：${(dist.get(v) / R * 100).toFixed(2)}%${v === -3 ? '（通賠）' : v === 3 ? '（通殺）' : ''}`));
console.log(`  平均 +${mean1.toFixed(4)}／局（= 桌上押注的 ${(mean1 / 3 * 100).toFixed(3)}%），標準差 ${sd1.toFixed(3)}／局`);
const sdInd = Math.sqrt(3 * (pw + pl - (pl - pw) ** 2));
console.log(`  三門同一莊家牌 → 正相關：標準差 ${sd1.toFixed(3)}，若三門獨立只有 ${sdInd.toFixed(3)}`);

// 以 UI 的模擬押注跑上莊：起始資金 = k × 最大賠付，打 N 局；資金 < 最大賠付就被迫下莊
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
console.log('\n【上莊】模擬押注（每門 85% 有人押、金額在場次範圍內均勻）');
for (const room of P.ROOMS) {
  const rnd = lcg(12345);
  const mp = P.maxPayout(room);
  const bg = new P.PaiGowGame({ balance: 1e15 });
  const T = 200000;
  let s1 = 0, s2 = 0, tb = 0;
  const nets = [];
  for (let k = 0; k < T; k++) {
    const r = bg.bank(room, 8, P.randomTableBets(room, rnd));
    s1 += r.net; s2 += r.net * r.net; tb += r.total; nets.push(r.net);
  }
  const m = s1 / T, sd = Math.sqrt(s2 / T - m * m);
  console.log(`  ${room.name}（每門 ${room.min}–${room.max}，最大賠付 ${mp}）：每局平均 +${m.toFixed(3)}，標準差 ${sd.toFixed(2)}，莊家抽到桌上押注的 ${(s1 / tb * 100).toFixed(3)}%`);
  const rows = [];
  for (const N of [100, 500]) {
    for (const k of [1, 3, 10, 30]) {
      let forced = 0, sum = 0; const ends = [];
      const S = 4000;
      for (let t = 0; t < S; t++) {
        let bal = k * mp, n = 0;
        for (; n < N; n++) {
          bal += nets[Math.floor(rnd() * T)];
          if (bal < mp) { forced++; break; }
        }
        ends.push(bal - k * mp); sum += bal - k * mp;
      }
      ends.sort((a, b) => a - b);
      rows.push(`    ${N} 局、起始 ${k}× 最大賠付（${(k * mp).toLocaleString()}）：被迫下莊 ${(forced / S * 100).toFixed(1)}%，損益 P5 ${ends[Math.floor(S * 0.05)].toFixed(0)} / 中位 ${ends[Math.floor(S / 2)].toFixed(0)} / P95 +${ends[Math.floor(S * 0.95)].toFixed(0)}`);
    }
  }
  console.log(rows.join('\n'));
}

// ---------- 公平性：同種子同結果 ----------
const a = P.deal('s', 'c', 7), b = P.deal('s', 'c', 7), a2 = P.deal('s', 'c', 7, 1);
check(a.deck.join() === b.deck.join(), '同種子同牌序');
check(new Set(a.deck).size === 32, '洗牌不重複');
check(new Set([...a.hands.flat(), ...a2.hands.flat()]).size === 32, '同一副牌兩局用完 32 張');
const sg = new P.PaiGowGame();
const s1 = sg.play({ 初: 1 }), s2 = sg.play({ 初: 1 }), s3 = sg.play({ 初: 1 });
check(s1.shoe === s2.shoe && s3.shoe === s1.shoe + 1, '兩局後換新牌');
check(s1.serverSeed === null && s2.serverSeed && P.deal(s2.serverSeed, s2.clientSeed, s2.shoe, 0).deck.join() === s1.deck.join(), '第 1 局不公開種子，打完第 2 局才公開且可驗證');
check(P.bankBlock(P.ROOMS[0], 1, 1e6) && !P.bankBlock(P.ROOMS[0], 2, 30) && P.bankBlock(P.ROOMS[0], 2, 29.99), '上莊資格：VIP 與最大賠付');

console.log(fail ? `\n${fail} 項失敗` : '\n全部通過');
process.exit(fail ? 1 : 0);
