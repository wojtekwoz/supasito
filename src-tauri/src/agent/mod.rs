pub mod claude;
pub mod sessions;

use serde_json::{json, Value};

use crate::sites::Site;

/// Extra system prompt so Claude knows it is working inside Supasito.
pub fn system_prompt(site: &Site, preview_url: Option<&str>) -> String {
    let preview = preview_url.unwrap_or("the Supasito preview pane");
    format!(
        "You are working inside Supasito, a desktop app where the user builds the website in this folder ({name}) by talking to you and watching a live preview.\n\
- The site's dev server is already running at {preview}. Do not start another dev server and do not run long-lived or watch processes; Supasito manages them.\n\
- When a message includes a 'Selected element' block, it describes the DOM element the user clicked in the preview, including the source file and line when the framework provides them. Treat that element as the target of the request and edit the code that produces it.\n\
- Prefer small, direct edits in the existing style of the codebase. Do not add dependencies unless asked.\n\
- After editing, verify cheaply when you can (type check or build) but keep it quick.\n\
- Reply briefly and in plain language: what you changed and where. The user sees the result in the preview, so do not paste large code blocks unless asked.",
        name = site.name,
        preview = preview
    )
}

/// An image attached to a user message (base64, as the Claude API expects).
#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImageIn {
    pub media_type: String,
    pub data: String,
}

/// Build the `content` array for a user message: the text, an optional selected-element block,
/// and any attached images.
pub fn compose_user_content(text: &str, selection: Option<&Value>, images: &[ImageIn]) -> Value {
    let mut blocks = Vec::new();
    for img in images {
        blocks.push(json!({ "type": "image", "source": { "type": "base64", "media_type": img.media_type, "data": img.data } }));
    }
    blocks.push(json!({ "type": "text", "text": text }));
    if let Some(sel) = selection {
        blocks.push(json!({ "type": "text", "text": describe_selection(sel) }));
    }
    Value::Array(blocks)
}

fn describe_selection(sel: &Value) -> String {
    let s = |k: &str| sel.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let mut out = String::from("Selected element (clicked in the live preview):\n");
    if let Some(src) = sel.get("source") {
        let file = src.get("file").and_then(|v| v.as_str()).unwrap_or("");
        let loc = src.get("loc").and_then(|v| v.as_str()).unwrap_or("");
        if !file.is_empty() { out.push_str(&format!("- source: {file}{}\n", if loc.is_empty() { String::new() } else { format!(":{loc}") })); }
    }
    let page = s("page");
    if !page.is_empty() { out.push_str(&format!("- page: {page}\n")); }
    out.push_str(&format!("- element: <{}>", s("tag")));
    let id = s("id");
    if !id.is_empty() { out.push_str(&format!(" id=\"{id}\"")); }
    if let Some(classes) = sel.get("classes").and_then(|v| v.as_array()) {
        let c: Vec<&str> = classes.iter().filter_map(|v| v.as_str()).collect();
        if !c.is_empty() { out.push_str(&format!(" class=\"{}\"", c.join(" "))); }
    }
    out.push('\n');
    if let Some(comps) = sel.pointer("/react/components").and_then(|v| v.as_array()) {
        let c: Vec<&str> = comps.iter().filter_map(|v| v.as_str()).collect();
        if !c.is_empty() { out.push_str(&format!("- React components (innermost first): {}\n", c.join(" < "))); }
    }
    let selector = s("selector");
    if !selector.is_empty() { out.push_str(&format!("- selector: {selector}\n")); }
    let text = s("text");
    if !text.is_empty() { out.push_str(&format!("- text: {:?}\n", text)); }
    if let Some(styles) = sel.get("styles").and_then(|v| v.as_object()) {
        let parts: Vec<String> = styles.iter().filter_map(|(k, v)| v.as_str().map(|v| format!("{k}: {v}"))).collect();
        if !parts.is_empty() { out.push_str(&format!("- computed: {}\n", parts.join("; "))); }
    }
    let html = s("outerHtml");
    if !html.is_empty() { out.push_str(&format!("- html: {html}\n")); }
    out
}
