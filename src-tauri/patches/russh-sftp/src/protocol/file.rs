use chrono::{DateTime, Utc};
use serde::{
    de::{self, Deserialize, Deserializer, SeqAccess, Visitor},
    ser::{Serialize, SerializeTuple, Serializer},
};
use std::time::{Duration, UNIX_EPOCH};

use super::FileAttributes;

#[derive(Debug, Clone)]
pub struct File {
    pub filename: String,
    pub longname: String,
    pub attrs: FileAttributes,
    /// Original raw filename bytes from the wire packet (preserved for non-UTF-8 encodings such as GBK/GB18030).
    pub raw_filename: Vec<u8>,
}

impl Serialize for File {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut tup = serializer.serialize_tuple(3)?;
        let raw = if self.raw_filename.is_empty() {
            self.filename.as_bytes()
        } else {
            &self.raw_filename
        };
        tup.serialize_element(&serde_bytes::Bytes::new(raw))?;
        tup.serialize_element(&self.longname)?;
        tup.serialize_element(&self.attrs)?;
        tup.end()
    }
}

impl<'de> Deserialize<'de> for File {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct FileVisitor;

        impl<'de> Visitor<'de> for FileVisitor {
            type Value = File;

            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("SFTP File entry tuple (filename bytes, longname, attrs)")
            }

            fn visit_seq<V>(self, mut seq: V) -> Result<File, V::Error>
            where
                V: SeqAccess<'de>,
            {
                let raw_buf: serde_bytes::ByteBuf = seq
                    .next_element()?
                    .ok_or_else(|| de::Error::invalid_length(0, &self))?;
                let longname: String = seq
                    .next_element()?
                    .ok_or_else(|| de::Error::invalid_length(1, &self))?;
                let attrs: FileAttributes = seq
                    .next_element()?
                    .ok_or_else(|| de::Error::invalid_length(2, &self))?;
                let raw_filename = raw_buf.into_vec();
                let filename = String::from_utf8_lossy(&raw_filename).into_owned();
                Ok(File {
                    filename,
                    longname,
                    attrs,
                    raw_filename,
                })
            }
        }

        deserializer.deserialize_tuple(3, FileVisitor)
    }
}

impl File {
    /// Omits `longname` and set dummy `attributes`. This is mainly used for [`crate::server::Handler::realpath`] as per the standard
    pub fn dummy<S: Into<String>>(filename: S) -> Self {
        let filename = filename.into();
        let raw_filename = filename.as_bytes().to_vec();
        Self {
            filename,
            longname: "".to_string(),
            attrs: FileAttributes::default(),
            raw_filename,
        }
    }

    /// Implies the use of longname
    pub fn new<S: Into<String>>(filename: S, attrs: FileAttributes) -> Self {
        let filename = filename.into();
        let raw_filename = filename.as_bytes().to_vec();
        let mut file = Self {
            filename,
            longname: "".to_string(),
            attrs,
            raw_filename,
        };
        file.longname = file.longname();
        file
    }

    /// Construct a file entry directly from raw wire filename bytes.
    pub fn dummy_raw(raw_filename: Vec<u8>) -> Self {
        let filename = String::from_utf8_lossy(&raw_filename).into_owned();
        Self {
            filename,
            longname: "".to_string(),
            attrs: FileAttributes::default(),
            raw_filename,
        }
    }

    /// Get formed longname
    pub fn longname(&self) -> String {
        let directory = if self.attrs.is_dir() { "d" } else { "-" };
        let permissions = self.attrs.permissions().to_string();

        let size = self.attrs.size.unwrap_or(0);
        let mtime = self.attrs.mtime.unwrap_or(0);

        let datetime = DateTime::<Utc>::from(UNIX_EPOCH + Duration::from_secs(mtime as u64));
        let delayed = datetime.format("%b %d %Y %H:%M");

        format!(
            "{directory}{permissions} 0 {} {} {size} {delayed} {}",
            if let Some(user) = &self.attrs.user {
                user.to_string()
            } else {
                self.attrs.uid.unwrap_or(0).to_string()
            },
            if let Some(group) = &self.attrs.group {
                group.to_string()
            } else {
                self.attrs.gid.unwrap_or(0).to_string()
            },
            self.filename
        )
    }
}

#[cfg(test)]
mod tests {
    use super::File;
    use crate::{de, protocol::Name, ser};

    #[test]
    fn preserves_non_utf8_raw_filename_bytes_across_wire_serde() {
        let gbk_bytes = b"/\xd6\xd0\xce\xc4/\xb2\xe2\xca\xd4.txt".to_vec();
        let pkt = Name {
            id: 7,
            files: vec![File::dummy_raw(gbk_bytes.clone())],
        };
        let mut encoded = ser::to_bytes(&pkt).expect("serialize Name");
        let decoded: Name = de::from_bytes(&mut encoded).expect("deserialize Name");
        assert_eq!(decoded.id, 7);
        assert_eq!(decoded.files.len(), 1);
        assert_eq!(decoded.files[0].raw_filename, gbk_bytes);
        assert!(decoded.files[0].filename.contains('\u{FFFD}'));
    }
}
