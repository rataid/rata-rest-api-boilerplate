/**
 * Pindahkan tiket aktif dari team Klinik ke team klinik tujuan.
 *
 * Sumber: docs/Ticket Active On Klinik.xlsx
 * Kolom yang dipakai: existing_assigned_team, existing_assigned_agent,
 * expected_assigned_team, expected_assigned_agent.
 *
 * Yang diubah: tickets.team_id dan tickets.agent_id supaya sama dengan
 * kolom expected. Kalau expected_assigned_agent kosong, agent_id dikosongkan.
 * Setiap perubahan menulis satu baris histories (TEAM / AGENT).
 * Status tidak dibaca dan tidak diubah. Team tujuan harus sudah ada.
 *
 * Koneksi sama dengan provision-cro-accounts.js:
 * TICKETING_DATABASE_URL, atau TICKETING_DB_HOST, TICKETING_DB_PORT,
 * TICKETING_DB_NAME, TICKETING_DB_USER, dan TICKETING_DB_PASS.
 * Tanpa --execute, script hanya membaca dan menulis laporan.
 *
 * Usage (dari rata-rest-api-boilerplate):
 *   node scripts/move-klinik-tickets.js
 *   node scripts/move-klinik-tickets.js --execute
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const xlsx = require("xlsx");

const REPO_ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(REPO_ROOT, ".env");
const OUTPUT_DIR = path.join(__dirname, "output");
const REPORT_PATH = path.join(OUTPUT_DIR, "move-klinik-tickets-report.csv");
const DEFAULT_WORKBOOK = path.resolve(REPO_ROOT, "docs/Ticket Active On Klinik.xlsx");

function parseArgs(argv) {
  const flags = new Set();
  let file;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--file") {
      file = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--file=")) {
      file = arg.slice("--file=".length);
    } else if (arg.startsWith("--")) {
      flags.add(arg);
    }
  }
  return { execute: flags.has("--execute"), file };
}

const { execute, file: fileArg } = parseArgs(process.argv.slice(2));

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File .env tidak ditemukan di ${filePath}`);
  }
  const env = {};
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1).replace(/^"|"$/g, "");
  }
  return env;
}

function dbConfig(env) {
  if (env.TICKETING_DATABASE_URL) {
    return { connectionString: env.TICKETING_DATABASE_URL };
  }
  if (
    !env.TICKETING_DB_HOST ||
    !env.TICKETING_DB_PORT ||
    !env.TICKETING_DB_NAME ||
    !env.TICKETING_DB_USER ||
    !env.TICKETING_DB_PASS
  ) {
    throw new Error(
      "Isi TICKETING_DB_HOST, TICKETING_DB_PORT, TICKETING_DB_NAME, TICKETING_DB_USER, dan TICKETING_DB_PASS di .env."
    );
  }
  return {
    host: env.TICKETING_DB_HOST,
    port: Number(env.TICKETING_DB_PORT),
    database: env.TICKETING_DB_NAME,
    user: env.TICKETING_DB_USER,
    password: env.TICKETING_DB_PASS,
  };
}

function resolveWorkbook() {
  if (fileArg) return path.resolve(fileArg);
  if (fs.existsSync(DEFAULT_WORKBOOK)) return DEFAULT_WORKBOOK;
  throw new Error(
    'File Excel tidak ditemukan. Jalankan dengan --file "/path/Ticket Active On Klinik.xlsx"'
  );
}

function readRows(workbookPath) {
  const workbook = xlsx.readFile(workbookPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
  return rows.map((row, index) => {
    const ticketNumber = String(row.ticket_number || "").trim();
    const existingTeam = String(row.existing_assigned_team || "").trim();
    const expectedTeam = String(row.expected_assigned_team || "").trim();
    const existingAgent = String(row.existing_assigned_agent || "").trim();
    const expectedAgent = String(row.expected_assigned_agent || "").trim();
    if (!ticketNumber || !existingTeam || !expectedTeam) {
      throw new Error(`Baris ${index + 2} tidak lengkap: ${JSON.stringify(row)}`);
    }
    return { ticketNumber, existingTeam, expectedTeam, existingAgent, expectedAgent };
  });
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writeReport(records) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const header = [
    "ticket_number",
    "sheet_team",
    "db_team",
    "expected_team",
    "sheet_agent",
    "expected_agent",
    "db_agent",
    "action",
    "note",
  ];
  const lines = records.map((record) =>
    [
      record.ticketNumber,
      record.existingTeam,
      record.dbTeam,
      record.expectedTeam,
      record.existingAgent,
      record.expectedAgent,
      record.dbAgent,
      record.action,
      record.note,
    ]
      .map(csvEscape)
      .join(",")
  );
  fs.writeFileSync(REPORT_PATH, `${header.join(",")}\n${lines.join("\n")}\n`);
}

async function main() {
  const env = loadEnv(ENV_PATH);
  const db = dbConfig(env);
  const workbookPath = resolveWorkbook();
  const rows = readRows(workbookPath);
  const client = new Client(db);
  await client.connect();

  const records = [];
  try {
    await client.query("BEGIN");
    const teamResult = await client.query("SELECT id, name FROM teams");
    const teams = new Map(teamResult.rows.map((team) => [team.name, team.id]));
    const userResult = await client.query("SELECT id, name FROM users WHERE name IS NOT NULL");
    const users = new Map();
    const ambiguousUsers = new Set();
    for (const user of userResult.rows) {
      const key = String(user.name).trim().toLowerCase();
      if (!key) continue;
      if (users.has(key)) ambiguousUsers.add(key);
      else users.set(key, user.id);
    }

    for (const row of rows) {
      const ticket = await client.query(
        `SELECT t.number, t.team_id, t.agent_id, team.name AS team_name, agent.name AS agent_name
         FROM tickets t
         LEFT JOIN teams team ON team.id = t.team_id
         LEFT JOIN users agent ON agent.id = t.agent_id
         WHERE t.number = $1`,
        [row.ticketNumber]
      );

      if (!ticket.rowCount) {
        records.push({ ...row, dbTeam: "", dbAgent: "", action: "skip", note: "tiket tidak ditemukan" });
        continue;
      }

      const current = ticket.rows[0];
      const dbTeam = current.team_name || "";
      const dbAgent = current.agent_name || "";
      const expectedTeamId = teams.get(row.expectedTeam);
      const notes = [];
      const teamAlready = dbTeam === row.expectedTeam;
      let expectedAgentId = null;

      if (!expectedTeamId) {
        records.push({
          ...row,
          dbTeam,
          dbAgent,
          action: "skip",
          note: `team tujuan '${row.expectedTeam}' belum ada`,
        });
        continue;
      }

      if (!teamAlready && dbTeam !== row.existingTeam) {
        records.push({
          ...row,
          dbTeam,
          dbAgent,
          action: "skip",
          note: `team di database '${dbTeam}' bukan '${row.existingTeam}'`,
        });
        continue;
      }

      if (row.expectedAgent) {
        const agentKey = row.expectedAgent.toLowerCase();
        if (ambiguousUsers.has(agentKey)) {
          records.push({
            ...row,
            dbTeam,
            dbAgent,
            action: "skip",
            note: `agent tujuan '${row.expectedAgent}' tidak unik`,
          });
          continue;
        }
        expectedAgentId = users.get(agentKey);
        if (!expectedAgentId) {
          records.push({
            ...row,
            dbTeam,
            dbAgent,
            action: "skip",
            note: `agent tujuan '${row.expectedAgent}' belum ada`,
          });
          continue;
        }
      }

      const agentAlready = row.expectedAgent
        ? dbAgent.toLowerCase() === row.expectedAgent.toLowerCase()
        : !current.agent_id;

      if (teamAlready && agentAlready) {
        records.push({ ...row, dbTeam, dbAgent, action: "already", note: "team dan agent sudah sesuai" });
        continue;
      }

      if (row.existingAgent && dbAgent.toLowerCase() !== row.existingAgent.toLowerCase()) {
        notes.push(`agent di database '${dbAgent || "-"}' berbeda dari sheet`);
      }
      if (!agentAlready && !row.expectedAgent) notes.push("agent dikosongkan");

      if (execute) {
        if (!teamAlready) {
          await client.query(
            "UPDATE tickets SET team_id = $1, updated_at = NOW() WHERE number = $2",
            [expectedTeamId, row.ticketNumber]
          );
          await client.query(
            `INSERT INTO histories (id, changed_column, old_value, new_value, ticket_id, created_at, updated_at)
             VALUES ($1, 'TEAM', $2, $3, $4, NOW(), NOW())`,
            [crypto.randomUUID(), String(current.team_id), String(expectedTeamId), row.ticketNumber]
          );
        }
        if (!agentAlready) {
          await client.query(
            "UPDATE tickets SET agent_id = $1, updated_at = NOW() WHERE number = $2",
            [expectedAgentId, row.ticketNumber]
          );
          await client.query(
            `INSERT INTO histories (id, changed_column, old_value, new_value, ticket_id, created_at, updated_at)
             VALUES ($1, 'AGENT', $2, $3, $4, NOW(), NOW())`,
            [crypto.randomUUID(), current.agent_id ? String(current.agent_id) : null, expectedAgentId, row.ticketNumber]
          );
        }
      }

      records.push({
        ...row,
        dbTeam,
        dbAgent,
        action: execute ? "moved" : "ready",
        note: notes.join("; "),
      });
    }

    const blocked = records.filter((record) => record.action === "skip");
    if (execute && blocked.length) {
      throw new Error(
        `${blocked.length} tiket tidak bisa dipindah. Tidak ada perubahan yang disimpan. Lihat ${REPORT_PATH}`
      );
    }

    if (execute) await client.query("COMMIT");
    else await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    writeReport(records);
    throw error;
  } finally {
    await client.end();
  }

  writeReport(records);
  const count = (action) => records.filter((record) => record.action === action).length;
  console.log(
    JSON.stringify(
      {
        execute,
        database: env.TICKETING_DB_NAME || "ticketing",
        host: env.TICKETING_DB_HOST || null,
        workbook: workbookPath,
        tickets: records.length,
        ready: count("ready"),
        moved: count("moved"),
        already: count("already"),
        skip: count("skip"),
        report: REPORT_PATH,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
