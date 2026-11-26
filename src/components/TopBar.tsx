import type { ActiveTab } from "../types/meditrack";

interface TopBarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onOpenPickupModal: () => void;
}

const NAV_ITEMS: Array<{ id: ActiveTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "segregation", label: "Segregation" },
  { id: "fleet", label: "Smart Bins" },
  { id: "routes", label: "Route Map" },
  { id: "compliance", label: "Compliance" },
  { id: "visitors", label: "Live Traffic" },
];

export function TopBar({
  activeTab,
  onSelectTab,
  onOpenPickupModal,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
      <div className="max-w-[1360px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Brand logo mark + single-line wordmark */}
        <button
          type="button"
          onClick={() => onSelectTab("overview")}
          className="inline-flex items-center gap-2.5 text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          <img
            src="/src/assets/images/meditrack_logo_1795630286027.jpg"
            alt="MediTrack logo"
            width={34}
            height={34}
            referrerPolicy="no-referrer"
            className="w-8 h-8 rounded-lg object-contain bg-white border border-slate-200/80"
          />
          <span>MediTrack</span>
        </button>

        {/* Zone 2: 5 concise single-line navigation links */}
        <nav
          aria-label="Primary Navigation"
          className="hidden md:flex items-center gap-6"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                aria-current={isActive ? "page" : undefined}
                className={`py-2 text-sm font-medium whitespace-nowrap shrink-0 transition-colors border-b-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${
                  isActive
                    ? "text-blue-700 border-blue-700"
                    : "text-slate-600 border-transparent hover:text-slate-900 hover:border-slate-300"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 primary action button */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onOpenPickupModal}
            className="px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            Request Pickup
          </button>
        </div>
      </div>

      {/* Compact mobile navigation row */}
      <nav
        aria-label="Mobile Navigation"
        className="md:hidden flex items-center justify-between gap-2.5 px-3 overflow-x-auto border-t border-slate-100 bg-slate-50/80"
      >
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              aria-current={isActive ? "page" : undefined}
              className={`py-2.5 text-xs font-medium whitespace-nowrap shrink-0 border-b-2 ${
                isActive
                  ? "text-blue-700 border-blue-700"
                  : "text-slate-600 border-transparent"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
