import React from 'react';
import { Locale, translations } from '../i18n/translations';
import { Heart, MessageSquareCode } from 'lucide-react';
import { GithubIcon } from './GithubIcon';

interface FooterProps {
  locale: Locale;
}

export const Footer: React.FC<FooterProps> = ({ locale }) => {
  const t = translations[locale].footer;

  return (
    <footer className="border-t border-slate-800/80 bg-[#050810] pt-14 pb-12 text-slate-400 text-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
          {/* Col 1: Brand Info */}
          <div className="space-y-4 md:col-span-1">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-cyan-500/20 border border-cyan-400/40">
                <svg className="w-5 h-5" viewBox="0 0 64 64" fill="none">
                  <circle cx="30" cy="29.5" r="16.5" stroke="#38BDF8" strokeWidth="5.5" strokeLinecap="round" />
                  <path d="M 22.5 22.5 L 29.5 29.5 L 22.5 36.5" stroke="#FFFFFF" strokeWidth="3.6" strokeLinecap="round" />
                  <rect x="34" y="26.5" width="5.5" height="6" rx="1.5" fill="#38BDF8" />
                  <path d="M 36 41.5 C 40 47, 43.5 52.5, 52.5 51" stroke="#38BDF8" strokeWidth="5.8" strokeLinecap="round" />
                </svg>
              </div>
              <span className="font-extrabold text-lg text-white font-mono">Qshell</span>
            </div>
            <p className="text-slate-400 leading-relaxed text-xs">
              {t.tagline}
            </p>
            <div className="text-[11px] text-cyan-400/90 font-mono">
              {t.builtWith}
            </div>
          </div>

          {/* Col 2: Quick Links */}
          <div>
            <h4 className="font-semibold text-slate-200 mb-3 text-xs tracking-wider uppercase">
              {t.linksTitle}
            </h4>
            <ul className="space-y-2">
              <li>
                <a href="#features" className="hover:text-cyan-300 transition-colors">
                  {translations[locale].nav.features}
                </a>
              </li>
              <li>
                <a href="#preview" className="hover:text-cyan-300 transition-colors">
                  {translations[locale].nav.preview}
                </a>
              </li>
              <li>
                <a href="#download" className="hover:text-cyan-300 transition-colors">
                  {translations[locale].nav.download}
                </a>
              </li>
              <li>
                <a href="#security" className="hover:text-cyan-300 transition-colors">
                  {translations[locale].nav.security}
                </a>
              </li>
            </ul>
          </div>

          {/* Col 3: Community & Issues */}
          <div>
            <h4 className="font-semibold text-slate-200 mb-3 text-xs tracking-wider uppercase">
              {t.communityTitle}
            </h4>
            <ul className="space-y-2">
              <li>
                <a
                  href="https://github.com/Tom-shushu/Qshell/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-cyan-300 transition-colors flex items-center gap-1.5"
                >
                  <MessageSquareCode className="w-3.5 h-3.5 text-slate-500" />
                  <span>{t.issuesLink}</span>
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/Tom-shushu/Qshell"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-cyan-300 transition-colors flex items-center gap-1.5"
                >
                  <GithubIcon className="w-3.5 h-3.5 text-slate-500" />
                  <span>{t.githubLink}</span>
                </a>
              </li>
              <li>
                <a
                  href="https://gitee.com/Tom-shushu/Qshell"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-cyan-300 transition-colors"
                >
                  {t.giteeLink}
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/Tom-shushu/Qshell/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-cyan-300 transition-colors"
                >
                  {t.changelogLink}
                </a>
              </li>
            </ul>
          </div>

          {/* Col 4: Legal & Security */}
          <div>
            <h4 className="font-semibold text-slate-200 mb-3 text-xs tracking-wider uppercase">
              {t.legalTitle}
            </h4>
            <ul className="space-y-2">
              <li>
                <a href="#security" className="hover:text-cyan-300 transition-colors">
                  {t.privacyLink}
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/Tom-shushu/Qshell/blob/main/README.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-cyan-300 transition-colors"
                >
                  {t.licenseLink}
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Copyright */}
        <div className="pt-8 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-slate-500">
          <div>{t.copyright}</div>
          <div className="flex items-center gap-1">
            <span>Crafted with</span>
            <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500" />
            <span>for Developers & SysAdmins</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
