import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { INTERMEDIATE_POINTS } from "@/lib/app-lock";

export interface PatternLockProps {
  /** 最小连接点数，默认 4 */
  minPoints?: number;
  /** 完成绘制时的回调（松开鼠标/手指时触发） */
  onComplete?: (pattern: number[]) => void;
  /** 开始绘制时的回调（按下首个圆点时触发） */
  onStart?: () => void;
  /** 当前状态：normal 默认高亮，error 错误告警（红），success 成功（绿） */
  status?: "normal" | "error" | "success";
  /** 是否禁用交互 */
  disabled?: boolean;
  /** 自定义外层容器类名 */
  className?: string;
  /** 画布像素尺寸（宽高正方形），默认 240 */
  size?: number;
  /** 是否在外部通知时重置已绘制的轨迹 */
  resetKey?: number | string;
}

interface PointCoord {
  id: number;
  x: number;
  y: number;
}

const DOT_COORDS: PointCoord[] = [
  { id: 0, x: 60, y: 60 },
  { id: 1, x: 150, y: 60 },
  { id: 2, x: 240, y: 60 },
  { id: 3, x: 60, y: 150 },
  { id: 4, x: 150, y: 150 },
  { id: 5, x: 240, y: 150 },
  { id: 6, x: 60, y: 240 },
  { id: 7, x: 150, y: 240 },
  { id: 8, x: 240, y: 240 },
];

const HIT_RADIUS = 36; // 命中判定的半径范围（viewBox 坐标系内）

export function PatternLock({
  onComplete,
  onStart,
  status = "normal",
  disabled = false,
  className,
  size = 240,
  resetKey,
}: PatternLockProps) {
  const [selectedPoints, setSelectedPoints] = useState<number[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(
    null,
  );

  const svgRef = useRef<SVGSVGElement>(null);
  const selectedSet = useMemo(() => new Set(selectedPoints), [selectedPoints]);

  // resetKey 变化时清空当前点阵与跟随线
  useEffect(() => {
    setSelectedPoints([]);
    setIsDrawing(false);
    setCursorPos(null);
  }, [resetKey]);

  // 将客户端屏幕坐标转换为 SVG 300x300 viewBox 坐标
  const getSvgCoordinates = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const scaleX = 300 / rect.width;
      const scaleY = 300 / rect.height;
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
      };
    },
    [],
  );

  // 检测指定坐标最近的圆点（如果小于命中阈值）
  const findClosestDot = useCallback((x: number, y: number): number | null => {
    for (const dot of DOT_COORDS) {
      const dist = Math.hypot(x - dot.x, y - dot.y);
      if (dist <= HIT_RADIUS) {
        return dot.id;
      }
    }
    return null;
  }, []);

  // 追加新节点（支持 Android 原生手感：中间跨点自动穿透穿连）
  const appendPoint = useCallback(
    (newPointId: number, currentList: number[]) => {
      if (currentList.includes(newPointId)) return currentList;

      const nextList = [...currentList];
      if (nextList.length > 0) {
        const last = nextList[nextList.length - 1];
        const bridgeKey = `${last}-${newPointId}`;
        const midPoint = INTERMEDIATE_POINTS[bridgeKey];
        if (midPoint !== undefined && !nextList.includes(midPoint)) {
          nextList.push(midPoint);
        }
      }
      nextList.push(newPointId);
      return nextList;
    },
    [],
  );

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (disabled || e.button !== 0) return;
    const coords = getSvgCoordinates(e.clientX, e.clientY);
    if (!coords) return;

    const hit = findClosestDot(coords.x, coords.y);
    if (hit !== null) {
      // 捕获指针，防止移出 SVG 边界时丢帧或中断手势
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // 部分测试环境或浏览器不支持捕获时静默降级
      }

      onStart?.();
      setIsDrawing(true);
      setSelectedPoints([hit]);
      setCursorPos(coords);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDrawing || disabled) return;
    const coords = getSvgCoordinates(e.clientX, e.clientY);
    if (!coords) return;

    setCursorPos(coords);

    const hit = findClosestDot(coords.x, coords.y);
    if (hit !== null && !selectedSet.has(hit)) {
      setSelectedPoints((prev) => appendPoint(hit, prev));
    }
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDrawing) return;
    setIsDrawing(false);
    setCursorPos(null);

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // 容错处理
    }

    if (selectedPoints.length > 0) {
      onComplete?.(selectedPoints);
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDrawing) return;
    setIsDrawing(false);
    setCursorPos(null);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // 容错处理
    }
  };

  // 颜色样式映射
  const colorMap = useMemo(() => {
    if (status === "error") {
      return {
        line: "stroke-destructive",
        dotRingFill: "fill-destructive/15",
        dotRingStroke: "stroke-destructive/60",
        dotCore: "fill-destructive",
      };
    }
    if (status === "success") {
      return {
        line: "stroke-emerald-500",
        dotRingFill: "fill-emerald-500/15",
        dotRingStroke: "stroke-emerald-500/60",
        dotCore: "fill-emerald-500",
      };
    }
    return {
      line: "stroke-primary",
      dotRingFill: "fill-primary/15",
      dotRingStroke: "stroke-primary/50",
      dotCore: "fill-primary",
    };
  }, [status]);

  // 已选中的最后一个点坐标
  const lastSelectedCoord = useMemo(() => {
    if (selectedPoints.length === 0) return null;
    const lastId = selectedPoints[selectedPoints.length - 1];
    return DOT_COORDS[lastId] || null;
  }, [selectedPoints]);

  return (
    <div
      className={cn(
        "relative flex items-center justify-center select-none touch-none",
        disabled && "opacity-60 cursor-not-allowed",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <svg
        ref={svgRef}
        viewBox="0 0 300 300"
        className="w-full h-full cursor-pointer touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        role="application"
        aria-label="Pattern Lock Grid"
        data-testid="pattern-lock-svg"
      >
        {/* 背景轻微呼吸光影（已绘制时激活） */}
        {selectedPoints.length > 0 && (
          <circle
            cx="150"
            cy="150"
            r="135"
            className={cn(
              "transition-opacity duration-300 pointer-events-none",
              status === "error"
                ? "fill-destructive/5"
                : status === "success"
                  ? "fill-emerald-500/5"
                  : "fill-primary/5",
            )}
          />
        )}

        {/* 1. 已连接点之间的固定折线 */}
        {selectedPoints.map((pointId, idx) => {
          if (idx === 0) return null;
          const prevId = selectedPoints[idx - 1];
          const p1 = DOT_COORDS[prevId];
          const p2 = DOT_COORDS[pointId];
          return (
            <line
              key={`line-${prevId}-${pointId}-${idx}`}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              strokeWidth="4"
              strokeLinecap="round"
              className={cn(
                "transition-colors duration-150 pointer-events-none",
                colorMap.line,
              )}
            />
          );
        })}

        {/* 2. 最后一个连接点跟随鼠标光标的弹性动态线 */}
        {isDrawing && lastSelectedCoord && cursorPos && (
          <line
            x1={lastSelectedCoord.x}
            y1={lastSelectedCoord.y}
            x2={cursorPos.x}
            y2={cursorPos.y}
            strokeWidth="3.5"
            strokeLinecap="round"
            className={cn("pointer-events-none opacity-80", colorMap.line)}
          />
        )}

        {/* 3. 九个圆点渲染 */}
        {DOT_COORDS.map((dot) => {
          const isSelected = selectedSet.has(dot.id);

          return (
            <g
              key={`dot-${dot.id}`}
              className="cursor-pointer"
              data-testid={`pattern-dot-${dot.id}`}
            >
              {/* 隐形扩展可点击响应区域 */}
              <circle
                cx={dot.x}
                cy={dot.y}
                r={HIT_RADIUS}
                fill="transparent"
                className="cursor-pointer"
              />

              {/* 选中态：外圈高亮光晕环 */}
              {isSelected && (
                <circle
                  cx={dot.x}
                  cy={dot.y}
                  r="24"
                  strokeWidth="2"
                  className={cn(
                    "animate-in zoom-in-75 duration-150 transition-colors pointer-events-none",
                    colorMap.dotRingFill,
                    colorMap.dotRingStroke,
                  )}
                />
              )}

              {/* 未选中时的外圈微弱感应环（悬浮感） */}
              {!isSelected && !disabled && (
                <circle
                  cx={dot.x}
                  cy={dot.y}
                  r="18"
                  className="fill-transparent hover:fill-muted/40 transition-colors pointer-events-none"
                />
              )}

              {/* 核心中心圆点 */}
              <circle
                cx={dot.x}
                cy={dot.y}
                r={isSelected ? 9 : 7}
                className={cn(
                  "transition-all duration-150 pointer-events-none",
                  isSelected
                    ? cn(colorMap.dotCore, "drop-shadow-sm")
                    : "fill-muted-foreground/35 hover:fill-muted-foreground/60",
                )}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
