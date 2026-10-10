import React, { useState } from 'react';
import { Locale, translations } from '../i18n/translations';
import { Menu, X, Globe, Download } from 'lucide-react';
import { GithubIcon } from './GithubIcon';

interface NavbarProps {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ locale, setLocale }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const t = translations[locale].nav;

  const navLinks = [
    { label: t.features, href: '#features' },
    { label: t.preview, href: '#preview' },
    { label: t.security, href: '#security' },
    { label: t.download, href: '#download' },
    { label: t.faq, href: '#faq' },
  ];

  return (
    <header className="sticky top-0 z-50 w-full glass-panel border-b border-cyan-500/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand Logo */}
        <a href="#" className="flex items-center gap-3 group focus:outline-none">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-gradient-to-br from-cyan-500/20 to-blue-600/30 border border-cyan-400/40 shadow-[0_0_15px_rgba(56,189,248,0.25)] group-hover:scale-105 transition-transform duration-200">
            <svg className="w-6 h-6" viewBox="0 0 64 64" fill="none">
              <circle cx="30" cy="29.5" r="16.5" stroke="#38BDF8" strokeWidth="5.5" strokeLinecap="round" />
              <path d="M 22.5 22.5 L 29.5 29.5 L 22.5 36.5" stroke="#FFFFFF" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="34" y="26.5" width="5.5" height="6" rx="1.5" fill="#38BDF8" />
              <path d="M 36 41.5 C 40 47, 43.5 52.5, 52.5 51" stroke="#38BDF8" strokeWidth="5.8" strokeLinecap="round" />
            </svg>
          </div>
          <div className="flex flex-col">
            <span className="font-extrabold text-xl tracking-tight text-white flex items-center gap-1.5 font-mono">
              Qshell
              <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                v1.0
              </span>
            </span>
          </div>
        </a>

        {/* Desktop Navigation Links */}
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-300">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="hover:text-cyan-400 transition-colors duration-150 py-1"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Right CTA and Language Switcher */}
        <div className="hidden md:flex items-center gap-3">
          {/* Language Toggle */}
          <button
            type="button"
            onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
            className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white px-2.5 py-1.5 rounded-lg border border-slate-700/60 bg-slate-800/40 hover:bg-slate-800/80 transition-all cursor-pointer"
            title="Toggle Language / 切换语言"
          >
            <Globe className="w-3.5 h-3.5 text-cyan-400" />
            <span>{locale === 'zh' ? 'EN' : '中'}</span>
          </button>

          {/* GitHub Repo */}
          <a
            href="https://github.com/Tom-shushu/Qshell"
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800/50 transition-colors"
            title="GitHub"
          >
            <GithubIcon className="w-4 h-4" />
          </a>

          {/* Download CTA Button */}
          <a
            href="#download"
            className="flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 shadow-[0_0_20px_rgba(56,189,248,0.3)] hover:shadow-[0_0_25px_rgba(56,189,248,0.5)] transition-all transform hover:-translate-y-0.5 active:translate-y-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{t.downloadNow}</span>
          </a>
        </div>

        {/* Mobile Hamburger Button */}
        <div className="flex md:hidden items-center gap-2">
          <button
            type="button"
            onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
            className="flex items-center gap-1 text-xs text-slate-300 p-2 rounded-lg border border-slate-700/60 bg-slate-800/40"
          >
            <Globe className="w-3.5 h-3.5 text-cyan-400" />
            <span>{locale === 'zh' ? 'EN' : '中'}</span>
          </button>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="text-slate-300 hover:text-white p-2 rounded-lg border border-slate-700/60 bg-slate-800/40 focus:outline-none"
            aria-label="Toggle Menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5 text-cyan-400" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden glass-panel border-b border-cyan-500/20 px-4 pt-3 pb-6 space-y-3 animate-in slide-in-from-top-2 duration-200">
          <div className="flex flex-col space-y-2 text-sm">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg text-slate-200 hover:bg-slate-800/60 hover:text-cyan-400 transition-colors"
              >
                {link.label}
              </a>
            ))}
          </div>

          <div className="pt-3 border-t border-slate-800 flex flex-col gap-2">
            <a
              href="#download"
              onClick={() => setMobileMenuOpen(false)}
              className="w-full flex items-center justify-center gap-2 text-sm font-semibold py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-medium"
            >
              <Download className="w-4 h-4" />
              <span>{t.downloadNow}</span>
            </a>
            <a
              href="https://github.com/Tom-shushu/Qshell"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 text-xs py-2 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800/60"
            >
              <GithubIcon className="w-3.5 h-3.5" />
              <span>GitHub Repository</span>
            </a>
          </div>
        </div>
      )}
    </header>
  );
};
