// AnnA Service Desk — API foundation (Node.js 20+).
// Database connectivity is server-side only; no ticket routes are exposed.
'use strict';
const http = require('node:http');
const { URL } = require('node:url');
const {createTicketReader} = require('./tickets.cjs');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid PORT');

let pool;
function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: true },
      max: 3,
      connectionTimeoutMillis: 4000,
      idleTimeoutMillis: 10000,
      statement_timeout: 4000,
      application_name: 'anna-service-desk-api'
    });
    pool.on('error', () => {}); // never leak credentials in unhandled errors
  }
  return pool;
}
async function databaseStatus() {
  const db = getPool();
  if (!db) return 'not-configured';
  try {
    // No access to customer data or schema required for connectivity probe.
    const result = await db.query('SELECT 1 AS ok');
    return result.rows[0]?.ok === 1 ? 'reachable' : 'unavailable';
  } catch (_) {
    return 'unavailable';
  }
}
const readTickets = createTicketReader(getPool);
const server = http.createServer(async (req,res) => {
  let path;
  try { path = new URL(req.url, 'http://localhost').pathname; }
  catch (_) { res.writeHead(400); res.end(); return; }
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if (req.method === 'GET' && path === '/health') {
    const db = await databaseStatus();
    res.writeHead(db === 'unavailable' ? 503 : 200, {'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({service:'anna-service-desk-api',status:'foundation',database:db,auth:'not-configured'}));
    return;
  }
  if (req.method === 'GET' && path === '/api/v1/tickets') return readTickets(req,res);
  res.writeHead(404, {'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify({error:'not_found'}));
});
if (require.main === module) server.listen(port,host,()=>console.log('AnnA Service Desk API foundation listening'));
module.exports = {server,databaseStatus};
