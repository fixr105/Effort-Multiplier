import { Zap, ChevronRight } from 'lucide-react';

export function Header() {
  return (
    <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-100">
      <div className="max-w-6xl mx-auto px-5 sm:px-6 lg:px-8">
        <div className="h-14 flex items-center justify-between gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gray-900 flex items-center justify-center shrink-0">
              <Zap size={16} className="text-white" fill="white" />
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold text-gray-900 whitespace-nowrap">
                  Effort Multiplier
                </span>
                <ChevronRight size={14} className="text-gray-300" />
                <span className="text-sm font-medium text-gray-500 whitespace-nowrap hidden sm:inline">
                  Integrations
                </span>
              </div>
              <span className="hidden md:inline text-xs text-gray-400 ml-2 truncate">
                Your business, connected.
              </span>
            </div>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-medium text-gray-400 px-2.5 py-1 rounded-full border border-gray-200 bg-gray-50">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              5x Club
            </div>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center text-white text-xs font-semibold shadow-sm">
              GP
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
