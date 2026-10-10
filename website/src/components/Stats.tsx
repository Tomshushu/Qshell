import React from 'react';
import { Locale, translations } from '../i18n/translations';
import { Server, Zap, Shield, Lock } from 'lucide-react';

interface StatsProps {
  locale: Locale;
}

export const Stats: React.FC<StatsProps> = ({ locale }) => {
  const t = translations[locale].stats;

  const items = [
    {
      icon: Server,
      val: t.stat1Val,
      label: t.stat1Label,
      desc: t.stat1Desc,
      glow: 'text-cyan-400',
    },
    {
      icon: Zap,
      val: t.stat2Val,
      label: t.stat2Label,
      desc: t.stat2Desc,
      glow: 'text-amber-400',
    },
    {
      icon: Shield,
      val: t.stat3Val,
      label: t.stat3Label,
      desc: t.stat3Desc,
      glow: 'text-emerald-400',
    },
    {
      icon: Lock,
      val: t.stat4Val,
      label: t.stat4Label,
      desc: t.stat4Desc,
      glow: 'text-sky-400',
    },
  ];

  return (
    <section className="relative -mt-6 sm:-mt-10 mb-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
        {items.map((item, idx) => {
          const Icon = item.icon;
          return (
            <div
              key={idx}
              className="glass-card rounded-2xl p-4 sm:p-6 flex flex-col justify-between transition-all duration-300 relative overflow-hidden group"
            >
              {/* Subtle accent line on top */}
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent group-hover:via-cyan-400/70 transition-all" />

              <div className="flex items-center justify-between mb-3">
                <span className={`text-2xl sm:text-4xl font-extrabold font-mono tracking-tight text-white group-hover:${item.glow} transition-colors`}>
                  {item.val}
                </span>
                <div className="w-8 h-8 rounded-lg bg-slate-800/80 border border-slate-700/50 flex items-center justify-center">
                  <Icon className={`w-4 h-4 ${item.glow}`} />
                </div>
              </div>

              <div>
                <h4 className="text-xs sm:text-sm font-semibold text-slate-200 mb-0.5">
                  {item.label}
                </h4>
                <p className="text-[11px] sm:text-xs text-slate-400 font-normal leading-snug">
                  {item.desc}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
