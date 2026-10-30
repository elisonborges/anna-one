'use strict';
const crypto = require('node:crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function verifyToken(header, config = process.env) {
  if (!header || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(header)) return null;
  const secret = config.SD_JWT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32 || !config.SD_JWT_ISSUER || !config.SD_JWT_AUDIENCE) return null;
  try {
    const token = header.slice(7);
    const [h,p,s] = token.split('.');
    const meta = JSON.parse(Buffer.from(h,'base64url').toString('utf8'));
    if (meta.alg !== 'HS256' || meta.typ !== 'JWT') return null;
    const expected = crypto.createHmac('sha256',secret).update(h+'.'+p).digest();
    const actual = Buffer.from(s,'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual,expected)) return null;
    const claims = JSON.parse(Buffer.from(p,'base64url').toString('utf8'));
    const now = Math.floor(Date.now()/1000);
    if (!UUID.test(claims.sub || '') || claims.iss !== config.SD_JWT_ISSUER ||
        claims.aud !== config.SD_JWT_AUDIENCE || !Number.isInteger(claims.exp) ||
        claims.exp <= now || claims.exp > now+3600 ||
        !Number.isInteger(claims.iat) || claims.iat > now+60 ||
        claims.iat > claims.exp || (claims.nbf != null && (typeof claims.nbf !== 'number' || claims.nbf > now))) return null;
    return {id:claims.sub};
  } catch (_) { return null; }
}
module.exports = {verifyToken};
