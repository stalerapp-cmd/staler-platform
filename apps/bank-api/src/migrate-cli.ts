import { migrate } from './db/migrate.js';
import { bootstrap } from './db/bootstrap.js';
import { pool } from './lib/db.js';

migrate()
  .then(bootstrap)
  .then(() => {
    console.log('database is up to date');
    return pool.end();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
