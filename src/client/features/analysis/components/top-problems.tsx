import type { Finding } from "../../../../shared/audit-types";
import { FindingCard } from "./finding-card";

export function TopProblems({ problems }: { problems: Finding[] }) {
  return (
    <section className="mt-8 sm:mt-12" aria-labelledby="top-problems-heading">
      <h2
        id="top-problems-heading"
        className="text-xl font-semibold tracking-tight text-neutral-50"
      >
        Top problems
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
        The three highest-priority issues identified by the audit.
      </p>
      <ol className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {problems.map((problem, index) => (
          <li key={problem.title}>
            <FindingCard finding={problem} rank={index + 1} />
          </li>
        ))}
      </ol>
    </section>
  );
}
