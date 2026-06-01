use std::io;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

const HEADER_BLOCK_LIMIT: usize = 8 * 1024;
const PAYLOAD_LIMIT: usize = 256 * 1024 * 1024;

pub async fn write_frame<W: AsyncWrite + Unpin + ?Sized>(
    writer: &mut W,
    payload: &[u8],
) -> io::Result<()> {
    let header = format!("Content-Length: {}\r\n\r\n", payload.len());
    writer.write_all(header.as_bytes()).await?;
    writer.write_all(payload).await?;
    writer.flush().await
}

pub async fn read_frame<R: AsyncRead + Unpin + ?Sized>(
    reader: &mut R,
) -> io::Result<Option<Vec<u8>>> {
    let mut header_buf: Vec<u8> = Vec::with_capacity(128);
    let mut byte = [0u8; 1];

    loop {
        match reader.read(&mut byte).await? {
            0 => {
                return if header_buf.is_empty() {
                    Ok(None)
                } else {
                    Err(io::Error::new(
                        io::ErrorKind::UnexpectedEof,
                        "sidecar stream closed mid-header",
                    ))
                };
            }
            _ => {
                header_buf.push(byte[0]);
                if header_buf.ends_with(b"\r\n\r\n") {
                    break;
                }
                if header_buf.len() > HEADER_BLOCK_LIMIT {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "header block exceeded limit",
                    ));
                }
            }
        }
    }

    let header_text = std::str::from_utf8(&header_buf)
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))?;

    let mut content_length: Option<usize> = None;
    for line in header_text.split("\r\n") {
        if line.is_empty() {
            continue;
        }
        let (name, value) = line
            .split_once(':')
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "malformed header line"))?;
        if name.trim().eq_ignore_ascii_case("Content-Length") {
            content_length = Some(
                value
                    .trim()
                    .parse::<usize>()
                    .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))?,
            );
        }
    }

    let len = content_length
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "missing Content-Length"))?;

    if len > PAYLOAD_LIMIT {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("payload size {len} exceeds limit"),
        ));
    }

    let mut payload = vec![0u8; len];
    reader.read_exact(&mut payload).await?;
    Ok(Some(payload))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn roundtrip_simple_payload() {
        let payload = br#"{"jsonrpc":"2.0","id":1,"method":"x"}"#.to_vec();
        let mut buf: Vec<u8> = Vec::new();
        write_frame(&mut buf, &payload).await.unwrap();
        let mut cursor = std::io::Cursor::new(buf);
        let got = read_frame(&mut cursor).await.unwrap().unwrap();
        assert_eq!(got, payload);
    }

    #[tokio::test]
    async fn read_frame_returns_none_on_clean_eof() {
        let mut cursor = std::io::Cursor::new(Vec::<u8>::new());
        assert!(read_frame(&mut cursor).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn read_frame_tolerates_extra_headers() {
        let mut buf: Vec<u8> = Vec::new();
        buf.extend_from_slice(
            b"Content-Type: application/vscode-jsonrpc; charset=utf-8\r\nContent-Length: 2\r\n\r\n{}",
        );
        let mut cursor = std::io::Cursor::new(buf);
        let got = read_frame(&mut cursor).await.unwrap().unwrap();
        assert_eq!(got, b"{}");
    }
}
