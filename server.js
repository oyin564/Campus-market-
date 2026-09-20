const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const db = require("./db");
const {
  hashSecret, verifySecret, createSession, getSession,
  makeId, makeLoginCode, sendLoginCodeEmail, sendEmail,
} = require("./auth");

const MANAGEMENT_EMAIL = process.env.MANAGEMENT_EMAIL || "ellieandtg@gmail.com";

const PORT = process.env.PORT || 3001;
const DELIVERY_FEE = 500;

/* ---------------------------- tiny helpers ---------------------------- */
function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 8_000_000) req.destroy(); // 8MB cap
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error("bad_json")); }
    });
    req.on("error", reject);
  });
}

function auth(req) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  return getSession(token);
}

const orderTotal = (o) => o.agreed_price * o.qty + o.delivery_fee;
const isSameDay = (ts, ref = Date.now()) => new Date(ts).toDateString() === new Date(ref).toDateString();

function dbErrorMessage(e) {
  if (/isn.t configured yet/.test(e.message)) return e.message;
  return "Database error. If this is a fresh setup, make sure the tables have been created in Supabase.";
}

/* ------------------------------- routes -------------------------------- */
const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const regex = new RegExp("^" + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "$");
  routes.push({ method, regex, keys, handler });
}

/* Buyers */
route("POST", "/api/buyers/signup", async (req, res, body) => {
  const username = String(body.username || "").trim().toLowerCase();
  const displayName = String(body.displayName || username).trim();
  const email = String(body.email || "").trim();
  const pin = String(body.pin || "").trim();
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return send(res, 400, { error: "Username must be 3-20 chars: letters, numbers, underscores." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { error: "Enter a valid email address." });
  if (pin.length < 4) return send(res, 400, { error: "PIN must be at least 4 digits." });

  const existing = await db.selectOne("buyers", "username", username);
  if (existing) return send(res, 409, { error: "That username is taken." });

  const { hash, salt } = hashSecret(pin);
  const code = makeLoginCode();
  await db.upsertRow("pending_signups", {
    username, display_name: displayName, email, pin_hash: hash, pin_salt: salt, code, created_at: Date.now(),
  }, "username");

  const emailResult = await sendLoginCodeEmail(email, code);
  send(res, 200, { pending: true, emailSent: emailResult.sent, devCode: emailResult.sent ? undefined : code });
});

route("POST", "/api/buyers/signup/verify", async (req, res, body) => {
  const username = String(body.username || "").trim().toLowerCase();
  const code = String(body.code || "").trim();
  const row = await db.selectOne("pending_signups", "username", username);
  if (!row || row.code !== code) return send(res, 401, { error: "Incorrect or expired code." });
  if (Date.now() - row.created_at > 10 * 60 * 1000) return send(res, 401, { error: "Code expired, sign up again." });

  const existing = await db.selectOne("buyers", "username", username);
  if (existing) return send(res, 409, { error: "That username is taken." });

  await db.insertRow("buyers", {
    username, display_name: row.display_name, email: row.email,
    pin_hash: row.pin_hash, pin_salt: row.pin_salt, created_at: Date.now(),
  });
  await db.deleteWhere("pending_signups", "username", username);

  const token = createSession("buyer", username);
  send(res, 201, { token, username, displayName: row.display_name });
});

route("POST", "/api/buyers/login", async (req, res, body) => {
  const username = String(body.username || "").trim().toLowerCase();
  const pin = String(body.pin || "").trim();
  const buyer = await db.selectOne("buyers", "username", username);
  if (!buyer) return send(res, 404, { error: "No account with that username." });
  if (!verifySecret(pin, buyer.pin_salt, buyer.pin_hash)) return send(res, 401, { error: "Wrong PIN." });

  const token = createSession("buyer", username);
  send(res, 200, { token, username: buyer.username, displayName: buyer.display_name });
});

route("GET", "/api/buyers/me", async (req, res) => {
  const session = auth(req);
  if (!session || session.user_type !== "buyer") return send(res, 401, { error: "Not signed in." });
  const buyer = await db.selectOne("buyers", "username", session.user_id);
  if (!buyer) return send(res, 404, { error: "Account not found." });
  send(res, 200, { username: buyer.username, displayName: buyer.display_name, avatarUrl: buyer.avatar_url || null });
});

route("PATCH", "/api/buyers/me", async (req, res, body) => {
  const session = auth(req);
  if (!session || session.user_type !== "buyer") return send(res, 401, { error: "Not signed in." });
  const patch = {};

  if (body.displayName !== undefined) {
    const displayName = String(body.displayName || "").trim();
    if (!displayName) return send(res, 400, { error: "Display name can't be empty." });
    patch.display_name = displayName;
  }

  if (body.avatarBase64) {
    const avatarUrl = await db.uploadImage(body.avatarBase64);
    if (avatarUrl) patch.avatar_url = avatarUrl;
  }

  if (body.newPin) {
    const newPin = String(body.newPin).trim();
    if (newPin.length < 4) return send(res, 400, { error: "New PIN must be at least 4 digits." });
    const buyer = await db.selectOne("buyers", "username", session.user_id);
    if (!body.currentPin || !verifySecret(String(body.currentPin), buyer.pin_salt, buyer.pin_hash)) {
      return send(res, 401, { error: "Current PIN is incorrect." });
    }
    const { hash, salt } = hashSecret(newPin);
    patch.pin_hash = hash;
    patch.pin_salt = salt;
  }

  if (Object.keys(patch).length === 0) return send(res, 400, { error: "Nothing to update." });
  await db.updateWhere("buyers", "username", session.user_id, patch);

  const updated = await db.selectOne("buyers", "username", session.user_id);
  send(res, 200, { username: updated.username, displayName: updated.display_name, avatarUrl: updated.avatar_url || null });
});

route("GET", "/api/orders/mine", async (req, res) => {
  const session = auth(req);
  if (!session || session.user_type !== "buyer") return send(res, 401, { error: "Not signed in." });
  const rows = await db.selectMany("orders", [["buyer_username", `eq.${session.user_id}`]], { order: "created_at.desc" });
  send(res, 200, { orders: rows });
});

/* Vendors */
route("GET", "/api/vendors", async (req, res) => {
  const rows = await db.selectMany("vendors", [], { select: "id,name,tag", order: "created_at.asc" });
  send(res, 200, { vendors: rows });
});

route("POST", "/api/vendors/register", async (req, res, body) => {
  const name = String(body.name || "").trim();
  const tag = String(body.tag || "Campus seller").trim();
  const phone = String(body.phone || "").trim();
  const password = String(body.password || "").trim();
  if (!name) return send(res, 400, { error: "Shop name is required." });
  if (!phone) return send(res, 400, { error: "Phone number is required." });
  if (password.length < 4) return send(res, 400, { error: "Password must be at least 4 characters." });

  const id = makeId("v");
  const { hash, salt } = hashSecret(password);
  await db.insertRow("vendors", { id, name, tag, phone, password_hash: hash, password_salt: salt, created_at: Date.now() });

  const token = createSession("vendor", id);
  send(res, 201, { token, id, name, tag });
});

route("POST", "/api/vendors/login", async (req, res, body) => {
  const id = String(body.id || "").trim();
  const password = String(body.password || "").trim();
  const vendor = await db.selectOne("vendors", "id", id);
  if (!vendor) return send(res, 404, { error: "Shop not found." });
  if (!verifySecret(password, vendor.password_salt, vendor.password_hash)) return send(res, 401, { error: "Wrong password." });
  const token = createSession("vendor", id);
  send(res, 200, { token, id: vendor.id, name: vendor.name, tag: vendor.tag });
});

/* Products */
route("GET", "/api/products", async (req, res) => {
  const rows = await db.selectMany("products", [], { order: "created_at.desc" });
  send(res, 200, {
    products: rows.map((p) => ({
      id: p.id, vendorId: p.vendor_id, name: p.name, category: p.category,
      price: p.price, icon: p.icon, imageUrl: p.image_path, desc: p.description,
    })),
  });
});

route("POST", "/api/products", async (req, res, body) => {
  const session = auth(req);
  if (!session || session.user_type !== "vendor") return send(res, 401, { error: "Not signed in as a seller." });
  const name = String(body.name || "").trim();
  const price = Number(body.price);
  if (!name || !price || price <= 0) return send(res, 400, { error: "Give the item a name and a price above 0." });

  const imagePath = await db.uploadImage(body.imageBase64);
  const id = makeId("p");
  await db.insertRow("products", {
    id, vendor_id: session.user_id, name, category: body.category || "Other", price,
    icon: body.icon || "🛍️", image_path: imagePath, description: body.desc || "", created_at: Date.now(),
  });

  send(res, 201, { id, vendorId: session.user_id, name, category: body.category || "Other", price, icon: body.icon || "🛍️", imageUrl: imagePath, desc: body.desc || "" });
});

/* Orders */
route("POST", "/api/orders", async (req, res, body) => {
  const session = auth(req);
  if (!session || session.user_type !== "buyer") return send(res, 401, { error: "Not signed in." });
  const product = await db.selectOne("products", "id", body.productId);
  if (!product) return send(res, 404, { error: "Item not found." });
  const buyer = await db.selectOne("buyers", "username", session.user_id);

  const qty = Math.max(1, Number(body.qty) || 1);
  const agreedPrice = Number(body.agreedPrice);
  if (!agreedPrice || agreedPrice <= 0) return send(res, 400, { error: "Enter the agreed price." });
  if (!body.location || !body.phone) return send(res, 400, { error: "Delivery location and phone are required." });

  const id = makeId("ord");
  await db.insertRow("orders", {
    id, product_id: product.id, product_name: product.name, vendor_id: product.vendor_id,
    buyer_username: buyer.username, buyer_display_name: buyer.display_name, qty, agreed_price: agreedPrice,
    delivery_fee: DELIVERY_FEE, payment_method: body.paymentMethod === "cash" ? "cash" : "transfer",
    location: body.location, phone: body.phone, notes: body.notes || "", status: "new", created_at: Date.now(),
  });

  send(res, 201, { id, status: "new" });
});

route("GET", "/api/orders/vendor", async (req, res) => {
  const session = auth(req);
  if (!session || session.user_type !== "vendor") return send(res, 401, { error: "Not signed in as a seller." });
  const rows = await db.selectMany("orders", [["vendor_id", `eq.${session.user_id}`]], { order: "created_at.desc" });
  send(res, 200, { orders: rows });
});

/* Owner / management */
route("POST", "/api/owner/login", async (req, res, body) => {
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "").trim();
  if (!username) return send(res, 400, { error: "Enter a username." });
  if (password.length < 4) return send(res, 400, { error: "Password must be at least 4 characters." });
  const existing = await db.selectOne("owner_auth", "id", 1);
  if (!existing) {
    const { hash, salt } = hashSecret(password);
    await db.insertRow("owner_auth", { id: 1, username, password_hash: hash, password_salt: salt });
    return send(res, 201, { token: createSession("owner", "owner"), created: true, username });
  }
  if (existing.username !== username) return send(res, 401, { error: "Wrong username or password." });
  if (!verifySecret(password, existing.password_salt, existing.password_hash)) return send(res, 401, { error: "Wrong username or password." });
  send(res, 200, { token: createSession("owner", "owner"), username: existing.username });
});

route("GET", "/api/owner/orders", async (req, res) => {
  const session = auth(req);
  if (!session || session.user_type !== "owner") return send(res, 401, { error: "Not signed in as management." });
  const rows = await db.selectMany("orders", [], { order: "created_at.desc" });
  const vendorRows = await db.selectMany("vendors", [], { select: "id,name,tag,phone" });
  const vendorsById = Object.fromEntries(vendorRows.map((v) => [v.id, v]));
  const buyerRows = await db.selectMany("buyers", [], { select: "username,email,avatar_url" });
  const buyersByUsername = Object.fromEntries(buyerRows.map((b) => [b.username, b]));

  const today = rows.filter((o) => isSameDay(o.created_at));
  const deliveredToday = today.filter((o) => o.status === "delivered");
  send(res, 200, {
    orders: rows.map((o) => {
      const vendor = vendorsById[o.vendor_id] || {};
      const buyer = buyersByUsername[o.buyer_username] || {};
      return {
        ...o, total: orderTotal(o),
        vendorName: vendor.name || "Unknown", vendorTag: vendor.tag || "", vendorPhone: vendor.phone || "",
        buyerEmail: buyer.email || "", buyerAvatarUrl: buyer.avatar_url || null,
      };
    }),
    stats: {
      ordersToday: today.length,
      deliveredToday: deliveredToday.length,
      revenueDeliveredToday: deliveredToday.reduce((s, o) => s + orderTotal(o), 0),
      expectedRevenueToday: today.reduce((s, o) => s + orderTotal(o), 0),
      pendingToday: today.length - deliveredToday.length,
    },
  });
});

route("GET", "/api/owner/vendors", async (req, res) => {
  const session = auth(req);
  if (!session || session.user_type !== "owner") return send(res, 401, { error: "Not signed in as management." });
  const rows = await db.selectMany("vendors", [], { select: "id,name,tag,phone,created_at", order: "created_at.asc" });
  send(res, 200, { vendors: rows });
});

route("PATCH", "/api/owner/orders/:id/deliver", async (req, res, body, params) => {
  const session = auth(req);
  if (!session || session.user_type !== "owner") return send(res, 401, { error: "Not signed in as management." });
  await db.updateWhere("orders", "id", params.id, { status: "delivered", delivered_at: Date.now() });
  await notifyAdminOfDelivery(params.id);
  send(res, 200, { ok: true });
});

async function notifyAdminOfDelivery(orderId) {
  try {
    const order = await db.selectOne("orders", "id", orderId);
    if (!order) return;
    const vendor = await db.selectOne("vendors", "id", order.vendor_id);
    await sendEmail(
      MANAGEMENT_EMAIL,
      `MoveMart: order delivered — ${order.product_name}`,
      `${order.qty}x ${order.product_name} from ${vendor ? vendor.name : "a seller"} was just delivered to ${order.buyer_display_name}. Total: ${orderTotal(order)}.`
    );
  } catch (e) { console.error("Delivery notification failed:", e.message); }
}

/* Messages */
route("GET", "/api/messages/for-vendor/:productId", async (req, res, _body, params) => {
  const session = auth(req);
  if (!session || session.user_type !== "vendor") return send(res, 401, { error: "Not signed in as a seller." });
  const rows = await db.selectMany("messages", [["product_id", `eq.${params.productId}`]], { select: "buyer_username" });
  const unique = [...new Set(rows.map((r) => r.buyer_username))];
  send(res, 200, { buyers: unique });
});

route("GET", "/api/messages/:productId/:buyerUsername", async (req, res, _body, params) => {
  const rows = await db.selectMany(
    "messages",
    [["product_id", `eq.${params.productId}`], ["buyer_username", `eq.${params.buyerUsername}`]],
    { order: "created_at.asc" }
  );
  send(res, 200, { messages: rows.map((m) => ({ sender: m.sender, name: m.sender_name, text: m.text, ts: m.created_at })) });
});

route("POST", "/api/messages", async (req, res, body) => {
  const session = auth(req);
  if (!session) return send(res, 401, { error: "Not signed in." });
  const isBuyer = session.user_type === "buyer";
  const isVendor = session.user_type === "vendor";
  if (!isBuyer && !isVendor) return send(res, 401, { error: "Not signed in." });

  const buyerUsername = isBuyer ? session.user_id : String(body.buyerUsername || "");
  if (!buyerUsername) return send(res, 400, { error: "buyerUsername required." });

  let senderName = "Someone";
  if (isBuyer) {
    const buyer = await db.selectOne("buyers", "username", session.user_id, "display_name");
    senderName = (buyer && buyer.display_name) || session.user_id;
  } else {
    const vendor = await db.selectOne("vendors", "id", session.user_id, "name");
    senderName = (vendor && vendor.name) || "Seller";
  }

  const id = makeId("msg");
  await db.insertRow("messages", {
    id, product_id: body.productId, buyer_username: buyerUsername,
    sender: isBuyer ? "buyer" : "vendor", sender_name: senderName, text: String(body.text || "").trim(), created_at: Date.now(),
  });

  send(res, 201, { id });
});

/* Delivery worker applications */
route("POST", "/api/workers/apply", async (req, res, body) => {
  const session = auth(req);
  if (!session || session.user_type !== "buyer") return send(res, 401, { error: "Not signed in." });

  const fullName = String(body.fullName || "").trim();
  const level = String(body.level || "").trim();
  const email = String(body.email || "").trim();
  const telegramNumber = String(body.telegramNumber || "").trim();
  const roomNumber = String(body.roomNumber || "").trim();
  if (!fullName || !level || !email || !telegramNumber || !roomNumber) return send(res, 400, { error: "Fill in every field." });

  const existing = await db.selectOne("worker_applications", "username", session.user_id);
  if (existing && existing.status === "pending") return send(res, 409, { error: "You already have a pending application." });
  if (existing && existing.status === "approved") return send(res, 409, { error: "You're already an approved delivery worker." });

  const id = makeId("wa");
  const token = makeId("tok");
  await db.upsertRow("worker_applications", {
    id, username: session.user_id, full_name: fullName, room_number: roomNumber,
    level, telegram_number: telegramNumber, email, status: "pending", token, applied_at: Date.now(), decided_at: null,
  }, "username");

  const base = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`;
  const acceptUrl = `${base}/api/workers/decision?token=${token}&action=accept`;
  const declineUrl = `${base}/api/workers/decision?token=${token}&action=decline`;
  const html = `
    <p>New delivery worker application for MoveMart:</p>
    <ul>
      <li><b>Name:</b> ${fullName}</li>
      <li><b>Level:</b> ${level}</li>
      <li><b>Email:</b> ${email}</li>
      <li><b>Telegram number:</b> ${telegramNumber}</li>
      <li><b>Room number:</b> ${roomNumber}</li>
    </ul>
    <p>
      <a href="${acceptUrl}" style="background:#20301f;color:#F0C846;padding:10px 20px;text-decoration:none;border-radius:6px;margin-right:10px;">Accept</a>
      <a href="${declineUrl}" style="background:#888;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;">Decline</a>
    </p>`;
  await sendEmail(MANAGEMENT_EMAIL, `MoveMart: delivery application from ${fullName}`, `${fullName} applied to be a delivery worker. Open this email in a browser to respond.`, html);

  send(res, 201, { status: "pending" });
});

route("GET", "/api/workers/me", async (req, res) => {
  const session = auth(req);
  if (!session || session.user_type !== "buyer") return send(res, 401, { error: "Not signed in." });
  const app = await db.selectOne("worker_applications", "username", session.user_id);
  send(res, 200, { application: app || null });
});

route("GET", "/api/workers/decision", async (req, res, _body, _params, query) => {
  const token = query.token;
  const action = query.action === "accept" ? "approved" : "declined";
  const app = await db.selectOne("worker_applications", "token", token);

  const page = (msg) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<html><body style="font-family:sans-serif;padding:40px;text-align:center;"><h2>${msg}</h2></body></html>`);
  };
  if (!app) return page("This link is invalid or has already been used.");
  if (app.status !== "pending") return page(`This application was already marked as ${app.status}.`);

  await db.updateWhere("worker_applications", "token", token, { status: action, decided_at: Date.now() });
  await sendEmail(
    app.email,
    action === "approved" ? "You've been approved as a MoveMart delivery worker!" : "MoveMart delivery application update",
    action === "approved"
      ? "Good news! Your application to be a delivery worker was approved. Log in to MoveMart and check your profile to start seeing deliveries."
      : "Thanks for applying to be a MoveMart delivery worker. Unfortunately your application wasn't approved this time."
  );
  page(action === "approved" ? `Approved ${app.full_name}. They've been emailed.` : `Declined ${app.full_name}. They've been emailed.`);
});

route("GET", "/api/workers/orders", async (req, res) => {
  const session = auth(req);
  if (!session || session.user_type !== "buyer") return send(res, 401, { error: "Not signed in." });
  const app = await db.selectOne("worker_applications", "username", session.user_id);
  if (!app || app.status !== "approved") return send(res, 403, { error: "Not an approved delivery worker." });

  const rows = await db.selectMany("orders", [["status", "eq.new"]], { order: "created_at.desc" });
  const vendorRows = await db.selectMany("vendors", [], { select: "id,name" });
  const vendors = Object.fromEntries(vendorRows.map((v) => [v.id, v.name]));
  send(res, 200, { orders: rows.map((o) => ({ ...o, vendorName: vendors[o.vendor_id] || "Unknown", total: orderTotal(o) })) });
});

route("PATCH", "/api/workers/orders/:id/deliver", async (req, res, _body, params) => {
  const session = auth(req);
  if (!session || session.user_type !== "buyer") return send(res, 401, { error: "Not signed in." });
  const app = await db.selectOne("worker_applications", "username", session.user_id);
  if (!app || app.status !== "approved") return send(res, 403, { error: "Not an approved delivery worker." });

  await db.updateWhere("orders", "id", params.id, { status: "delivered", delivered_at: Date.now() });
  await notifyAdminOfDelivery(params.id);
  send(res, 200, { ok: true });
});

/* --------------------------------- server -------------------------------- */
const FRONTEND_PATH = path.join(__dirname, "public_index.html");
const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});

  const url = new URL(req.url, `http://${req.headers.host}`);

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.regex.exec(url.pathname);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const query = Object.fromEntries(url.searchParams);
    try {
      const body = (req.method === "POST" || req.method === "PATCH") ? await readBody(req) : {};
      return await r.handler(req, res, body, params, query);
    } catch (e) {
      console.error(e);
      return send(res, 500, { error: dbErrorMessage(e) });
    }
  }

  if (req.method === "GET" && fs.existsSync(FRONTEND_PATH)) {
    res.writeHead(200, { "Content-Type": "text/html" });
    return fs.createReadStream(FRONTEND_PATH).pipe(res);
  }

  send(res, 404, { error: "Not found." });
});

server.listen(PORT, () => console.log(`Campus Market API listening on :${PORT}`));

module.exports = server;
