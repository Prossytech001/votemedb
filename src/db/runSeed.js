const fs = require('fs');
const path = require('path');
const pool = require('./pool');

async function run() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const seed = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8');

  try {
    console.log('Running schema...');
    await pool.query(schema);
    console.log('Running seed...');
    await pool.query(seed);
    console.log('Done. Categories seeded.');
  } catch (err) {
    console.error('Error running schema/seed:', err.message);
  } finally {
    await pool.end();
  }
}

run();
