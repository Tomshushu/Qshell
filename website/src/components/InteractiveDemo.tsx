import React, { useState, useEffect, useCallback } from 'react';
import { Locale, translations } from '../i18n/translations';
import {
  Terminal,
  FolderTree,
  SplitSquareVertical,
  Sparkles,
  SlidersHorizontal,
  Maximize2,
  X,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Eye,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';

interface InteractiveDemoProps {
  locale: Locale;
}

const CHAPTER_ICONS = [
  Terminal,
  FolderTree,
  SplitSquareVertical,
  Sparkles,
  SlidersHorizontal,
];

const ACCENT_COLORS = [
  {
    pill: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
    glow: 'from-cyan-500/15 via-blue-500/5 to-transparent',
    border: 'border-cyan-500/40',
    bar: 'bg-cyan-400',
    specBg: 'bg-cyan-950/20 border-cyan-500/20 text-cyan-300',
  },
  {
    pill: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    glow: 'from-emerald-500/15 via-teal-500/5 to-transparent',
    border: 'border-emerald-500/40',
    bar: 'bg-emerald-400',
    specBg: 'bg-emerald-950/20 border-emerald-500/20 text-emerald-300',
  },
  {
    pill: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
    glow: 'from-indigo-500/15 via-purple-500/5 to-transparent',
    border: 'border-indigo-500/40',
    bar: 'bg-indigo-400',
    specBg: 'bg-indigo-950/20 border-indigo-500/20 text-indigo-300',
  },
  {
    pill: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    glow: 'from-amber-500/15 via-orange-500/5 to-transparent',
    border: 'border-amber-500/40',
    bar: 'bg-amber-400',
    specBg: 'bg-amber-950/20 border-amber-500/20 text-amber-300',
  },
  {
    pill: 'bg-violet-500/10 text-violet-400 border-violet-500/30',
    glow: 'from-violet-500/15 via-fuchsia-500/5 to-transparent',
    border: 'border-violet-500/40',
    bar: 'bg-violet-400',
    specBg: 'bg-violet-950/20 border-violet-500/20 text-violet-300',
  },
];

export const InteractiveDemo: React.FC<InteractiveDemoProps> = ({ locale }) => {
  const t = translations[locale].demo;
  const chapters = t.chapters;

  const [activeIndex, setActiveIndex] = useState(0);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [isAutoplay, setIsAutoplay] = useState(false);

  const currentChapter = chapters[activeIndex];
  const IconComponent = CHAPTER_ICONS[activeIndex % CHAPTER_ICONS.length];
  const currentAccent = ACCENT_COLORS[activeIndex % ACCENT_COLORS.length];

  const handlePrev = useCallback(() => {
    setActiveIndex((prev) => (prev - 1 + chapters.length) % chapters.length);
  }, [chapters.length]);

  const handleNext = useCallback(() => {
    setActiveIndex((prev) => (prev + 1) % chapters.length);
  }, [chapters.length]);

  // Keyboard navigation for lightbox
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isLightboxOpen) return;
      if (e.key === 'Escape') setIsLightboxOpen(false);
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === 'ArrowRight') handleNext();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLightboxOpen, handlePrev, handleNext]);

  return (
    <section id="demo" className="py-24 bg-[#050811] relative overflow-hidden border-t border-b border-slate-800/80">
      {/* Background ambient lighting */}
      <div
        className={`absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[500px] bg-gradient-to-tr ${currentAccent.glow} blur-[120px] pointer-events-none transition-all duration-700 rounded-full`}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900/90 border border-slate-800 text-slate-300 text-xs font-semibold uppercase tracking-wider mb-5 shadow-lg backdrop-blur-md">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
            {t.badge}
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white tracking-tight leading-tight">
            {t.title}
          </h2>
          <p className="mt-4 text-base sm:text-lg text-slate-400 leading-relaxed max-w-2xl mx-auto">
            {t.subtitle}
          </p>
        </div>

        {/* Apple-style Chapter Selector Tabs */}
        <div className="flex items-center justify-center mb-10">
          <div className="inline-flex max-w-full p-1.5 rounded-2xl bg-slate-900/90 border border-slate-800/90 shadow-2xl overflow-x-auto no-scrollbar gap-1.5 backdrop-blur-xl">
            {chapters.map((ch, idx) => {
              const TabIcon = CHAPTER_ICONS[idx % CHAPTER_ICONS.length];
              const isActive = activeIndex === idx;
              return (
                <button
                  key={ch.id}
                  onClick={() => setActiveIndex(idx)}
                  className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl font-medium text-xs sm:text-sm whitespace-nowrap transition-all duration-300 cursor-pointer ${
                    isActive
                      ? 'bg-slate-800 text-white shadow-lg border border-slate-700 ring-1 ring-cyan-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent'
                  }`}
                >
                  <span className={`font-mono text-xs ${isActive ? 'text-cyan-400 font-bold' : 'text-slate-500'}`}>
                    {ch.number}
                  </span>
                  <TabIcon className={`w-4 h-4 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                  <span>{ch.tag.split(' ')[0]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Wide Cinematic Showcase Card (Apple Product Feature Presentation) */}
        <div className="rounded-3xl border border-slate-800 bg-gradient-to-b from-slate-900/80 via-slate-950/90 to-[#070b16] p-6 sm:p-10 shadow-2xl shadow-cyan-950/20 backdrop-blur-2xl relative overflow-hidden transition-all duration-500">
          {/* Subtle interior glow */}
          <div className="absolute top-0 right-1/4 w-80 h-80 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
            {/* Left Column: Storytelling Narrative & Spec Highlights (5 cols on lg) */}
            <div className="lg:col-span-5 flex flex-col justify-between space-y-6">
              <div>
                {/* Chapter Number & Tag Badge */}
                <div className="flex items-center gap-2.5 mb-4">
                  <span className="font-mono text-xs font-bold text-slate-500 tracking-wider">
                    CHAPTER {currentChapter.number}
                  </span>
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${currentAccent.pill}`}>
                    <IconComponent className="w-3.5 h-3.5" />
                    {currentChapter.tag}
                  </span>
                </div>

                {/* Big Punchline Headline (Apple Style) */}
                <h3 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-white leading-tight tracking-tight">
                  {currentChapter.headline}
                </h3>

                {/* Narrative Paragraph */}
                <p className="mt-4 text-sm sm:text-base text-slate-300 leading-relaxed">
                  {currentChapter.desc}
                </p>
              </div>

              {/* 3 Apple-Style Spec Metrics Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                {currentChapter.specs.map((spec, sIdx) => (
                  <div
                    key={sIdx}
                    className="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800/90 flex flex-col justify-between hover:border-slate-700 transition-colors"
                  >
                    <span className="text-[11px] text-slate-400 font-medium">
                      {spec.label}
                    </span>
                    <span className="text-sm font-bold text-white font-mono mt-1">
                      {spec.value}
                    </span>
                  </div>
                ))}
              </div>

              {/* Carousel Controls */}
              <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={handlePrev}
                    className="p-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-all cursor-pointer shadow-md"
                    title={t.prevChapter}
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    onClick={handleNext}
                    className="p-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-all cursor-pointer shadow-md"
                    title={t.nextChapter}
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                  <span className="text-xs text-slate-400 font-mono ml-2">
                    {activeIndex + 1} / {chapters.length}
                  </span>
                </div>

                {/* Progress bar dots */}
                <div className="flex items-center gap-1.5">
                  {chapters.map((_, dotIdx) => (
                    <button
                      key={dotIdx}
                      onClick={() => setActiveIndex(dotIdx)}
                      className={`h-2 rounded-full transition-all duration-300 cursor-pointer ${
                        activeIndex === dotIdx
                          ? 'w-8 bg-cyan-400'
                          : 'w-2 bg-slate-700 hover:bg-slate-500'
                      }`}
                      aria-label={`Go to chapter ${dotIdx + 1}`}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column: Wide Native Desktop Window Frame (7 cols on lg) */}
            <div className="lg:col-span-7">
              <div className="rounded-2xl border border-slate-700/80 bg-slate-950 shadow-2xl shadow-cyan-950/30 overflow-hidden group">
                {/* Window Chrome Title Bar */}
                <div className="flex items-center justify-between px-4 py-3 bg-[#0a0f1d] border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-rose-500/80" />
                      <div className="w-3 h-3 rounded-full bg-amber-500/80" />
                      <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
                    </div>
                    <span className="text-xs text-slate-400 font-mono ml-2 hidden sm:inline">
                      qshell-desktop — {currentChapter.tag}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Native 60FPS
                    </span>
                    <button
                      onClick={() => setIsLightboxOpen(true)}
                      className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 px-2.5 py-1 rounded-lg border border-slate-700 transition-all cursor-pointer shadow-sm"
                      title={t.clickToEnlarge}
                    >
                      <Maximize2 className="w-3.5 h-3.5 text-cyan-400" />
                      <span className="hidden sm:inline">{t.clickToEnlarge}</span>
                    </button>
                  </div>
                </div>

                {/* Big Image Viewport Container */}
                <div
                  className="relative bg-black/90 cursor-zoom-in aspect-[16/10] flex items-center justify-center overflow-hidden"
                  onClick={() => setIsLightboxOpen(true)}
                >
                  <img
                    src={currentChapter.image}
                    alt={currentChapter.headline}
                    className="w-full h-full object-contain select-none transition-transform duration-500 group-hover:scale-[1.01]"
                    loading="lazy"
                  />

                  {/* Hover Overlay Hint */}
                  <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center pointer-events-none">
                    <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900/90 border border-cyan-500/50 text-cyan-300 text-sm font-medium shadow-2xl backdrop-blur-md">
                      <Eye className="w-4 h-4 text-cyan-400" />
                      {t.clickToEnlarge}
                    </div>
                  </div>
                </div>

                {/* Window Status Footer Bar */}
                <div className="px-4 py-2.5 bg-[#090e1a] border-t border-slate-800 text-[11px] text-slate-400 font-mono flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span>所见即所得 · 桌面客户端真实运行渲染画面</span>
                  </div>
                  <div className="flex items-center gap-3 text-slate-400">
                    <span>1920x1080 Native</span>
                    <span className="text-emerald-400 font-semibold">100% Match</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Chapter Strip Bar at Bottom */}
        <div className="mt-8 grid grid-cols-2 sm:grid-cols-5 gap-3">
          {chapters.map((ch, idx) => {
            const isSelected = activeIndex === idx;
            const ChIcon = CHAPTER_ICONS[idx % CHAPTER_ICONS.length];
            return (
              <button
                key={ch.id}
                onClick={() => setActiveIndex(idx)}
                className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? 'bg-slate-900 border-cyan-500/50 ring-1 ring-cyan-500/30 shadow-lg shadow-cyan-950/30'
                    : 'bg-slate-900/40 border-slate-800/80 hover:bg-slate-900/80 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <ChIcon className={`w-4 h-4 ${isSelected ? 'text-cyan-400' : 'text-slate-400'}`} />
                  <span className="text-[10px] font-mono text-slate-500">{ch.number}</span>
                </div>
                <div className="text-xs font-bold text-white truncate">
                  {ch.tag}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Fullscreen High-Resolution Lightbox Modal */}
      {isLightboxOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex flex-col p-4 md:p-6 animate-in fade-in duration-200"
          onClick={() => setIsLightboxOpen(false)}
        >
          {/* Modal Header */}
          <div
            className="flex items-center justify-between pb-3 border-b border-slate-800 max-w-7xl w-full mx-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <h3 className="text-white text-base md:text-lg font-semibold truncate max-w-md">
                {currentChapter.headline}
              </h3>
              <span className="text-xs text-slate-400 font-mono hidden sm:inline">
                [{activeIndex + 1} / {chapters.length}]
              </span>
            </div>

            <button
              onClick={() => setIsLightboxOpen(false)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/60 text-slate-300 hover:text-rose-200 border border-slate-700 transition-all cursor-pointer text-xs"
            >
              <X className="w-4 h-4" />
              <span>{t.closePreview}</span>
            </button>
          </div>

          {/* Modal Image Viewport */}
          <div
            className="flex-1 relative flex items-center justify-center p-2 md:p-6 overflow-hidden max-w-7xl w-full mx-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={handlePrev}
              className="absolute left-2 md:left-4 z-10 p-3 rounded-full bg-slate-900/80 hover:bg-cyan-600 text-slate-300 hover:text-white border border-slate-700/80 transition-all cursor-pointer shadow-xl backdrop-blur-sm"
              title="Previous (Left Arrow)"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>

            <img
              src={currentChapter.image}
              alt={currentChapter.headline}
              className="max-h-[82vh] max-w-full object-contain rounded-xl border border-slate-800 shadow-2xl"
            />

            <button
              onClick={handleNext}
              className="absolute right-2 md:right-4 z-10 p-3 rounded-full bg-slate-900/80 hover:bg-cyan-600 text-slate-300 hover:text-white border border-slate-700/80 transition-all cursor-pointer shadow-xl backdrop-blur-sm"
              title="Next (Right Arrow)"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </div>

          {/* Modal Bottom Caption */}
          <div
            className="pt-2 text-center text-xs text-slate-400 font-mono max-w-4xl mx-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <span>{currentChapter.desc}</span>
          </div>
        </div>
      )}
    </section>
  );
};
