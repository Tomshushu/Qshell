import React from "react";
import { Play, Pause, FileText, Square, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n";

export interface TerminalRecordingBadgeProps {
  activeTermId: string | null;
  recordingTermIds: Set<string>;
  recordingPausedIds: Set<string>;
  isOpening: boolean;
  onResumeRecording: () => void;
  onPauseRecording: () => void;
  onOpenLogFile: () => void;
  onStopRecording: () => void;
}

export function TerminalRecordingBadge({
  activeTermId,
  recordingTermIds,
  recordingPausedIds,
  isOpening,
  onResumeRecording,
  onPauseRecording,
  onOpenLogFile,
  onStopRecording,
}: TerminalRecordingBadgeProps) {
  const { t } = useTranslation();

  if (!activeTermId || !recordingTermIds.has(activeTermId)) return null;

  const isPaused = recordingPausedIds.has(activeTermId);

  return (
    <div className="absolute top-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-red-500/40 bg-background/90 py-1 pl-2.5 pr-1 text-xs shadow-lg backdrop-blur-sm">
      <span
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          isPaused ? "bg-amber-500" : "animate-pulse bg-red-500",
        )}
      />
      <span className="select-none font-medium text-foreground/90">
        {isPaused ? t("recording_paused_label") : t("recording_active_label")}
      </span>
      <span className="mx-0.5 h-3.5 w-px bg-border/60" />
      {isPaused ? (
        <button
          type="button"
          onClick={onResumeRecording}
          className="flex items-center gap-1 rounded-full px-2 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title={t("recording_resume_menu")}
        >
          <Play className="h-3 w-3" />
          <span>{t("recording_resume_short")}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={onPauseRecording}
          className="flex items-center gap-1 rounded-full px-2 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title={t("recording_pause_menu")}
        >
          <Pause className="h-3 w-3" />
          <span>{t("recording_pause_short")}</span>
        </button>
      )}
      <button
        type="button"
        onClick={onOpenLogFile}
        disabled={isOpening}
        className="flex items-center gap-1 rounded-full px-2 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        title={t("recording_open_file")}
      >
        {isOpening ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <FileText className="h-3 w-3" />
        )}
        <span>{t("recording_open_short")}</span>
      </button>
      <button
        type="button"
        onClick={onStopRecording}
        className="flex items-center gap-1 rounded-full px-2 py-0.5 text-red-500 transition-colors hover:bg-red-500/10"
        title={t("recording_stop_menu")}
      >
        <Square className="h-3 w-3" />
        <span>{t("recording_stop_short")}</span>
      </button>
    </div>
  );
}
