const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const db = require("./db");
const {
  hashSecret, verifySecret, createSession, getSession,
  makeId, makeLoginCode, sendLoginCodeEmail,
} = require("./auth");

const PORT = process.env.PORT || 3001;
const DELIVERY_FEE = 500;
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

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

function saveImage(base64DataUrl) {
  if (!base64DataUrl) return null;
  const match = /^data:(image\/\w+);base64,(.+)$/.exec(base64DataUrl);
  if (!match) return null;
  const ext = match[1].split("/")[1].replace("jpeg", "jpg");
  const fileName = `${crypto.randomBytes(12).toString("hex")}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, fileName), Buffer.from(match[2], "base64"));
  return `/uploads/${fileName}`;
}

const orderTotal = (o) => o.agreed_price * o.qty + o.delivery_fee;
const isSameDay = (ts, ref = Date.now()) => new Date(ts).toDateString() === new Date(ref).toDateString();

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

  const existing = db.prepare("SELECT username FROM buyers WHERE username = ?").get(username);
  if (existing) return send(res, 409, { error: "That username is taken." });

  const { hash, salt } = hashSecret(pin);
  db.prepare(
    "INSERT INTO buyers (username, display_name, email, pin_hash, pin_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(username, displayName, email, hash, salt, Date.now());

  const token = createSession("buyer", username);
  send(res, 201, { token, username, displayName });
});

route("POST", "/api/buyers/login", async (req, res, body) => {
  const username = String(body.username || "").trim().toLowerCase();
  const pin = String(body.pin || "").trim();
  const buyer = db.prepare("SELECT * FROM buyers WHERE username = ?").get(username);
  if (!buyer) return send(res, 404, { error: "No account with that username." });
  if (!verifySecret(pin, buyer.pin_salt, buyer.pin_hash)) return send(res, 401, { error: "Wrong PIN." });

  const code = makeLoginCode();
  db.prepare(
    "INSERT INTO login_codes (username, code, created_at) VALUES (?, ?, ?) ON CONFLICT(username) DO UPDATE SET code = excluded.code, created_at = excluded.created_at"
  ).run(username, code, Date.now());
  const emailResult = await sendLoginCodeEmail(buyer.email, code);
  send(res, 200, { pending: true, emailSent: emailResult.sent, devCode: emailResult.sent ? undefined : code });
});

route("POST", "/api/buyers/verify", async (req, res, body) => {
  const username = String(body.username || "").trim().toLowerCase();
  const code = String(body.code || "").trim();
  const row = db.prepare("SELECT * FROM login_codes WHERE username = ?").get(username);
  if (!row || row.code !== code) return send(res, 401, { error: "Incorrect or expired code." });
  if (Date.now() - row.created_at > 10 * 60 * 1000) return send(res, 401, { error: "Code expired, request a new one." });
  db.prepare("DELETE FROM login_codes WHERE username = ?").run(username);

  const buyer = db.prepare("SELECT * FROM buyers WHERE username = ?").get(username);
  const token = createSession("buyer", username);
  send(res, 200, { token, username: buyer.username, displayName: buyer.display_name });
});

route("PATCH", "/api/buyers/me", async (req, res, body) => {
  const session = auth(req);
  if (!session || session.user_type !== "buyer") return send(res, 401, { error: "Not signed in." });
  const displayName = String(body.displayName || "").trim();
  if (!displayName) return send(res, 400, { error: "Display name can't be empty." });
  db.prepare("UPDATE buyers SET display_name = ? WHERE username = ?").run(displayName, session.user_id);
  send(res, 200, { username: session.user_id, displayName });
});

route("GET", "/api/orders/mine", async (req, res) => {
  const session = auth(req);
  if (!session || session.user_type !== "buyer") return send(res, 401, { error: "Not signed in." });
  const rows = db.prepare("SELECT * FROM orders WHERE buyer_username = ? ORDER BY created_at DESC").all(session.user_id);
  send(res, 200, { orders: rows });
});

/* Vendors */
route("GET", "/api/vendors", async (req, res) => {
  const rows = db.prepare("SELECT id, name, tag FROM vendors ORDER BY created_at ASC").all();
  send(res, 200, { vendors: rows });
});

route("POST", "/api/vendors/register", async (req, res, body) => {
  const name = String(body.name || "").trim();
  const tag = String(body.tag || "Campus seller").trim();
  const password = String(body.password || "").trim();
  if (!name) return send(res, 400, { error: "Shop name is required." });
  if (password.length < 4) return send(res, 400, { error: "Password must be at least 4 characters." });

  const id = makeId("v");
  const { hash, salt } = hashSecret(password);
  db.prepare(
    "INSERT INTO vendors (id, name, tag, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, name, tag, hash, salt, Date.now());

  const token = createSession("vendor", id);
  send(res, 201, { token, id, name, tag });
});

route("POST", "/api/vendors/login", async (req, res, body) => {
  const id = String(body.id || "").trim();
  const password = String(body.password || "").trim();
  const vendor = db.prepare("SELECT * FROM vendors WHERE id = ?").get(id);
  if (!vendor) return send(res, 404, { error: "Shop not found." });
  if (!verifySecret(password, vendor.password_salt, vendor.password_hash)) return send(res, 401, { error: "Wrong password." });
  const token = createSession("vendor", id);
  send(res, 200, { token, id: vendor.id, name: vendor.name, tag: vendor.tag });
});

/* Products */
route("GET", "/api/products", async (req, res) => {
  const rows = db.prepare("SELECT * FROM products ORDER BY created_at DESC").all();
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

  const imagePath = saveImage(body.imageBase64);
  const id = makeId("p");
  db.prepare(
    "INSERT INTO products (id, vendor_id, name, category, price, icon, image_path, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, session.user_id, name, body.category || "Other", price, body.icon || "🛍️", imagePath, body.desc || "", Date.now());

  send(res, 201, { id, vendorId: session.user_id, name, category: body.category || "Other", price, icon: body.icon || "🛍️", imageUrl: imagePath, desc: body.desc || "" });
});

/* Orders */
route("POST", "/api/orders", async (req, res, body) => {
  const session = auth(req);
  if (!session || session.user_type !== "buyer") return send(res, 401, { error: "Not signed in." });
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(body.productId);
  if (!product) return send(res, 404, { error: "Item not found." });
  const buyer = db.prepare("SELECT * FROM buyers WHERE username = ?").get(session.user_id);

  const qty = Math.max(1, Number(body.qty) || 1);
  const agreedPrice = Number(body.agreedPrice);
  if (!agreedPrice || agreedPrice <= 0) return send(res, 400, { error: "Enter the agreed price." });
  if (!body.location || !body.phone) return send(res, 400, { error: "Delivery location and phone are required." });

  const id = makeId("ord");
  db.prepare(`
    INSERT INTO orders (id, product_id, product_name, vendor_id, buyer_username, buyer_display_name, qty, agreed_price, delivery_fee, payment_method, location, phone, notes, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)
  `).run(id, product.id, product.name, product.vendor_id, buyer.username, buyer.display_name, qty, agreedPrice, DELIVERY_FEE,
         body.paymentMethod === "cash" ? "cash" : "transfer", body.location, body.phone, body.notes || "", Date.now());

  send(res, 201, { id, status: "new" });
});

route("GET", "/api/orders/vendor", async (req, res) => {
  const session = auth(req);
  if (!session || session.user_type !== "vendor") return send(res, 401, { error: "Not signed in as a seller." });
  const rows = db.prepare("SELECT * FROM orders WHERE vendor_id = ? ORDER BY created_at DESC").all(session.user_id);
  send(res, 200, { orders: rows });
});

/* Owner / management */
route("POST", "/api/owner/login", async (req, res, body) => {
  const password = String(body.password || "").trim();
  if (password.length < 4) return send(res, 400, { error: "Password must be at least 4 characters." });
  const existing = db.prepare("SELECT * FROM owner_auth WHERE id = 1").get();
  if (!existing) {
    const { hash, salt } = hashSecret(password);
    db.prepare("INSERT INTO owner_auth (id, password_hash, password_salt) VALUES (1, ?, ?)").run(hash, salt);
    return send(res, 201, { token: createSession("owner", "owner"), created: true });
  }
  if (!verifySecret(password, existing.password_salt, existing.password_hash)) return send(res, 401, { error: "Wrong password." });
  send(res, 200, { token: createSession("owner", "owner") });
});

route("GET", "/api/owner/orders", async (req, res) => {
  const session = auth(req);
  if (!session || session.user_type !== "owner") return send(res, 401, { error: "Not signed in as management." });
  const rows = db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all();
  const vendors = Object.fromEntries(db.prepare("SELECT id, name FROM vendors").all().map((v) => [v.id, v.name]));

  const today = rows.filter((o) => isSameDay(o.created_at));
  const deliveredToday = today.filter((o) => o.status === "delivered");
  send(res, 200, {
    orders: rows.map((o) => ({ ...o, vendorName: vendors[o.vendor_id] || "Unknown", total: orderTotal(o) })),
    stats: {
      ordersToday: today.length,
      deliveredToday: deliveredToday.length,
      revenueDeliveredToday: deliveredToday.reduce((s, o) => s + orderTotal(o), 0),
      expectedRevenueToday: today.reduce((s, o) => s + orderTotal(o), 0),
      pendingToday: today.length - deliveredToday.length,
    },
  });
});

route("PATCH", "/api/owner/orders/:id/deliver", async (req, res, body, params) => {
  const session = auth(req);
  if (!session || session.user_type !== "owner") return send(res, 401, { error: "Not signed in as management." });
  db.prepare("UPDATE orders SET status = 'delivered', delivered_at = ? WHERE id = ?").run(Date.now(), params.id);
  send(res, 200, { ok: true });
});

/* Messages */
route("GET", "/api/messages/for-vendor/:productId", async (req, res, _body, params) => {
  const session = auth(req);
  if (!session || session.user_type !== "vendor") return send(res, 401, { error: "Not signed in as a seller." });
  const buyers = db.prepare(
    "SELECT DISTINCT buyer_username FROM messages WHERE product_id = ?"
  ).all(params.productId);
  send(res, 200, { buyers: buyers.map((b) => b.buyer_username) });
});

route("GET", "/api/messages/:productId/:buyerUsername", async (req, res, _body, params) => {
  const rows = db.prepare(
    "SELECT * FROM messages WHERE product_id = ? AND buyer_username = ? ORDER BY created_at ASC"
  ).all(params.productId, params.buyerUsername);
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
    const buyer = db.prepare("SELECT display_name FROM buyers WHERE username = ?").get(session.user_id);
    senderName = buyer?.display_name || session.user_id;
  } else {
    const vendor = db.prepare("SELECT name FROM vendors WHERE id = ?").get(session.user_id);
    senderName = vendor?.name || "Seller";
  }

  const id = makeId("msg");
  db.prepare(
    "INSERT INTO messages (id, product_id, buyer_username, sender, sender_name, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, body.productId, buyerUsername, isBuyer ? "buyer" : "vendor", senderName, String(body.text || "").trim(), Date.now());

  send(res, 201, { id });
});

/* --------------------------------- server -------------------------------- */
const FRONTEND_PATH = path.join(__dirname, "public_index.html");
const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname.startsWith("/uploads/")) {
    const filePath = path.join(UPLOADS_DIR, path.basename(url.pathname));
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { "Access-Control-Allow-Origin": "*" });
      return fs.createReadStream(filePath).pipe(res);
    }
    res.writeHead(404); return res.end();
  }

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.regex.exec(url.pathname);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    try {
      const body = (req.method === "POST" || req.method === "PATCH") ? await readBody(req) : {};
      return await r.handler(req, res, body, params);
    } catch (e) {
      console.error(e);
      return send(res, 500, { error: "Server error." });
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
