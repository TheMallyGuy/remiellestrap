use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Package {
    pub name: String,
    pub md5: String,
    pub compressed_size: u64,
    pub size: u64,
}

#[derive(Debug, Clone)]
pub struct Manifest {
    pub version: String,
    pub packages: Vec<Package>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientVersion {
    pub version: String,
    #[serde(rename = "clientVersionUpload")]
    pub client_version_upload: String,
    #[serde(default)]
    #[serde(rename = "bootstrapperVersion")]
    pub bootstrapper_version: String,
}

/// GET the current client version GUID for a channel.
pub async fn fetch_version(client: &reqwest::Client, channel: &str) -> Result<ClientVersion, String> {
    let url = format!("https://setup.rbxcdn.com/channel/{channel}/v2/client-version/WindowsPlayer");
    client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<ClientVersion>()
        .await
        .map_err(|e| e.to_string())
}

/// GET and parse `{guid}-rbxPkgManifest.txt`.
pub async fn fetch(client: &reqwest::Client, channel: &str, guid: &str) -> Result<Manifest, String> {
    let url = format!("https://setup.rbxcdn.com/channel/{channel}/{guid}-rbxPkgManifest.txt");
    let text = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    parse(&text)
}

/// The manifest is line-based: a version line, then four lines per package
/// (name / md5 / compressed size / size).
pub fn parse(text: &str) -> Result<Manifest, String> {
    let mut lines = text.lines();
    let version = lines.next().unwrap_or("v1").trim().to_string();

    let rest: Vec<&str> = lines.collect();
    let mut packages = Vec::new();
    for chunk in rest.chunks(4) {
        if chunk.len() < 4 {
            continue;
        }
        packages.push(Package {
            name: chunk[0].trim().to_string(),
            md5: chunk[1].trim().to_string(),
            compressed_size: chunk[2].trim().parse().unwrap_or(0),
            size: chunk[3].trim().parse().unwrap_or(0),
        });
    }

    Ok(Manifest { version, packages })
}
