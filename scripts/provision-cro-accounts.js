/**
 * Provision CRO accounts on the ticketing database.
 *
 * - create the clinic team from the spreadsheet when it does not exist
 * - create the CRO role and copy Agent - Klinik privileges
 * - create or move the user onto that role
 * - generate a password only for accounts that do not exist yet
 * - email the address and password only for those new accounts
 * Existing accounts keep their current password and are not emailed.
 * Emails are sent one at a time, with one minute between each message.
 *
 * Usage (from rata-rest-api-boilerplate):
 *   node scripts/provision-cro-accounts.js --dry-run --file "docs/Request Akun Ticketing Untuk CRO.xlsx"
 *   node scripts/provision-cro-accounts.js --file "docs/Request Akun Ticketing Untuk CRO.xlsx"
 *   node scripts/provision-cro-accounts.js --skip-email --file "docs/Request Akun Ticketing Untuk CRO.xlsx"
 *   node scripts/provision-cro-accounts.js --resend-email
 *   node scripts/provision-cro-accounts.js --smtp-test --to user@rata.id --name "Nama Orang"
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");
const { Client } = require("pg");
const xlsx = require("xlsx");

const REPO_ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(REPO_ROOT, ".env");
const OUTPUT_DIR = path.join(__dirname, "output");
const CREDENTIALS_PATH = path.join(OUTPUT_DIR, "cro-dev-credentials.csv");
const DEFAULT_WORKBOOK = path.resolve(
  REPO_ROOT,
  "docs/Request Akun Ticketing Untuk CRO.xlsx"
);
const PRIVILEGE_TEMPLATE_ROLE = "Agent - Klinik";
const BCRYPT_ROUNDS = 12;
const EMAIL_DELAY_MS = 60 * 1000;

function parseArgs(argv) {
  const flags = new Set();
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--file" || arg === "--to" || arg === "--name") {
      options[arg.slice(2)] = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--file=") || arg.startsWith("--to=") || arg.startsWith("--name=")) {
      const separator = arg.indexOf("=");
      options[arg.slice(2, separator)] = arg.slice(separator + 1);
    } else if (arg.startsWith("--")) {
      flags.add(arg);
    }
  }
  return { flags, ...options };
}

const { flags, file: fileArg, to: toArg, name: nameArg } = parseArgs(process.argv.slice(2));
const dryRun = flags.has("--dry-run");
const skipEmail = flags.has("--skip-email");
const resendEmail = flags.has("--resend-email");

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

function mailConfig(env) {
  const host = env.TICKETING_SMTP_HOST;
  const port = Number(env.TICKETING_SMTP_PORT);
  const user = env.TICKETING_SMTP_USER;
  const pass = env.TICKETING_SMTP_PASSWORD;
  const from = env.TICKETING_SMTP_FROM;
  if (!host || !port || !user || !pass || !from) {
    throw new Error(
      "Isi TICKETING_SMTP_HOST, TICKETING_SMTP_PORT, TICKETING_SMTP_USER, TICKETING_SMTP_PASSWORD, dan TICKETING_SMTP_FROM di .env."
    );
  }
  return { host, port, user, pass, from };
}

function resolveWorkbook() {
  if (fileArg) return path.resolve(fileArg);
  if (fs.existsSync(DEFAULT_WORKBOOK)) return DEFAULT_WORKBOOK;
  throw new Error(
    'File Excel tidak ditemukan. Jalankan dengan --file "/path/Request Akun Ticketing Untuk CRO.xlsx"'
  );
}

function generatePassword() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "@#$%";
  const all = upper + lower + digits + symbols;
  const pick = (source) => source[crypto.randomInt(source.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < 12) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readAccounts(workbookPath) {
  const workbook = xlsx.readFile(workbookPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
  return rows.map((row, index) => {
    const name = String(row["Nama CRO"] || "").trim();
    const email = String(row["email rata"] || "").trim().toLowerCase();
    const team = String(row.team || "").trim();
    const role = String(row.role || "").trim();
    const clinic = String(row.Klinik || "").trim();
    if (!name || !email || !team || !role) {
      throw new Error(`Baris ${index + 2} tidak lengkap: ${JSON.stringify(row)}`);
    }
    return { name, email, team, role, clinic };
  });
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writeCredentials(records) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const header = "name,email,password,team,role,action,email_sent";
  const lines = records.map((record) =>
    [
      record.name,
      record.email,
      record.password,
      record.team,
      record.role,
      record.action,
      record.emailSent ? "yes" : "no",
    ]
      .map(csvEscape)
      .join(",")
  );
  fs.writeFileSync(CREDENTIALS_PATH, `${header}\n${lines.join("\n")}\n`);
}

function readCredentials() {
  const text = fs.readFileSync(CREDENTIALS_PATH, "utf8").trim();
  const [header, ...lines] = text.split("\n");
  const columns = header.split(",");
  return lines.filter(Boolean).map((line) => {
    const values = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        if (quoted && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = !quoted;
        }
      } else if (char === "," && !quoted) {
        values.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current);
    const record = {};
    columns.forEach((column, index) => {
      record[column] = values[index];
    });
    return record;
  });
}

function loginLabel(loginUrl) {
  try {
    return new URL(loginUrl).host;
  } catch {
    return loginUrl;
  }
}

function emailBody(record, loginUrl) {
  const labelCell =
    "padding:8px 12px;border:1px solid #d9d9d9;background:#f8d0cb;font-weight:600;white-space:nowrap;";
  const valueCell = "padding:8px 12px;border:1px solid #d9d9d9;";
  const row = (label, value) =>
    `<tr><td style="${labelCell}">${label}</td><td style="${valueCell}">${value}</td></tr>`;
  return (
    `<p>Dear ${escapeHtml(record.name)},</p>` +
    `<p>Akun E-Ticketing anda telah berhasil dibuat dengan detail sebagai berikut:</p>` +
    `<table style="border-collapse:collapse;margin:16px 0;">` +
    row("Nama", escapeHtml(record.name)) +
    row("Email", escapeHtml(record.email)) +
    row("Password", escapeHtml(record.password)) +
    `</table>` +
    `<p>Sistem E-Ticketing dapat diakses melalui link <a href="${escapeHtml(loginUrl)}">${escapeHtml(loginLabel(loginUrl))}</a></p>` +
    `<p>Demi menjaga keamanan akun, mohon segera <strong>ganti kata sandi</strong> di atas setelah login pertama dan pastikan tidak menyebarkannya kepada pihak lain.</p>` +
    `<p>Jika ada pertanyaan atau mengalami kendala saat login, silakan untuk dapat menghubungi saya dengan membalas email ini.</p>` +
    `<p>Terima kasih</p>`
  );
}

function createTransport(mail) {
  return nodemailer.createTransport({
    host: mail.host,
    port: mail.port,
    secure: false,
    requireTLS: true,
    auth: {
      user: mail.user,
      pass: mail.pass,
    },
  });
}

async function sendCredentialEmail(transport, mail, record, loginUrl) {
  await transport.sendMail({
    from: mail.from,
    to: record.email,
    subject: `Pembuatan Akun E-Ticketing - ${record.name}`,
    html: emailBody(record, loginUrl),
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function smtpRejected(error) {
  return /535|BadCredentials|Invalid login/i.test(error.message);
}

async function sendPendingEmails(transport, mail, records, loginUrl) {
  const pending = records.filter(
    (record) => record.action === "created" && record.password && !record.emailSent
  );
  console.log(`email yang akan dikirim: ${pending.length}, jeda 1 menit`);
  for (let index = 0; index < pending.length; index += 1) {
    if (index > 0) {
      console.log("menunggu 1 menit sebelum email berikutnya");
      await sleep(EMAIL_DELAY_MS);
    }
    const record = pending[index];
    try {
      await sendCredentialEmail(transport, mail, record, loginUrl);
      record.emailSent = true;
      writeCredentials(records);
      console.log(`email terkirim: ${record.email}`);
    } catch (error) {
      console.error(`email gagal: ${record.email} — ${error.message}`);
      if (smtpRejected(error)) {
        console.error("SMTP menolak login. Sisa email tidak dikirim.");
        break;
      }
    }
  }
}

async function ensureTeam(client, name, cache) {
  if (cache.has(name)) return { id: cache.get(name), created: false };
  const existing = await client.query("SELECT id FROM teams WHERE name = $1", [name]);
  if (existing.rowCount) {
    cache.set(name, existing.rows[0].id);
    return { id: existing.rows[0].id, created: false };
  }
  if (dryRun) {
    cache.set(name, -1);
    return { id: -1, created: true };
  }
  const inserted = await client.query(
    `INSERT INTO teams (id, name, created_at, updated_at)
     VALUES (nextval('teams_sequence'), $1, NOW(), NOW())
     RETURNING id`,
    [name]
  );
  cache.set(name, inserted.rows[0].id);
  return { id: inserted.rows[0].id, created: true };
}

async function ensureRole(client, name, teamId, templateRoleId, cache) {
  if (cache.has(name)) return { id: cache.get(name), created: false };
  const existing = await client.query("SELECT id FROM roles WHERE name = $1", [name]);
  let roleId;
  let created = false;
  if (existing.rowCount) {
    roleId = existing.rows[0].id;
  } else if (dryRun) {
    roleId = -1;
    created = true;
  } else {
    const inserted = await client.query(
      `INSERT INTO roles (id, name, created_at, updated_at)
       VALUES (nextval('roles_sequence'), $1, NOW(), NOW())
       RETURNING id`,
      [name]
    );
    roleId = inserted.rows[0].id;
    created = true;
    await client.query(
      `INSERT INTO roles_privileges (role_id, privilege_id)
       SELECT $1, privilege_id
       FROM roles_privileges
       WHERE role_id = $2
       ON CONFLICT DO NOTHING`,
      [roleId, templateRoleId]
    );
  }
  if (!dryRun && teamId > 0) {
    const link = await client.query(
      "SELECT 1 FROM teams_roles WHERE role_id = $1 AND team_id = $2",
      [roleId, teamId]
    );
    if (!link.rowCount) {
      await client.query(
        "INSERT INTO teams_roles (role_id, team_id) VALUES ($1, $2)",
        [roleId, teamId]
      );
    }
  }
  cache.set(name, roleId);
  return { id: roleId, created };
}

async function provision() {
  const env = loadEnv(ENV_PATH);
  const loginUrl = env.TICKETING_LOGIN_URL || "https://dev-ticketing.rata.id";
  const workbookPath = resolveWorkbook();
  const accounts = readAccounts(workbookPath);
  const client = new Client(dbConfig(env));
  await client.connect();

  const summary = {
    teamsCreated: [],
    rolesCreated: [],
    created: 0,
    updated: 0,
  };
  const records = [];

  try {
    await client.query("BEGIN");
    const template = await client.query("SELECT id FROM roles WHERE name = $1", [
      PRIVILEGE_TEMPLATE_ROLE,
    ]);
    if (!template.rowCount) {
      throw new Error(`Role template '${PRIVILEGE_TEMPLATE_ROLE}' tidak ditemukan`);
    }
    const templateRoleId = template.rows[0].id;
    const teamCache = new Map();
    const roleCache = new Map();

    for (const account of accounts) {
      const team = await ensureTeam(client, account.team, teamCache);
      if (team.created) summary.teamsCreated.push(account.team);
      const role = await ensureRole(
        client,
        account.role,
        team.id,
        templateRoleId,
        roleCache
      );
      if (role.created) summary.rolesCreated.push(account.role);

      const existing = await client.query(
        `SELECT u.id, u.name,
                COALESCE(string_agg(DISTINCT r.name, ', '), '') AS roles
         FROM users u
         LEFT JOIN users_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
         WHERE lower(u.email) = $1
         GROUP BY u.id, u.name`,
        [account.email]
      );

      let action;
      let password = "";

      if (existing.rowCount) {
        action = "kept";
        summary.updated += 1;
        if (!dryRun) {
          await client.query(
            `UPDATE users
             SET name = $2,
                 is_active = TRUE,
                 deleted_at = NULL,
                 updated_at = NOW()
             WHERE id = $1`,
            [existing.rows[0].id, account.name]
          );
          await client.query("DELETE FROM users_roles WHERE user_id = $1", [
            existing.rows[0].id,
          ]);
          await client.query(
            "INSERT INTO users_roles (user_id, role_id) VALUES ($1, $2)",
            [existing.rows[0].id, role.id]
          );
        }
      } else {
        action = "created";
        summary.created += 1;
        password = generatePassword();
        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        if (!dryRun) {
          const inserted = await client.query(
            `INSERT INTO users (id, email, name, password, password_argon, is_active, created_at, updated_at)
             VALUES ($1, $2, $3, $4, NULL, TRUE, NOW(), NOW())
             RETURNING id`,
            [crypto.randomUUID(), account.email, account.name, passwordHash]
          );
          await client.query(
            "INSERT INTO users_roles (user_id, role_id) VALUES ($1, $2)",
            [inserted.rows[0].id, role.id]
          );
        }
      }

      records.push({ ...account, password, action, emailSent: false });
    }

    if (dryRun) await client.query("ROLLBACK");
    else await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }

  if (!dryRun) writeCredentials(records);

  if (!dryRun && !skipEmail) {
    const mail = mailConfig(env);
    const transport = createTransport(mail);
    await sendPendingEmails(transport, mail, records, loginUrl);
  }

  const databaseName = env.TICKETING_DB_NAME || "ticketing";
  console.log(
    JSON.stringify(
      {
        dryRun,
        database: databaseName,
        workbook: workbookPath,
        accounts: accounts.length,
        created: summary.created,
        updated: summary.updated,
        teamsCreated: summary.teamsCreated,
        rolesCreated: summary.rolesCreated,
        emailsSent: records.filter((record) => record.emailSent).length,
        credentialsFile: dryRun ? null : CREDENTIALS_PATH,
      },
      null,
      2
    )
  );
}

async function resend() {
  const env = loadEnv(ENV_PATH);
  const loginUrl = env.TICKETING_LOGIN_URL || "https://dev-ticketing.rata.id";
  const records = readCredentials().map((record) => ({
    ...record,
    emailSent: record.email_sent === "yes",
  }));
  const toSend = records.filter(
    (record) => record.action === "created" && record.password && !record.emailSent
  );
  const mail = mailConfig(env);
  const transport = createTransport(mail);
  await sendPendingEmails(transport, mail, records, loginUrl);
  console.log(
    JSON.stringify(
      {
        resent: toSend.length,
        emailsSent: records.filter((record) => record.emailSent).length,
      },
      null,
      2
    )
  );
}

async function smtpTest() {
  if (!toArg || !nameArg) {
    throw new Error("Uji SMTP butuh --to dan --name. Contoh: --smtp-test --to user@rata.id --name \"Nama Orang\"");
  }
  const env = loadEnv(ENV_PATH);
  const loginUrl = env.TICKETING_LOGIN_URL || "https://ticketing.rata.id/";
  const mail = mailConfig(env);
  const transport = createTransport(mail);
  await sendCredentialEmail(
    transport,
    mail,
    { name: nameArg, email: toArg, password: "UjiSmtp1@rata" },
    loginUrl
  );
  console.log(`email uji terkirim ke ${toArg}`);
}

const run = flags.has("--smtp-test") ? smtpTest() : resendEmail ? resend() : provision();
run.catch((error) => {
  console.error(error);
  process.exit(1);
});
