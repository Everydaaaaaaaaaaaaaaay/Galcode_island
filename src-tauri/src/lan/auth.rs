// 局域网移动端鉴权：密码哈希 + 随机 token 管理。
//
// 流程：
//   1. 用户在桌面端设置面板填密码 → set_password 把 sha256(salt || password) 存到 disk
//   2. 移动端 POST /api/login { password } → 哈希校验通过 → 返回 32B hex token
//   3. token 存到 LanState.tokens 内存 HashMap（带过期时间）+ 同步落盘 lan.json
//   4. 后续请求带 Authorization: Bearer <token>，服务端 verify_token 检查
//   5. token 过期或被撤销 → 401

use rand::RngCore;
use sha2::{Digest, Sha256};

pub const TOKEN_TTL_SECS: u64 = 60 * 60 * 24 * 30; // 30 天

/// 生成 16 字节盐 hex 字符串。
pub fn generate_salt() -> String {
    let mut buf = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut buf);
    hex::encode(buf)
}

/// 生成 32 字节随机 token hex 字符串（256 bit 熵）。
pub fn generate_token() -> String {
    let mut buf = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut buf);
    hex::encode(buf)
}

/// 计算密码哈希：sha256(salt_bytes || password_bytes) → hex。
/// 简化版（一次哈希即可——本场景为局域网弱威胁模型，且已有 token 缓存避免重复输入）。
pub fn hash_password(salt_hex: &str, password: &str) -> String {
    let salt = hex::decode(salt_hex).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(&salt);
    hasher.update(password.as_bytes());
    hex::encode(hasher.finalize())
}

/// 安全字符串比较（防 timing attack）。
pub fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.bytes().zip(b.bytes()) {
        diff |= x ^ y;
    }
    diff == 0
}
