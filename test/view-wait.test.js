'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startWait } = require('../lib/view-wait');
const POST = (url, token, text = '안: A\n이유: 충분한 이유\n주석:\n- 제목 · 보완') => fetch(url + 'answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, text }) });

test('wait serves token page and Mermaid, rejects wrong token then prints answer once with exit 0', async () => {
  const printed = [];
  const session = await startWait('<html>답 화면</html>', { open: () => {}, output: (s) => printed.push(s), timeout: 2 });
  try {
    assert.equal((await fetch(session.url)).status, 200);
    assert.equal((await fetch(session.url + 'mermaid.min.js')).status, 200);
    assert.equal((await POST(session.url, 'wrong')).status, 403);
    const text = '안: A\n이유: 충분한 이유';
    assert.equal((await POST(session.url, session.token, text)).status, 200);
    assert.equal(await session.done, 0);
    assert.equal(printed.at(-1), text);
  } finally { session.close(); }
});
test('wait rejects a second queued POST with already sent status', async () => {
  const session = await startWait('화면', { open: () => {}, output: () => {}, timeout: 2 });
  try {
    const { connect } = require('node:net');
    const url = new URL(session.url);
    const body = JSON.stringify({ token: session.token, text: '이유: 충분한 이유' });
    const request = `POST ${url.pathname}answer HTTP/1.1\r\nHost: ${url.host}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    const response = await new Promise((resolve, reject) => {
      const socket = connect(Number(url.port), '127.0.0.1');
      let text = '';
      socket.setEncoding('utf8');
      socket.on('error', reject);
      socket.on('data', (chunk) => { text += chunk; });
      socket.on('end', () => resolve(text));
      socket.on('connect', () => socket.write(request + request));
    });
    assert.match(response, /HTTP\/1.1 200/);
    assert.match(response, /HTTP\/1.1 409/);
    assert.match(response, /이미 보냈습니다/);
    assert.equal(await session.done, 0);
  } finally { session.close(); }
});
test('wait timeout prints copy fallback and returns distinct exit 124', async () => {
  const printed = [];
  const session = await startWait('화면', { open: () => { throw new Error('no browser'); }, output: (s) => printed.push(s), timeout: 0.03 });
  assert.equal(await session.done, 124);
  assert.match(printed.join('\n'), /답이 오지 않았다.*복사 버튼/);
  assert.ok(printed.includes(session.url), 'address survives opener failure');
});

test('wait command prints submitted text and exits 0', async () => {
  const { spawn } = require('node:child_process');
  const path = require('node:path');
  const { repo, BASIC } = require('./helpers');
  const root = repo(BASIC, { 'spec.md': '# 명세' });
  const view = path.resolve(__dirname, '../lib/view.js');
  const bin = path.resolve(__dirname, '../bin/qh.js');
  const code = `const view=require(${JSON.stringify(view)});const run=view.run;view.run=(r,a,c)=>run(r,a,c,{open:()=>{}});process.argv=[process.execPath,${JSON.stringify(bin)},'view','spec','spec.md','--wait','--timeout','2'];require(${JSON.stringify(bin)})`;
  const child = spawn(process.execPath, ['-e', code], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (data) => { stdout += data; });
  child.stderr.on('data', (data) => { stderr += data; });
  const closed = new Promise((resolve) => child.once('close', resolve));
  try {
    const url = await new Promise((resolve, reject) => {
      child.stdout.on('data', () => {
        const match = stdout.match(/http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]+\//);
        if (match) resolve(match[0]);
      });
      child.once('close', () => reject(new Error(stderr || stdout)));
    });
    const text = '주석:\n- 명세 · 더 자세히';
    assert.equal((await POST(url, new URL(url).pathname.split('/')[1], text)).status, 200);
    assert.equal(await closed, 0);
    assert.ok(stdout.endsWith(text + '\n'), stdout);
    assert.match(stdout, /화면은 이미 열렸다/, 'waiting mode tells the agent the page is open and the answer prints here');
    assert.doesNotMatch(stdout, /사용자에게 경로를 주지 말고/, 'no instruction to open the page again');
  } finally { child.kill(); }
});
