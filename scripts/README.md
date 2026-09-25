# Provision akun CRO

Script `provision-cro-accounts.js` memasukkan akun dari file Excel ke database ticketing.

Untuk setiap baris di spreadsheet, script ini:

- membuat team klinik kalau belum ada
- membuat role CRO dan menyalin privilege dari role `Agent - Klinik`
- membuat akun baru, lalu mengirim email berisi email dan password
- kalau email sudah terdaftar, hanya memperbarui nama dan role. Password tidak diubah dan email tidak dikirim

## Persiapan

Jalankan dari folder `rata-rest-api-boilerplate`.

```bash
npm install --prefix scripts
cp .env.example .env
```

Isi `.env` dengan koneksi database dan SMTP ticketing. Nama variabelnya memakai awalan `TICKETING_`, terpisah dari `DATABASE_URL` dan `SMTP_*` aplikasi boilerplate.

- `TICKETING_DB_HOST`, `TICKETING_DB_PORT`, `TICKETING_DB_NAME`, `TICKETING_DB_USER`, `TICKETING_DB_PASS`
- `TICKETING_SMTP_HOST`, `TICKETING_SMTP_PORT`, `TICKETING_SMTP_USER`, `TICKETING_SMTP_PASSWORD`, `TICKETING_SMTP_FROM`
- `TICKETING_LOGIN_URL` (opsional, default `https://dev-ticketing.rata.id`)

## Menjalankan

Cek dulu tanpa menulis ke database dan tanpa mengirim email:

```bash
node scripts/provision-cro-accounts.js --dry-run --file "docs/Request Akun Ticketing Untuk CRO.xlsx"
```

Jalankan dan kirim email hanya untuk akun yang baru dibuat:

```bash
node scripts/provision-cro-accounts.js --file "docs/Request Akun Ticketing Untuk CRO.xlsx"
```

Simpan akun baru tanpa mengirim email:

```bash
node scripts/provision-cro-accounts.js --skip-email --file "docs/Request Akun Ticketing Untuk CRO.xlsx"
```

Kirim ulang email untuk akun baru yang sudah tersimpan di file kredensial:

```bash
node scripts/provision-cro-accounts.js --resend-email
```

Kalau `--file` tidak diisi dan file Excel ada di `docs/Request Akun Ticketing Untuk CRO.xlsx`, path itu yang dipakai.

## Hasil

Kredensial akun baru tertulis di `scripts/output/cro-dev-credentials.csv`. File itu diabaikan git karena berisi password.

# Pindah tiket Klinik

Script `move-klinik-tickets.js` memindahkan tiket di `docs/Ticket Active On Klinik.xlsx` dari team `Klinik` ke team tujuan (`expected_assigned_team`).

Yang diubah hanya `team_id` tiket, plus satu history kolom `TEAM`. Agent dan status tidak diubah. Team tujuan harus sudah ada di database. Kalau team di database tidak sama dengan `existing_assigned_team`, tiket itu dilewati.

Script ini hanya membaca env production:

- `TICKETING_PROD_DB_HOST`
- `TICKETING_PROD_DB_PORT`
- `TICKETING_PROD_DB_NAME`
- `TICKETING_PROD_DB_USER`
- `TICKETING_PROD_DB_PASS`

Env dev (`TICKETING_DB_*`) tidak dipakai.

Cek dulu. Perintah ini tidak menulis ke database:

```bash
node scripts/move-klinik-tickets.js --file "docs/Ticket Active On Klinik.xlsx"
```

Kalau laporannya sudah benar, jalankan perubahan:

```bash
node scripts/move-klinik-tickets.js --execute --file "docs/Ticket Active On Klinik.xlsx"
```

Laporan ada di `scripts/output/move-klinik-tickets-report.csv`. Jangan jalankan `--execute` sebelum env production terisi.
