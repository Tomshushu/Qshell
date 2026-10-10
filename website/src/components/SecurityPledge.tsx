import React from 'react';
import { Locale, translations } from '../i18n/translations';
import { ShieldCheck, HardDrive, KeyRound, EyeOff, Radio } from 'lucide-react';

interface SecurityPledgeProps {
  locale: Locale;
}

export const SecurityPledge: React.FC<SecurityPledgeProps> = ({ locale }) => {
  const t = translations[locale].security;

  const pledges = [
    {
      icon: Radio,
      title: t.p1Title,
      desc: t.p1Desc,
    },
    {
      icon: HardDrive,
      title: t.p2Title,
      desc: t.p2Desc,
    },
    {
      icon: EyeOff,
      title: t.p3Title,
      desc: t.p3Desc,
    },
    {
      icon: KeyRound,
      title: t.p4Title,
      desc: t.p4Desc,
    },
  ];

  return (
    <section id="security" className="py-16 md:py-24 relative overflow-hidden bg-slate-950/40 border-y border-slate-800/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/30 bg-emerald-950/30 text-emerald-400 text-xs font-medium mb-3">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>{t.badge}</span>
          </div>
          <h2 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight mb-4">
            {t.title}
          </h2>
          <p className="text-sm sm:text-base text-slate-300">
            {t.subtitle}
          </p>
        </div>

        {/* 4 Security Pillars Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8 max-w-5xl mx-auto mb-12">
          {pledges.map((item, idx) => {
            const Icon = item.icon;
            return (
              <div
                key={idx}
                className="glass-card rounded-2xl p-6 sm:p-7 border border-emerald-500/10 hover:border-emerald-500/30 transition-all duration-200"
              >
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
                    <Icon className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white mb-2">
                      {item.title}
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                      {item.desc}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Manifesto Bottom Callout */}
        <div className="max-w-4xl mx-auto p-5 sm:p-6 rounded-2xl bg-gradient-to-r from-emerald-950/40 via-slate-900/60 to-cyan-950/40 border border-emerald-500/20 text-center">
          <p className="text-xs sm:text-sm text-slate-300 font-mono">
            🛡️ <strong className="text-white font-semibold">Qshell 架构安全宣言：</strong> 你的主机资产、SSH 私钥及密码属于企业核心资产，绝不在任何第三方云端留存副本。我们坚持纯本地离线优先（Local-First），代码透明，经得起安全审查。
          </p>
        </div>
      </div>
    </section>
  );
};
