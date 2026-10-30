// AnnA Service Desk — API foundation (Node.js 20+).
// Server-side database access; ticket listing is gated by JWT and RLS.
'use strict';
const http = require('node:http');
const { URL } = require('node:url');
const {createTicketReader} = require('./tickets.cjs');
const {createTicketWriter} = require('./ticket-create.cjs');
const {createUnitsReader} = require('./units.cjs');
const {createLoginHandler} = require('./login.cjs');
const {createBrandingHandler} = require('./branding.cjs');
const {createLogoHandler} = require('./branding-logo.cjs');
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
const writeTicket = createTicketWriter(getPool);
const readUnits = createUnitsReader(getPool);
const login = createLoginHandler(getPool);
const branding = createBrandingHandler(getPool);
const brandingLogo = createLogoHandler(getPool);
const authConfigured = () => Boolean((process.env.SD_JWT_SECRET && Buffer.byteLength(process.env.SD_JWT_SECRET) >= 32 && process.env.SD_JWT_ISSUER && process.env.SD_JWT_AUDIENCE));
const server = http.createServer(async (req,res) => {
  let path;
  try { path = new URL(req.url, 'http://localhost').pathname; }
  catch (_) { res.writeHead(400); res.end(); return; }
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  // Only the approved GitHub Pages origin may call this API from a browser.
  const allowedOrigins=new Set(['https://elisonborges.github.io','https://annaone.com.br']);
  const origin=req.headers.origin;
  if(allowedOrigins.has(origin)){
    res.setHeader('Access-Control-Allow-Origin',origin);
    res.setHeader('Vary','Origin');
    res.setHeader('Access-Control-Allow-Methods','GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, X-Tenant-Id');
    res.setHeader('Access-Control-Max-Age','600');
  }
  if(req.method==='OPTIONS' && (path==='/api/v1/auth/login'||path==='/api/v1/tickets'||path==='/api/v1/units'||path==='/api/v1/admin/branding'||path.startsWith('/api/v1/branding-logo/'))){
    if(!allowedOrigins.has(origin)){
      // Origin is a public website address, not a credential. Never log request bodies or headers.
      console.warn('[service-desk/cors] preflight rejected', {
        origin: typeof origin==='string' ? origin.slice(0,200) : 'missing',
        path
      });
      res.writeHead(403,{'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify({error:'origin_not_allowed'}));
      return;
    }
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === 'GET' && path === '/health') {
    const db = await databaseStatus();
    res.writeHead(db === 'unavailable' ? 503 : 200, {'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({service:'anna-service-desk-api',status:'foundation',database:db,auth:authConfigured() ? 'configured-not-verified' : 'not-configured'}));
    return;
  }
  if ((req.method === 'GET'||req.method === 'POST') && path.startsWith('/api/v1/branding-logo/')) return brandingLogo(req,res,path.slice('/api/v1/branding-logo/'.length));
  if ((req.method === 'GET'||req.method === 'PUT') && path === '/api/v1/admin/branding') return branding(req,res);
  if (req.method === 'POST' && path === '/api/v1/auth/login') return login(req,res);
  if (req.method === 'GET' && path === '/api/v1/units') return readUnits(req,res);
  if (req.method === 'GET' && path === '/api/v1/tickets') return readTickets(req,res);
  if (req.method === 'POST' && path === '/api/v1/tickets') return writeTicket(req,res);
  res.writeHead(404, {'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify({error:'not_found'}));
});
if (require.main === module) server.listen(port,host,()=>console.log('AnnA Service Desk API foundation listening'));
module.exports = {server,databaseStatus};
