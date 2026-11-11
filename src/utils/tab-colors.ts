export interface TabColorOption {
  nameKey: string;
  value?: string;
}

export { TAB_COLORS } from "@/components/layout/tab-strip";

export const PRESET_TAB_COLORS: { nameKey: string; value: string }[] = [
  { nameKey: "color_red", value: "#ef4444" },
  { nameKey: "color_orange", value: "#f97316" },
  { nameKey: "color_yellow", value: "#eab308" },
  { nameKey: "color_green", value: "#22c55e" },
  { nameKey: "color_cyan", value: "#06b6d4" },
  { nameKey: "color_blue", value: "#3b82f6" },
  { nameKey: "color_purple", value: "#a855f7" },
  { nameKey: "color_pink", value: "#ec4899" },
];
