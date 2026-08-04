/**
 * Talks to Supabase's auto-generated REST API (PostgREST) over plain fetch,
 * so we still need zero npm packages. Requires two environment variables:
 *   SUPABASE_URL           e.g. https://xxxxx.supabase.co
 *   SUPABASE_SERVICE_KEY   the "service_role" secret key (Settings -> API)
 * The service_role key bypasses row-level security, which is what a trusted
 * backend server is supposed to use — never send this key to the browser.
 */

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

function configured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);
}

function headers(extra) {
  return Object.assign(
    {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    extra || {}
  );
}

async function rest(method, table, opts) {
  opts = opts || {};
  if (!configured()) {
    throw new Error(
      "Database isn't configured yet — set SUPABASE_URL and SUPABASE_SERVICE_KEY as environment variables."
    );
  }
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  const qs = new URLSearchParams();
  if (opts.select) qs.set("select", opts.select);
  if (opts.filters) opts.filters.forEach(([col, val]) => qs.append(col, val));
  if (opts.order) qs.set("order", opts.order);
  if (opts.limit) qs.set("limit", opts.limit);
  if ([...qs].length) url += "?" + qs.toString();

  const extraHeaders = {};
  if (opts.returning) extraHeaders["Prefer"] = "return=representation";
  if (opts.onConflict) url += (url.includes("?") ? "&" : "?") + "on_conflict=" + opts.onConflict;
  if (opts.resolution) extraHeaders["Prefer"] = (extraHeaders["Prefer"] ? extraHeaders["Prefer"] + "," : "") + "resolution=" + opts.resolution;

  const res = await fetch(url, {
    method,
    headers: headers(extraHeaders),
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase ${method} ${table} failed (${res.status}): ${text}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/* ---- generic helpers used throughout server.js ---- */
async function selectOne(table, column, value, select) {
  const rows = await rest("GET", table, { filters: [[column, `eq.${value}`]], select: select || "*", limit: 1 });
  return rows && rows[0] ? rows[0] : null;
}
async function selectMany(table, filters, opts) {
  opts = opts || {};
  return await rest("GET", table, { filters: filters || [], select: opts.select || "*", order: opts.order });
}
async function insertRow(table, row) {
  const rows = await rest("POST", table, { body: row, returning: true });
  return rows && rows[0] ? rows[0] : null;
}
async function updateWhere(table, column, value, patch) {
  await rest("PATCH", table, { filters: [[column, `eq.${value}`]], body: patch });
}
async function upsertRow(table, row, onConflictColumn) {
  await rest("POST", table, { body: row, onConflict: onConflictColumn, resolution: "merge-duplicates" });
}
async function deleteWhere(table, column, value) {
  await rest("DELETE", table, { filters: [[column, `eq.${value}`]] });
}

/* ---- image storage (Supabase Storage, bucket must be named "product-images" and public) ---- */
async function uploadImage(base64DataUrl) {
  if (!base64DataUrl || !configured()) return null;
  const match = /^data:(image\/\w+);base64,(.+)$/.exec(base64DataUrl);
  if (!match) return null;
  const ext = match[1].split("/")[1].replace("jpeg", "jpg");
  const crypto = require("node:crypto");
  const fileName = `${crypto.randomBytes(12).toString("hex")}.${ext}`;
  const buffer = Buffer.from(match[2], "base64");

  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/product-images/${fileName}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": match[1],
    },
    body: buffer,
  });
  if (!res.ok) {
    console.error("Image upload failed:", await res.text().catch(() => ""));
    return null;
  }
  return `${SUPABASE_URL}/storage/v1/object/public/product-images/${fileName}`;
}

module.exports = { configured, selectOne, selectMany, insertRow, updateWhere, upsertRow, deleteWhere, uploadImage };
