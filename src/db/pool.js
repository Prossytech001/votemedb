// const { Pool } = require('pg');
// require('dotenv').config();

// const pool = new Pool({
//   connectionString: process.env.DATABASE_URL,
//   ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
//     ? false
//     : { rejectUnauthorized: false }, // needed for most managed Postgres (Render, Railway, Supabase)
// });

// module.exports = pool;

const { Pool } = require('pg');
require('dotenv').config();

// Set DB_SSL=true in .env for managed Postgres providers that require it
// (Render, Railway, Supabase, Neon, etc). Leave unset/false for local Postgres.
const useSSL = process.env.DB_SSL === 'true';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

module.exports = pool;