//! Explicit HKCU\Software\Classes protocol registration on Windows, pointing
//! at the executable with `"%1"`. The deep-link plugin performs the same
//! registration via `register_all()`; this exists as a belt-and-braces
//! fallback and is a no-op on other platforms.

/// Register `roblox://` and `roblox-player://` handlers under the current
/// user hive.
#[cfg(windows)]
pub fn register_protocols() -> Result<(), String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let exe = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .display()
        .to_string();

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    for scheme in ["roblox", "roblox-player"] {
        let (key, _) = hkcu
            .create_subkey(format!("Software\\Classes\\{scheme}"))
            .map_err(|e| e.to_string())?;
        key.set_value("", &format!("URL:{scheme} Protocol"))
            .map_err(|e| e.to_string())?;
        key.set_value("URL Protocol", &"")
            .map_err(|e| e.to_string())?;

        let (icon, _) = key.create_subkey("DefaultIcon").map_err(|e| e.to_string())?;
        icon.set_value("", &format!("{exe},0"))
            .map_err(|e| e.to_string())?;

        let (cmd, _) = key
            .create_subkey("shell\\open\\command")
            .map_err(|e| e.to_string())?;
        cmd.set_value("", &format!("\"{exe}\" \"%1\""))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// No-op stub on non-Windows platforms.
#[cfg(not(windows))]
pub fn register_protocols() -> Result<(), String> {
    Ok(())
}
