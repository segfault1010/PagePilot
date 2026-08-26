import type { CategoryReport } from "@pagepilot/contracts";
import { CategoryCard } from "./category-card";

export function CategoryGrid({ categories }: { categories: CategoryReport[] }) {
  return (
    <section className="mt-12 sm:mt-14" aria-labelledby="categories-heading">
      <h2
        id="categories-heading"
        className="text-xl font-semibold tracking-tight text-neutral-50"
      >
        Category scores
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
        How the page performs across the seven areas that shape landing-page
        UX.
      </p>
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {categories.map((category) => (
          <CategoryCard key={category.category} category={category} />
        ))}
      </div>
    </section>
  );
}
