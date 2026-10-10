fn main() {
    // Unset deprecated STATIC_VCRUNTIME if set by CI runner to avoid warning
    unsafe {
        std::env::remove_var("STATIC_VCRUNTIME");
    }
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.png");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    let attributes = tauri_build::Attributes::new()
        .windows_attributes(tauri_build::WindowsAttributes::new().static_vc_runtime(true));
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
