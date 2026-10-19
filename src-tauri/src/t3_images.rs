use reqwest::Url;

const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
fn image_type(mime_type: &str) -> bool {
    ["image/png", "image/jpeg", "image/webp", "image/gif"].contains(&mime_type)
}
fn image_url(origin: &str, relative_url: &str, upload: bool) -> Result<Url, String> {
    let origin = super::local_origin(origin)?;
    let prefix = if upload { "/api/attachments/upload/" } else { "/api/assets/" };
    let url = Url::parse(&origin).unwrap().join(relative_url).map_err(|_| "Invalid image URL.")?;
    if !relative_url.starts_with(prefix) || url.origin().ascii_serialization() != origin
        || !url.path().starts_with(prefix) || !url.username().is_empty() || url.password().is_some()
    {
        return Err("Only signed image URLs from the paired T3 server are supported.".into());
    }
    Ok(url)
}
pub async fn upload(origin: &str, relative_url: &str, mime_type: &str, bytes: Vec<u8>) -> Result<(), String> {
    if !image_type(mime_type) || bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err("Use a PNG, JPEG, WebP, or GIF image up to 10 MiB.".into());
    }
    let response = super::http()?.post(image_url(origin, relative_url, true)?)
        .header("Content-Type", mime_type).body(bytes).send().await
        .map_err(|_| "Could not upload the image to T3.")?;
    if !response.status().is_success() { return Err(format!("Image upload failed (HTTP {}).", response.status())); }
    Ok(())
}
pub async fn load(origin: &str, relative_url: &str) -> Result<Vec<u8>, String> {
    let mut response = super::http()?.get(image_url(origin, relative_url, false)?).send().await
        .map_err(|_| "Could not load the image from T3.")?;
    if !response.status().is_success() { return Err(format!("Image unavailable (HTTP {}).", response.status())); }
    let mime_type = response.headers().get("Content-Type").and_then(|v| v.to_str().ok()).unwrap_or("")
        .split(';').next().unwrap_or("");
    if !image_type(mime_type) { return Err("T3 did not return a supported image.".into()); }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "Could not read the image.")? {
        if bytes.len() + chunk.len() > MAX_IMAGE_BYTES { return Err("Image exceeds 10 MiB.".into()); }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signed_image_requests_stay_on_the_paired_server_and_expected_route() {
        for (path, upload) in [("/api/attachments/upload/signature", true), ("/api/assets/signature/image.png", false)] {
            assert!(image_url("http://127.0.0.1:3773", path, upload).is_ok());
        }
        for path in ["https://example.com/api/assets/a", "//example.com/api/assets/a", "/api/assets/../../oauth/token", "/oauth/token"] {
            assert!(image_url("http://127.0.0.1:3773", path, false).is_err());
        }
        assert!(image_url("https://example.com", "/api/assets/a", false).is_err());
        assert!(image_url("http://localhost:3773", "/api/assets/a", true).is_err());
        assert!(!image_type("image/svg+xml"));
    }

    #[test]
    fn uploads_and_loads_image_bytes_and_rejects_non_image_responses() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            for i in 0..3 {
                let (mut socket, _) = listener.accept().unwrap();
                socket.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
                let mut request = Vec::new();
                let header_end = loop {
                    let mut byte = [0];
                    socket.read_exact(&mut byte).unwrap();
                    request.push(byte[0]);
                    if request.ends_with(b"\r\n\r\n") { break request.len(); }
                };
                let headers = String::from_utf8_lossy(&request).to_lowercase();
                let length: usize = headers.lines().find_map(|line| line.strip_prefix("content-length: "))
                    .map(|v| v.parse().unwrap()).unwrap_or(0);
                request.resize(header_end + length, 0);
                socket.read_exact(&mut request[header_end..]).unwrap();
                if i == 0 {
                    assert!(headers.starts_with("post /api/attachments/upload/signed "));
                    assert!(headers.contains("content-type: image/png"));
                    assert_eq!(&request[header_end..], b"png bytes");
                } else { assert!(headers.starts_with("get /api/assets/signed/image.png ")); }
                let mime = if i == 2 { "text/html" } else { "image/png" };
                write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: 9\r\nConnection: close\r\n\r\npng bytes").unwrap();
            }
        });
        tauri::async_runtime::block_on(async {
            upload(&origin, "/api/attachments/upload/signed", "image/png", b"png bytes".to_vec()).await.unwrap();
            assert_eq!(load(&origin, "/api/assets/signed/image.png").await.unwrap(), b"png bytes");
            assert!(load(&origin, "/api/assets/signed/image.png").await.unwrap_err().contains("supported image"));
        });
        server.join().unwrap();
    }
}
