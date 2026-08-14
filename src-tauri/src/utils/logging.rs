use std::path::Path;

/// Initialise `tracing` with a daily rolling file appender under
/// `{app_data}/Logs` and prune logs older than `keep_days`.
pub fn init(logs_dir: &Path, keep_days: u64) {
    let _ = std::fs::create_dir_all(logs_dir);

    let file_appender = tracing_appender::rolling::daily(logs_dir, "remiellestrap");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("remiellestrap=info,info"));

    // `try_init` so we never panic if another subscriber is already installed.
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .with_writer(non_blocking)
        .try_init();

    // Keep the worker alive for the lifetime of the process.
    std::mem::forget(guard);

    prune_old_logs(logs_dir, keep_days);
}

fn prune_old_logs(dir: &Path, days: u64) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let cutoff = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(days * 24 * 3600))
        .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

    for entry in entries.flatten() {
        if let Ok(meta) = entry.metadata() {
            if meta.is_file() {
                if let Ok(modified) = meta.modified() {
                    if modified < cutoff {
                        let _ = std::fs::remove_file(entry.path());
                    }
                }
            }
        }
    }
}
