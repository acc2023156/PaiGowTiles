/* 從大廳（GDBO）進入時使用 SHA Platform：洗牌、發牌、派彩與餘額皆由伺服器決定，餘額為會員的 GDBO 錢包。
   網址帶 ?api=<SHA API>&return=<大廳> 與 #token=<launch token>；沒有 token 時沿用本機試玩（engine.js）。
   一副牌打兩局，伺服器種子在第 2 局結束後才公開。 */
(function (global) {
  'use strict';
  const P = global.PaiGow;

  const query = new URLSearchParams(global.location.search);
  let token = new URLSearchParams(global.location.hash.slice(1)).get('token');
  try {
    if (token) global.sessionStorage.setItem('paigow.launchToken', token);
    else token = global.sessionStorage.getItem('paigow.launchToken');
  } catch (e) { /* ignore */ }
  if (global.location.hash) global.history.replaceState(null, '', global.location.pathname + global.location.search);
  // api 只接受 Cloudflare Workers 或本機，launch token 不會送到其他主機
  const apiBase = (() => {
    try {
      const u = new URL(query.get('api') || 'https://sha-platform-dev.sha-platform.workers.dev/api/v1');
      return /\.workers\.dev$|(^|\.)gdclub\.cc$|^(localhost|127\.0\.0\.1)$/.test(u.hostname) ? u.href.replace(/\/$/, '') : '';
    } catch (e) { return ''; }
  })();

  const toUnits = coins => Math.round(coins * 100) * 10;
  const fromUnits = units => Number(units) / 1000;
  const fromMoney = money => Number(money.units) / 10 ** money.scale;

  class RemotePaiGowGame extends P.PaiGowGame {
    constructor(opts) {
      super({ ...opts, balance: 0, shoe: null });
      this.remote = true;
      this.commitment = null;
    }

    // 這副牌打完前，下一副牌的承諾尚未產生
    get nextServerHash() { return this.commitment && !this.shoeInProgress ? this.commitment.server_seed_hash : '本副牌打完後產生'; }

    async api(path, body) {
      const response = await fetch(apiBase + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body || {}),
        cache: 'no-store'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const messages = { INSUFFICIENT_FUNDS: '餘額不足', INVALID_LAUNCH_TOKEN: '登入已逾時，請回大廳重新進入', INVALID_BET: '押注不合法' };
        throw new Error(messages[payload.error && payload.error.code] || (payload.error && payload.error.message) || `連線錯誤 (${response.status})`);
      }
      return payload;
    }

    /** 取得餘額與目前這副牌的承諾；這副牌打到一半時還原牌墩。 */
    async connect() {
      const session = await this.api('/games/pai-gow-tiles/session');
      this.balance = fromMoney(session.balance);
      const c = this.commitment = session.commitment;
      this.shoe = c.rounds_played
        ? { nonce: +c.nonce, serverSeed: null, serverHash: c.server_seed_hash, clientSeed: c.client_seed, used: c.rounds_played }
        : null;
      if (this.shoe) this.nonce = this.shoe.nonce;
    }

    // 閒家下注並由伺服器開牌、結算；回傳格式與本機 PaiGowGame.play 相同
    async play(rawBets) {
      const bets = P.DOORS.map(d => P.cents(Math.max(0, +(rawBets && rawBets[d]) || 0)));
      const total = P.cents(bets.reduce((a, b) => a + b, 0));
      if (!(total > 0)) throw new Error('請至少押一門');
      if (total > this.balance + 1e-9) throw new Error('餘額不足');
      const doors = bets.map(toUnits);
      const res = await this.api('/games/pai-gow-tiles/bets', {
        request_id: global.crypto.randomUUID(), commitment_id: this.commitment.id, client_seed: this.clientSeed,
        wager: { units: String(doors.reduce((a, b) => a + b, 0)), currency: 'TWD', scale: 3 }, doors
      });
      const f = res.fairness, o = res.outcome;
      this.balance = fromMoney(res.balance);
      this.commitment = res.next_commitment;
      this.nonce = +f.nonce;
      this.roundNo += 1;
      this.shoe = { nonce: this.nonce, serverSeed: f.server_seed, serverHash: f.server_seed_hash, clientSeed: f.client_seed, used: o.round + 1 };
      const arranged = o.hands.map(P.arrange);
      const pays = o.payouts.map(fromUnits);
      const payout = fromMoney(res.payout);
      return {
        round: o.round, hands: o.hands, arranged, doors: arranged.slice(1).map(a => P.compare(a, arranged[0])),
        roundNo: this.roundNo, shoe: this.nonce, shoeDone: !!f.server_seed,
        serverHash: f.server_seed_hash, serverSeed: f.server_seed, clientSeed: f.client_seed,
        role: 'player', bets, total, pays, payout, net: P.cents(payout - total)
      };
    }
  }

  P.remote = token && apiBase ? { RemotePaiGowGame } : null;
})(window);
