const crypto = require("node:crypto");

function hashSecret(secret, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(secret), salt, 64).toString("hex");
  return { hash, salt };
}

function verifySecret(secret, salt, expectedHash) {
  const { hash } = hashSecret(secret, salt);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(expectedHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

function makeLoginCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Self-contained, signed session tokens (HMAC-SHA256) — no session table
 * needed, so logins survive server restarts. Set SESSION_SECRET as an
 * environment variable in production; a random fallback is used otherwise
 * (which means existing sessions won't survive a restart until you set one).
 */
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
if (!process.env.SESSION_SECRET) {
  console.warn("[auth] SESSION_SECRET not set — using a random secret for this run. Set SESSION_SECRET as an env var so logins survive restarts.");
}
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base64urlDecode(input) {
  input = input.replace(/-/g, "+").replace(/_/g, "/");
  while (input.length % 4) input += "=";
  return Buffer.from(input, "base64").toString("utf8");
}
function sign(payload) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
}

function createSession(userType, userId) {
  const payload = JSON.stringify({ t: userType, u: userId, e: Date.now() + SESSION_TTL_MS });
  const encoded = base64url(payload);
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

function getSession(token) {
  if (!token || !token.includes(".")) return null;
  const [encoded, signature] = token.split(".");
  const expectedSig = sign(encoded);
  const a = Buffer.from(signature || "", "hex");
  const b = Buffer.from(expectedSig, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(base64urlDecode(encoded)); } catch { return null; }
  if (!payload.e || Date.now() > payload.e) return null;
  return { user_type: payload.t, user_id: payload.u };
}

/**
 * Sends the login code by email via the Resend HTTP API (no SDK needed —
 * just fetch, which Node has built in). Falls back to logging the code to
 * the server console when RESEND_API_KEY isn't set, so this still works
 * in local/dev testing without an email provider configured.
 */
async function sendLoginCodeEmail(toEmail, code) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.FROM_EMAIL || "onboarding@resend.dev";

  if (!apiKey) {
    console.log(`[dev email] Login code for ${toEmail}: ${code}`);
    return { sent: false, reason: "no_api_key" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: toEmail,
        subject: "Your Campus Market login code",
        text: `Your login code is ${code}. It expires in 10 minutes.`,
      }),
    });
    if (!res.ok) {
      console.error("Resend API error:", await res.text());
      return { sent: false, reason: "provider_error" };
    }
    return { sent: true };
  } catch (e) {
    console.error("Email send failed:", e.message);
    return { sent: false, reason: "network_error" };
  }
}

module.exports = { hashSecret, verifySecret, createSession, getSession, makeId, makeLoginCode, sendLoginCodeEmail };
