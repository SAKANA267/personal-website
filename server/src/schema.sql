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

-- 二维码分享（文字/图片/文件）
CREATE TABLE IF NOT EXISTS share_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(8) NOT NULL UNIQUE,            -- 6位取件码（字符集去除 0O1I 等易混字符）
  type ENUM('text','image','file') NOT NULL,
  title VARCHAR(255) NOT NULL,                -- 展示标题：文字取首行截断，文件用原始文件名
  content MEDIUMTEXT NULL,                    -- type=text 时的正文
  stored_name VARCHAR(255) NULL,              -- 磁盘随机文件名（file/image），原始文件名只存 title
  mime_type VARCHAR(128) NULL,
  size BIGINT NULL,                           -- 文件字节数（text 为 NULL）
  views INT NOT NULL DEFAULT 0,               -- 取件页打开次数
  downloads INT NOT NULL DEFAULT 0,           -- 下载次数
  uploader_ip VARCHAR(64) NULL,
  expires_at DATETIME NULL,                   -- 过期时间，NULL = 永久；过期后访问即惰性删除
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
