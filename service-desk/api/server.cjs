// AnnA Service Desk — API foundation (Node.js 20+).
// Only a health endpoint is exposed until identity and permissions are configured.
'use strict';
const http = require('node:http');
const { URL } = require('node:url');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid PORT');
const server = http.createServer((req,res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({service:'anna-service-desk-api',status:'foundation',database:'not-connected',auth:'not-configured'}));
    return;
  }
  res.writeHead(404, {'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify({error:'not_found'}));
});
if (require.main === module) server.listen(port,host,()=>console.log('AnnA Service Desk API foundation listening'));
module.exports = {server};
