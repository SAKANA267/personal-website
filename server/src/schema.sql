-- personal_website 数据库表结构
-- 依据原项目 PHP 查询推导（原项目未提供 schema）。

-- 留言板
CREATE TABLE IF NOT EXISTS messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- 提交留言时不写入 is_displayed，因此必须默认 1，留言才能在首页显示
  is_displayed TINYINT(1) NOT NULL DEFAULT 1
);

-- 开发日志
CREATE TABLE IF NOT EXISTS devLog (
  id INT AUTO_INCREMENT PRIMARY KEY,
  -- 时间戳由数据库生成（提交时仅写 change_description）
  timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  change_description TEXT NOT NULL
);

-- 用户（注册/登录）
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL           -- bcrypt 哈希（约 60 字符，预留余量）
);

-- WebSocket 聊天日志（由 ws 服务器写入）
CREATE TABLE IF NOT EXISTS logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sender VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 博客文章
CREATE TABLE IF NOT EXISTS blog_posts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  excerpt TEXT NOT NULL,
  `date` DATE NOT NULL,                       -- 文章日期，前端按此倒序
  category VARCHAR(64) NOT NULL,
  tags JSON NOT NULL,                         -- 对应前端 tags: string[]，mysql2 自动解析
  read_time INT NULL,                         -- 阅读时长（分钟），可空 → readTime
  is_published TINYINT(1) NOT NULL DEFAULT 1, -- 草稿 / 下线开关，默认发布
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
