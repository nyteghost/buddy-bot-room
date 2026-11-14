//! Data/ is adjacent to the executable: no roaming profile, registry changes,
//! installation, cloud connection, or implicit data fallback.
use crate::state::DemoState;
use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
};

pub const DATA_DIR: &str = "Data";
pub const SETTINGS_FILE: &str = "settings.json";

#[derive(Debug)]
pub struct Store {
    pub root: PathBuf,
    pub writable: bool,
}

impl Store {
    pub fn beside_executable() -> io::Result<Self> {
        Ok(Self::at(executable_dir()?.join(DATA_DIR)))
    }

    pub fn at(root: PathBuf) -> Self {
        Self {
            root,
            writable: true,
        }
    }

    pub fn settings_path(&self) -> PathBuf {
        self.root.join(SETTINGS_FILE)
    }

    pub fn load(&self) -> io::Result<DemoState> {
        match fs::read_to_string(self.settings_path()) {
            Ok(contents) => {
                let state: DemoState = serde_json::from_str(&contents)
                    .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
                state
                    .validate()
                    .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
                Ok(state)
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(DemoState::default()),
            Err(error) => Err(error),
        }
    }

    /// Checks whether Data/ can be written WITHOUT touching settings.json.
    /// The probe name is process-unique so a stale probe left by a crash or
    /// power loss can never make a writable folder look read-only.
    pub fn probe_writable(&mut self) -> io::Result<()> {
        let result = fs::create_dir_all(&self.root).and_then(|()| {
            let probe = self
                .root
                .join(format!(".s4-write-check-{}", std::process::id()));
            let file = OpenOptions::new().write(true).create_new(true).open(&probe);
            let _ = fs::remove_file(&probe);
            file.map(drop)
        });
        if result.is_err() {
            self.writable = false;
        }
        result
    }

    pub fn save(&mut self, state: &DemoState) -> io::Result<()> {
        if !self.writable {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "read-only portable state",
            ));
        }
        state.validate().map_err(io::Error::other)?;
        if let Err(error) = self.write_atomic(state) {
            self.writable = false; // never silently redirect data to AppData or network
            return Err(error);
        }
        Ok(())
    }

    fn write_atomic(&self, state: &DemoState) -> io::Result<()> {
        fs::create_dir_all(&self.root)?;
        let target = self.settings_path();
        let temp = self
            .root
            .join(format!(".settings-{}.tmp", std::process::id()));
        let result = write_then_rename(&temp, &target, state);
        if result.is_err() {
            let _ = fs::remove_file(&temp);
        }
        result
    }

    pub fn data_path(&self) -> &Path {
        &self.root
    }
}

fn write_then_rename(temp: &Path, target: &Path, state: &DemoState) -> io::Result<()> {
    let mut writer = OpenOptions::new().write(true).create_new(true).open(temp)?;
    serde_json::to_writer_pretty(&mut writer, state).map_err(io::Error::other)?;
    writer.write_all(b"\n")?;
    writer.sync_all()?;
    drop(writer);
    // std::fs::rename uses MoveFileExW(MOVEFILE_REPLACE_EXISTING) on Windows.
    fs::rename(temp, target)
}

pub fn executable_dir() -> io::Result<PathBuf> {
    let executable = std::env::current_exe()?;
    executable
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| io::Error::other("no executable directory"))
}

/// Headless round-trip in an isolated sub-folder of Data/. The user's real
/// settings.json is never read or written by the self-test.
pub fn run_self_test() -> io::Result<()> {
    let path = executable_dir()?
        .join(DATA_DIR)
        .join(format!("s4-self-test-{}", std::process::id()));
    fs::create_dir_all(&path)?;
    let result = self_test_in(&path);
    let _ = fs::remove_dir_all(&path);
    result
}

fn self_test_in(path: &Path) -> io::Result<()> {
    let mut store = Store::at(path.to_path_buf());
    store.probe_writable()?;
    let mut state = store.load()?;
    state.pal_clicks = 42;
    store.save(&state)?;
    if store.load()?.pal_clicks != 42 {
        return Err(io::Error::other("portable round-trip failed"));
    }
    state.pal_clicks = 43;
    store.save(&state)?;
    if Store::at(path.to_path_buf()).load()?.pal_clicks != 43 {
        return Err(io::Error::other("replacement round-trip failed"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_folder(name: &str) -> PathBuf {
        let folder =
            std::env::temp_dir().join(format!("pixelpals-s4-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&folder);
        folder
    }

    #[test]
    fn portable_roundtrip_and_binary_replacement_preserve_state() {
        let folder = temp_folder("persist");
        let mut store = Store::at(folder.clone());
        let mut state = store.load().unwrap();
        state.pal_clicks = 111;
        store.save(&state).unwrap();
        let mut replacement = Store::at(folder.clone());
        assert_eq!(replacement.load().unwrap().pal_clicks, 111);
        state.pal_clicks = 112;
        replacement.save(&state).unwrap();
        assert_eq!(replacement.load().unwrap().pal_clicks, 112);
        let _ = fs::remove_dir_all(folder);
    }

    #[test]
    fn unwritable_store_is_explicit_and_never_redirects() {
        let folder = temp_folder("readonly");
        let mut store = Store::at(folder.clone());
        store.writable = false;
        let error = store.save(&DemoState::default()).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
        assert!(!folder.exists(), "read-only store must not create folders");
    }

    #[test]
    fn invalid_settings_do_not_get_overwritten() {
        let folder = temp_folder("invalid");
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join(SETTINGS_FILE), b"{no json}").unwrap();
        let store = Store::at(folder.clone());
        assert_eq!(store.load().unwrap_err().kind(), io::ErrorKind::InvalidData);
        assert_eq!(fs::read(folder.join(SETTINGS_FILE)).unwrap(), b"{no json}");
        let _ = fs::remove_dir_all(folder);
    }

    #[test]
    fn stale_write_probe_does_not_force_read_only() {
        let folder = temp_folder("probe");
        fs::create_dir_all(&folder).unwrap();
        // Simulates a probe left behind by an earlier crashed process.
        fs::write(folder.join(".s4-write-check"), b"").unwrap();
        fs::write(folder.join(".s4-write-check-1"), b"").unwrap();
        let mut store = Store::at(folder.clone());
        store.probe_writable().unwrap();
        assert!(store.writable);
        assert!(!folder
            .join(format!(".s4-write-check-{}", std::process::id()))
            .exists());
        let _ = fs::remove_dir_all(folder);
    }

    #[test]
    fn probe_never_touches_existing_settings() {
        let folder = temp_folder("probe-settings");
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join(SETTINGS_FILE), b"keep-me").unwrap();
        let mut store = Store::at(folder.clone());
        store.probe_writable().unwrap();
        assert_eq!(fs::read(folder.join(SETTINGS_FILE)).unwrap(), b"keep-me");
        let _ = fs::remove_dir_all(folder);
    }

    #[test]
    fn self_test_runs_in_isolated_folder() {
        let folder = temp_folder("selftest");
        fs::create_dir_all(&folder).unwrap();
        self_test_in(&folder).unwrap();
        let _ = fs::remove_dir_all(folder);
    }
}
