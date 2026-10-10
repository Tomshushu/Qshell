import React, { useState } from 'react';
import { Locale } from './i18n/translations';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { Stats } from './components/Stats';
import { InteractiveDemo } from './components/InteractiveDemo';
import { Features } from './components/Features';
import { SecurityPledge } from './components/SecurityPledge';
import { DownloadSection } from './components/DownloadSection';
import { Faq } from './components/Faq';
import { Footer } from './components/Footer';

export const App: React.FC = () => {
  const [locale, setLocale] = useState<Locale>('zh');

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col selection:bg-cyan-500 selection:text-black">
      {/* Top Navbar */}
      <Navbar locale={locale} setLocale={setLocale} />

      {/* Main Content Sections */}
      <main className="flex-1">
        <Hero locale={locale} />
        <Stats locale={locale} />
        <InteractiveDemo locale={locale} />
        <Features locale={locale} />
        <SecurityPledge locale={locale} />
        <DownloadSection locale={locale} />
        <Faq locale={locale} />
      </main>

      {/* Footer */}
      <Footer locale={locale} />
    </div>
  );
};

export default App;
