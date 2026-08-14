use serde::Serialize;

/// Emitted as the `bootstrap-progress` Tauri event.
#[derive(Debug, Clone, Serialize)]
pub struct BootstrapProgress {
    pub stage: String,
    pub package: Option<String>,
    /// 0.0..=1.0
    pub pkg_progress: f64,
    /// 0.0..=1.0
    pub total_progress: f64,
    pub bytes_per_sec: f64,
    pub detail: Option<String>,
}

/// Emitted as the `bootstrap-status` Tauri event.
#[derive(Debug, Clone, Serialize)]
pub struct BootstrapStatus {
    /// "idle" | "working" | "done" | "error" | "cancelled"
    pub state: String,
    pub message: String,
}

impl BootstrapStatus {
    pub fn idle() -> Self {
        Self {
            state: "idle".into(),
            message: String::new(),
        }
    }
    pub fn working(message: impl Into<String>) -> Self {
        Self {
            state: "working".into(),
            message: message.into(),
        }
    }
    pub fn done() -> Self {
        Self {
            state: "done".into(),
            message: "done".into(),
        }
    }
    pub fn error(message: impl Into<String>) -> Self {
        Self {
            state: "error".into(),
            message: message.into(),
        }
    }
    pub fn cancelled() -> Self {
        Self {
            state: "cancelled".into(),
            message: "cancelled".into(),
        }
    }
}

impl Default for BootstrapStatus {
    fn default() -> Self {
        Self::idle()
    }
}
