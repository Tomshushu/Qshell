import React from 'react';
import { Locale, translations } from '../i18n/translations';
import { Download, Monitor, Apple, Terminal, CheckCircle, ExternalLink, ShieldCheck } from 'lucide-react';

interface DownloadSectionProps {
  locale: Locale;
}

export const DownloadSection: React.FC<DownloadSectionProps> = ({ locale }) => {
  const t = translations[locale].download;

  const baseReleaseUrl = 'https://github.com/Tom-shushu/Qshell/releases/latest';

  return (
    <section id="download" className="py-16 md:py-24 relative">
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

        {/* 3 Platform Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 mb-10">
          {/* 1. Windows Card (Recommended) */}
          <div className="glass-card rounded-2xl p-6 sm:p-8 border-2 border-cyan-500/40 relative flex flex-col justify-between shadow-[0_0_30px_-5px_rgba(56,189,248,0.25)]">
            <div className="absolute -top-3 right-6 bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 text-[10px] font-extrabold px-3 py-0.5 rounded-full uppercase tracking-wider">
              推荐 / Popular
            </div>

            <div>
              <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-5">
                <Monitor className="w-6 h-6 text-cyan-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-1.5">{t.windowsTitle}</h3>
              <p className="text-xs text-slate-400 mb-6">{t.windowsDesc}</p>

              <div className="space-y-3">
                <a
                  href={`${baseReleaseUrl}/download/Qshell_1.0.0_x64-setup.exe`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs sm:text-sm shadow-md transition-all group"
                >
                  <span className="flex items-center gap-2">
                    <Download className="w-4 h-4" />
                    <span>{t.btnNsis}</span>
                  </span>
                  <span className="text-[11px] font-mono opacity-80">.exe</span>
                </a>

                <a
                  href={`${baseReleaseUrl}/download/Qshell_1.0.0_x64-portable.zip`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-slate-700 hover:border-cyan-500/50 bg-slate-900/60 hover:bg-slate-800 text-slate-200 text-xs sm:text-sm font-medium transition-all"
                >
                  <span className="flex items-center gap-2">
                    <Download className="w-4 h-4 text-cyan-400" />
                    <span>{t.btnPortable}</span>
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">.zip</span>
                </a>
              </div>
            </div>

            <div className="pt-6 mt-6 border-t border-slate-800 text-[11px] text-slate-400 space-y-1">
              <div className="flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>原生 64 位 x86_64 架构</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>免安装便携版支持 U 盘即插即用</span>
              </div>
            </div>
          </div>

          {/* 2. macOS Card */}
          <div className="glass-card rounded-2xl p-6 sm:p-8 border border-slate-700/60 flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 rounded-xl bg-slate-800/80 border border-slate-700 flex items-center justify-center mb-5">
                <Apple className="w-6 h-6 text-slate-200" />
              </div>
              <h3 className="text-xl font-bold text-white mb-1.5">{t.macTitle}</h3>
              <p className="text-xs text-slate-400 mb-6">{t.macDesc}</p>

              <div className="space-y-3">
                <a
                  href={`${baseReleaseUrl}/download/Qshell_1.0.0_aarch64.dmg`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-slate-700 hover:border-slate-500 bg-slate-900/60 hover:bg-slate-800 text-slate-200 text-xs sm:text-sm font-medium transition-all"
                >
                  <span className="flex items-center gap-2">
                    <Download className="w-4 h-4 text-cyan-400" />
                    <span>{t.btnMacArm}</span>
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">.dmg</span>
                </a>

                <a
                  href={`${baseReleaseUrl}/download/Qshell_1.0.0_x64.dmg`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-slate-700 hover:border-slate-500 bg-slate-900/60 hover:bg-slate-800 text-slate-200 text-xs sm:text-sm font-medium transition-all"
                >
                  <span className="flex items-center gap-2">
                    <Download className="w-4 h-4 text-slate-400" />
                    <span>{t.btnMacIntel}</span>
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">.dmg</span>
                </a>
              </div>
            </div>

            <div className="pt-6 mt-6 border-t border-slate-800 text-[11px] text-slate-400 space-y-1">
              <div className="flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>支持 M1 / M2 / M3 / M4 芯片</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>支持 macOS Dark 黑暗模式</span>
              </div>
            </div>
          </div>

          {/* 3. Linux Card */}
          <div className="glass-card rounded-2xl p-6 sm:p-8 border border-slate-700/60 flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 rounded-xl bg-slate-800/80 border border-slate-700 flex items-center justify-center mb-5">
                <Terminal className="w-6 h-6 text-amber-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-1.5">{t.linuxTitle}</h3>
              <p className="text-xs text-slate-400 mb-6">{t.linuxDesc}</p>

              <div className="space-y-3">
                <a
                  href={`${baseReleaseUrl}/download/Qshell_1.0.0_amd64.AppImage`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-slate-700 hover:border-amber-500/50 bg-slate-900/60 hover:bg-slate-800 text-slate-200 text-xs sm:text-sm font-medium transition-all"
                >
                  <span className="flex items-center gap-2">
                    <Download className="w-4 h-4 text-amber-400" />
                    <span>{t.btnAppImage}</span>
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">AppImage</span>
                </a>

                <a
                  href={`${baseReleaseUrl}/download/qshell_1.0.0_amd64.deb`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-slate-700 hover:border-slate-500 bg-slate-900/60 hover:bg-slate-800 text-slate-200 text-xs sm:text-sm font-medium transition-all"
                >
                  <span className="flex items-center gap-2">
                    <Download className="w-4 h-4 text-slate-400" />
                    <span>{t.btnDeb}</span>
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">.deb</span>
                </a>

                <a
                  href={`${baseReleaseUrl}/download/qshell-1.0.0-1.x86_64.rpm`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-slate-700 hover:border-slate-500 bg-slate-900/60 hover:bg-slate-800 text-slate-200 text-xs sm:text-sm font-medium transition-all"
                >
                  <span className="flex items-center gap-2">
                    <Download className="w-4 h-4 text-slate-400" />
                    <span>{t.btnRpm}</span>
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">.rpm</span>
                </a>
              </div>
            </div>

            <div className="pt-6 mt-6 border-t border-slate-800 text-[11px] text-slate-400 space-y-1">
              <div className="flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>基于 WebKitGTK 4.1 硬件加速</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>支持主流发行版桌面图标集成</span>
              </div>
            </div>
          </div>
        </div>

        {/* Checksum and Gitee Release Note */}
        <div className="flex flex-col sm:flex-row items-center justify-between p-4 rounded-xl bg-slate-900/40 border border-slate-800 text-xs text-slate-400 gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>{t.checksumTip}</span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/Tom-shushu/Qshell/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
            >
              <span>GitHub Releases</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href="https://gitee.com/Tom-shushu/Qshell/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-300 hover:text-white flex items-center gap-1"
            >
              <span>Gitee 国内镜像</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
};
