---
title: bcrypt.compare：修好那个登录漏洞
date: 2026-06-09
category: 后端
tags: [node, security, bcrypt]
excerpt: 老站登录用的是明文比对，密码裸奔在数据库里。换成 bcrypt 哈希存储、bcrypt.compare 校验，注册时盐轮 10，重复用户名返回 400。一次迟到的安全修补。
readTime: 6
---

老站的登录是明文比对，密码以可读形式躺在数据库里，拖到这次重构才处理。

## 换成哈希

注册时用 `bcrypt.hash` 存储，盐轮 10；登录时用 `bcrypt.compare` 校验。重复用户名触发 `ER_DUP_ENTRY`，返回 400「用户名已存在」。

```ts
const ok = await bcrypt.compare(inputPassword, row.password_hash)
```

## 顺手的修补

同一轮把字符串拼接 SQL 全换成了参数化查询，注入面一并收掉。
