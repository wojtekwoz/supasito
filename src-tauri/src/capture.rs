//! Screenshot of a region of the main window, used to show Claude the preview pane.
//! On macOS this asks WKWebView for a snapshot of its own contents (cross-origin iframes
//! included), so no Screen Recording permission is involved.

use tauri::AppHandle;

/// Capture `(x, y, w, h)` in CSS pixels relative to the webview's top-left. Returns PNG bytes.
#[cfg(target_os = "macos")]
pub async fn capture_region(app: &AppHandle, x: f64, y: f64, w: f64, h: f64) -> Result<Vec<u8>, String> {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    use tauri::Manager;

    let window = app.get_webview_window("main").ok_or("no main window")?;
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<Vec<u8>, String>>();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    let max_width = w.min(1600.0);

    window
        .with_webview(move |webview| unsafe {
            let wk = webview.inner() as *mut AnyObject;
            let cfg: *mut AnyObject = msg_send![class!(WKSnapshotConfiguration), new];
            let rect = NSRect::new(NSPoint::new(x, y), NSSize::new(w.max(1.0), h.max(1.0)));
            let _: () = msg_send![cfg, setRect: rect];
            let width: *mut AnyObject = msg_send![class!(NSNumber), numberWithDouble: max_width];
            let _: () = msg_send![cfg, setSnapshotWidth: width];
            let _: () = msg_send![cfg, setAfterScreenUpdates: true];

            let tx2 = tx.clone();
            let block = block2::RcBlock::new(move |image: *mut AnyObject, error: *mut AnyObject| {
                let result: Result<Vec<u8>, String> = (|| {
                    if image.is_null() {
                        let desc: *mut AnyObject = if error.is_null() { std::ptr::null_mut() } else { msg_send![error, localizedDescription] };
                        let msg = if desc.is_null() { "snapshot failed".to_string() } else {
                            let cstr: *const std::ffi::c_char = msg_send![desc, UTF8String];
                            if cstr.is_null() { "snapshot failed".into() } else { std::ffi::CStr::from_ptr(cstr).to_string_lossy().to_string() }
                        };
                        return Err(msg);
                    }
                    let tiff: *mut AnyObject = msg_send![image, TIFFRepresentation];
                    if tiff.is_null() { return Err("snapshot produced no image data".into()); }
                    let rep: *mut AnyObject = msg_send![class!(NSBitmapImageRep), imageRepWithData: tiff];
                    if rep.is_null() { return Err("snapshot could not be decoded".into()); }
                    let props: *mut AnyObject = msg_send![class!(NSDictionary), dictionary];
                    // NSBitmapImageFileTypePNG == 4
                    let png: *mut AnyObject = msg_send![rep, representationUsingType: 4usize, properties: props];
                    if png.is_null() { return Err("snapshot could not be encoded as PNG".into()); }
                    let len: usize = msg_send![png, length];
                    let ptr: *const u8 = msg_send![png, bytes];
                    Ok(std::slice::from_raw_parts(ptr, len).to_vec())
                })();
                if let Some(tx) = tx2.lock().unwrap().take() { let _ = tx.send(result); }
            });
            let _: () = msg_send![wk, takeSnapshotWithConfiguration: cfg, completionHandler: &*block];
            // keep the block alive until WebKit is done with it
            std::mem::forget(block);
        })
        .map_err(|e| e.to_string())?;

    match tokio::time::timeout(std::time::Duration::from_secs(10), rx).await {
        Ok(Ok(r)) => r,
        Ok(Err(_)) => Err("snapshot was cancelled".into()),
        Err(_) => Err("snapshot timed out".into()),
    }
}

#[cfg(not(target_os = "macos"))]
pub async fn capture_region(_app: &AppHandle, _x: f64, _y: f64, _w: f64, _h: f64) -> Result<Vec<u8>, String> {
    Err("Preview screenshots are only available on macOS for now.".into())
}
