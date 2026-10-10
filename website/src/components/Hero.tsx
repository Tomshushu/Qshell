import React, { useEffect, useState } from 'react';
import { Locale, translations } from '../i18n/translations';
import { Download, Terminal, ShieldCheck, ArrowRight, Zap, CheckCircle2 } from 'lucide-react';

interface HeroProps {
  locale: Locale;
}

export const Hero: React.FC<HeroProps> = ({ locale }) => {
  const t = translations[locale].hero;
  const [detectedOs, setDetectedOs] = useState<'windows' | 'mac' | 'linux'>('windows');

  useEffect(() => {
    const ua = window.navigator.userAgent.toLowerCase();
    if (ua.includes('mac')) {
      setDetectedOs('mac');
    } else if (ua.includes('linux')) {
      setDetectedOs('linux');
    } else {
      setDetectedOs('windows');
    }
  }, []);

  return (
    <section className="relative overflow-hidden pt-12 pb-20 md:pt-20 md:pb-32">
      {/* Background Radial Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] sm:w-[600px] md:w-[900px] h-[350px] sm:h-[500px] bg-gradient-to-tr from-cyan-600/20 via-sky-500/15 to-blue-600/10 blur-[100px] md:blur-[140px] pointer-events-none rounded-full -z-10" />

      {/* Grid Pattern */}
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none -z-10"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, #38bdf8 1px, transparent 0)`,
          backgroundSize: '32px 32px',
        }}
      />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center">
        {/* Release Pill Badge */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-cyan-500/30 bg-cyan-950/40 text-cyan-300 text-xs font-medium mb-6 shadow-[0_0_20px_rgba(56,189,248,0.2)] animate-pulse-glow">
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
          </span>
          <span>{t.badge}</span>
        </div>

        {/* Hero Title */}
        <h1 className="text-3xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-white leading-[1.15] sm:leading-[1.12] mb-6">
          {t.titlePart1}
          <span className="bg-gradient-to-r from-cyan-400 via-sky-300 to-blue-500 bg-clip-text text-transparent neon-glow">
            {t.titleHighlight}
          </span>
          {t.titlePart2}
        </h1>

        {/* Hero Subtitle */}
        <p className="max-w-3xl mx-auto text-base sm:text-lg md:text-xl text-slate-300 font-normal leading-relaxed mb-10">
          {t.subtitle}
        </p>

        {/* Download & CTA Buttons (Adaptive by OS) */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 max-w-md mx-auto sm:max-w-none mb-6">
          {detectedOs === 'windows' ? (
            <>
              {/* Primary Windows Installer */}
              <a
                href="https://github.com/Tom-shushu/Qshell/releases/latest"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full sm:w-auto flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-2xl bg-gradient-to-r from-cyan-500 via-sky-400 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-sm md:text-base shadow-[0_10px_30px_-5px_rgba(56,189,248,0.4)] hover:shadow-[0_15px_35px_-5px_rgba(56,189,248,0.6)] transform hover:-translate-y-0.5 transition-all cursor-pointer"
              >
                <Download className="w-5 h-5" />
                <span>{t.downloadWin}</span>
              </a>

              {/* Portable Zip (No Install) */}
              <a
                href="#download"
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-3.5 rounded-2xl border border-slate-700 hover:border-cyan-500/50 bg-slate-900/60 hover:bg-slate-800/60 text-slate-200 text-sm md:text-base font-medium transition-all"
              >
                <Zap className="w-4 h-4 text-cyan-400" />
                <span>{t.downloadPortable}</span>
              </a>
            </>
          ) : (
            <a
              href="#download"
              className="w-full sm:w-auto flex items-center justify-center gap-2.5 px-7 py-3.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-bold text-sm md:text-base shadow-[0_10px_30px_-5px_rgba(56,189,248,0.4)] hover:shadow-[0_15px_35px_-5px_rgba(56,189,248,0.6)] transition-all cursor-pointer"
            >
              <Download className="w-5 h-5" />
              <span>{t.viewAllPlatforms}</span>
            </a>
          )}

          {/* View All Platforms Link */}
          <a
            href="#download"
            className="text-xs sm:text-sm text-slate-400 hover:text-cyan-300 flex items-center gap-1 transition-colors py-2 px-3"
          >
            <span>{t.viewAllPlatforms}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </a>
        </div>

        {/* Security & System compatibility bullets */}
        <div className="flex flex-wrap items-center justify-center gap-y-2 gap-x-6 text-xs text-slate-400 font-mono">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
            <span>{t.offlineGuaranteed}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>{t.compatibleWith}</span>
          </div>
        </div>
      </div>
    </section>
  );
};
