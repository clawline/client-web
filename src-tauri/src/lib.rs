use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
#[cfg(target_os = "macos")]
use tauri::RunEvent;

mod ws;
use ws::manager::WsManager;

#[tauri::command]
fn set_unread_count(app: tauri::AppHandle, count: u32) -> Result<(), String> {
    // Update tray tooltip (cross-platform)
    if let Some(tray) = app.tray_by_id("main-tray") {
        let tip = if count == 0 {
            "Clawline".to_string()
        } else {
            format!("Clawline ({} unread)", count)
        };
        let _ = tray.set_tooltip(Some(tip));
    }
    // Dock badge — macOS only (Linux/Windows have no equivalent API).
    #[cfg(target_os = "macos")]
    {
        let badge = if count == 0 { None } else { Some(count.to_string()) };
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.set_badge_label(badge);
        }
    }
    let _ = (app, count);
    Ok(())
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            set_unread_count,
            show_main_window,
            ws::ws_connect,
            ws::ws_send,
            ws::ws_disconnect,
            ws::ws_status,
            ws::ws_drain_offline_buffer,
            ws::ws_clear_offline_buffer,
        ])
        .setup(|app| {
            // Initialise the WS manager (opens SQLite buffer, sets up DashMap).
            let manager = WsManager::init(&app.handle()).map_err(|e| -> Box<dyn std::error::Error> {
                Box::<dyn std::error::Error>::from(e)
            })?;
            app.manage(manager);
            let show_item = MenuItem::with_id(app, "show", "Show Clawline", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .icon_as_template(true)
                .tooltip("Clawline")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            let visible = win.is_visible().unwrap_or(false);
                            if visible {
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                                let _ = win.unminimize();
                                let _ = win.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app, _event| {
        // macOS: clicking dock icon / notification when no visible windows
        // triggers Reopen — show the main window. Other platforms don't have
        // this event (Windows/Linux don't have a dock concept).
        #[cfg(target_os = "macos")]
        if let RunEvent::Reopen { has_visible_windows, .. } = _event {
            if !has_visible_windows {
                if let Some(win) = _app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.unminimize();
                    let _ = win.set_focus();
                }
            }
        }
    });
}

