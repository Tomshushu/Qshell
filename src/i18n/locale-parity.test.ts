import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import zhCN from './locales/zh-CN'
import zhTW from './locales/zh-TW'
import en from './locales/en'

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'locales' || entry.name === '__tests__' || entry.name === 'node_modules') {
        continue
      }
      out.push(...collectSourceFiles(full))
    } else if (
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.test.tsx') &&
      !entry.name.endsWith('.d.ts')
    ) {
      out.push(full)
    }
  }
  return out
}

describe('primary locale parity', () => {
  it('keeps Chinese and English translation keys aligned', () => {
    const zhKeys = Object.keys(zhCN).sort()
    const enKeys = Object.keys(en).sort()
    expect(zhKeys.filter((key) => !(key in en))).toEqual([])
    expect(enKeys.filter((key) => !(key in zhCN))).toEqual([])
  })

  it('does not leave empty primary translations', () => {
    expect(Object.entries(zhCN).filter(([, value]) => !String(value).trim())).toEqual([])
    expect(Object.entries(en).filter(([, value]) => !String(value).trim())).toEqual([])
  })

  it('keeps all Wave 3 keys present in all three locales', () => {
    const wave3Keys = [
      'status_local_mode',
      'dash_selected_count',
      'ct_local',
      'ct_local_desc',
      'cp_local',
      'ls_section_title',
      'ls_open_saved_servers',
      'ls_quick_btn',
      'ls_profile_label',
      'ls_cwd_label',
      'ls_cwd_placeholder',
      'ls_default_auto',
      'ls_broadcast_disabled',
      'ssh_auth_interaction_title',
      'ssh_auth_interaction_default_desc',
      'ssh_auth_interaction_submit',
      'ssh_auth_interaction_submitting',
      'ssh_auth_interaction_timeout_hint',
      'tb_lock',
      'tb_unlock',
      'tm_lock_overlay_title',
      'tm_lock_overlay_desc',
      'tm_lock_overlay_unlock_btn',
      'tm_lock_overlay_safe_tip',
      'tm_lock_success',
      'tm_unlock_success',
      'sidebar_auth_profiles',
      'auth_profiles_title',
      'auth_profiles_desc',
      'auth_profiles_add',
      'auth_profiles_edit',
      'auth_profiles_empty',
      'auth_profiles_name',
      'auth_profiles_name_placeholder',
      'auth_profiles_username',
      'auth_profiles_auth_type',
      'auth_profiles_delete_confirm',
      'auth_profiles_saved',
      'auth_profiles_deleted',
      'dash_batch_edit',
      'batch_edit_title',
      'batch_edit_desc',
      'batch_edit_apply',
      'batch_edit_success',
      'batch_edit_timeout_range',
      'batch_edit_failed',
      'batch_edit_tags',
      'batch_edit_tags_add',
      'batch_edit_tags_remove',
      'batch_edit_tags_replace',
      'batch_edit_tag_placeholder',
      'batch_edit_auth_profile',
      'batch_edit_auth_unlink',
      'batch_edit_timeout',
      'batch_edit_forward_agent',
      'batch_edit_forward_on',
      'batch_edit_forward_off',
      'auth_type_password',
      'auth_type_private_key',
      'auth_type_certificate',
      'auth_type_ssh_agent',
      'auth_type_keyboard_interactive',
      'auth_profiles_name_required',
      'auth_profiles_save_failed',
      'auth_profiles_delete_failed',
      'auth_profiles_search_placeholder',
      'auth_profiles_vault_key',
      'auth_profiles_encrypted_rest',
      'auth_profiles_agent_forwarding_badge',
      'auth_profiles_editor_desc',
      'auth_profiles_username_placeholder',
      'auth_profiles_password_label',
      'auth_profiles_keep_saved',
      'auth_profiles_password_placeholder',
      'auth_profiles_vault_key_select',
      'auth_profiles_vault_key_none',
      'auth_profiles_private_key_path',
      'auth_profiles_cert_path',
      'auth_profiles_passphrase_label',
      'auth_profiles_passphrase_optional',
      'auth_profiles_agent_identity_label',
      'auth_profiles_agent_default_opt',
      'auth_profiles_agent_refresh',
      'auth_profiles_kbi_hint',
      'auth_profiles_forward_agent_label',
      'auth_profiles_forward_agent_warn',
      'auth_profiles_notes_label',
      'auth_profiles_notes_placeholder',
      'auth_profiles_save_btn',
      'auth_profiles_clear_saved',
      'auth_profiles_will_clear',
      'auth_profiles_delete_title',
      'term_restarting_local',
      'term_bracketed_paste_title',
      'term_bracketed_paste_desc',
      'term_type_title',
      'term_type_desc',
      'term_type_recommended',
      'tm_lock_status_pin_hint',
      'tm_lock_app_disabled_hint',
      'tm_lock_pattern_subtitle',
      'tm_lock_badge',
      'tm_transfer_and_files',
      'tm_upload_files_sftp',
      'tm_upload_folder_sftp',
      'tm_drag_folder_hint',
      'tm_open_files_panel',
      'tm_open_sftp_tab',
      'tm_zmodem_send',
      'tm_zmodem_receive_hint',
      'tm_zmodem_receive_toast',
      'tm_session_controls',
      'tm_lock_this_terminal',
      'tm_lock_app',
      'lock_password_required',
      'lock_wrong_password',
      'tm_lock_enter_app_pwd',
      'tm_lock_unlock_btn',
      'batch_edit_terminal_type',
      'batch_edit_terminal_type_inherit',
      'batch_edit_timeout_default_hint',
      'batch_edit_forward_agent_profile_hint',
      'cancel',
      'confirm',
      'delete',
      'common_edit',
      'common_hide',
      'common_show',
      'common_copy',
      'common_clear',
      'ai_delete_session',
      'ai_send_message',
      'ai_disabled_notice',
      'dash_open_vnc',
      'sftp_local_storage',
      'db_tunnel_port',
      'compose_history_deleted',
      'compose_history_cleared',
      'bmc_sel_severity',
      'bmc_ready',
      'dk_compose_stopped',
      'rdp_color_depth',
      'rdp_advanced_options',
      'rdp_redirect_clipboard',
      'rdp_redirect_drives',
      'rdp_redirect_printers',
      'rdp_use_multimon',
      'rdp_smart_sizing',
      'rdp_enable_credssp',
      'rdp_audio_mode',
      'rdp_audio_local',
      'rdp_audio_remote',
      'rdp_audio_disabled',
      'rdp_save_config',
      'rdp_config_saved',
      'auto_btn_label',
      'auto_title',
      'auto_running',
      'auto_stop',
      'auto_run',
      'auto_tab_scripts',
      'auto_tab_triggers',
      'auto_tab_macros',
      'auto_scripts_hint',
      'auto_new_script',
      'auto_script_name_placeholder',
      'auto_scripts_empty',
      'auto_server_logon_script',
      'auto_trigger_name',
      'auto_trigger_pattern',
      'auto_trigger_payload',
      'auto_action_send_text',
      'auto_action_toast',
      'auto_action_bell',
      'auto_action_marker',
      'auto_action_highlight',
      'auto_action_stop',
      'auto_triggers_empty',
      'auto_recorder_ready',
      'auto_recording_count',
      'auto_start_record',
      'auto_stop_record',
      'auto_recorded_prefix',
      'auto_export_script',
      'auto_export_macro',
      'auto_macro_name',
      'auto_macros_empty',
      'auto_macro_steps',
      'status_fs_fallback_scp',
      'tx_tab_s2s',
      'tx_empty_s2s',
      'tx_empty_s2s_hint',
      'tx_s2s_hint',
      'tx_n_queued',
      'tx_n_scheduled',
      'tx_n_paused',
      'tx_status_queued',
      'tx_status_scheduled',
      'tx_scheduled_in',
      'tx_scheduled_soon',
      'tx_priority_high',
      'tx_priority_normal',
      'tx_priority_low',
      'tx_priority_toggle_hint',
      'tx_filter_hint',
      'sftp_external_edit_max_size_label',
      'sftp_external_edit_max_size_desc',
      'sftp_external_edit_unlimited',
      'sftp_symlink_policy_label',
      'sftp_symlink_policy_desc',
      'sftp_symlink_skip',
      'sftp_symlink_follow',
      'sftp_include_patterns_label',
      'sftp_include_patterns_desc',
      'sftp_include_patterns_placeholder',
      'sftp_size_range_label',
      'sftp_size_range_desc',
      'sftp_size_min_placeholder',
      'sftp_size_max_placeholder',
      'sftp_size_range_invalid',
      'logs_filter_transfer',
      'hex_viewer_title',
      'hex_viewer_jump_placeholder',
      'hex_viewer_jump_btn',
      'hex_viewer_search_placeholder',
      'hex_viewer_copy_offset',
      'hex_viewer_copy_hex',
      'hex_viewer_empty',
      'hex_viewer_bytes_per_row',
      'hex_viewer_invalid_offset',
      'hex_viewer_no_match',
      'bdiff_title',
      'bdiff_only_changed',
      'bdiff_equal_bytes',
      'bdiff_diff_bytes',
      'bdiff_left_size',
      'bdiff_right_size',
      'bdiff_no_diff',
      'bdiff_truncated_hint',
      'batch_rename_title',
      'batch_rename_pattern',
      'batch_rename_replace',
      'batch_rename_regex',
      'batch_rename_prefix',
      'batch_rename_suffix',
      'batch_rename_preview',
      'batch_rename_apply',
      'batch_rename_conflict',
      'batch_rename_success',
      'sftp_pane_mode_dual',
      'sftp_pane_mode_left',
      'sftp_pane_mode_right',
      'sftp_pane_toggle',
      'sftp_tree_toggle',
      'sftp_tree_show',
      'sftp_tree_hide',
      'sftp_clipboard_path_jump',
      'sftp_clipboard_path_detected',
      'sftp_clipboard_path_empty',
      'sftp_view_unified_desc',
      'sftp_file_diff',
      'sftp_file_diff_tip',
      'sftp_file_diff_pair_tip',
      'sftp_file_diff_multi_tip',
      'sftp_file_diff_need_two_tip',
      'sftp_file_diff_dirs_only_tip',
      'sftp_compare_directories_tip',
      'sftp_transfer_policy_shortcut',
      'sftp_transfer_policy_active',
    ] as const
    const missing = wave3Keys.filter(
      (k) => !(k in zhCN) || !(k in en) || !(k in zhTW),
    )
    expect(missing).toEqual([])
  })

  it('defines every static t(...) key used in src in both zh-CN and en', () => {
    // zh-TW 历史遗留大量未补齐的旧键，静态 t() 的三语全量覆盖不现实；
    // 主语言 zh-CN/en 必须覆盖所有源码字面量 key，Wave 3 新增键则由上面的测试保证三语齐全。
    const keyRe = /(?<![a-zA-Z0-9_$.])t\(\s*(['"])([a-zA-Z0-9_.-]+)\1\s*(?:,|\))/g
    const missing: string[] = []
    for (const file of collectSourceFiles(srcRoot)) {
      const content = readFileSync(file, 'utf8')
      let match: RegExpExecArray | null
      while ((match = keyRe.exec(content)) !== null) {
        const key = match[2]
        if (!(key in zhCN) || !(key in en)) {
          missing.push(`${relative(srcRoot, file)} -> ${key}`)
        }
      }
    }
    expect(missing).toEqual([])
  })
})
