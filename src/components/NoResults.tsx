import { SearchX } from 'lucide-react';

export function NoResults({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center mb-4">
        <SearchX size={24} className="text-gray-300" />
      </div>
      <h3 className="text-sm font-semibold text-gray-900 mb-1">
        No integrations found
      </h3>
      <p className="text-sm text-gray-400 max-w-xs">
        {query
          ? `No results for "${query}". Try a different search term or category.`
          : 'No integrations match this category. Try selecting "All".'}
      </p>
    </div>
  );
}
