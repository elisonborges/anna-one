// Validação de JWT por JWKS. Não habilitar sem confirmar que Neon Auth emite
// tokens compatíveis, e sem configurar issuer, audience e URL JWKS oficiais.
// Não confundir token opaco de sessão com JWT.
const decode = value => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(bytes, c => c.charCodeAt(0));
};
const parse = value => JSON.parse(new TextDecoder().decode(decode(value)));
const reject = () => { throw new Error("Token inválido"); };

export async function verifyBearer(request, env) {
  if (!env.AUTH_ISSUER || !env.AUTH_AUDIENCE || !env.AUTH_JWKS_URL) {
    throw new Error("Autenticação não configurada");
  }
  const jwksUrl = new URL(env.AUTH_JWKS_URL);
  if (jwksUrl.protocol !== "https:" || jwksUrl.username || jwksUrl.password ||
      jwksUrl.search || jwksUrl.hash) reject();
  const header = request.headers.get("Authorization") || "";
  const match = /^Bearer ([A-Za-z0-9_\-.]+)$/.exec(header);
  if (!match || match[1].length > 8192) reject();
  const parts = match[1].split(".");
  if (parts.length !== 3) reject();
  let protectedHeader, claims;
  try { protectedHeader = parse(parts[0]); claims = parse(parts[1]); }
  catch { reject(); }
  if (protectedHeader.alg !== "RS256" || typeof protectedHeader.kid !== "string" ||
      !protectedHeader.kid || protectedHeader.crit || protectedHeader.jku || protectedHeader.jwk) reject();
  if (claims.iss !== env.AUTH_ISSUER ||
      !(typeof claims.aud === "string" ? claims.aud === env.AUTH_AUDIENCE :
        Array.isArray(claims.aud) && claims.aud.includes(env.AUTH_AUDIENCE))) reject();
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(claims.exp) || claims.exp <= now ||
      !Number.isInteger(claims.iat) || claims.iat > now + 30 ||
      claims.exp - claims.iat > 86400 ||
      (claims.nbf !== undefined && (!Number.isInteger(claims.nbf) || claims.nbf > now + 30)) ||
      typeof claims.sub !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(claims.sub)) reject();
  const response = await fetch(jwksUrl.toString(), { redirect: "error" });
  if (!response.ok) reject();
  const jwks = await response.json();
  if (!Array.isArray(jwks.keys)) reject();
  const keys = jwks.keys.filter(k => k.kid === protectedHeader.kid && k.kty === "RSA" &&
    k.alg === "RS256" && (!k.use || k.use === "sig"));
  if (keys.length !== 1) reject();
  const key = await crypto.subtle.importKey("jwk", keys[0],
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decode(parts[2]),
    new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!ok) reject();
  return { userId: claims.sub };
}
