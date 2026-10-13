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
-- 列表/详情的静态文章来自 client/src/content/posts/*.md（打包期）；
-- 登录用户撰写的文章存本表：author_username 非空行为用户文章（slug 以 u- 开头，
-- 与静态文章的文件名 slug 隔离），body 存 Markdown 正文，NULL = 静态/遗留行。
CREATE TABLE IF NOT EXISTS blog_posts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(128) NULL UNIQUE,                 -- 用户文章路由 slug（u-xxx），静态/遗留行为 NULL
  author_username VARCHAR(255) NULL,             -- 作者（登录用户名），NULL = SAKANA 静态文章（遗留行）
  title VARCHAR(255) NOT NULL,
  excerpt TEXT NOT NULL,                         -- 服务端从正文派生（前 80 字）
  `date` DATE NOT NULL,                          -- 文章日期，前端按此倒序
  category VARCHAR(64) NOT NULL,
  tags JSON NOT NULL,                            -- 对应前端 tags: string[]，mysql2 自动解析
  read_time INT NULL,                            -- 阅读时长（分钟），服务端按正文估算
  is_published TINYINT(1) NOT NULL DEFAULT 1,    -- 草稿 / 下线开关，默认发布（0 仅作者可见）
  body MEDIUMTEXT NULL,                          -- 用户文章 Markdown 正文
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL
);

-- 文章评论（登录用户；按 slug 键控——静态 .md 文章与用户文章都可被评论）
CREATE TABLE IF NOT EXISTS post_comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  post_slug VARCHAR(128) NOT NULL,
  username VARCHAR(255) NOT NULL,                -- 评论者（session 用户名，不由请求体携带）
  content TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_comments_post (post_slug, id)
);

-- 文章点赞（登录用户，一人一赞；UNIQUE 约束保证不重复）
CREATE TABLE IF NOT EXISTS post_likes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  post_slug VARCHAR(128) NOT NULL,
  username VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_like (post_slug, username)
);

-- 博客插图（撰写页上传；正文 Markdown 以 /api/blog/images/<stored_name> 引用。
-- 上传经 mime 白名单 + 扩展名 + 魔数嗅探三重校验，SVG 一律拒绝。
-- 展示变体：上传时生成 WebP 压缩版（宽 ≤1600/高 ≤4000，q82），文章默认读变体、
-- /original 读原图；小图不生成（display_* 为 NULL，读原图即展示版））
CREATE TABLE IF NOT EXISTS blog_images (
  id INT AUTO_INCREMENT PRIMARY KEY,
  stored_name VARCHAR(128) NOT NULL UNIQUE,             -- 原图磁盘文件名（32 位 hex + 规范扩展名）
  uploader_username VARCHAR(255) NOT NULL,              -- 上传者（登录用户；配额与删除权归属）
  mime_type VARCHAR(64) NOT NULL,                       -- 原图白名单 mime（落库取嗅探类型的规范 mime）
  size INT NOT NULL,                                    -- 原图字节数
  display_name VARCHAR(128) NULL,                       -- 展示变体文件名（<同hex>.disp.webp，NULL = 未压缩）
  display_mime VARCHAR(64) NULL,                        -- 变体 mime（恒 image/webp）
  display_size INT NULL,                                -- 变体字节数（阅读页徽标与「查看原图」展示用）
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_images_uploader (uploader_username)
);

-- 二维码分享（文字/图片/文件）
CREATE TABLE IF NOT EXISTS share_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(8) NOT NULL UNIQUE,               -- 6位取件码（字符集去除 0O1I 等易混字符）
  type ENUM('text','image','file') NOT NULL,
  title VARCHAR(255) NOT NULL,                   -- 展示标题：文字取首行截断，文件用原始文件名
  content MEDIUMTEXT NULL,                       -- type=text 时的正文
  stored_name VARCHAR(255) NULL,                 -- 磁盘随机文件名（file/image），原始文件名只存 title
  mime_type VARCHAR(128) NULL,
  size BIGINT NULL,                              -- 文件字节数（text 为 NULL）
  views INT NOT NULL DEFAULT 0,                  -- 取件页打开次数
  downloads INT NOT NULL DEFAULT 0,              -- 下载次数
  uploader_ip VARCHAR(64) NULL,
  uploader_user VARCHAR(255) NULL,               -- 登录适配：上传者用户名（游客为 NULL）
  expires_at DATETIME NULL,                      -- 过期时间，NULL = 永久；过期后访问即惰性删除
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ===== 已有部署升级迁移（按顺序执行；新库由上面建表语句直接包含）=====
-- 分享归属（历史迁移，已执行过）：
-- ALTER TABLE share_items ADD COLUMN uploader_user VARCHAR(255) NULL AFTER uploader_ip;
--
-- 博客登录联动（2026-10，部署本次改动前执行）：
-- ALTER TABLE blog_posts ADD COLUMN slug VARCHAR(128) NULL UNIQUE AFTER id;
-- ALTER TABLE blog_posts ADD COLUMN author_username VARCHAR(255) NULL AFTER slug;
-- ALTER TABLE blog_posts ADD COLUMN body MEDIUMTEXT NULL;
-- ALTER TABLE blog_posts ADD COLUMN updated_at DATETIME NULL;
-- CREATE TABLE post_comments / post_likes（同上方定义）；
--
-- 博客插图上传（2026-10，部署本次改动前执行）：
-- CREATE TABLE blog_images（同上方定义）；
-- 已建过 blog_images 的部署补展示变体三列：
-- ALTER TABLE blog_images ADD COLUMN display_name VARCHAR(128) NULL AFTER size;
-- ALTER TABLE blog_images ADD COLUMN display_mime VARCHAR(64) NULL AFTER display_name;
-- ALTER TABLE blog_images ADD COLUMN display_size INT NULL AFTER display_mime;
