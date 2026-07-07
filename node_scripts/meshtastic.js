const mqtt   = require("mqtt");
const { Pool } = require("pg");
const crypto = require("crypto");

// ── Config ───────────────────────────────────────────────────────────────────
const MQTT_URL  = process.env.MQTT_URL  || "mqtt://mosquitto:1883";
const MQTT_USER = process.env.MQTT_USER;
const MQTT_PASS = process.env.MQTT_PASS;

const PG_HOST = process.env.PG_HOST || "postgres";
const PG_PORT = process.env.PG_PORT || 5432;
const PG_DB   = process.env.PG_DB   || "meshtastic";
const PG_USER = process.env.PG_USER;
const PG_PASS = process.env.PG_PASS;

const TOPIC_PATTERN = "msh/+/+/json/#";

// ── PostgreSQL ────────────────────────────────────────────────────────────────
const pool = new Pool({
  host: PG_HOST, port: PG_PORT, database: PG_DB, user: PG_USER, password: PG_PASS,
});
pool.on("error", (e) => console.error("[pg] pool error:", e.message));

// ── Schema ───────────────────────────────────────────────────────────────────
async function initSchema() {
  const client = await pool.connect();
  try {
    await client.query(`
      -- ── messages ─────────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS messages (
        id          BIGSERIAL        PRIMARY KEY,
        receive_time TIMESTAMPTZ     NOT NULL DEFAULT now(),
        topic       TEXT,
        topic_channel TEXT,
        topic_node  TEXT,
        msg_id      BIGINT,                        -- payload.id
        from_node   BIGINT,                        -- payload.from  (entier)
        to_node     BIGINT,                        -- payload.to    (entier)
        from_txt    TEXT GENERATED ALWAYS AS (     -- 4 derniers hex de from_node
                      right(lpad(to_hex(COALESCE(from_node, 0)), 8, '0'), 4)
                    ) STORED,
        to_txt      TEXT GENERATED ALWAYS AS (     -- 4 derniers hex de to_node
                      right(lpad(to_hex(COALESCE(to_node, 0)), 8, '0'), 4)
                    ) STORED,
        type        TEXT,
        sender      TEXT,                          -- payload.sender (!xxxxxxxx)
        channel     INT,
        hop_start   INT,
        hops_away   INT,
        node_ts     TIMESTAMPTZ,                   -- timestamp fourni par le nœud
        payload     JSONB
      );

      CREATE INDEX IF NOT EXISTS idx_msg_receive  ON messages (receive_time DESC);
      CREATE INDEX IF NOT EXISTS idx_msg_from     ON messages (from_node);
      CREATE INDEX IF NOT EXISTS idx_msg_to       ON messages (to_node);
      CREATE INDEX IF NOT EXISTS idx_msg_type     ON messages (type);
      CREATE INDEX IF NOT EXISTS idx_msg_channel  ON messages (channel);

    `);
    console.log("[pg] ✅ Schema ready (tables: messages)");
  } finally {
    client.release();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────


// Parse topic → { region, channel, node }
// msh / EU_868 / 2 / json / ROM / !9e9d189c
function parseTopic(topic) {
  const parts = topic.split("/");
  if (parts.length < 6) return null;
  return {
    region:  parts[1],
    channel: parts.slice(4, parts.length - 1).join("/"),
    node:    parts[parts.length - 1],
  };
}

// ── MQTT ──────────────────────────────────────────────────────────────────────
console.log(`[mqtt-bridge] Connecting to ${MQTT_URL} …`);

const mqttClient = mqtt.connect(MQTT_URL, {
  username: MQTT_USER, password: MQTT_PASS,
  reconnectPeriod: 5000, connectTimeout: 15000,
});

mqttClient.on("connect", () => {
  console.log("[mqtt-bridge] ✅ Connected");
  mqttClient.subscribe(TOPIC_PATTERN, { qos: 1 }, (err) => {
    if (err) console.error("[mqtt-bridge] Subscribe error:", err);
    else     console.log(`[mqtt-bridge] Subscribed: ${TOPIC_PATTERN}`);
  });
});
mqttClient.on("error",     (e) => console.error("[mqtt-bridge] error:", e.message));
mqttClient.on("offline",   ()  => console.warn ("[mqtt-bridge] offline – reconnecting…"));
mqttClient.on("reconnect", ()  => console.log  ("[mqtt-bridge] reconnecting…"));

// ── Message handler ───────────────────────────────────────────────────────────
mqttClient.on("message", async (topic, rawBuf) => {

  // 1. Parse topic
  const meta = parseTopic(topic);
  if (!meta) { console.warn("[mqtt-bridge] unparseable topic:", topic); return; }

  // 2. Parse JSON
  let p;
  try { p = JSON.parse(rawBuf.toString()); }
  catch (e) { console.warn("[mqtt-bridge] non-JSON:", rawBuf.toString().slice(0, 80)); return; }

  // 3. Timestamp nœud (payload.timestamp souvent 0, fallback sur payload.payload.time)
  const rawTs = (p.timestamp && p.timestamp !== 0)
    ? p.timestamp
    : (p.payload?.time && p.payload.time !== 0) ? p.payload.time : null;
  const nodeTs = rawTs ? new Date(rawTs * 1000).toISOString() : null;

  // 4. Hash dédup

  // ── TABLE messages ──────────────────────────────────────────────────────────
  let insertedId = null;
  try {
    const res = await pool.query(
      `INSERT INTO messages
         (msg_id, from_node, to_node, type, sender, channel,
          hop_start, hops_away, node_ts, payload, topic, topic_channel, topic_node)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, $11, $12, $13)
       RETURNING id`,
      [
        p.id      ?? null,
        p.from    ?? null,
        p.to      ?? null,
        p.type    || null,
        p.sender  ?? null,
        p.channel ?? null,
        p.hop_start  ?? null,
        p.hops_away  ?? null,
        nodeTs,
        p.payload ?? {},
        topic,
        meta.channel,
        meta.node
      ]
    );

    if (res.rowCount === 0) {
      console.log(`[msg] ⚡ dup ${meta.node} type=${p.type || "?"}`);
      return;  // doublon → on arrête là
    }
    insertedId = res.rows[0].id;
    console.log(`[msg] ✓ id=${insertedId} ${meta.node} type=${p.type || "?"}`);
  } catch (e) {
    console.error("[msg] insert error:", e.message);
    return;
  }

});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown(sig) {
  console.log(`\n[mqtt-bridge] ${sig} – closing…`);
  mqttClient.end();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

// ── Boot ──────────────────────────────────────────────────────────────────────
initSchema().catch((e) => {
  console.error("[pg] schema init failed:", e.message);
  process.exit(1);
});