import { CATEGORY_LABELS } from '@/data/integrations';
import type { FilterChip } from '@/types';

interface CategoryFiltersProps {
  activeFilter: string;
  onFilterChange: (filter: string) => void;
  counts?: Record<string, number>;
}

export function CategoryFilters({
  activeFilter,
  onFilterChange,
}: CategoryFiltersProps) {
  const chips: FilterChip[] = [
    { id: 'all', label: 'All' },
    ...Object.entries(CATEGORY_LABELS)
      .filter(([id]) => id !== 'all')
      .map(([id, label]) => ({ id: id as string, label })),
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip) => {
        const active = activeFilter === chip.id;
        return (
          <button
            key={chip.id}
            onClick={() => onFilterChange(chip.id)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all duration-200 border ${
              active
                ? 'bg-gray-900 text-white border-gray-900 shadow-sm'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:text-gray-900'
            }`}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
