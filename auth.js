const crypto = require("node:crypto");
const db = require("./db");

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

function makeToken() {
  return crypto.randomBytes(32).toString("hex");
}

function createSession(userType, userId) {
  const token = makeToken();
  db.prepare(
    "INSERT INTO sessions (token, user_type, user_id, created_at) VALUES (?, ?, ?, ?)"
  ).run(token, userType, userId, Date.now());
  return token;
}

function getSession(token) {
  if (!token) return null;
  return db.prepare("SELECT * FROM sessions WHERE token = ?").get(token) || null;
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

function makeLoginCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
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

module.exports = { hashSecret, verifySecret, makeToken, createSession, getSession, makeId, makeLoginCode, sendLoginCodeEmail };
