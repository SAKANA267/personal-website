import mysql from 'mysql2/promise';

// 全局共享的连接池；凭据来自 .env（绝不硬编码）
export const pool = mysql.createPool({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'personal_website',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
});
