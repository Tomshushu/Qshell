import React from 'react';
import { Locale, translations } from '../i18n/translations';
import { Layers, Zap, Terminal, Box, Activity, ShieldCheck, ArrowUpRight } from 'lucide-react';

interface FeaturesProps {
  locale: Locale;
}

export const Features: React.FC<FeaturesProps> = ({ locale }) => {
  const t = translations[locale].features;

  const features = [
    {
      icon: Layers,
      title: t.f1Title,
      desc: t.f1Desc,
      tag: 'SSH / Telnet / RDP / BMC',
      gradient: 'from-cyan-500/20 to-blue-600/10',
      border: 'border-cyan-500/30',
      glow: 'text-cyan-400',
    },
    {
      icon: Zap,
      title: t.f2Title,
      desc: t.f2Desc,
      tag: 'Chunked Pipelining · 100MB/s+',
      gradient: 'from-amber-500/20 to-orange-600/10',
      border: 'border-amber-500/30',
      glow: 'text-amber-400',
    },
    {
      icon: Terminal,
      title: t.f3Title,
      desc: t.f3Desc,
      tag: 'WebGL GPU · Zmodem · Broadcast',
      gradient: 'from-emerald-500/20 to-teal-600/10',
      border: 'border-emerald-500/30',
      glow: 'text-emerald-400',
    },
    {
      icon: Box,
      title: t.f4Title,
      desc: t.f4Desc,
      tag: 'Live Logs · Metrics · Compose',
      gradient: 'from-sky-500/20 to-indigo-600/10',
      border: 'border-sky-500/30',
      glow: 'text-sky-400',
    },
    {
      icon: Activity,
      title: t.f5Title,
      desc: t.f5Desc,
      tag: 'Agentless · Ping/MTR/Ports',
      gradient: 'from-violet-500/20 to-purple-600/10',
      border: 'border-violet-500/30',
      glow: 'text-violet-400',
    },
    {
      icon: ShieldCheck,
      title: t.f6Title,
      desc: t.f6Desc,
      tag: 'TOFU Verify · Memory Zeroize',
      gradient: 'from-rose-500/20 to-red-600/10',
      border: 'border-rose-500/30',
      glow: 'text-rose-400',
    },
  ];

  return (
    <section id="features" className="py-16 md:py-24 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-14 md:mb-20">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-cyan-500/30 bg-cyan-950/30 text-cyan-300 text-xs font-medium mb-3">
            <span>{t.badge}</span>
          </div>
          <h2 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight mb-4">
            {t.title}
          </h2>
          <p className="text-sm sm:text-base text-slate-300">
            {t.subtitle}
          </p>
        </div>

        {/* Feature Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
          {features.map((f, idx) => {
            const Icon = f.icon;
            return (
              <div
                key={idx}
                className="glass-card rounded-2xl p-6 sm:p-8 flex flex-col justify-between transition-all duration-300 group hover:-translate-y-1 relative"
              >
                <div>
                  {/* Top Bar with Icon and Tag */}
                  <div className="flex items-center justify-between mb-5">
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${f.gradient} border ${f.border} flex items-center justify-center`}>
                      <Icon className={`w-6 h-6 ${f.glow}`} />
                    </div>
                    <span className="text-[10px] sm:text-[11px] font-mono font-medium text-slate-400 bg-slate-900/80 px-2.5 py-1 rounded-md border border-slate-800">
                      {f.tag}
                    </span>
                  </div>

                  <h3 className="text-base sm:text-lg font-bold text-white mb-2.5 group-hover:text-cyan-300 transition-colors">
                    {f.title}
                  </h3>

                  <p className="text-xs sm:text-sm text-slate-400 leading-relaxed font-normal">
                    {f.desc}
                  </p>
                </div>

                <div className="pt-6 mt-4 border-t border-slate-800/60 flex items-center justify-between text-xs font-medium text-slate-400 group-hover:text-cyan-400 transition-colors">
                  <span>原生 Rust 高性能实现</span>
                  <ArrowUpRight className="w-4 h-4 transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
