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
// The device list mirrors the real account (2 offline). Drive the page with Playwright to test.
const https = require('https');
const fs = require('fs');
const path = require('path');

const devices = [
  ['d1', 'Trimlight Back', 1], ['d2', 'Trimlight', 1], ['d3', 'Trimlight Landscape', 1],
  ['d4', 'Pergola', 1], ['d5', 'moms house', 0], ['d6', 'Trimlight', 0],
].map(([deviceId, name, connectivity]) => ({ deviceId, name, connectivity }));

const dir = __dirname;
https.createServer({ key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) }, (req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    let payload = {};
    if (req.url.endsWith('/devices')) payload = { data: devices };
    else if (req.url.endsWith('/device/get')) payload = { switchState: 1, effects: [{ id: 1, name: 'Saved on controller' }] };
    else fs.appendFileSync(path.join(dir, 'fake-log.txt'), `${req.method} ${req.url.split('/').pop()} ${body}\n`);
    res.end(JSON.stringify({ code: 0, desc: 'success', payload }));
  });
}).listen(4443, () => console.log('Fake Trimlight API on https://localhost:4443'));
