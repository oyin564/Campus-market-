const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const db = require("./db");
const {
  hashSecret, verifySecret, createSession, getSession,
  makeId, makeLoginCode, sendLoginCodeEmail,
} = require("./auth");

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
  await db.insertRow("buyers", {
    username, display_name: displayName, email, pin_hash: hash, pin_salt: salt, created_at: Date.now(),
  });

  const token = createSession("buyer", username);
  send(res, 201, { token, username, displayName });
});

route("POST", "/api/buyers/login", async (req, res, body) => {
  const username = String(body.username || "").trim().toLowerCase();
  const pin = String(body.pin || "").trim();
  const buyer = await db.selectOne("buyers", "username", username);
  if (!buyer) return send(res, 404, { error: "No account with that username." });
  if (!verifySecret(pin, buyer.pin_salt, buyer.pin_hash)) return send(res, 401, { error: "Wrong PIN." });

  const code = makeLoginCode();
  await db.upsertRow("login_codes", { username, code, created_at: Date.now() }, "username");
  const emailResult = await sendLoginCodeEmail(buyer.email, code);
  send(res, 200, { pending: true, emailSent: emailResult.sent, devCode: emailResult.sent ? undefined : code });
});

route("POST", "/api/buyers/verify", async (req, res, body) => {
  const username = String(body.username || "").trim().toLowerCase();
  const code = String(body.code || "").trim();
  const row = await db.selectOne("login_codes", "username", username);
  if (!row || row.code !== code) return send(res, 401, { error: "Incorrect or expired code." });
  if (Date.now() - row.created_at > 10 * 60 * 1000) return send(res, 401, { error: "Code expired, request a new one." });
  await db.deleteWhere("login_codes", "username", username);

  const buyer = await db.selectOne("buyers", "username", username);
  const token = createSession("buyer", username);
  send(res, 200, { token, username: buyer.username, displayName: buyer.display_name });
});

route("PATCH", "/api/buyers/me", async (req, res, body) => {
  const session = auth(req);
  if (!session || session.user_type !== "buyer") return send(res, 401, { error: "Not signed in." });
  const displayName = String(body.displayName || "").trim();
  if (!displayName) return send(res, 400, { error: "Display name can't be empty." });
  await db.updateWhere("buyers", "username", session.user_id, { display_name: displayName });
  send(res, 200, { username: session.user_id, displayName });
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
  const password = String(body.password || "").trim();
  if (!name) return send(res, 400, { error: "Shop name is required." });
  if (password.length < 4) return send(res, 400, { error: "Password must be at least 4 characters." });

  const id = makeId("v");
  const { hash, salt } = hashSecret(password);
  await db.insertRow("vendors", { id, name, tag, password_hash: hash, password_salt: salt, created_at: Date.now() });

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
  const password = String(body.password || "").trim();
  if (password.length < 4) return send(res, 400, { error: "Password must be at least 4 characters." });
  const existing = await db.selectOne("owner_auth", "id", 1);
  if (!existing) {
    const { hash, salt } = hashSecret(password);
    await db.insertRow("owner_auth", { id: 1, password_hash: hash, password_salt: salt });
    return send(res, 201, { token: createSession("owner", "owner"), created: true });
  }
  if (!verifySecret(password, existing.password_salt, existing.password_hash)) return send(res, 401, { error: "Wrong password." });
  send(res, 200, { token: createSession("owner", "owner") });
});

route("GET", "/api/owner/orders", async (req, res) => {
  const session = auth(req);
  if (!session || session.user_type !== "owner") return send(res, 401, { error: "Not signed in as management." });
  const rows = await db.selectMany("orders", [], { order: "created_at.desc" });
  const vendorRows = await db.selectMany("vendors", [], { select: "id,name" });
  const vendors = Object.fromEntries(vendorRows.map((v) => [v.id, v.name]));

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
  await db.updateWhere("orders", "id", params.id, { status: "delivered", delivered_at: Date.now() });
  send(res, 200, { ok: true });
});

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
    try {
      const body = (req.method === "POST" || req.method === "PATCH") ? await readBody(req) : {};
      return await r.handler(req, res, body, params);
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
