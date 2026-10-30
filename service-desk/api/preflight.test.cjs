'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validate}=require('./preflight.cjs');
const base={DATABASE_URL:'postgresql://sd_login:password@host.neon.tech/neondb?sslmode=require',SD_JWT_SECRET:'a'.repeat(40),SD_JWT_ISSUER:'anna-sd',SD_JWT_AUDIENCE:'anna-sd-api'};
test('accepts plausible restricted TLS configuration without claiming connection',()=>assert.deepEqual(validate(base),[]));
test('rejects privileged database user',()=>assert.ok(validate({...base,DATABASE_URL:'postgresql://neondb_owner:password@host.neon.tech/neondb?sslmode=require'}).some(x=>x.includes('forbidden'))));
test('rejects missing TLS and short signing secret',()=>{const errors=validate({...base,DATABASE_URL:'postgresql://sd_login:password@host.neon.tech/neondb',SD_JWT_SECRET:'short'});assert.ok(errors.some(x=>x.includes('TLS')));assert.ok(errors.some(x=>x.includes('too short')));});
