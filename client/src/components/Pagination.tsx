import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Shared pager for the list pages. Client-side: the lists are already in the
 * query cache, so paging is instant — this exists so a 120-item grid doesn't
 * render as one endless scroll.
 */
export function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-6 flex items-center justify-center gap-4" data-testid="pagination">
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        data-testid="button-page-prev"
      >
        <ChevronLeft size={14} className="mr-1" />
        Previous
      </Button>
      <span className="text-xs text-muted-foreground tabular">
        Page {page} of {totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
        data-testid="button-page-next"
      >
        Next
        <ChevronRight size={14} className="ml-1" />
      </Button>
    </div>
  );
}
