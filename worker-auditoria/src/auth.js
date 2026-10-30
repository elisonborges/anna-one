/**
 * Neon Managed Auth: JWT assinado por EdDSA (Ed25519).
 * O token de getSession().data.session.token é opaco: NÃO utilizá-lo aqui.
 * Obter JWT com auth.token()/getJWTToken() conforme versão do SDK validada.
 * O Worker NÃO aceita requisições administrativas antes de haver autorização SQL.
 */
const invalid = (stage = "invalid") => { const e = new Error("Credencial inválida"); e.stage = stage; throw e; };
function decodeBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) invalid();
  const str = atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
  return Uint8Array.from(str, c => c.charCodeAt(0));
}
function parsePart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}
export async function verifyBearer(request, env) {
  if (!env.AUTH_ISSUER || !env.AUTH_JWKS_URL) {
    invalid("config");
  }
  const jwksUrl = new URL(env.AUTH_JWKS_URL);
  if (jwksUrl.protocol !== "https:" || jwksUrl.username || jwksUrl.password ||
      jwksUrl.search || jwksUrl.hash) invalid("config");
  const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(request.headers.get("Authorization") || "");
  if (!match || match[1].length > 8192) invalid("bearer");
  const parts = match[1].split(".");
  if (parts.length !== 3) invalid("format");
  let header, claims;
  try { header = parsePart(parts[0]); claims = parsePart(parts[1]); } catch { invalid("format"); }
  if (header.alg !== "EdDSA" || typeof header.kid !== "string" || !header.kid ||
      header.crit || header.jwk || header.jku) invalid("header");
  const aud = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== env.AUTH_ISSUER ||
      (env.AUTH_AUDIENCE && (!Array.isArray(aud) || !aud.includes(env.AUTH_AUDIENCE))) ||
      typeof claims.sub !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claims.sub) ||
      !Number.isInteger(claims.exp) || claims.exp <= now ||
      !Number.isInteger(claims.iat) || claims.iat > now + 30 ||
      claims.exp - claims.iat > 900 ||
      (claims.nbf !== undefined && (!Number.isInteger(claims.nbf) || claims.nbf > now + 30))) invalid("claims");
  const response = await fetch(jwksUrl.toString(), { redirect: "error" });
  if (!response.ok) invalid("jwks");
  const jwks = await response.json();
  if (!Array.isArray(jwks.keys)) invalid("jwks");
  const keys = jwks.keys.filter(k => k.kid === header.kid && k.kty === "OKP" &&
    k.crv === "Ed25519" && (!k.alg || k.alg === "EdDSA") &&
    (!k.use || k.use === "sig") && typeof k.x === "string");
  if (keys.length !== 1) invalid("key");
  const key = await crypto.subtle.importKey("jwk", keys[0], "Ed25519", false, ["verify"]);
  if (!await crypto.subtle.verify("Ed25519", key, decodeBase64Url(parts[2]),
    new TextEncoder().encode(parts[0] + "." + parts[1]))) invalid("signature");
  return { userId: claims.sub };
}
