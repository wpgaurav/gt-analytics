import React from "react";

interface PaginationButtonsProps {
    page: number;
    hasMore: boolean;
    handlePagination: (page: number) => void;
}

const PaginationButtons: React.FC<PaginationButtonsProps> = ({
    page,
    hasMore,
    handlePagination,
}) => {
    const canGoBack = page > 1;

    return (
        <nav className="pager" aria-label="Pagination">
            <span className="pager__label">Page {page}</span>
            <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => canGoBack && handlePagination(page - 1)}
                disabled={!canGoBack}
                aria-label="Previous page"
            >
                Previous
            </button>
            <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => hasMore && handlePagination(page + 1)}
                disabled={!hasMore}
                aria-label="Next page"
            >
                Next
            </button>
        </nav>
    );
};

export default PaginationButtons;
