import { createContext, useContext } from "react";
import { useAppStore } from "@/store";

// 导入独立的语系文件
import zhCN from "./locales/zh-CN";
import zhTW from "./locales/zh-TW";
import en from "./locales/en";
import ja from "./locales/ja";
import es from "./locales/es";
import de from "./locales/de";
import fr from "./locales/fr";
import it from "./locales/it";
import ptPT from "./locales/pt-PT";
import th from "./locales/th";
import ru from "./locales/ru";
import ko from "./locales/ko";
import id from "./locales/id";
import vi from "./locales/vi";
import ms from "./locales/ms";
import ar from "./locales/ar";
import tr from "./locales/tr";
import hi from "./locales/hi";
import ptBR from "./locales/pt-BR";
import nl from "./locales/nl";
import pl from "./locales/pl";
import sv from "./locales/sv";
import uk from "./locales/uk";
import esMX from "./locales/es-MX";
import da from "./locales/da";
import no from "./locales/no";
import fi from "./locales/fi";

export interface LanguageInfo {
  code: string;
  name: string;
  rtl?: boolean;
}

export const LANGUAGES: LanguageInfo[] = [
  { code: "zh-CN", name: "简体中文" },
  { code: "zh-TW", name: "中文（繁体）" },
  { code: "en", name: "English" },
  { code: "ja", name: "日本語" },
  { code: "es", name: "Español" },
  { code: "de", name: "Deutsch" },
  { code: "fr", name: "Français" },
  { code: "it", name: "Italiano" },
  { code: "pt-PT", name: "Português" },
  { code: "th", name: "ไทย" },
  { code: "ru", name: "Русский" },
  { code: "ko", name: "한국어" },
  { code: "id", name: "Bahasa Indonesia" },
  { code: "vi", name: "Tiếng Việt" },
  { code: "ms", name: "Bahasa Melayu" },
  { code: "ar", name: "العربية", rtl: true },
  { code: "tr", name: "Türkçe" },
  { code: "hi", name: "हिन्दी" },
  { code: "pt-BR", name: "Português (Brasil)" },
  { code: "nl", name: "Nederlands" },
  { code: "pl", name: "Polski" },
  { code: "sv", name: "Svenska" },
  { code: "uk", name: "Українська" },
  { code: "es-MX", name: "Español (México)" },
  { code: "da", name: "Dansk" },
  { code: "no", name: "Norsk" },
  { code: "fi", name: "Suomi" },
];

export type TranslationKeys =
  | "sidebar_terminal"
  | "sidebar_shortcuts"
  | "sidebar_logs"
  | "sidebar_account"
  | "sidebar_ssh_id"
  | "sidebar_sftp"
  | "sidebar_app_theme"
  | "sidebar_doc"
  | "sidebar_bug"
  | "sidebar_version"
  | "theme_system"
  | "theme_dark"
  | "theme_light"
  | "term_title"
  | "term_general"
  | "term_auto_reconnect"
  | "term_copy_on_select"
  | "term_bell_sound"
  | "term_bold_bright"
  | "term_font_family"
  | "term_font_size"
  | "term_opacity"
  | "term_custom_theme"
  | "term_custom_btn"
  | "shortcuts_title"
  | "shortcut_theme_dlg"
  | "shortcut_fullscreen"
  | "shortcut_sidebar"
  | "shortcut_split"
  | "shortcut_new_tab"
  | "shortcut_close"
  | "shortcut_next_tab"
  | "shortcut_prev_tab"
  | "shortcut_cmd_ref"
  | "shortcut_port_fw"
  | "logs_title"
  | "logs_search_placeholder"
  | "logs_btn_search"
  | "logs_btn_clear"
  | "logs_filter_all"
  | "logs_filter_frontend"
  | "logs_filter_backend"
  | "logs_th_time"
  | "logs_th_type"
  | "logs_th_event"
  | "logs_th_status"
  | "logs_loading"
  | "logs_empty"
  | "logs_confirm_clear_title"
  | "logs_confirm_clear_desc"
  | "logs_confirm_btn"
  | "logs_cancel_btn"
  | "placeholder_title"
  | "placeholder_desc"
  | "language_settings"
  | "nav_servers"
  | "nav_recent"
  | "nav_favorites"
  | "nav_keys"
  | "nav_settings"
  | "dashboard_subtitle"
  | "dashboard_search_placeholder"
  | "dashboard_filter_all"
  | "dashboard_filter_online"
  | "dashboard_filter_offline"
  | "dashboard_filter_tags"
  | "dashboard_sort_name"
  | "dashboard_sort_status"
  | "dashboard_btn_add"
  | "dashboard_btn_new_conn"
  | "dashboard_btn_import"
  | "dashboard_btn_export_all"
  | "dashboard_help_text"
  | "dashboard_empty"
  | "dashboard_empty_anime"
  | "dashboard_no_matches"
  | "dashboard_no_matches_anime"
  | "dashboard_no_favorites_anime"
  | "dashboard_search_placeholder_anime"
  | "dashboard_btn_add_anime"
  | "tab_home"
  | "tab_expand_sidebar"
  | "tab_collapse_sidebar"
  | "tab_duplicate"
  | "tab_open_new_window"
  | "tab_rename"
  | "tab_lock"
  | "tab_unlock"
  | "tab_set_color"
  | "tab_close_current"
  | "tab_close_others"
  | "tab_confirm_close_title"
  | "tab_confirm_close_desc"
  | "tab_confirm_close_btn"
  | "tab_confirm_close_others_title"
  | "tab_confirm_close_others_desc"
  | "tab_confirm_close_others_btn"
  | "tab_cancel_btn"
  | "color_default"
  | "color_red"
  | "color_orange"
  | "color_yellow"
  | "color_green"
  | "color_cyan"
  | "color_blue"
  | "color_purple"
  | "color_pink"
  | "module_overview"
  | "module_terminal"
  | "module_services"
  | "module_processes"
  | "module_network"
  | "module_ports"
  | "module_files"
  | "module_docker"
  | "btn_connect"
  | "btn_connecting"
  | "btn_connected"
  | "btn_snapshot"
  | "status_connected_to"
  | "status_disconnected"
  | "status_ready"
  | "status_ssh_mode"
  | "db_add_server"
  | "db_edit_server"
  | "db_server_name"
  | "db_host"
  | "db_port"
  | "db_username"
  | "db_auth_type"
  | "db_password"
  | "db_private_key"
  | "db_private_key_path"
  | "db_tag_placeholder"
  | "db_notes"
  | "db_notes_placeholder"
  | "db_timeout"
  | "db_btn_test"
  | "db_btn_save"
  | "db_test_success"
  | "db_test_failed"
  | "db_save_failed"
  | "db_err_required"
  | "db_err_port"
  | "db_err_host"
  | "db_err_pwd_empty"
  | "db_err_key_empty"
  | "db_err_switch_pwd"
  | "db_pwd_placeholder"
  | "db_key_placeholder"
  | "conn_step_tcp"
  | "conn_step_ssh"
  | "conn_step_auth"
  | "conn_step_session"
  | "conn_btn_retry"
  | "ws_disconnected"
  | "ws_reconnect"
  | "ws_not_connected"
  | "ws_not_connected_desc"
  | "ws_btn_connect"
  | "time_days"
  | "time_hours"
  | "time_minutes"
  | "time_seconds"
  | "tm_close_terminal"
  | "tm_hint_not_applicable"
  | "tm_hint_correction"
  | "tm_hint_alias"
  | "tm_hint_history"
  | "tm_hint_path"
  | "tm_hint_val"
  | "tm_hint_cmd"
  | "tm_hint_sub"
  | "tm_hint_res"
  | "tm_hint_arg"
  | "tm_toast_copy_failed"
  | "tm_toast_pasting_large_text"
  | "tm_toast_paste_failed"
  | "tm_toast_invalid_regex"
  | "tm_log_connecting"
  | "tm_log_conn_failed"
  | "tm_log_conn_established"
  | "tm_log_creating_shell"
  | "tm_search_regex_on"
  | "tm_search_regex_off"
  | "dash_sort_asc_title"
  | "dash_sort_desc_title"
  | "dash_view_card_title"
  | "dash_view_list_title"
  | "dash_file_select_failed"
  | "db_ssh_port"
  | "db_auth_agent_hint"
  | "db_auth_cert_hint"
  | "db_refresh_agent_hint"
  | "db_select_cert_file"
  | "db_hide_pwd"
  | "db_show_pwd"
  | "db_seconds"
  | "db_auto_selected_key"
  | "sftp_sync_root_warn"
  | "sftp_transfer_paused_hint"
  | "sftp_diag_failed"
  | "sftp_load_failed_retry"
  | "sftp_no_matching_files"
  | "sftp_diag_title"
  | "sftp_diag_desc"
  | "sftp_diag_status_healthy"
  | "sftp_diag_status_warning"
  | "sftp_diag_status_critical"
  | "sftp_diag_status_skipped"
  | "sftp_diag_issues_header"
  | "sftp_diag_suggestions_header"
  | "sftp_diag_close"
  | "sftp_err_op_failed"
  | "sftp_err_unknown"
  | "sftp_err_partial_delete_failed"
  | "sftp_err_partial_download_failed"
  | "sftp_err_partial_upload_failed"
  | "sftp_err_upload_failed"
  | "sftp_err_partial_transfer_failed"
  | "sftp_err_delete_failed"
  | "sftp_err_rename_failed"
  | "sftp_err_mkdir_failed"
  | "sftp_err_download_failed"
  | "sftp_err_read_failed"
  | "sftp_err_write_failed"
  | "sftp_err_permission_denied"
  | "sftp_err_file_not_found"
  | "sftp_err_conn_disconnected"
  | "sftp_err_conn_timeout"
  | "bg_err_desktop_only"
  | "bg_err_file_too_large"
  | "bg_err_unsupported_video"
  | "bg_err_write_video_failed"
  | "bg_err_img_read_failed"
  | "tag_edit_title"
  | "tag_delete_title"
  | "tag_delete_desc"
  | "tag_delete_confirm"
  | "tag_delete_cancel"
  | "tag_rename_conflict"
  | "tag_renamed"
  | "tag_deleted"
  | "tag_search_placeholder"
  | "tag_empty"
  | "tag_no_matches"
  | "trash_title"
  | "trash_empty"
  | "trash_auto_cleanup"
  | "trash_select_all"
  | "trash_days_left"
  | "trash_restore_btn"
  | "trash_purge_btn"
  | "trash_restored"
  | "trash_purged"
  | "trash_purge_confirm_title"
  | "trash_purge_confirm_desc"
  | "trash_moved"
  | "trash_moved_batch";

// 各语言文件为扁平的 key -> 文案 对象（部分语言可能尚未覆盖全部 key），
// 因此这里按 string 索引声明；缺失 key 在运行时回退到 key 本身。
export const TRANSLATIONS: Record<string, Record<string, string>> = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  en,
  ja,
  es,
  de,
  fr,
  it,
  "pt-PT": ptPT,
  th,
  ru,
  ko,
  id,
  vi,
  ms,
  ar,
  tr,
  hi,
  "pt-BR": ptBR,
  nl,
  pl,
  sv,
  uk,
  "es-MX": esMX,
  da,
  no,
  fi,
};

interface I18nContextType {
  // Accept any string key: locale files contain 1000+ keys across many modules.
  // Runtime falls back to the key itself if missing, so type-safety is not critical here.
  t: (key: string, params?: Record<string, string | number>) => string;
  language: string;
  setLanguage: (lang: string) => void;
  isRTL: boolean;
}

export const I18nContext = createContext<I18nContextType | null>(null);

export function translate(key: string, params?: Record<string, string | number>): string {
  const language = useAppStore.getState?.()?.language || "zh-CN";
  const langTranslations = TRANSLATIONS[language] || TRANSLATIONS["en"];
  const template = langTranslations[key] || TRANSLATIONS["en"][key] || String(key);
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

export function useTranslation() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useTranslation must be used within an I18nProvider");
  }
  return context;
}
