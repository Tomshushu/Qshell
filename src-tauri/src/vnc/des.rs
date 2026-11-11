// src-tauri/src/vnc/des.rs
//
// 标准 VNC DES 挑战加密算法（RFC 6143 Section 7.2.2）
//
// VNC 协议特有规则：
// 1. 密码取前 8 个字节（不足补 0）；
// 2. 密钥每个字节的 8 个 bit 必须反转位序作为 DES 密钥；
// 3. 使用该密钥分别以 DES-ECB 加密 16 字节随机挑战的前 8 字节与后 8 字节。

const DES_IP: [usize; 64] = [
    58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4,
    62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8,
    57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3,
    61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7,
];

const DES_FP: [usize; 64] = [
    40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31,
    38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29,
    36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27,
    34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25,
];

const DES_PC1: [usize; 56] = [
    57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18,
    10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36,
    63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22,
    14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4,
];

const DES_PC2: [usize; 48] = [
    14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10,
    23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2,
    41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48,
    44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32,
];

const DES_SHIFTS: [usize; 16] = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];

const DES_E: [usize; 48] = [
    32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9,
    8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16, 17,
    16, 17, 18, 19, 20, 21, 20, 21, 22, 23, 24, 25,
    24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1,
];

const DES_P: [usize; 32] = [
    16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10,
    2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25,
];

const DES_SBOX: [[[u8; 16]; 4]; 8] = [
    [
        [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7],
        [0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8],
        [4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0],
        [15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
    ],
    [
        [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10],
        [3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5],
        [0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15],
        [13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
    ],
    [
        [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8],
        [13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1],
        [13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7],
        [1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
    ],
    [
        [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15],
        [13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9],
        [10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4],
        [3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
    ],
    [
        [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9],
        [14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6],
        [4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14],
        [11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
    ],
    [
        [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11],
        [10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8],
        [9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6],
        [4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
    ],
    [
        [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1],
        [13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6],
        [1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2],
        [6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
    ],
    [
        [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7],
        [1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2],
        [7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8],
        [2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11],
    ],
];

fn bytes_to_bits(bytes: &[u8]) -> Vec<u8> {
    let mut bits = Vec::with_capacity(bytes.len() * 8);
    for &b in bytes {
        for bit in (0..8).rev() {
            bits.push((b >> bit) & 1);
        }
    }
    bits
}

fn bits_to_bytes(bits: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bits.len() / 8);
    for chunk in bits.chunks(8) {
        let mut val = 0u8;
        for (i, &bit) in chunk.iter().enumerate() {
            val |= bit << (7 - i);
        }
        out.push(val);
    }
    out
}

fn permute(bits: &[u8], table: &[usize]) -> Vec<u8> {
    table.iter().map(|&pos| bits[pos - 1]).collect()
}

fn left_rotate_28(bits: &[u8], shift: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(28);
    out.extend_from_slice(&bits[shift..]);
    out.extend_from_slice(&bits[..shift]);
    out
}

fn des_encrypt_block(block8: &[u8], subkeys: &[[u8; 48]; 16]) -> [u8; 8] {
    let ip = permute(&bytes_to_bits(block8), &DES_IP);
    let mut l = ip[0..32].to_vec();
    let mut r = ip[32..64].to_vec();

    for round in 0..16 {
        let expanded = permute(&r, &DES_E);
        let mut xored = Vec::with_capacity(48);
        for idx in 0..48 {
            xored.push(expanded[idx] ^ subkeys[round][idx]);
        }

        let mut sbox_out = Vec::with_capacity(32);
        for s in 0..8 {
            let chunk = &xored[s * 6..s * 6 + 6];
            let row = ((chunk[0] << 1) | chunk[5]) as usize;
            let col = ((chunk[1] << 3) | (chunk[2] << 2) | (chunk[3] << 1) | chunk[4]) as usize;
            let val = DES_SBOX[s][row][col];
            sbox_out.push((val >> 3) & 1);
            sbox_out.push((val >> 2) & 1);
            sbox_out.push((val >> 1) & 1);
            sbox_out.push(val & 1);
        }

        let f_out = permute(&sbox_out, &DES_P);
        let mut next_r = Vec::with_capacity(32);
        for idx in 0..32 {
            next_r.push(l[idx] ^ f_out[idx]);
        }
        l = r;
        r = next_r;
    }

    // 最后一轮结束后 R 与 L 拼接进行逆初始置换 (FP)
    let mut pre_output = Vec::with_capacity(64);
    pre_output.extend_from_slice(&r);
    pre_output.extend_from_slice(&l);

    let fp_bits = permute(&pre_output, &DES_FP);
    let out_bytes = bits_to_bytes(&fp_bits);
    let mut res = [0u8; 8];
    res.copy_from_slice(&out_bytes[0..8]);
    res
}

/// 执行 VNC 标准 DES 挑战加密计算（RFC 6143 §7.2.2）
pub fn vnc_des_encrypt_challenge(challenge16: &[u8], password: &str) -> [u8; 16] {
    let mut key_bytes = [0u8; 8];
    let pwd_bytes = password.as_bytes();
    for i in 0..8 {
        let code = if i < pwd_bytes.len() { pwd_bytes[i] } else { 0 };
        key_bytes[i] = code.reverse_bits();
    }

    let key56 = permute(&bytes_to_bits(&key_bytes), &DES_PC1);
    let mut c = key56[0..28].to_vec();
    let mut d = key56[28..56].to_vec();

    let mut subkeys = [[0u8; 48]; 16];
    for i in 0..16 {
        c = left_rotate_28(&c, DES_SHIFTS[i]);
        d = left_rotate_28(&d, DES_SHIFTS[i]);
        let mut combined = Vec::with_capacity(56);
        combined.extend_from_slice(&c);
        combined.extend_from_slice(&d);
        let sk = permute(&combined, &DES_PC2);
        subkeys[i].copy_from_slice(&sk[0..48]);
    }

    let mut out = [0u8; 16];
    let b1 = des_encrypt_block(&challenge16[0..8], &subkeys);
    let b2 = des_encrypt_block(&challenge16[8..16], &subkeys);
    out[0..8].copy_from_slice(&b1);
    out[8..16].copy_from_slice(&b2);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vnc_des_encrypt_deterministic() {
        let challenge = [
            0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
            0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54, 0x32, 0x10,
        ];
        let res1 = vnc_des_encrypt_challenge(&challenge, "secret12");
        let res2 = vnc_des_encrypt_challenge(&challenge, "secret12");
        let res_diff = vnc_des_encrypt_challenge(&challenge, "otherpwd");

        assert_eq!(res1, res2);
        assert_ne!(res1, res_diff);
        assert_eq!(res1.len(), 16);
    }
}
