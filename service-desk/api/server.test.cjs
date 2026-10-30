'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const {server} = require('./server.cjs');

test('health endpoint exposes no real-service claim', async () => {
 await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
 try {
  const port=server.address().port;
  const res=await fetch('http://127.0.0.1:'+port+'/health');
  assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(data.database,'not-configured');
  assert.equal(data.auth,'not-configured');
  const missing=await fetch('http://127.0.0.1:'+port+'/api/v1/tickets');
  assert.equal(missing.status,401);
 } finally {
  await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
 }
});
