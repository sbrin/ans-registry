import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'ans-registry.db');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH);
const run = promisify(db.run.bind(db)) as (sql: string, params?: any[]) => Promise<any>;
const get = promisify(db.get.bind(db)) as (sql: string, params?: any[]) => Promise<any>;
const all = promisify(db.all.bind(db)) as (sql: string, params?: any[]) => Promise<any[]>;

// Initialize database schema
export async function initDatabase() {
  await run(`
    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agentId TEXT UNIQUE NOT NULL,
      ansName TEXT UNIQUE NOT NULL,
      agentDisplayName TEXT NOT NULL,
      agentDescription TEXT,
      version TEXT NOT NULL,
      agentHost TEXT NOT NULL,
      status TEXT DEFAULT 'PENDING_VALIDATION',
      endpoints TEXT,
      identityCsrPEM TEXT,
      identityCertPEM TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS validation_challenges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agentId TEXT NOT NULL,
      token TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      FOREIGN KEY (agentId) REFERENCES agents(agentId)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS transparency_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      eventType TEXT NOT NULL,
      agentId TEXT,
      ansName TEXT,
      data TEXT,
      merkleHash TEXT NOT NULL,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('Database initialized at', DB_PATH);
}

export { db, run, get, all };
