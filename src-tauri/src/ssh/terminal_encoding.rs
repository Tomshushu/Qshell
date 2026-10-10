use codepage_strings::Coding;
use encoding_rs::{Decoder, Encoding, UTF_8};

/// Stateful terminal codec. Multibyte sequences split across network packets are
/// retained by `encoding_rs::Decoder`; OEM/DOS code pages are single-byte.
pub struct TerminalCodec {
    name: String,
    kind: CodecKind,
}

enum CodecKind {
    Standard {
        encoding: &'static Encoding,
        decoder: Decoder,
    },
    CodePage(Coding),
}

impl TerminalCodec {
    pub fn new(name: &str) -> Result<Self, String> {
        let normalized = normalize_encoding(name);
        let kind = match normalized.as_str() {
            value if value.starts_with("cp") => {
                let parsed_cp = value.strip_prefix("cp").and_then(|v| v.parse::<u16>().ok());
                if let Some(cp) = parsed_cp.filter(|&cp| matches!(cp, 437 | 720 | 737 | 775 | 850 | 852 | 855 | 857 | 858 | 860 | 861 | 862 | 864 | 865 | 866 | 869)) {
                    CodecKind::CodePage(Coding::new(cp).map_err(|e| e.to_string())?)
                } else {
                    let encoding = Encoding::for_label(normalized.as_bytes())
                        .ok_or_else(|| format!("Unsupported terminal encoding: {name}"))?;
                    CodecKind::Standard {
                        encoding,
                        decoder: encoding.new_decoder_without_bom_handling(),
                    }
                }
            }
            "ibm866" => CodecKind::CodePage(Coding::new(866).map_err(|e| e.to_string())?),
            _ => {
                let encoding = Encoding::for_label(normalized.as_bytes())
                    .ok_or_else(|| format!("Unsupported terminal encoding: {name}"))?;
                CodecKind::Standard {
                    encoding,
                    decoder: encoding.new_decoder_without_bom_handling(),
                }
            }
        };
        Ok(Self { name: normalized, kind })
    }

    pub fn utf8() -> Self {
        Self {
            name: "utf-8".to_string(),
            kind: CodecKind::Standard {
                encoding: UTF_8,
                decoder: UTF_8.new_decoder_without_bom_handling(),
            },
        }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn decode(&mut self, bytes: &[u8], last: bool) -> String {
        match &mut self.kind {
            CodecKind::Standard { decoder, .. } => {
                let capacity = decoder
                    .max_utf8_buffer_length(bytes.len())
                    .unwrap_or_else(|| bytes.len().saturating_mul(4).saturating_add(16));
                let mut output = String::with_capacity(capacity);
                let _ = decoder.decode_to_string(bytes, &mut output, last);
                output
            }
            CodecKind::CodePage(coding) => coding.decode_lossy(bytes).into_owned(),
        }
    }

    pub fn encode(&self, text: &str) -> Result<Vec<u8>, String> {
        match &self.kind {
            CodecKind::Standard { encoding, .. } => {
                let (encoded, _, had_errors) = encoding.encode(text);
                if had_errors {
                    Err(format!(
                        "Text contains characters that cannot be represented by {}",
                        self.name
                    ))
                } else {
                    Ok(encoded.into_owned())
                }
            }
            CodecKind::CodePage(coding) => coding.encode(text).map_err(|e| e.to_string()),
        }
    }
}

pub fn normalize_encoding(name: &str) -> String {
    match name.trim().to_ascii_lowercase().replace('_', "-").as_str() {
        "" | "default" | "default-language" | "unicode" | "utf8" => "utf-8".to_string(),
        "gb2312" | "cp936" => "gbk".to_string(),
        "cp950" => "big5".to_string(),
        "shift-jis" | "sjis" | "cp932" => "shift_jis".to_string(),
        "eucjp" => "euc-jp".to_string(),
        "euckr" | "cp949" => "euc-kr".to_string(),
        "asmo-708" | "cp708" => "iso-8859-6".to_string(),
        "iso-8859-8-visual" => "iso-8859-8".to_string(),
        "iso-8859-8-logical" => "iso-8859-8-i".to_string(),
        "iso-8859-9" => "windows-1254".to_string(),
        "iso-8859-1" => "windows-1252".to_string(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::TerminalCodec;

    #[test]
    fn utf8_split_sequence_is_not_lost() {
        let mut codec = TerminalCodec::utf8();
        let bytes = "中文".as_bytes();
        assert_eq!(codec.decode(&bytes[..2], false), "");
        assert_eq!(codec.decode(&bytes[2..], false), "中文");
    }

    #[test]
    fn gbk_round_trip_and_split_sequence() {
        let codec = TerminalCodec::new("gbk").unwrap();
        let bytes = codec.encode("中文").unwrap();
        let mut decoder = TerminalCodec::new("gbk").unwrap();
        assert_eq!(decoder.decode(&bytes[..1], false), "");
        assert_eq!(decoder.decode(&bytes[1..], false), "中文");
    }

    #[test]
    fn aliases_remain_backward_compatible() {
        assert_eq!(TerminalCodec::new("default").unwrap().name(), "utf-8");
        assert_eq!(TerminalCodec::new("GB2312").unwrap().name(), "gbk");
    }
}
