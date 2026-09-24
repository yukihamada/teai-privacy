import { createServer } from 'node:http';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createPrivacyClient } from '../src/client.js';

const samples = 120, warmups = 20;
let calls = 0;
const server = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  assert.ok(!body.includes('alice@example.com'));
  calls++;
  res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"choices":[{"message":{"content":"fixture"}}]}');
}).listen(0, '127.0.0.1');
await once(server, 'listening');
const baseURL = `http://127.0.0.1:${server.address().port}/v1`;
const client = createPrivacyClient({ baseURL, apiKey: 'fixture-key', allowLoopbackHTTP: true });
const stats = a => { const v = [...a].sort((a,b)=>a-b); return { p50_ms: v[Math.floor(v.length*.5)], p95_ms: v[Math.ceil(v.length*.95)-1] }; };
const results = [];
try {
  for (const size of [2048, 32768, 131072]) {
    const input = { model: 'fixture', messages: [{ role: 'user', content: 'readable text '.repeat(Math.ceil(size/14)).slice(0,size) + ' alice@example.com' }] };
    // Direct control uses already-sanitized data. Both server paths see no PII.
    const sanitized = JSON.stringify(client.inspect(input).body);
    const direct = async () => { const response = await fetch(baseURL + '/chat/completions', { method: 'POST', headers: { 'content-type':'application/json', authorization: 'Bearer fixture-key' }, body:sanitized }); await response.text(); };
    const guarded = async () => { const {response} = await client.complete(input); await response.text(); };
    for (let i=0;i<warmups;i++) { await direct(); await guarded(); }
    const a=[],b=[];
    for (let i=0;i<samples;i++) {
      for (const [fn, timings] of i%2 ? [[guarded,b],[direct,a]] : [[direct,a],[guarded,b]]) { const start=performance.now(); await fn(); timings.push(performance.now()-start); }
    }
    const before=stats(a),after=stats(b);
    results.push({ input_bytes: Buffer.byteLength(JSON.stringify(input)), direct_presanitized:before, client_local_inspection:after, difference_of_p50_ms:after.p50_ms-before.p50_ms, samples_ms:{direct:a,client:b} });
  }
  const prior=calls;
  await assert.rejects(client.complete({model:'fixture',messages:[{role:'user',content:'sk-'+ 'a'.repeat(32)}]}));
  assert.equal(calls,prior);
  const report={ measured_at:new Date().toISOString(), runtime:process.version, method:'Real loopback HTTP; same sanitized input at receiver; 20 warmup pairs, 120 alternating-order measured pairs per size; read entire JSON response; no model or WAN', blocked_request_network_calls:0, results };
  if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({...report,results:results.map(({samples_ms,...r})=>r)},null,2));
} finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
