// Fake Trimlight API for local testing — no real lights or credentials needed.
//
//   cd trimlight-control/dev
//   openssl req -x509 -newkey rsa:2048 -nodes -keyout k.pem -out c.pem -days 1 \
//     -subj /CN=localhost -addext subjectAltName=DNS:localhost
//   node fake-trimlight.js            # listens on https://localhost:4443, logs commands to fake-log.txt
//
// Then, from trimlight-control/:
//   DATA_DIR=./dev/data NODE_EXTRA_CA_CERTS=./dev/c.pem TRIMLIGHT_BASE_URL=https://localhost:4443/trimlight \
//   TRIMLIGHT_CLIENT_ID=abc TRIMLIGHT_CLIENT_SECRET=def APP_PASSWORD=pw PORT=3997 node server.js
//
// The device list mirrors the real account (2 offline). Saved effects are kept in memory, so the
// save + view flow (and the reusable "Lights App" slots) can be checked in fake-log.txt.
// Drive the page with Playwright to test.
const https = require('https');
const fs = require('fs');
const path = require('path');

const devices = [
  ['d1', 'Trimlight Back', 1], ['d2', 'Trimlight', 1], ['d3', 'Trimlight Landscape', 1],
  ['d4', 'Pergola', 1], ['d5', 'moms house', 0], ['d6', 'Trimlight', 0],
].map(([deviceId, name, connectivity]) => ({ deviceId, name, connectivity }));

// Saved effects per controller, like the real cloud: effect/save with id -1 creates one.
const effects = Object.fromEntries(devices.map(d => [d.deviceId, [{ id: 1, name: 'Saved on controller', category: 1, mode: 0 }]]));
let nextId = 100;
const current = {};   // deviceId → effect last played

const dir = __dirname;
const log = line => fs.appendFileSync(path.join(dir, 'fake-log.txt'), line + '\n');
https.createServer({ key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) }, (req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    const b = body ? JSON.parse(body) : {};
    const endpoint = req.url.replace('/trimlight/v1/oauth/resources/', '');
    let payload = {};
    if (endpoint === 'devices') payload = { data: devices };
    else if (endpoint === 'device/get') payload = {
      name: (devices.find(d => d.deviceId === b.deviceId) || {}).name, switchState: 1, connectivity: 1, state: 0,
      fwVersionName: 'fake-1.0', ports: [{ id: 0, start: 1, end: 300 }],
      effects: effects[b.deviceId] || [], currentEffect: current[b.deviceId] || null,
    };
    else if (endpoint === 'device/effect/view') {
      current[b.deviceId] = (effects[b.deviceId] || []).find(e => e.id === b.payload.id) || null;
      log(`VIEW ${b.deviceId} id=${b.payload.id}`);
    }
    else if (endpoint === 'device/effect/save') {
      const list = effects[b.deviceId] || (effects[b.deviceId] = []);
      const e = { ...b.payload };
      if (e.id === -1 || !list.some(x => x.id === e.id)) e.id = nextId++;
      effects[b.deviceId] = [...list.filter(x => x.id !== e.id), e];
      payload = { id: e.id };
      log(`SAVE ${b.deviceId} id=${e.id} "${e.name}" category=${e.category} mode=${e.mode} speed=${e.speed} brightness=${e.brightness} lit=${(e.pixels || []).filter(p => p.count).length}/${(e.pixels || []).length}`);
    } else if (endpoint === 'device/effect/preview') {
      log(`PREVIEW ${b.deviceId} (broken on real firmware!)`);
    } else log(`${endpoint.toUpperCase()} ${body}`);
    res.end(JSON.stringify({ code: 0, desc: 'success', payload }));
  });
}).listen(4443, () => console.log('Fake Trimlight API on https://localhost:4443'));
