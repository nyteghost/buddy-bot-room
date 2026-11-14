//! Data/ is adjacent to the executable: no roaming profile, registry changes,
//! installation, cloud connection, or implicit data fallback.
use crate::state::DemoState;
use std::{fs::{self, OpenOptions}, io::{self, Write}, path::{Path, PathBuf}};

#[derive(Debug)]
pub struct Store {
    pub root: PathBuf,
    pub writable: bool,
}

impl Store {
    pub fn beside_executable() -> io::Result<Self> {
        let executable = std::env::current_exe()?;
        let parent = executable.parent().ok_or_else(|| io::Error::other("no executable directory"))?;
        Ok(Self::at(parent.join("Data")))
    }

    pub fn at(root: PathBuf) -> Self {
        Self { root, writable: true }
    }

    pub fn load(&self) -> io::Result<DemoState> {
        let file = self.root.join("settings.json");
        match fs::read_to_string(file) {
            Ok(contents) => {
                let state: DemoState = serde_json::from_str(&contents)
                    .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
                state.validate().map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
                Ok(state)
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(DemoState::default()),
            Err(error) => Err(error),
        }
    }

    pub fn save(&mut self, state: &DemoState) -> io::Result<()> {
        if !self.writable { return Err(io::Error::new(io::ErrorKind::PermissionDenied, "read-only portable state")); }
        state.validate().map_err(io::Error::other)?;
        if let Err(error) = self.write_atomic(state) {
            self.writable = false; // never silently redirect data to AppData or network
            return Err(error);
        }
        Ok(())
    }

    fn write_atomic(&self, state: &DemoState) -> io::Result<()> {
        fs::create_dir_all(&self.root)?;
        let target = self.root.join("settings.json");
        let temp = self.root.join(format!(".settings-{}.tmp", std::process::id()));
        let result = (|| {
            let mut writer = OpenOptions::new().write(true).create_new(true).open(&temp)?;
            serde_json::to_writer_pretty(&mut writer, state).map_err(io::Error::other)?;
            writer.write_all(b"\n")?;
            writer.sync_all()?;
            drop(writer);
            fs::rename(&temp, &target)?;
            Ok(())
        })();
        if result.is_err() { let _ = fs::remove_file(&temp); }
        result
    }

    pub fn data_path(&self) -> &Path { &self.root }
}

pub fn run_self_test() -> io::Result<()> {
    let exe_dir = std::env::current_exe()?.parent()
        .ok_or_else(|| io::Error::other("no executable directory"))?.to_path_buf();
    let path = exe_dir.join("Data").join(format!("s4-self-test-{}", std::process::id()));
    fs::create_dir_all(&path)?;
    let result = (|| {
        let mut store = Store::at(path.clone());
        let mut state = store.load()?;
        state.pal_clicks = 42;
        store.save(&state)?;
        if store.load()?.pal_clicks != 42 { return Err(io::Error::other("portable round-trip failed")); }
        state.pal_clicks = 43;
        store.save(&state)?;
        if store.load()?.pal_clicks != 43 { return Err(io::Error::other("replacement round-trip failed")); }
        Ok(())
    })();
    let _ = fs::remove_dir_all(&path);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_folder(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("pixelpals-s4-{name}-{}", std::process::id()))
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
        let mut store = Store::at(folder);
        store.writable = false;
        let error = store.save(&DemoState::default()).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
    }

    #[test]
    fn invalid_settings_do_not_get_overwritten() {
        let folder = temp_folder("invalid");
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("settings.json"), b"{no json}").unwrap();
        let store = Store::at(folder.clone());
        assert_eq!(store.load().unwrap_err().kind(), io::ErrorKind::InvalidData);
        assert_eq!(fs::read(folder.join("settings.json")).unwrap(), b"{no json}");
        let _ = fs::remove_dir_all(folder);
    }
}
