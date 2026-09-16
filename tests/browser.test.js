/*  Drive index.html in headless Chrome over the DevTools protocol.
    Checks the astronomy against published sunrise/sunset times, checks the
    3D Earth orientation agrees with the maths, and saves screenshots.
    Node 22+ (global WebSocket), no dependencies.   Run: node tests/browser.test.js  */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.join(__dirname, '..');
const PORT = 8797, CDP = 9337;
const OUT = process.env.SHOT_DIR || os.tmpdir();
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fails = 0;
function ok(cond, label, extra){
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (extra ? '   ' + extra : ''));
  if (!cond) fails++;
}

const types = { '.html':'text/html', '.js':'text/javascript', '.jpg':'image/jpeg', '.png':'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT);

async function main(){
  const profile = path.join(os.tmpdir(), 'daynightcdp' + Date.now());
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
    '--window-size=1400,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio:'ignore' });
  try {
    let targets;
    for (let i = 0; i < 50; i++){
      try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); if (targets.length) break; } catch {}
      await sleep(200);
    }
    const page = targets.find(t => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise(r => ws.onopen = r);
    let id = 0; const pending = new Map(); const errors = [];
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text + ' ' + (m.params.entry.url || ''));
    };
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id:i, method, params })); });
    const evaluate = async expr => {
      const r = await send('Runtime.evaluate', { expression:expr, returnByValue:true, awaitPromise:true });
      if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed');
      return r.result.result.value;
    };
    const shot = async name => {
      const r = await send('Page.captureScreenshot', { format:'png' });
      const f = path.join(OUT, `daynight-${name}.png`);
      fs.writeFileSync(f, Buffer.from(r.result.data, 'base64'));
      console.log('  shot  ' + f);
    };

    await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
    await send('Emulation.setTimezoneOverride', { timezoneId:'Asia/Singapore' });
    await send('Page.navigate', { url:`http://127.0.0.1:${PORT}/` });
    for (let i = 0; i < 50; i++){ if (await evaluate('!!window.__sim').catch(() => false)) break; await sleep(200); }
    await sleep(2500);
    await shot('fresh-load');

    // Put the sim into a known place/time. Returns orientation + readouts.
    const setup = (city, iso, tz) => evaluate(`(() => {
      const S = window.__sim;
      const c = ${JSON.stringify(city)};
      S.setPlace(c);
      const [d, t] = ${JSON.stringify(iso)}.split('T');
      const [y, mo, da] = d.split('-').map(Number), [h, mi] = t.split(':').map(Number);
      S.state.utc = S.localToUtc(c.tz, y, mo, da, h, mi);
      S.refreshUI(true);
      return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => {
        const wp = S.cityGroup.getWorldPosition(S.cityGroup.position.clone()).normalize();
        const axis = S.cityGroup.position.clone().set(0,1,0).applyQuaternion(S.earth.quaternion);
        const sp = S.sunPosition(S.state.utc);
        r({
          geoAlt: Math.asin(-wp.x) * 180/Math.PI,                // Sun is along -X
          mathAlt: S.sunAltitude(S.state.utc, c.lat, c.lon),
          axisDotSun: -axis.x, sinDec: Math.sin(sp.dec*Math.PI/180),
          rise: document.getElementById('rRise').textContent,
          set: document.getElementById('rSet').textContent,
          len: document.getElementById('rLen').textContent,
          season: document.getElementById('sName').textContent,
          next: document.getElementById('sNext').textContent,
          local: document.getElementById('rLocal').textContent,
          tzl: document.getElementById('rTz').textContent,
        });
      })));
    })()`);
    const toMin = s => { const m = /(\d+):(\d+) (AM|PM)/.exec(s); if (!m) return NaN; return (+m[1] % 12 + (m[3] === 'PM' ? 12 : 0))*60 + +m[2]; };

    console.log('\n== sunrise / sunset vs published (timeanddate.com / NOAA), ±3 min ==');
    const cases = [
      [{ name:'London', country:'UK', lat:51.5074, lon:-0.1278, tz:'Europe/London' }, '2026-06-21T12:00', '4:43 AM', '9:21 PM', 'Summer in the Northern Hemisphere'],
      [{ name:'London', country:'UK', lat:51.5074, lon:-0.1278, tz:'Europe/London' }, '2026-12-21T12:00', '8:03 AM', '3:54 PM', 'Autumn in the Northern Hemisphere'],
      [{ name:'Singapore', country:'SG', lat:1.3521, lon:103.8198, tz:'Asia/Singapore' }, '2026-03-20T12:00', '7:10 AM', '7:17 PM', null],
      [{ name:'Sydney', country:'AU', lat:-33.8688, lon:151.2093, tz:'Australia/Sydney' }, '2026-06-22T12:00', '7:00 AM', '4:54 PM', 'Winter in the Southern Hemisphere'],
      [{ name:'New York', country:'US', lat:40.7128, lon:-74.0060, tz:'America/New_York' }, '2026-03-20T12:00', '6:59 AM', '7:09 PM', null],
    ];
    for (const [c, iso, rise, set, season] of cases){
      const r = await setup(c, iso);
      ok(Math.abs(toMin(r.rise) - toMin(rise)) <= 3, `${c.name} ${iso.slice(0,10)} sunrise ${r.rise}`, `(want ${rise})`);
      ok(Math.abs(toMin(r.set) - toMin(set)) <= 3, `${c.name} ${iso.slice(0,10)} sunset  ${r.set}`, `(want ${set})`);
      if (season) ok(r.season === season, `season label "${r.season}"`);
    }

    console.log('\n== polar cases ==');
    const trom = { name:'Tromsø', country:'NO', lat:69.6492, lon:18.9553, tz:'Europe/Oslo' };
    let r = await setup(trom, '2026-06-21T00:30');
    ok(/midnight sun/.test(r.len), `Tromsø June: ${r.len}`);
    ok(r.geoAlt > 0, `Tromsø June 00:30 sun above horizon in 3D (${r.geoAlt.toFixed(2)}°)`);
    r = await setup(trom, '2026-12-21T12:00');
    ok(/polar night/.test(r.len), `Tromsø December: ${r.len}`);
    const mcm = { name:'McMurdo', country:'AQ', lat:-77.8419, lon:166.6863, tz:'Antarctica/McMurdo' };
    r = await setup(mcm, '2026-12-21T00:00');
    ok(/midnight sun/.test(r.len), `McMurdo December: ${r.len}`);

    console.log('\n== 3D orientation agrees with maths ==');
    const probes = [
      [{ name:'Quito', country:'EC', lat:-0.18, lon:-78.47, tz:'America/Guayaquil' }, '2026-09-23T06:15'],
      [{ name:'Tokyo', country:'JP', lat:35.68, lon:139.65, tz:'Asia/Tokyo' }, '2026-01-05T15:40'],
      [{ name:'Cape Town', country:'ZA', lat:-33.92, lon:18.42, tz:'Africa/Johannesburg' }, '2026-07-01T09:00'],
      [{ name:'Kathmandu', country:'NP', lat:27.72, lon:85.32, tz:'Asia/Kathmandu' }, '2026-11-11T23:59'],
      [{ name:'Anchorage', country:'US', lat:61.22, lon:-149.9, tz:'America/Anchorage' }, '1999-08-11T04:00'],
    ];
    for (const [c, iso] of probes){
      const r = await setup(c, iso);
      ok(Math.abs(r.geoAlt - r.mathAlt) < 0.05, `${c.name} ${iso}: 3D sun alt ${r.geoAlt.toFixed(3)}° vs maths ${r.mathAlt.toFixed(3)}°`);
      ok(Math.abs(r.axisDotSun - r.sinDec) < 1e-6, `  axis·sun = sin(dec) (${r.axisDotSun.toFixed(4)})`);
    }
    r = await setup(probes[3][0], '2026-11-11T12:00');
    ok(r.tzl === 'UTC+5:45', `Kathmandu offset label ${r.tzl}`);
    r = await setup({ name:'NY', country:'US', lat:40.71, lon:-74.0, tz:'America/New_York' }, '2026-03-08T03:30');
    ok(r.local === '3:30 AM', `New York DST day, 3:30 AM local shown as ${r.local}`);

    console.log('\n== next event ==');
    r = await setup(cases[0][0], '2026-09-16T12:00');
    ok(/September equinox, 23 Sep 2026/.test(r.next), r.next);

    console.log('\n== UI interaction ==');
    await evaluate(`(() => { const s = document.getElementById('city'); s.value = 'Tokyo'; s.dispatchEvent(new Event('change')); })()`);
    await sleep(200);
    ok(await evaluate(`window.__sim.state.place.name`) === 'Tokyo', 'city dropdown selects Tokyo');
    await evaluate(`(() => { const e = document.getElementById('inTime'); e.value = '06:00'; e.dispatchEvent(new Event('change')); })()`);
    ok(await evaluate(`document.getElementById('rLocal').textContent`) === '6:00 AM', 'time input sets local time');
    const u0 = await evaluate('window.__sim.state.utc');
    await evaluate(`document.getElementById('btnPlay').click()`);
    await sleep(1000);
    const u1 = await evaluate('window.__sim.state.utc');
    ok(u1 - u0 > 5*60000, `play advances time (${((u1-u0)/60000).toFixed(1)} min in ~1 s at 10 min/s)`);
    await evaluate(`(() => { const s = document.getElementById('speed'); s.value = 'd:15'; s.dispatchEvent(new Event('change')); })()`);
    const p0 = await evaluate(`(() => { const S = window.__sim, p = S.localParts(S.state.utc, S.state.place.tz); return p.hour + ':' + p.minute; })()`);
    const uS = await evaluate('window.__sim.state.utc');
    await sleep(1000);
    const days = (await evaluate('window.__sim.state.utc') - uS)/86400000;
    ok(days > 8 && days < 20, `seasons mode advanced ${days.toFixed(1)} days`);
    await evaluate(`document.getElementById('btnPlay').click()`);
    const p1 = await evaluate(`(() => { const S = window.__sim, p = S.localParts(S.state.utc, S.state.place.tz); return p.hour + ':' + p.minute; })()`);
    ok(p1 === p0, `seasons mode keeps clock time (${p0} → ${p1})`);
    // click the globe centre -> custom place
    await send('Input.dispatchMouseEvent', { type:'mousePressed', x:535, y:420, button:'left', clickCount:1 });
    await send('Input.dispatchMouseEvent', { type:'mouseReleased', x:535, y:420, button:'left', clickCount:1 });
    await sleep(200);
    ok(await evaluate(`!!window.__sim.state.place.custom`), `click globe picks custom spot: ${await evaluate('window.__sim.state.place.name')}`);

    console.log('\n== screenshots ==');
    await evaluate(`(() => { const s = document.getElementById('city'); s.value = 'London'; s.dispatchEvent(new Event('change')); })()`);
    await setup(cases[0][0], '2026-06-21T12:00'); await evaluate('window.__sim.flyToCity()'); await sleep(1500); await shot('london-june-noon');
    await setup(cases[0][0], '2026-12-21T12:00'); await evaluate('window.__sim.flyToCity()'); await sleep(1500); await shot('london-dec-noon');
    await setup(trom, '2026-03-20T20:00'); await evaluate('window.__sim.flyToCity()'); await sleep(1500); await shot('tromso-equinox-night');
    await send('Emulation.setDeviceMetricsOverride', { width:390, height:844, deviceScaleFactor:2, mobile:true });
    await sleep(1200); await shot('mobile');

    console.log('\n== errors ==');
    ok(errors.length === 0, 'no console errors', errors.join(' | '));
  } finally {
    chrome.kill(); server.close();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
